"""test_legacy_finnish_sort_labels.py
Prove the exact legacy-Finnish sort-label repair in isolated PostgreSQL and bootstrap.
Connect WO50's second migration, both dictionary stores and release ownership.
Preserve site-authored Finnish (serlog.com's own wording), English, other locales and replay.
"""
import hashlib
import json
from pathlib import Path

import pytest

from bootstrap_contract_assertions import assert_bootstrap_baseline
from test_field_settings_language_seed import database  # noqa: F401
from test_hero_sort_language_seed import language_database, snapshot, quote  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / 'server_tools/migrations/20261029000002_replace_legacy_finnish_sort_labels.sql'
OWNER = '20261029000099_record_database_release_9_13_2.sql'
LEGACY = {
    'sort_newest': ('Lajittele uusimmat', 'Uusimmat ensin'),
    'sort_oldest': ('Lajittele vanhimmat', 'Vanhimmat ensin'),
    'sort_updated_newest': ('Lajittele päivitetyt uusimmat', 'Viimeksi päivitetyt ensin'),
    'sort_updated_oldest': ('Lajittele päivitetyt vanhimmat', 'Vanhimmin päivitetyt ensin'),
}
# serlog.com's own wording since 14.10. (coordinator's read-only production read, 19.10.): must stay byte-for-byte.
SERLOG = {
    'sort_newest': ('Uusimmat', 'Newest'),
    'sort_oldest': ('Vanhimmat', 'Oldest'),
    'sort_updated_newest': ('Juuri päivitetyt', 'Most recently updated'),
    'sort_updated_oldest': ('Kauiten sitten päivitetyt', 'Least recently updated'),
}


def test_packaging_owner_marker_and_bootstrap():
    sql = MIGRATION.read_text()
    assert sql.splitlines()[0] == '-- ' + MIGRATION.name
    assert '-- VERSION_DB: 9.13.2' in sql
    assert '-- VERSION_DB_OWNER: ' + OWNER in sql and MIGRATION.name < OWNER
    assert '-- COMPLETION_MARKER: wo50_legacy_finnish_sort_labels' in sql
    assert 'system_db_version' not in sql and 'btrim' not in sql
    for key, (legacy, fi) in LEGACY.items():
        assert f"('{key}', '{legacy}', '{fi}')" in sql
    bootstrap = APP / 'server_tools/public_bootstrap'
    assert sql in (bootstrap / 'seed_data.sql').read_text()
    assert_bootstrap_baseline((bootstrap / 'seed_data.sql').read_text(), MIGRATION)
    assert MIGRATION.name in (bootstrap / 'generate_bootstrap.py').read_text().split('setting_seed_migrations')[0]
    manifest = json.loads((bootstrap / 'manifest.json').read_text())
    assert manifest['source_files'][f'filterest/app/server_tools/migrations/{MIGRATION.name}']['sha256'] == hashlib.sha256(MIGRATION.read_bytes()).hexdigest()


def seed(database, values):
    """values: key -> (fi, en). Both stores get them; other locales get a sentinel."""
    for key, (fi, en) in values.items():
        database(f"""INSERT INTO system_lang_keys(lang_key,fi,en,ch,yue,creation_spec)
            VALUES('{key}',{quote(fi)},{quote(en)},'保留','保留','Site origin');
            INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
            SELECT id,code,CASE code WHEN 'fi' THEN {quote(fi)} WHEN 'en' THEN {quote(en)} ELSE '保留' END,'legacy_fi','approved'
            FROM system_lang_keys CROSS JOIN (VALUES('fi'),('en'),('zh-CN'),('zh-TW'),('zh-HK'),('ch'),('yue')) codes(code)
            WHERE lang_key='{key}';""")


def fi_values(database, key):
    return database(f"""SELECT k.fi || '|' || t.translation FROM system_lang_keys k
        JOIN system_lang_key_translations t ON t.lang_key_id = k.id AND t.language_code = 'fi' WHERE k.lang_key = '{key}'""")


def test_exact_legacy_finnish_labels_are_replaced_in_both_stores(language_database):
    database = language_database
    seed(database, {key: (legacy, 'Newest first') for key, (legacy, _fi) in LEGACY.items()})
    others = "SELECT jsonb_agg(t ORDER BY lang_key_id,language_code) FROM system_lang_key_translations t WHERE language_code <> 'fi'"
    before_others = database(others)
    database(MIGRATION.read_text())
    for key, (_legacy, fi) in LEGACY.items():
        assert fi_values(database, key) == fi + '|' + fi
        assert database(f"SELECT en FROM system_lang_keys WHERE lang_key='{key}'") == 'Newest first'
    assert database(others) == before_others
    assert database("SELECT count(*) FROM system_lang_keys WHERE ch='保留' AND yue='保留' AND creation_spec='Site origin'") == '4'
    before = snapshot(database)
    database(MIGRATION.read_text())  # replay: nothing changes, one completion record
    assert snapshot(database) == before
    assert database("SELECT count(*) FROM system_data_repair_records WHERE migration='wo50_legacy_finnish_sort_labels'") == '1'


def test_serlog_wording_stays_byte_for_byte(language_database):
    database = language_database
    seed(database, SERLOG)
    before = snapshot(database)
    database(MIGRATION.read_text())
    assert json.loads(snapshot(database))[:3] == json.loads(before)[:3]
    for key, (fi, en) in SERLOG.items():
        assert fi_values(database, key) == fi + '|' + fi
        assert database(f"SELECT en FROM system_lang_keys WHERE lang_key='{key}'") == en


@pytest.mark.parametrize('value', [' Lajittele uusimmat', 'Lajittele uusimmat ', 'lajittele uusimmat', 'Lajittele uusimmat!', None, ''])
def test_near_matches_and_blanks_survive(language_database, value):
    database = language_database
    seed(database, {'sort_newest': (value, 'Newest first')})
    before = snapshot(database)
    database(MIGRATION.read_text())
    assert json.loads(snapshot(database))[:3] == json.loads(before)[:3]
