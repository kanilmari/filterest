"""Contract for label-free new card metadata in native and public installs."""

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    REPO_ROOT
    / "server_tools"
    / "migrations"
    / "20260817000004_default_card_field_labels_off.sql"
)
PUBLIC_GENERATOR = (
    REPO_ROOT
    / "server_tools"
    / "public_slice_export"
    / "generate_filterest_public_repo.sh"
)


def test_native_migration_changes_only_the_default():
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "ALTER COLUMN show_key_on_card SET DEFAULT FALSE" in sql
    assert "UPDATE public.system_column_details" not in sql


def test_public_first_run_schema_uses_the_same_default():
    source = PUBLIC_GENERATOR.read_text(encoding="utf-8")

    assert "show_key_on_card boolean DEFAULT false" in source
    assert "show_key_on_card boolean DEFAULT true" not in source
