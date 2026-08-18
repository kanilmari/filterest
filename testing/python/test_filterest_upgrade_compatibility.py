"""Static upgrade contracts for older generated Filterest installations."""

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]

FIRST_RUN_MIGRATIONS = (
    "20260803000001_add_first_run_admin_setup.sql",
    "20260804000001_add_first_run_environment_and_login_verification.sql",
    "20260804000002_add_first_run_site_identity.sql",
)


def test_first_run_migrations_do_not_require_private_value_type_catalog() -> None:
    migration_root = REPO_ROOT / "server_tools" / "migrations"

    for filename in FIRST_RUN_MIGRATIONS:
        source = (migration_root / filename).read_text(encoding="utf-8")
        executable_sql = "\n".join(
            line for line in source.splitlines() if not line.lstrip().startswith("--")
        )
        assert "system_config_value_data_types" not in executable_sql, filename
        assert "value_type" not in executable_sql, filename


def test_public_generator_embeds_release_identity_in_runtime_images() -> None:
    generator = (
        REPO_ROOT
        / "server_tools"
        / "public_slice_export"
        / "generate_filterest_public_repo.sh"
    ).read_text(encoding="utf-8")

    assert "COPY BUILD_IDENTITY.json ./BUILD_IDENTITY.json" in generator
    assert (
        "COPY server_tools/versioning/release_ledger.v1.jsonl "
        "./server_tools/versioning/release_ledger.v1.jsonl"
    ) in generator
