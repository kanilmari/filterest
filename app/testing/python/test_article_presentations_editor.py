"""test_article_presentations_editor.py
Verify the editor's copy, bootstrap wiring and preservation of reviewed translations.
Connect article language keys to the existing disposable language fixture.
"""
import hashlib
import json
from pathlib import Path
import re
from test_field_settings_language_seed import database  # noqa: F401
APP = Path(__file__).resolve().parents[2]
SEED = APP / 'server_tools/migrations/20261015000018_seed_article_presentations_language_keys.sql'
SERVICE = APP / 'server_tools/migrations/20261015000017_add_article_presentations_editor.sql'

def copy_rows():
    return [re.findall(r"'((?:''|[^'])*)'", line) for line in SEED.read_text().split('), written AS (')[0].splitlines() if line.startswith("    ('")]

def test_article_editor_copy_and_bootstrap_contract():
    rows = copy_rows()
    assert len(rows) == 39 and len({row[0] for row in rows}) == len(rows)
    assert all(len(row) == 6 and all(value.strip() for value in row) for row in rows)
    for code in ['fi','en','ch','yue','zh','zh-CN','zh-TW','zh-HK']:
        assert f"('{code}'," in SEED.read_text()
    current_db = (APP / 'VERSION_DB').read_text().strip()
    manifest = json.loads((APP / 'server_tools/public_bootstrap/manifest.json').read_text())
    for path in [SEED,SERVICE]:
        assert '-- VERSION_DB: 9.12.0' in path.read_text()
        assert '-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql' in path.read_text()
        assert path.name in manifest['migration_ledger_baseline']
        assert manifest['source_files']['filterest/app/server_tools/migrations/'+path.name]['sha256'] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert SEED.read_text() in (APP / 'server_tools/public_bootstrap/seed_data.sql').read_text()
    assert SERVICE.read_text() in (APP / 'server_tools/public_bootstrap/schema.sql').read_text()
    assert (APP / 'server_tools/public_bootstrap/schema.sql').read_bytes() == (APP / f'server_tools/versioning/schema_snapshots/db-{current_db}.sql').read_bytes()
    assert 'app_save_article_projection' in SERVICE.read_text()
    assert 'SECURITY DEFINER' not in SERVICE.read_text()
    assert 'article_opener_policy=' not in SERVICE.read_text()

def test_article_editor_seed_preserves_reviewed_copy_and_replay(database):
    database("CREATE TABLE system_languages(language_code text PRIMARY KEY); INSERT INTO system_languages VALUES('fi'),('en'),('ch'),('yue'),('zh'),('zh-CN'),('zh-TW'),('zh-HK');")
    database(SEED.read_text())
    assert database('SELECT count(*) FROM system_lang_keys') == str(len(copy_rows()))
    assert database('SELECT count(*) FROM system_lang_key_translations') == str(len(copy_rows())*8)
    database("UPDATE system_lang_keys SET fi='Oma teksti' WHERE lang_key='article_presentations_title'; UPDATE system_lang_key_translations SET translation='Reviewed site copy',review_status='custom' WHERE language_code='en';")
    query = "SELECT jsonb_build_object('keys',(SELECT jsonb_agg(to_jsonb(k) ORDER BY id) FROM system_lang_keys k),'translations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY lang_key_id,language_code) FROM system_lang_key_translations t))"
    before=database(query)
    database(SEED.read_text());assert database(query)==before
