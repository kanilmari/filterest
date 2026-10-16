"""test_lang_key_archiving_paused_language_seed.py
Verify fi/en pause copy and equal bootstrap/upgrade language-key state.
Connect the reviewed seed migration, catalogue and generated bootstrap to disposable PostgreSQL.
Protect authored translations, other languages, evidence rows and repeatable upgrades.
"""
import hashlib
import json
from pathlib import Path
import re

import pytest

from test_field_settings_language_seed import database  # noqa: F401

APP = Path(__file__).resolve().parents[2]
NAME = '20261015000004_seed_lang_key_archiving_paused_language_keys.sql'
MIGRATION = APP / 'server_tools/migrations' / NAME
OWNER = '20261015000099_record_database_release_9_12_0.sql'
KEYS = {'consistency_orphan_archiving_paused', 'consistency_synthetic_key_archiving_paused',
        'consistency_orphan_age_days', 'consistency_lang_key_counting_source'}


def reviewed_rows():
    return [re.findall(r"'((?:''|[^'])*)'", line)
            for line in MIGRATION.read_text().split('), written AS (')[0].splitlines()
            if line.startswith("    ('")]


def test_pause_copy_is_fi_en_only_and_in_bootstrap_catalogue():
    source = MIGRATION.read_text()
    rows = reviewed_rows()
    assert {row[0] for row in rows} == KEYS
    assert all(len(row) == 3 and all(value.strip() for value in row) for row in rows)
    assert "(VALUES ('fi', s.fi), ('en', s.en))" in source
    assert '-- VERSION_DB: 9.12.0' in source
    assert '-- VERSION_DB_OWNER: ' + OWNER in source and NAME < OWNER
    assert 'system_db_version' not in source
    assert source in (APP / 'server_tools/public_bootstrap/seed_data.sql').read_text()
    assert NAME in (APP / 'server_tools/public_bootstrap/generate_bootstrap.py').read_text()
    manifest = json.loads((APP / 'server_tools/public_bootstrap/manifest.json').read_text())
    assert manifest['source_files']['filterest/app/server_tools/migrations/' + NAME]['sha256'] == hashlib.sha256(MIGRATION.read_bytes()).hexdigest()
    producer = (APP / 'backend/core_components/system_table_tools/lang_key_consistency_checks.go').read_text()
    for key, fi, en in rows:
        assert key in producer
        assert fi not in producer and en not in producer
    assert not re.search(r"'ch'|'yue'|'zh-[^']+'", source)


def initialize_languages(database):
    database("CREATE TABLE system_languages(language_code text PRIMARY KEY); "
             "INSERT INTO system_languages VALUES ('fi'),('en'),('sv'); "
             "ALTER TABLE system_lang_key_translations ADD FOREIGN KEY(language_code) REFERENCES system_languages;")


def state(database):
    return json.loads(database("SELECT json_build_object('keys', "
        "(SELECT json_agg(k ORDER BY lang_key) FROM "
        "(SELECT lang_key,fi,en,ch,yue,creation_spec FROM system_lang_keys) k), "
        "'translations',(SELECT json_agg(t ORDER BY lang_key,language_code) FROM "
        "(SELECT k.lang_key,t.language_code,t.translation,t.source_kind,t.review_status "
        "FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id) t), "
        "'sources',(SELECT json_agg(s ORDER BY lang_key) FROM "
        "(SELECT k.lang_key,s.source_type,s.source_high,s.source_low,s.usage_explanation "
        "FROM system_lang_key_sources s JOIN system_lang_keys k ON k.id=s.lang_key_id) s));"))


def test_pause_seed_fresh_bootstrap_equals_upgrade_postgres(database):
    initialize_languages(database)
    source = MIGRATION.read_text()
    bootstrap = (APP / 'server_tools/public_bootstrap/seed_data.sql').read_text()
    start = bootstrap.index('-- ' + NAME)
    database(bootstrap[start:start + len(source)])
    fresh = state(database)
    assert len(fresh['keys']) == 4 and len(fresh['translations']) == 8 and len(fresh['sources']) == 4
    assert {row['language_code'] for row in fresh['translations']} == {'fi', 'en'}
    database("TRUNCATE system_lang_key_sources,system_lang_key_translations,system_lang_keys;")
    database(source)
    assert state(database) == fresh
    database(source)
    assert state(database) == fresh
    assert database('SELECT count(*) FROM system_db_version') == '0'


@pytest.mark.parametrize('language', ['fi', 'en'])
def test_pause_seed_upgrade_preserves_authored_copy_and_other_languages_postgres(database, language):
    initialize_languages(database)
    database("INSERT INTO system_lang_keys(lang_key,fi,en,ch,yue,creation_spec) VALUES "
             "('consistency_orphan_archiving_paused','',NULL,'existing ch','existing yue','site context'); "
             f"UPDATE system_lang_keys SET {language}='  site legacy  '; "
             "INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status) "
             "SELECT id,code,'  site translation  ','manual','custom' FROM system_lang_keys "
             "CROSS JOIN (VALUES ('fi'),('en'),('sv')) languages(code);")
    database(MIGRATION.read_text())
    before = state(database)
    database(MIGRATION.read_text())
    assert state(database) == before
    key = next(row for row in before['keys'] if row['lang_key'] == 'consistency_orphan_archiving_paused')
    assert key[language] == '  site legacy  ' and key['creation_spec'] == 'site context'
    assert key['ch'] == 'existing ch' and key['yue'] == 'existing yue'
    assert all(row['translation'] == '  site translation  ' and row['review_status'] == 'custom'
               for row in before['translations'] if row['lang_key'] == key['lang_key'])
    assert sum(row['language_code'] == 'sv' for row in before['translations']) == 1
