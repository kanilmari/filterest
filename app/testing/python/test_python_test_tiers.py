"""test_python_test_tiers.py
Verify changed-path tier decisions and representative classification boundaries.
Connect the batch selector to installation paths, deletions and ordinary features.
Prevent missed heavy coverage without starting installation or recovery tools.
"""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys

import pytest

from python_test_tiers import HEAVY_INSTALLATION_FILES, needs_heavy_installation, tier_for_path


@pytest.mark.parametrize("changed_path", [
    "filterest", "ctl", "app/filterest", "app/ctl", "compose.yml", "compose.override.yaml",
    "docker-compose.override.yml", ".dockerignore", "app/docker/Dockerfile",
    "app/docker/compose/host-proxy.yml", "app/filterest.paths.example", "config/filterest.paths",
    "app/server_tools/install_filterest.sh", "app/server_tools/setup_local_dev_environment.sh",
    "app/server_tools/update_filterest.sh", "app/server_tools/run_filterest_admin.sh",
    "app/server_tools/run_filterest_docker.sh", "app/server_tools/scaffold.sh",
    "app/server_tools/ctl/lib/instance_backup.sh", "app/server_tools/ctl/lib/instance_restore.sh",
    "app/server_tools/lib/recovery_archives.py", "app/server_tools/lib/database_recovery.py",
    "app/server_tools/lib/source_dependency_installer.sh", "app/server_tools/lib/installation_records.sh",
    "app/server_tools/db_init/02_import_public_bootstrap.sh",
    "app/server_tools/initial_admin_bootstrap/main.go",
    "app/server_tools/admin_credential_recovery/main.go",
    "app/server_tools/check_first_cloud_recovery_readiness.sh",
    "app/server_tools/scripts/setup_swap.sh",
    "app/server_tools/scripts/reconcile_self_managed_migration.sql",
    "app/server_tools/public_bootstrap/source/base.schema.sql",
    "app/server_tools/public_slice_export/audit_public_bootstrap.py",
    "app/server_tools/update_verification/verify_update.py",
    "app/server_tools/migrations/20990101000001_new.sql",
    "app/server_tools/versioning/release_contract_v1.py", "app/VERSION_DB",
    "app/backend/core_components/migrations/migrations.go",
    "app/backend/core_components/startup/migration_runner.go",
    "app/backend/core_components/startup/public_bootstrap_media_creator.go",
    "app/backend/core_components/auth/first_run_admin.go",
    "app/backend/core_components/application_updates/admission_handler.go",
    "app/backend/core_components/router/update_notice_handler.go",
    "app/backend/core_components/runtime_grant_mutations/application_update_guard_test.go",
    "app/backend/pipeline/access_control/application_update_recovery_test.go",
    "app/frontend/core_components/auth/first_run_admin_page.js",
    "app/frontend/templates/first_run_admin.html",
    "app/frontend/core_components/admin_tools/admin_update_notice_subscriber.js",
    "app/frontend/core_components/endpoints/application_update_endpoint_router.js",
    "app/testing/python/conftest.py", "app/testing/python/python_category_support.py",
    "app/testing/python/python_test_tiers.py", "app/testing/python/test_python_category_support.py",
    "app/testing/python/test_python_test_tiers.py", "app/testing/python/test_database_recovery.py",
    "app/testing/python/test_filterest_launcher_install_profile.py",
    "app/testing/python/test_native_lifecycle_roots.py", "app/testing/python/test_runtime_grant_restore_barrier.py",
    "app/testing/python/installation_fixture_files.py", "app/testing/python/recovery_operator_input_probes.py",
    "app/testing/python/update_verification_fixture.py", "app/testing/python/release_bundle_fixture.py",
    "app/testing/python/bootstrap_contract_assertions.py", "app/testing/python/fixtures/docker_runner_defaults.json",
    "app/testing/python/test_field_settings_language_seed.py", "app/testing/python/test_row_actor_support.py",
    "./app/server_tools/update_filterest.sh", r"app\server_tools\update_filterest.sh",
    "app/frontend/../server_tools/update_filterest.sh",
])
def test_installation_paths_require_heavy_coverage_even_when_deleted(changed_path):
    assert needs_heavy_installation([changed_path])


@pytest.mark.parametrize("changed_path", [
    "app/frontend/core_components/table_views/card_view/row_article_view_restore_state.js",
    "app/frontend/core_components/general_tables/gt_1_row_crud/gt_1_3_row_update/cell_editor.js",
    "app/backend/core_components/middlewares/panic_recovery.go",
    "app/backend/pipeline/error_handling/error_recovery.go",
    "app/testing/python/test_login_recovery_send_bundle.py",
    "app/testing/python/test_article_view_migration.py",
    "app/testing/python/test_release_publication.py",
    "app/testing/python/test_python_tool_environment_notes.py",
    "app/server_tools/release/publish_release.py", "app/docs/README.md",
    "app/frontend/core_components/ai_features/table_chat/openai_key_setup_printer.js",
    "app/frontend/initial_shell_bootstrap.test.js",
])
def test_application_features_and_release_tooling_remain_ordinary(changed_path):
    assert not needs_heavy_installation([changed_path])


def test_any_heavy_path_in_a_batch_requires_heavy_coverage():
    ordinary = "app/frontend/main.js"
    heavy = "app/server_tools/update_filterest.sh"
    assert needs_heavy_installation([ordinary, heavy, ordinary])
    assert needs_heavy_installation([heavy, ordinary])
    assert not needs_heavy_installation([ordinary, ordinary])
    assert not needs_heavy_installation([])


@pytest.mark.parametrize("invalid", ["/tmp/install.sh", "../filterest", "app/../../ctl", "", ".", r"C:\repo\ctl"])
def test_invalid_paths_refuse_instead_of_silently_selecting_ordinary(invalid):
    with pytest.raises(ValueError):
        needs_heavy_installation([invalid])
    with pytest.raises(ValueError):
        needs_heavy_installation(["ctl", invalid])


@pytest.mark.parametrize("filename,expected", [
    ("test_filterest_paths.py", "heavy-installation"),
    ("test_runtime_grant_restore_barrier.py", "heavy-installation"),
    ("test_current_release_bootstrap.py", "heavy-installation"),
    ("test_login_recovery_send_bundle.py", "ordinary"),
    ("test_article_view_migration.py", "ordinary"),
    ("test_release_publication.py", "ordinary"),
    ("test_unreviewed_feature.py", "ordinary"),
])
def test_tiers_follow_reviewed_exercised_behavior(filename, expected):
    assert tier_for_path(Path(filename)) == expected


def test_reviewed_manifest_has_no_missing_files_or_missing_batch_triggers():
    suite = Path(__file__).resolve().parent
    for filename, reason in HEAVY_INSTALLATION_FILES.items():
        assert (suite / filename).is_file(), filename
        assert reason, filename
        assert needs_heavy_installation([f"app/testing/python/{filename}"]), filename


@pytest.mark.parametrize("paths,output,status", [
    (["app/server_tools/update_filterest.sh"], "heavy-installation\n", 0),
    (["app/frontend/main.js"], "ordinary\n", 0),
    ([], "ordinary\n", 0),
    (["../ctl"], "", 2),
])
def test_selector_cli_prints_one_tier_or_reports_invalid_input(paths, output, status):
    result = subprocess.run(
        [sys.executable, "-B", str(Path(__file__).with_name("python_test_tiers.py")), *paths],
        capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == status, result.stderr
    assert result.stdout == output
    if status:
        assert "must stay inside the repository" in result.stderr
