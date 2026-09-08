"""Protect registered SQL views during table-catalog cleanup.

Runs the real cleanup and orphan-detection SQL against disposable PostgreSQL.
Connects registration metadata, PostgreSQL relation kinds, and access grants.
Prevents a live view from disappearing from navigation after a catalog refresh.
"""
from pathlib import Path
import re

from test_field_settings_language_seed import database

APP = Path(__file__).resolve().parents[2]
DELETE_SOURCE = APP / "backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_delete/drop_table_handler.go"
CHECK_SOURCE = APP / "backend/core_components/system_table_tools/database_consistency_check_queries.go"


def test_catalog_refresh_keeps_views_and_their_rights_but_removes_missing_relations(database):
    database("""
        CREATE TABLE example_data (id integer);
        CREATE VIEW example_report AS SELECT id FROM example_data;
        CREATE MATERIALIZED VIEW example_snapshot AS SELECT id FROM example_data;
        CREATE TABLE system_db_tables (id integer, table_uid integer, table_name text, schema_name text);
        CREATE TABLE system_group_table_func_rights (id integer, target_table_uid integer, target_schema_name text);
        CREATE TABLE system_foreign_key_relations_1_m (id integer, source_table_uid integer, target_table_uid integer);
        CREATE TABLE system_foreign_key_relations_m_m (id integer, table_a_uid integer, table_b_uid integer, bridging_table_uid integer);
        INSERT INTO system_db_tables VALUES (1,11,'example_data','public'), (2,22,'example_report','public'),
            (3,33,'removed_data','public'), (4,44,'example_snapshot','public');
        INSERT INTO system_group_table_func_rights VALUES (1,22,'public'),(2,33,'public');
    """)
    source = CHECK_SOURCE.read_text().split("func checkOrphanSystemDbTableRows()", 1)[1]
    check_query = re.search(r"query := `(.*?)`", source, re.S)[1]
    assert database(check_query) == "removed_data|public"
    source = DELETE_SOURCE.read_text().split("func DeleteRemovedTables(", 1)[1]
    cleanup_query = re.search(r"deleteQuery := `(.*?)`", source, re.S)[1]
    database(cleanup_query)
    assert database("SELECT string_agg(table_name, ',' ORDER BY id) FROM system_db_tables") == "example_data,example_report,example_snapshot"
    assert database("SELECT target_table_uid FROM system_group_table_func_rights") == "22"
    database(cleanup_query)
    assert database("SELECT count(*) FROM system_db_tables") == "3"
