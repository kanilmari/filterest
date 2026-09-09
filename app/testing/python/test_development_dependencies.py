"""Verify dependency setup preserves installed data and reports failed downloads.

Exercises real public installer dispatch and cache receipts with isolated command
fixtures, without starting services, downloading packages or importing databases.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[2]
INSTALLER = SOURCE / "server_tools/install_filterest.sh"
HELPER = SOURCE / "server_tools/lib/source_dependency_installer.sh"


class DevelopmentDependenciesTest(unittest.TestCase):
    def run_bash(self, program, *arguments, environment=None):
        return subprocess.run(
            ["bash", "-c", program, "test", *map(str, arguments)],
            env={**os.environ, **(environment or {})}, text=True, capture_output=True,
        )

    def test_dependency_only_dispatch_cannot_touch_installed_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            helper = root / "server_tools/lib/source_dependency_installer.sh"
            helper.parent.mkdir(parents=True)
            helper.write_text('filterest_install_development_dependencies() { echo dependencies >> "$TEST_EVENTS"; }\n')
            result = self.run_bash(r'''
set -euo pipefail
export FILTEREST_INSTALLER_LIBRARY_ONLY=1
source "$1"
SOURCE_ROOT="$2"
RUNTIME_ROOT="$2/runtime"
is_generated_filterest_checkout() { return 0; }
install_go_toolchain_if_needed() { echo go >> "$TEST_EVENTS"; }
install_node_toolchain_if_needed() { echo node >> "$TEST_EVENTS"; }
for forbidden in install_host_packages configure_environment_files stop_stale_checkout_server_before_install ensure_admin_binary prepare_database_superuser bootstrap_database_and_dependencies start_installed_filterest; do
    eval "$forbidden() { echo forbidden >> \"\$TEST_EVENTS\"; exit 88; }"
done
main --profile development --dependencies-only --yes
''', INSTALLER, root, environment={"TEST_EVENTS": str(root / "events")})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((root / "events").read_text().splitlines(), ["go", "node", "dependencies"])
            self.assertFalse((root / "runtime/filterest-setup-complete").exists())

    def test_completed_database_setup_still_reconciles_dependencies(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            helper = root / "server_tools/lib/source_dependency_installer.sh"
            helper.parent.mkdir(parents=True)
            helper.write_text('filterest_install_development_dependencies() { echo checked > "$TEST_EVENTS"; }\n')
            setup = root / "server_tools/setup_local_dev_environment.sh"
            setup.write_text('#!/bin/bash\nexit 88\n')
            setup.chmod(0o755)
            runtime = root / "runtime"
            runtime.mkdir()
            (runtime / "filterest-setup-complete").write_text('profile=development\n')
            (root / "version").write_text('9.3.2\n')
            result = self.run_bash(r'''
set -euo pipefail
export FILTEREST_INSTALLER_LIBRARY_ONLY=1
source "$1"
SOURCE_ROOT="$2"
RUNTIME_ROOT="$2/runtime"
APP_VERSION_FILE="$2/version"
DB_VERSION_FILE="$2/version"
PROFILE=development
resolve_installation_private_paths() { EASELECT_RUNTIME_ENV_FILE="$SOURCE_ROOT/env"; }
postgresql_cluster_port() { echo 5433; }
env_value() { echo fixture; }
psql() { if [[ "$*" == *COUNT* ]]; then echo 10; else echo t; fi; }
bootstrap_database_and_dependencies
''', INSTALLER, root, environment={"TEST_EVENTS": str(root / "events")})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((root / "events").read_text().strip(), "checked")

    def test_embedding_keeps_its_own_manifests_and_runtime_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            workspace.mkdir()
            manifests = {"package.json": '{"name":"private-fixture","scripts":{"build":"private-build"}}', "package-lock.json": '{"name":"private-fixture"}'}
            for name, content in manifests.items():
                (workspace / name).write_text(content)
            binary = root / "bin"
            binary.mkdir()
            npm = binary / "npm"
            npm.write_text('#!/bin/bash\nmkdir -p "$2/node_modules"\n')
            npm.chmod(0o755)
            runtime = workspace / "runtime"
            result = self.run_bash('set -euo pipefail; source "$1"; filterest_install_node_dependencies "$2" "$3" "$2"', HELPER, workspace, runtime, environment={"PATH": str(binary) + ":" + os.environ["PATH"]})
            self.assertEqual(result.returncode, 0, result.stderr)
            for name, content in manifests.items():
                self.assertEqual((workspace / name).read_text(), content)
            self.assertTrue((runtime / "node/.filterest-source-manifests.sha256").exists())
            self.assertFalse((workspace / ".filterest-source-manifests.sha256").exists())

    def test_admin_profile_rejects_dependency_only_before_setup(self):
        result = self.run_bash(r'''
export FILTEREST_INSTALLER_LIBRARY_ONLY=1
source "$1"
main --profile admin --dependencies-only --yes
''', INSTALLER)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires --profile development", result.stderr)

    def test_failed_node_install_has_no_success_receipt_and_can_retry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            (source / "package.json").write_text('{"name":"fixture"}')
            (source / "package-lock.json").write_text('{}')
            binary = root / "bin"
            binary.mkdir()
            npm = binary / "npm"
            npm.write_text('#!/bin/bash\necho invoked >> "$TEST_EVENTS"\nif [[ "$FAKE_NPM_STATUS" != 0 ]]; then exit "$FAKE_NPM_STATUS"; fi\nmkdir -p "$2/node_modules"\n')
            npm.chmod(0o755)
            env = {"PATH": str(binary) + ":" + os.environ["PATH"], "TEST_EVENTS": str(root / "events"), "FAKE_NPM_STATUS": "17"}
            program = 'set -euo pipefail; source "$1"; filterest_install_node_dependencies "$2" "$3"'
            runtime = root / "runtime"
            failed = self.run_bash(program, HELPER, source, runtime, environment=env)
            receipt = runtime / "node/.filterest-source-manifests.sha256"
            self.assertNotEqual(failed.returncode, 0)
            self.assertFalse(receipt.exists())
            env["FAKE_NPM_STATUS"] = "0"
            retry = self.run_bash(program, HELPER, source, runtime, environment=env)
            self.assertEqual(retry.returncode, 0, retry.stderr)
            self.assertTrue(receipt.exists())
            repeat = self.run_bash(program, HELPER, source, runtime, environment=env)
            self.assertEqual(repeat.returncode, 0, repeat.stderr)
            self.assertEqual(len((root / "events").read_text().splitlines()), 2)
            (source / "package-lock.json").write_text('{"changed":true}')
            env["FAKE_NPM_STATUS"] = "17"
            changed = self.run_bash(program, HELPER, source, runtime, environment=env)
            self.assertNotEqual(changed.returncode, 0)
            self.assertFalse(receipt.exists())

    def test_node_install_refuses_external_dependency_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            runtime = root / "runtime"
            runtime.mkdir()
            external = root / "external"
            external.mkdir()
            (runtime / "node").symlink_to(external, target_is_directory=True)
            result = self.run_bash('source "$1"; filterest_install_node_dependencies "$2" "$3"', HELPER, source, runtime)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(list(external.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
