"""Static contract for the admin-owned table and field embedding policy."""

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_SOURCE_ROOT = (
    REPO_ROOT / "filterest"
    if (REPO_ROOT / "filterest/go.mod").is_file()
    else REPO_ROOT
)
MIGRATION = (
    REPO_ROOT
    / "server_tools"
    / "migrations"
    / "20260817000001_add_dataset_embedding_policy_defaults.sql"
)
POLICY_SOURCE = (
    PUBLIC_SOURCE_ROOT
    / "backend"
    / "core_components"
    / "dynamic_table_tools"
    / "ai_features"
    / "embedding_source_policy.go"
)
PRIVATE_GENERATOR_RUNTIME_SCHEMA = (
    PUBLIC_SOURCE_ROOT / "server_tools/public_bootstrap/source/runtime.schema.sql"
)
PRIVATE_GENERATOR_APP_SEED = (
    PUBLIC_SOURCE_ROOT / "server_tools/public_bootstrap/source/app_tables.seed.sql"
)
PRIVATE_GENERATOR_LANGUAGE_SEED = (
    PUBLIC_SOURCE_ROOT / "server_tools/public_bootstrap/source/app_tables.lang_keys.sql"
)
GENERATED_PUBLIC_SCHEMA = PUBLIC_SOURCE_ROOT / "server_tools/public_bootstrap/schema.sql"
GENERATED_PUBLIC_SEED = PUBLIC_SOURCE_ROOT / "server_tools/public_bootstrap/seed_data.sql"
PUBLIC_RUNTIME_SCHEMA = (
    PRIVATE_GENERATOR_RUNTIME_SCHEMA
    if PRIVATE_GENERATOR_RUNTIME_SCHEMA.is_file()
    else GENERATED_PUBLIC_SCHEMA
)
PUBLIC_APP_SEED = (
    PRIVATE_GENERATOR_APP_SEED
    if PRIVATE_GENERATOR_APP_SEED.is_file()
    else GENERATED_PUBLIC_SEED
)
PUBLIC_LANGUAGE_SEED = (
    PRIVATE_GENERATOR_LANGUAGE_SEED
    if PRIVATE_GENERATOR_LANGUAGE_SEED.is_file()
    else GENERATED_PUBLIC_SEED
)


def test_dataset_policy_defaults_are_explicit_and_preserve_used_policy():
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "external_embedding_enabled BOOLEAN NOT NULL DEFAULT FALSE" in sql
    assert "external_embedding_policy_configured BOOLEAN NOT NULL DEFAULT FALSE" in sql
    assert "columns.external_embedding_allowed IS TRUE" in sql
    assert "external_embedding_enabled = TRUE" in sql
    assert "external_embedding_policy_configured = TRUE" in sql


def test_restricted_schema_is_not_a_policy_candidate():
    source = POLICY_SOURCE.read_text(encoding="utf-8")

    assert "COALESCE(NULLIF(schema_name, ''), 'public') = 'public'" in source
    assert "isc.table_schema = COALESCE(NULLIF(sdt.schema_name, ''), 'public')" in source
    assert "information_schema.columns" in source


def test_fresh_public_bootstrap_contains_the_complete_embedding_policy_runtime():
    schema = PUBLIC_RUNTIME_SCHEMA.read_text(encoding="utf-8")
    seed = PUBLIC_APP_SEED.read_text(encoding="utf-8")
    language_seed = PUBLIC_LANGUAGE_SEED.read_text(encoding="utf-8")

    assert "external_embedding_allowed BOOLEAN NOT NULL DEFAULT FALSE" in schema
    assert "external_embedding_enabled BOOLEAN NOT NULL DEFAULT FALSE" in schema
    assert "external_embedding_policy_configured BOOLEAN NOT NULL DEFAULT FALSE" in schema
    assert "CREATE TABLE IF NOT EXISTS public.system_embedding_refresh_jobs" in schema
    assert "idx_system_embedding_refresh_jobs_claim" in schema
    assert "'system_embedding_refresh_jobs'" in seed
    assert "'external_embedding_allowed'" in seed
    assert "'external_embedding_enabled'" in seed
    assert "'external_embedding_policy_configured'" in seed

    for lang_key in (
        "embedding_external_fields",
        "embedding_enable_dataset",
        "embedding_external_warning",
        "embedding_save_field_policy",
        "embedding_field_policy_saved",
    ):
        assert f"('{lang_key}'" in language_seed
