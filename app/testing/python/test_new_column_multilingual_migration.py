"""Exercise the dataset language default on disposable PostgreSQL only."""
from pathlib import Path
from test_field_settings_language_seed import database

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / "server_tools/migrations/20260912000002_add_new_column_multilingual_default.sql"

def test_new_language_default_preserves_existing_columns_and_rows(database):
    database("""
        CREATE TABLE system_db_tables (table_uid integer PRIMARY KEY, table_name text);
        CREATE TABLE system_column_details (table_uid integer, column_name text, is_multilingual boolean);
        CREATE TABLE existing_content (title text, link text);
        INSERT INTO system_db_tables VALUES (1,'existing_content'),(2,'plain_content');
        INSERT INTO system_column_details VALUES (1,'title',true),(1,'link',false),(2,'title',false);
        INSERT INTO existing_content VALUES ('Original title','https://example.test/');
    """)
    database(MIGRATION.read_text())
    assert database("SELECT count(*) FROM system_db_tables WHERE new_columns_multilingual IS NULL") == "2"
    assert database("SELECT column_name||':'||is_multilingual FROM system_column_details ORDER BY table_uid,column_name") == "link:false\ntitle:true\ntitle:false"
    assert database("SELECT title||'|'||link FROM existing_content") == "Original title|https://example.test/"
    query = """SELECT dt.table_uid || ':' || COALESCE(dt.new_columns_multilingual, EXISTS (
        SELECT 1 FROM system_column_details c WHERE c.table_uid=dt.table_uid AND c.is_multilingual))
        FROM system_db_tables dt ORDER BY dt.table_uid"""
    assert database(query) == "1:true\n2:false"
    database("UPDATE system_db_tables SET new_columns_multilingual=false WHERE table_uid=1")
    database(MIGRATION.read_text())
    assert database(query) == "1:false\n2:false"
