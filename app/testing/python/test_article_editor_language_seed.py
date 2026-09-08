"""Verify article-editor language copy on an isolated PostgreSQL fixture.

Connects the standalone language source and its incremental migration.
Protects reviewed site copy, normalized language foreign keys and idempotence.
"""
from pathlib import Path
from test_field_settings_language_seed import database

APP = Path(__file__).resolve().parents[2]
SEED = APP / "server_tools/public_bootstrap/source/article_editor.lang_keys.sql"
MIGRATION = APP / "server_tools/migrations/20260908000009_seed_article_editor_copy.sql"

def snapshot(database):
    return database("""SELECT jsonb_build_object(
        'keys',(SELECT jsonb_agg(to_jsonb(k) ORDER BY id) FROM system_lang_keys k),
        'translations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY lang_key_id,language_code) FROM system_lang_key_translations t),
        'versions',(SELECT jsonb_agg(to_jsonb(v)) FROM system_db_version v)
    )""")

def test_fresh_seed_and_upgrade_preserve_reviewed_copy_and_repeat(database):
    database("""
      CREATE TABLE system_languages(language_code text PRIMARY KEY);
      INSERT INTO system_languages VALUES ('fi'),('en'),('zh-CN'),('zh-TW'),('zh-HK');
      ALTER TABLE system_lang_key_translations ADD FOREIGN KEY(language_code) REFERENCES system_languages(language_code);
    """)
    database(SEED.read_text())
    assert database("SELECT count(*) FROM system_lang_keys") == "5"
    assert database("SELECT count(*) FROM system_lang_key_translations") == "10"
    assert database("SELECT count(*) FROM system_db_version") == "0"
    first = snapshot(database)
    database(SEED.read_text())
    assert snapshot(database) == first
    database("""
        UPDATE system_lang_keys SET fi='  Site wording  ', creation_spec='Own context'
          WHERE lang_key='article_edit_languages';
        UPDATE system_lang_key_translations SET translation='  Reviewed wording  ',review_status='custom'
          WHERE language_code='fi';
    """)
    before = database("SELECT fi||creation_spec FROM system_lang_keys WHERE lang_key='article_edit_languages'")
    translations = database("SELECT jsonb_agg(to_jsonb(t) ORDER BY lang_key_id) FROM system_lang_key_translations t WHERE language_code='fi'")
    database(MIGRATION.read_text())
    assert database("SELECT fi||creation_spec FROM system_lang_keys WHERE lang_key='article_edit_languages'") == before
    assert database("SELECT jsonb_agg(to_jsonb(t) ORDER BY lang_key_id) FROM system_lang_key_translations t WHERE language_code='fi'") == translations
    assert database("SELECT count(*) FROM system_db_version WHERE version='9.7.12'") == "1"
    upgraded = snapshot(database)
    database(MIGRATION.read_text())
    assert snapshot(database) == upgraded
    assert SEED.read_text() in MIGRATION.read_text()
