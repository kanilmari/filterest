"""test_dataset_default_view_language_seed.py
Protect the default-view copy migration and its fresh-install inclusion.
Connect the release owner, normalized dictionaries and disposable replay fixture.
Keep administrator access out of a translation-only database release.
"""
from pathlib import Path
import re

from test_field_settings_language_seed import database  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / 'server_tools/migrations/20261015000003_seed_dataset_default_view_language_keys.sql'
OWNER = '20261015000099_record_database_release_9_12_0.sql'
KEYS = {'dataset_default_view_for', 'dataset_default_view_saved', 'dataset_default_view_error'}


def test_default_view_copy_is_complete_and_does_not_grant_permissions():
    source = MIGRATION.read_text()
    rows = [re.findall(r"'((?:''|[^'])*)'", line) for line in source.split('), written AS (')[0].splitlines()
            if line.startswith("    ('")]
    assert {row[0] for row in rows} == KEYS
    assert all(len(row) == 6 and all(value.strip() for value in row) for row in rows)
    assert '-- VERSION_DB: 9.12.0' in source
    assert '-- VERSION_DB_OWNER: ' + OWNER in source and MIGRATION.name < OWNER
    assert source in (APP / 'server_tools/public_bootstrap/seed_data.sql').read_text()
    for table in ('system_functions', 'system_group_table_func_rights', 'system_db_tables', 'system_db_version'):
        assert table not in source
    current = (APP / 'VERSION_DB').read_text().strip()
    assert (APP / f'server_tools/versioning/schema_snapshots/db-{current}.sql').read_bytes() == (
        APP / 'server_tools/public_bootstrap/schema.sql').read_bytes()


def test_default_view_copy_replay_preserves_site_translations_postgres(database):
    database("CREATE TABLE system_languages(language_code text PRIMARY KEY); "
             "INSERT INTO system_languages VALUES ('fi'),('en'),('zh-CN'),('zh-TW'),('zh-HK');")
    source = MIGRATION.read_text()
    database(source)
    assert database('SELECT count(*) FROM system_lang_keys') == '3'
    assert database('SELECT count(*) FROM system_lang_key_translations') == '15'
    database("UPDATE system_lang_keys SET fi='Oma teksti' WHERE lang_key='dataset_default_view_for'; "
             "UPDATE system_lang_key_translations SET translation='Site wording' WHERE language_code='en';")
    database(source)
    assert database("SELECT fi FROM system_lang_keys WHERE lang_key='dataset_default_view_for'") == 'Oma teksti'
    assert database("SELECT count(*) FROM system_lang_key_translations WHERE language_code='en' AND translation='Site wording'") == '3'
    owner = (MIGRATION.parent / OWNER).read_text()
    database(owner); database(owner)
    assert database("SELECT count(*) FROM system_db_version WHERE version='9.12.0'") == '1'
