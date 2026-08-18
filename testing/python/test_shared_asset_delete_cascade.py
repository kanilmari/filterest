"""Static contract for shared-asset parent-row delete behavior.

Bridges the asset-linking table creator with the upgrade migration for existing
Filterest databases. It exists to keep cascading deletion narrowly limited to
Filterest-owned ``<parent>_assets`` relations whose upload metadata is enabled.
"""

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    REPO_ROOT
    / "server_tools/migrations/20260817000009_repair_shared_asset_delete_cascade.sql"
)
CREATOR = (
    REPO_ROOT
    / "backend/core_components/dynamic_table_tools/dtt_asset_linking/asset_linking_creator.go"
)
TABLE_BUILDER = (
    REPO_ROOT
    / "backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_create/create_table.go"
)


def test_new_shared_asset_tables_explicitly_request_cascade() -> None:
    creator = CREATOR.read_text(encoding="utf-8")
    builder = TABLE_BUILDER.read_text(encoding="utf-8")

    assert "CascadeDelete:     true" in creator
    assert "if fk.CascadeDelete" in builder
    assert 'query_builder.WriteString(" ON DELETE CASCADE")' in builder


def test_existing_relation_repair_is_scoped_to_managed_asset_tables() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")

    for required_scope in (
        "source_metadata.table_name = target_metadata.table_name || '_assets'",
        "relation_metadata.source_column_name = target_metadata.table_name || '_id'",
        "relation_metadata.target_column_name = 'id'",
        "relation_metadata.target_insert_specs -> 'file_upload' ->> 'enabled'",
        "constraints.confdeltype <> 'c'",
        "array_length(constraints.conkey, 1) = 1",
        "array_length(constraints.confkey, 1) = 1",
    ):
        assert required_scope in sql

    assert "ON DELETE CASCADE" in sql
    assert "DROP TABLE" not in sql
    assert "DELETE FROM" not in sql


def test_repair_quotes_every_discovered_identifier() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "ALTER TABLE %I.%I DROP CONSTRAINT %I" in sql
    assert "ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I)" in sql
    assert "REFERENCES %I.%I (%I) ON DELETE CASCADE" in sql
