"""Verify shell recovery copy on disposable PostgreSQL install/upgrade fixtures.

Uses the existing Unix-socket-only cluster fixture, never an installation DB.
Protects authored wording, the Finnish/English-only contract and repeatability.
"""
from pathlib import Path
import json
import re
from test_field_settings_language_seed import database  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / 'server_tools/migrations/20261005000060_seed_shell_boot_recovery_language_keys.sql'
READER = APP / 'backend/core_components/lang/shell_boot_translation_reader.go'
BOOTSTRAP = APP / 'server_tools/public_bootstrap'


def authored_rows():
    block = MIGRATION.read_text().split('WITH authored_keys', 1)[1].split('), written_keys', 1)[0]
    return {key: (fi, en) for key, fi, en in re.findall(r"\('([^']+)', '([^']+)', '([^']+)'\)", block)}


def test_bootstrap_and_emergency_copy_share_the_reviewed_seed():
    rows = authored_rows()
    assert len(rows) == 6
    source = READER.read_text()
    for key, copy in rows.items():
        match = re.search(r'"' + key + r'":\s*\{"([^"]+)", "([^"]+)"\}', source)
        assert match and match.groups() == copy
    seed = (BOOTSTRAP / 'seed_data.sql').read_text()
    assert MIGRATION.read_text() in seed
    assert f"('{MIGRATION.name}')" in seed
    assert MIGRATION.name in (BOOTSTRAP / 'generate_bootstrap.py').read_text()
    assert (APP / 'server_tools/versioning/schema_snapshots/db-9.10.0.sql').read_bytes() == (BOOTSTRAP / 'schema.sql').read_bytes()


def test_seed_fills_only_empty_values_and_is_idempotent(database):  # noqa: F811
    database("CREATE TABLE system_languages (language_code TEXT PRIMARY KEY); INSERT INTO system_languages VALUES ('fi'), ('en'), ('fr');")
    database("""
        INSERT INTO system_lang_keys (lang_key, fi, en, creation_spec)
        VALUES ('shell_boot_failed_title', '  Site Finnish  ', '', 'site owned');
        INSERT INTO system_lang_key_translations (lang_key_id, language_code, translation, source_kind, review_status)
        SELECT id, 'fi', 'Reviewed Finnish', 'manual', 'approved'
        FROM system_lang_keys WHERE lang_key = 'shell_boot_failed_title';
    """)
    database(MIGRATION.read_text())
    assert database("SELECT count(*) FROM system_lang_keys WHERE lang_key LIKE 'shell_boot_%'") == '6'
    assert database("SELECT count(*) FROM system_lang_key_translations WHERE language_code NOT IN ('fi','en')") == '0'
    assert database("SELECT fi || '|' || en || '|' || creation_spec FROM system_lang_keys WHERE lang_key='shell_boot_failed_title'") == 'Site Finnish  |The page could not load.|site owned'
    assert database("SELECT translation FROM system_lang_key_translations WHERE language_code='fi' AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='shell_boot_failed_title')") == 'Reviewed Finnish'
    for key, (fi, en) in authored_rows().items():
        if key == 'shell_boot_failed_title': continue
        assert json.loads(database(f"SELECT json_build_array(fi,en) FROM system_lang_keys WHERE lang_key='{key}'")) == [fi, en]
    snapshot = database("SELECT json_build_array((SELECT json_agg(k ORDER BY id) FROM system_lang_keys k), (SELECT json_agg(t ORDER BY lang_key_id,language_code) FROM system_lang_key_translations t))")
    database(MIGRATION.read_text())
    assert database("SELECT json_build_array((SELECT json_agg(k ORDER BY id) FROM system_lang_keys k), (SELECT json_agg(t ORDER BY lang_key_id,language_code) FROM system_lang_key_translations t))") == snapshot
    assert database("SELECT count(*) FROM system_db_version") == '0'
