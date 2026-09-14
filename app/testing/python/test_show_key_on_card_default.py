"""Contract for inherited new label metadata in native and public installs."""

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    REPO_ROOT
    / "server_tools"
    / "migrations"
    / "20260817000004_default_card_field_labels_off.sql"
)
INHERIT_MIGRATION = REPO_ROOT / "server_tools/migrations/20260914000005_inherit_card_field_labels.sql"
PUBLIC_SCHEMA_SOURCE = REPO_ROOT / "server_tools/public_bootstrap/source/base.schema.sql"
PUBLIC_SUPPORTED_VIEWS = REPO_ROOT / "server_tools/public_bootstrap/source/column_supported_views.schema.sql"


def test_native_migration_changes_only_the_default():
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "ALTER COLUMN show_key_on_card SET DEFAULT FALSE" in sql
    assert "UPDATE public.system_column_details" not in sql


def test_public_first_run_and_upgrade_keep_new_labels_inherited():
    source = PUBLIC_SCHEMA_SOURCE.read_text(encoding="utf-8")
    upgrade = INHERIT_MIGRATION.read_text(encoding="utf-8")
    supported_views = PUBLIC_SUPPORTED_VIEWS.read_text(encoding="utf-8")

    assert "show_key_on_card boolean," in source
    assert "show_key_on_card boolean DEFAULT" not in source
    assert "ALTER COLUMN show_key_on_card DROP DEFAULT" in upgrade
    assert "UPDATE public.system_column_details" not in upgrade
    assert "public.resolve_card_label_visibility" in supported_views
    assert "public.resolve_card_label_visibility" in upgrade
