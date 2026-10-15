"""test_article_view_access_language_seed.py
Verify article-access copy, bootstrap inclusion and safe replay.
Connect the text-only migration to existing disposable PostgreSQL fixtures.
Keep view/grant data out of this multilingual interface change.
"""
import json
from pathlib import Path
import re

from test_field_settings_language_seed import database  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / 'server_tools/migrations/20261014000001_seed_article_view_access_language_keys.sql'
OWNER = '20261014000099_record_database_release_9_11_2.sql'
KEYS = {'article_view_permission_missing', 'view_group_permission_missing',
        'view_group_open_permissions', 'view_group_permissions_unavailable'}


def test_reviewed_copy_has_supported_languages_and_no_permission_mutations():
    source = MIGRATION.read_text()
    rows = [re.findall(r"'((?:''|[^'])*)'", line) for line in source.split('), written AS (')[0].splitlines()
            if line.startswith("    ('")]
    assert {row[0] for row in rows} == KEYS
    assert all(len(row) == 6 and all(value.strip() for value in row) for row in rows)
    assert 'system_group_table_func_rights' not in source
    assert 'system_functions' not in source
    assert '-- VERSION_DB: 9.11.2' in source
    # The release record owns the version row; the bootstrap writes its own (no duplicate row).
    assert '-- VERSION_DB_OWNER: ' + OWNER in source and MIGRATION.name < OWNER
    assert 'system_db_version' not in source
    assert source in (APP / 'server_tools/public_bootstrap/seed_data.sql').read_text()
    for row in rows:
        owner = (APP / 'frontend/core_components/table_views/card_view/article_view_access.js'
                 if row[0] == 'article_view_permission_missing'
                 else APP / 'frontend/core_components/admin_tools/view_field_assignments_copy.js')
        for value in (row[1], row[2], row[3], row[5]):
            assert value in owner.read_text()


def snapshot(database):
    return json.loads(database("SELECT json_build_object('keys', "
        "(SELECT json_agg(k ORDER BY id) FROM (SELECT k.*,xmin::text AS tuple FROM system_lang_keys k) k), "
        "'translations',(SELECT json_agg(t ORDER BY lang_key_id,language_code) "
        "FROM (SELECT t.*,xmin::text AS tuple FROM system_lang_key_translations t) t), "
        "'sources',(SELECT json_agg(s ORDER BY lang_key_id) FROM system_lang_key_sources s));"))


def test_article_access_copy_preserves_site_text_and_replays_on_disposable_postgres(database):
    database("CREATE TABLE system_languages(language_code text PRIMARY KEY); "
             "INSERT INTO system_languages VALUES ('fi'),('en'),('zh-CN'),('zh-TW'),('zh-HK'); "
             "ALTER TABLE system_lang_key_translations ADD FOREIGN KEY(language_code) REFERENCES system_languages;")
    database(MIGRATION.read_text())
    assert database('SELECT count(*) FROM system_lang_keys') == '4'
    assert database('SELECT count(*) FROM system_lang_key_translations') == '20'
    database("UPDATE system_lang_keys SET fi='  Oma selitys  ' WHERE lang_key='article_view_permission_missing'; "
             "UPDATE system_lang_key_translations SET translation='  Reviewed site copy  ',review_status='custom' "
             "WHERE language_code='en';")
    before = snapshot(database)
    database(MIGRATION.read_text())
    assert snapshot(database) == before
    assert database("SELECT count(*) FROM system_db_version WHERE version='9.11.2'") == '0'
    owner = (MIGRATION.parent / OWNER).read_text()
    database(owner)
    database(owner)
    assert database("SELECT count(*) FROM system_db_version WHERE version='9.11.2'") == '1'
