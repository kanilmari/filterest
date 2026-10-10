"""python_test_tiers.py
Define reviewed installation/recovery tests and the paths that require them.
Connect pytest category selection and batch planning to one tier policy.
Keep ordinary batches small without dropping lifecycle coverage from nightly runs.
"""

from __future__ import annotations

import argparse
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Iterable


# Reviewed by exercised behavior, not by words such as "restore" in a filename.
# Feature-specific migration/seed checks remain ordinary; these files exercise
# installation orchestration, its shared boundaries, or whole-bootstrap evidence.
HEAVY_INSTALLATION_FILES = {
    "test_application_update_migrations.py": "Update-admission installation and upgrade storage contracts.",
    "test_bootstrap_contract_assertions.py": "Whole-bootstrap migration acceptance and ledger validation.",
    "test_bootstrap_ledger_postgres.py": "Complete fresh-install bootstrap ledger and version proof.",
    "test_bootstrap_seed_shell.py": "Native setup imports, grants and first-admin handoff.",
    "test_current_release_bootstrap.py": "Complete fresh installation and bootstrap import ordering.",
    "test_database_recovery.py": "Backup/restore ordering, packet authentication and failure isolation.",
    "test_database_recovery_postgres.py": "Real disposable-database recovery and rollback.",
    "test_database_recovery_role_scope.py": "Recovery role scope, snapshot races and rollback refusals.",
    "test_database_recovery_update.py": "Whole-update rollback, archive authentication and extraction.",
    "test_development_dependencies.py": "Installation dependency setup and failure receipts.",
    "test_docker_deployment_settings.py": "Docker setup, readiness, identity and network preflight.",
    "test_docker_frontend_build_inputs.py": "Docker image build inputs required for a working installation.",
    "test_docker_storage_deleted_mounts.py": "Compose storage, database initialization and restore contracts.",
    "test_filterest_docker_runner.py": "Portable Docker runner setup, secrets and lifecycle dispatch.",
    "test_filterest_launcher_install_profile.py": "Public launcher setup/start/status installation-profile dispatch.",
    "test_filterest_paths.py": "Portable installation roots and mutable-home isolation/relocation.",
    "test_filterest_upgrade_compatibility.py": "First-run upgrade compatibility for older installations.",
    "test_go_toolchain_installation.py": "Native toolchain installation and untrusted-download refusal.",
    "test_instance_ctl_bash32_compatibility.py": "Instance lifecycle, backup and retirement shell portability.",
    "test_migration_execution_evidence.py": "Migration execution ledger and whole-bootstrap provenance.",
    "test_native_development_ports.py": "Shared native launcher/installer ports and runtime origins.",
    "test_native_lifecycle_roots.py": "Native/Docker installation, updates, locks and lifecycle roots.",
    "test_port_preflight_shutdown.py": "Installer preflight shutdown and process-identity protection.",
    "test_project_python_venv_paths.py": "Installation-owned Python environment selection across layouts.",
    "test_public_bootstrap_independence.py": "Complete public bootstrap generation and validation boundaries.",
    "test_python_bytecode_runtime_paths.py": "Launcher cache writes with immutable application source.",
    "test_python_tool_environment.py": "Public launcher interpreter selection and installation isolation.",
    "test_recovery_archives_relocated_roots.py": "Rollback archive roots and preservation of external disks.",
    "test_recovery_checkout_preflight.py": "Updater checkout refusals before downtime or writes.",
    "test_recovery_content_postgres.py": "Actual backup contents through disposable PostgreSQL transports.",
    "test_recovery_content_sinks.py": "Recovery packet, settings and SQL staging confidentiality.",
    "test_recovery_direct_entrypoints.py": "Direct recovery launcher startup and diagnostic boundaries.",
    "test_recovery_launcher_startup.py": "Ordinary versus recovery launcher/scanner dispatch.",
    "test_recovery_log_before_update.py": "Updater log refusal before shutdown or installation writes.",
    "test_recovery_native_log_startup.py": "Native recovery startup logging and descriptor lifetime.",
    "test_recovery_process_boundaries.py": "Whole-process recovery diagnostic scanning and exit status.",
    "test_recovery_quoted_routes.py": "Recovery lookup and quoted filename diagnostic redaction.",
    "test_recovery_spelling_closure.py": "Recovery diagnostic encodings and chunk-boundary confidentiality.",
    "test_recovery_static_prerequisites.py": "Setup/update/restore prerequisite refusals before mutation.",
    "test_recovery_synchronous_diagnostics.py": "Recovery launchers synchronously drain scanned diagnostics.",
    "test_recovery_tool_cancellation.py": "Recovery tool startup cancellation and cleanup.",
    "test_recovery_writer_permissions.py": "Backup allocation and in-flight recovery writer privacy.",
    "test_runtime_grant_clone_gate.py": "Bootstrap/clone dispatch and import readiness barriers.",
    "test_runtime_grant_restore_barrier.py": "Cold restore validation, swap ordering and failure barriers.",
    "test_sql_identifier_validator.py": "Bootstrap generation refusal before replacing installation inputs.",
    "test_standalone_ctl_stop.py": "Public native lifecycle stop and sibling-process isolation.",
    "test_update_box_checkout_guidance.py": "Launcher-to-Docker update checkout evidence.",
    "test_update_prerequisites_before_downtime.py": "Native/Docker update prerequisites before shutdown.",
    "test_update_verification.py": "Offline update authentication, staging and lock-time rechecks.",
}

# Repository-relative fnmatch globs; '*' also covers nested directories. Keep
# every batch trigger here, including shared test fixtures and tier tooling.
# Callers pass both old and new paths for renames, and deleted paths too.
HEAVY_PATH_PATTERNS = (
    "filterest", "ctl", "app/filterest", "app/ctl",
    "compose*.yml", "compose*.yaml", "docker-compose*.yml", "docker-compose*.yaml",
    "Dockerfile*", ".dockerignore", "app/.dockerignore", "app/docker/*",
    "app/filterest.paths.example", "config/filterest.paths*",
    "app/server_tools/install*.sh", "app/server_tools/setup*.sh",
    "app/server_tools/update*.sh", "app/server_tools/run_filterest*.sh",
    "app/server_tools/scaffold.sh", "app/server_tools/ctl/*",
    "app/server_tools/lib/*", "app/server_tools/db_init/*",
    "app/server_tools/initial_admin_bootstrap/*",
    "app/server_tools/admin_credential_recovery/*",
    "app/server_tools/check_first_cloud_recovery_readiness.sh",
    "app/server_tools/scripts/setup*.sh", "app/server_tools/scripts/*migration*",
    "app/server_tools/public_bootstrap/*", "app/server_tools/public_slice_export/*bootstrap*",
    "app/server_tools/update_verification/*", "app/server_tools/migrations/*",
    "app/server_tools/versioning/*", "app/VERSION_*",
    "app/backend/core_components/migrations/*",
    "app/backend/core_components/startup/migration*",
    "app/backend/core_components/startup/public_bootstrap*",
    "app/backend/core_components/auth/first_run*",
    "app/backend/core_components/application_updates/*",
    "app/backend/core_components/router/*update*",
    "app/backend/core_components/runtime_grant_mutations/application_update*",
    "app/backend/pipeline/access_control/application_update*",
    "app/frontend/core_components/auth/first_run*", "app/frontend/templates/first_run*",
    "app/frontend/core_components/admin_tools/admin_update*",
    "app/frontend/core_components/endpoints/application_update*",
    "app/testing/python/conftest.py", "app/testing/python/python_category_support.py",
    "app/testing/python/python_test_tiers.py", "app/testing/python/test_python_category_support.py",
    "app/testing/python/test_python_test_tiers.py",
    "app/testing/python/installation_fixture_files.py",
    "app/testing/python/recovery_*_probes.py", "app/testing/python/update_verification_fixture.py",
    "app/testing/python/release_bundle_fixture.py", "app/testing/python/bootstrap_contract_assertions.py",
    "app/testing/python/fixtures/docker_runner*",
    # Ordinary feature suites also supply disposable-cluster fixtures to heavy tests.
    "app/testing/python/test_field_settings_language_seed.py",
    "app/testing/python/test_row_actor_support.py",
)


def tier_for_path(path: Path) -> str:
    """Assign one reviewed file to exactly one tier; unknown files are ordinary."""
    return "heavy-installation" if path.name in HEAVY_INSTALLATION_FILES else "ordinary"


def needs_heavy_installation(changed_paths: Iterable[str]) -> bool:
    """Select lifecycle coverage from repository-relative paths without filesystem access.

    Lexical normalization accepts ./ and Windows separators and still works for
    deleted files. Reject absolute/escaping paths instead of silently missing them.
    """
    needs_heavy = False
    for changed_path in changed_paths:
        path = changed_path.replace("\\", "/")
        if path.startswith("/") or (len(path) > 1 and path[1] == ":"):
            raise ValueError("changed paths must be repository-relative")
        parts: list[str] = []
        for part in path.split("/"):
            if part in ("", "."):
                continue
            if part == "..":
                if not parts:
                    raise ValueError("changed paths must stay inside the repository")
                parts.pop()
            else:
                parts.append(part)
        path = "/".join(parts)
        if not path:
            raise ValueError("changed paths must name a file or directory")
        is_heavy_test = (
            path.startswith("app/testing/python/")
            and path.removeprefix("app/testing/python/") in HEAVY_INSTALLATION_FILES
        )
        needs_heavy |= is_heavy_test or any(fnmatchcase(path, pattern) for pattern in HEAVY_PATH_PATTERNS)
    return needs_heavy


def main() -> int:
    """Print a batch's required tier; classification has no installation side effects."""
    parser = argparse.ArgumentParser(description="Print heavy-installation or ordinary for changed paths.")
    parser.add_argument("changed_paths", nargs="*", help="Repository-relative paths, including deletions/renames.")
    arguments = parser.parse_args()
    try:
        heavy = needs_heavy_installation(arguments.changed_paths)
    except ValueError as error:
        parser.error(str(error))
    print("heavy-installation" if heavy else "ordinary")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
