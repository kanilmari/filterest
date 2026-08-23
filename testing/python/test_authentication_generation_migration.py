"""Static contracts for per-user authentication generation and public bootstrap support."""

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    PROJECT_ROOT
    / "server_tools"
    / "migrations"
    / "20260824000001_add_user_auth_generation.sql"
)
PUBLIC_RUNTIME_SCHEMA = (
    PROJECT_ROOT
    / "server_tools"
    / "public_slice_export"
    / "public_bootstrap"
    / "runtime.schema.sql"
)


def test_authentication_generation_migration_owns_db_9_6_2() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "-- VERSION_DB: 9.6.2" in sql
    assert sql.count("-- VERSION_DB:") == 1
    assert sql.count("INSERT INTO public.system_db_version") == 1
    assert "to_regclass('restricted.users_restricted') IS NULL" in sql
    assert "ADD COLUMN IF NOT EXISTS authentication_generation bigint NOT NULL DEFAULT 1" in sql
    assert "CHECK (authentication_generation >= 1)" in sql
    assert "WHERE authentication_generation < 1" in sql


def test_public_bootstrap_contains_authentication_generation_contract() -> None:
    sql = PUBLIC_RUNTIME_SCHEMA.read_text(encoding="utf-8")

    assert "ALTER TABLE restricted.users_restricted" in sql
    assert "ADD COLUMN IF NOT EXISTS authentication_generation bigint NOT NULL DEFAULT 1" in sql
    assert "users_restricted_authentication_generation_positive" in sql
    assert "CHECK (authentication_generation >= 1)" in sql
