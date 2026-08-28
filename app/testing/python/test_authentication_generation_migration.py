"""Static contracts for per-user authentication generation and public bootstrap support."""

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_SOURCE_ROOT = (
    PROJECT_ROOT / "filterest"
    if (PROJECT_ROOT / "filterest/go.mod").is_file()
    else PROJECT_ROOT
)
MIGRATION = (
    PROJECT_ROOT
    / "server_tools"
    / "migrations"
    / "20260824000001_add_user_auth_generation.sql"
)
PUBLIC_RUNTIME_SCHEMA_CANDIDATES = (
    PUBLIC_SOURCE_ROOT / "server_tools/public_bootstrap/source/runtime.schema.sql",
    PUBLIC_SOURCE_ROOT / "server_tools/public_bootstrap/schema.sql",
)


def public_runtime_schema() -> Path:
    """Resolve the same bootstrap contract in private-source and public layouts."""
    for path in PUBLIC_RUNTIME_SCHEMA_CANDIDATES:
        if path.is_file():
            return path
    raise AssertionError(
        f"expected a public runtime schema in: {PUBLIC_RUNTIME_SCHEMA_CANDIDATES}"
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
    sql = public_runtime_schema().read_text(encoding="utf-8")

    assert "ALTER TABLE restricted.users_restricted" in sql
    assert "ADD COLUMN IF NOT EXISTS authentication_generation bigint NOT NULL DEFAULT 1" in sql
    assert "users_restricted_authentication_generation_positive" in sql
    assert "CHECK (authentication_generation >= 1)" in sql
