"""test_bootstrap_seed_shell.py
Verifies bootstrap schema streaming and native setup permission contracts.
Bridges macOS Bash 3.2, bootstrap seed helpers, and local setup regression tests.
Exists so PostGIS-free imports and startup-required grants remain reproducible.
"""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_SOURCE_ROOT = (
    PROJECT_ROOT / "filterest"
    if (PROJECT_ROOT / "filterest/go.mod").is_file()
    else PROJECT_ROOT
)


def stream_schema(schema_file: Path, postgis_available: bool) -> str:
    """Run the production helper through macOS's system Bash contract."""

    env = os.environ.copy()
    env.update(
        {
            "PROJECT_ROOT": str(PROJECT_ROOT),
            "PUBLIC_SOURCE_ROOT": str(PUBLIC_SOURCE_ROOT),
            "SCHEMA_FILE": str(schema_file),
            "POSTGIS_AVAILABLE": "1" if postgis_available else "0",
        }
    )
    result = subprocess.run(
        [
            "/bin/bash",
            "-c",
            'source "$PUBLIC_SOURCE_ROOT/server_tools/lib/public_bootstrap.sh"; '
            'stream_bootstrap_schema_sql "$SCHEMA_FILE" "$POSTGIS_AVAILABLE"',
        ],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )
    return result.stdout


class BootstrapSeedShellTests(unittest.TestCase):
    def test_stream_bootstrap_schema_keeps_postgis_when_available(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            schema_file = Path(temp_dir) / "schema.sql"
            schema_file.write_text(
                "\\restrict token\n"
                "CREATE SCHEMA postgis;\n"
                "CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA postgis;\n"
                "COMMENT ON EXTENSION postgis IS 'spatial';\n"
                "CREATE TABLE locations (position postgis.geometry(Point,4326));\n"
                "\\unrestrict token\n",
                encoding="utf-8",
            )

            rendered = stream_schema(schema_file, postgis_available=True)

        self.assertNotIn("\\restrict", rendered)
        self.assertNotIn("\\unrestrict", rendered)
        self.assertIn("CREATE SCHEMA IF NOT EXISTS postgis;", rendered)
        self.assertIn("CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA postgis;", rendered)
        self.assertIn("COMMENT ON EXTENSION postgis", rendered)
        self.assertIn("postgis.geometry(Point,4326)", rendered)

    def test_stream_bootstrap_schema_removes_postgis_for_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            schema_file = Path(temp_dir) / "schema.sql"
            schema_file.write_text(
                "\\restrict token\n"
                "CREATE SCHEMA postgis;\n"
                "CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA postgis;\n"
                "COMMENT ON EXTENSION postgis IS 'spatial';\n"
                "CREATE TABLE locations (position postgis.geometry(Point,4326));\n"
                "\\unrestrict token\n",
                encoding="utf-8",
            )

            rendered = stream_schema(schema_file, postgis_available=False)

        self.assertNotIn("\\restrict", rendered)
        self.assertNotIn("\\unrestrict", rendered)
        self.assertIn("CREATE SCHEMA postgis;", rendered)
        self.assertNotIn("CREATE EXTENSION IF NOT EXISTS postgis", rendered)
        self.assertNotIn("COMMENT ON EXTENSION postgis", rendered)
        self.assertIn("CREATE TABLE locations (position text);", rendered)

    def test_all_no_postgis_setup_imports_use_the_shared_filter(self) -> None:
        setup_script = (
            PUBLIC_SOURCE_ROOT / "server_tools/setup_local_dev_environment.sh"
        ).read_text(encoding="utf-8")

        # Both package branches import through the shared stop-at-first-error import,
        # which streams the schema through the shared filter; the full-dump fallback
        # still streams its dump through the filter directly.
        self.assertEqual(setup_script.count('import_bootstrap_package "$'), 2)
        self.assertEqual(setup_script.count('"$POSTGIS_OK" \\'), 2)
        self.assertEqual(setup_script.count('stream_bootstrap_schema_sql "$'), 1)
        self.assertNotIn("sed 's/postgis\\.geometry(Point,4326)/text/g'", setup_script)

    def test_every_package_import_path_uses_the_shared_import(self) -> None:
        """No import path may skip a schema error: the management instance init used to."""
        instance_sync = (PUBLIC_SOURCE_ROOT / "server_tools/ctl/lib/instance_sync.sh").read_text(encoding="utf-8")
        self.assertIn('/instance_bootstrap.sh"', instance_sync)
        instance_sync += (PUBLIC_SOURCE_ROOT / "server_tools/ctl/lib/instance_bootstrap.sh").read_text(encoding="utf-8")
        docker = (PUBLIC_SOURCE_ROOT / "server_tools/ctl/lib/docker.sh").read_text(encoding="utf-8")

        self.assertIn('import_bootstrap_package "$schema_apply_file" "$bootstrap_seed_file" 1', instance_sync)
        self.assertNotIn("bootstrap_schema.sql >/tmp/easelect_bootstrap_schema_", instance_sync)
        self.assertNotIn("|| true\n\n    core_table_count", instance_sync)
        self.assertIn(
            'import_bootstrap_package "${bootstrap_tmp_dir}/schema.sql" "${bootstrap_tmp_dir}/seed_data.sql" 1',
            docker,
        )

    def _import_with_fake_psql(self, schema: str, seed: str) -> tuple[subprocess.CompletedProcess, Path]:
        """Run the shared import against a stand-in psql that fails on a FAIL line.

        The stand-in records every stream it is given, so a test can see whether the
        seed was ever sent after the schema failed.
        """
        temp_dir = Path(tempfile.mkdtemp())
        (temp_dir / "schema.sql").write_text(schema, encoding="utf-8")
        (temp_dir / "seed_data.sql").write_text(seed, encoding="utf-8")
        fake = temp_dir / "fake_psql"
        fake.write_text(
            "#!/bin/bash\n"
            'printf "%s\\n" "$*" >> "$RECORD_DIR/args"\n'
            'while IFS= read -r line; do\n'
            '  printf "%s\\n" "$line" >> "$RECORD_DIR/streams"\n'
            "  if [[ \"$line\" == FAIL* ]]; then echo 'ERROR:  syntax error at or near \"FAIL\"'; exit 3; fi\n"
            'done\n',
            encoding="utf-8",
        )
        fake.chmod(0o755)
        env = os.environ.copy()
        env.update({"PUBLIC_SOURCE_ROOT": str(PUBLIC_SOURCE_ROOT), "RECORD_DIR": str(temp_dir),
                    "SCHEMA_FILE": str(temp_dir / "schema.sql"), "SEED_FILE": str(temp_dir / "seed_data.sql"),
                    "FAKE_PSQL": str(fake)})
        result = subprocess.run(
            ["/bin/bash", "-c",
             'source "$PUBLIC_SOURCE_ROOT/server_tools/lib/public_bootstrap.sh"; '
             'import_bootstrap_package "$SCHEMA_FILE" "$SEED_FILE" 1 "$FAKE_PSQL" -d target'],
            capture_output=True, text=True, env=env,
        )
        return result, temp_dir

    def test_shared_import_runs_schema_then_seed_with_on_error_stop(self) -> None:
        result, records = self._import_with_fake_psql(
            "\\restrict key\nCREATE SCHEMA postgis;\nCREATE TABLE a (id int);\n\\unrestrict key\n",
            "\\restrict key\nINSERT INTO a VALUES (1);\n\\unrestrict key\n",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        args = (records / "args").read_text(encoding="utf-8").splitlines()
        self.assertEqual(args, ["-d target -v ON_ERROR_STOP=1"])
        streams = (records / "streams").read_text(encoding="utf-8")
        self.assertIn("CREATE SCHEMA IF NOT EXISTS postgis;", streams)
        self.assertTrue(streams.startswith("SELECT pg_advisory_lock(hashtext('filterest.runtime_startup_barrier'));"))
        self.assertLess(streams.index("CREATE TABLE a"), streams.index("INSERT INTO a"))
        self.assertNotIn("\\restrict", streams)

    def test_shared_import_stops_before_the_seed_when_the_schema_fails(self) -> None:
        result, records = self._import_with_fake_psql("CREATE TABLE a (id int);\nFAIL;\n", "INSERT INTO a VALUES (1);\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Bootstrap package import failed", result.stderr)
        self.assertIn('syntax error at or near "FAIL"', result.stderr)
        self.assertNotIn("INSERT INTO a", (records / "streams").read_text(encoding="utf-8"))

    def test_shared_import_reports_a_failed_seed(self) -> None:
        result, _ = self._import_with_fake_psql("CREATE TABLE a (id int);\n", "INSERT INTO a VALUES (1);\nFAIL;\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Bootstrap package import failed", result.stderr)

    def test_shared_import_refuses_a_missing_file(self) -> None:
        result, records = self._import_with_fake_psql("CREATE TABLE a (id int);\n", "")
        (records / "seed_data.sql").unlink()
        env = os.environ.copy()
        env.update({"PUBLIC_SOURCE_ROOT": str(PUBLIC_SOURCE_ROOT), "RECORD_DIR": str(records)})
        missing = subprocess.run(
            ["/bin/bash", "-c",
             'source "$PUBLIC_SOURCE_ROOT/server_tools/lib/public_bootstrap.sh"; '
             f'import_bootstrap_package "{records}/schema.sql" "{records}/seed_data.sql" 1 true'],
            capture_output=True, text=True, env=env,
        )
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("seed_data.sql is missing", missing.stderr)

    def test_setup_grants_public_schema_create_to_configured_admin(self) -> None:
        setup_script = (
            PUBLIC_SOURCE_ROOT / "server_tools/setup_local_dev_environment.sh"
        ).read_text(encoding="utf-8")
        self.assertIn('source "$SCRIPT_DIR/lib/setup_database_grants.sh"', setup_script)
        self.assertIn("grant_local_database_permissions", setup_script)
        setup_script += (
            PUBLIC_SOURCE_ROOT / "server_tools/lib/setup_database_grants.sh"
        ).read_text(encoding="utf-8")

        self.assertIn('--set=admin_user="$DB_ADMIN_USER"', setup_script)
        self.assertIn(
            "GRANT USAGE, CREATE ON SCHEMA public TO %I",
            setup_script,
        )

    def test_setup_installs_node_dependencies_without_mutating_lockfile(self) -> None:
        setup_script = (
            PUBLIC_SOURCE_ROOT / "server_tools/setup_local_dev_environment.sh"
        ).read_text(encoding="utf-8")

        dependency_installer = (
            PUBLIC_SOURCE_ROOT / "server_tools/lib/source_dependency_installer.sh"
        ).read_text(encoding="utf-8")
        self.assertIn('filterest_install_node_dependencies ', setup_script)
        self.assertIn('npm --prefix "$dependency_root" ci --no-audit --no-fund', dependency_installer)
        self.assertNotIn("npm install --silent", setup_script + dependency_installer)

    def test_normal_setup_leaves_first_admin_to_guarded_browser_form(self) -> None:
        setup_script = (
            PUBLIC_SOURCE_ROOT / "server_tools/setup_local_dev_environment.sh"
        ).read_text(encoding="utf-8")

        self.assertIn(
            '${FILTEREST_AUTOMATED_PREVIEW_INITIAL_ADMIN:-}" != "1"',
            setup_script,
        )
        self.assertIn(
            "First administrator will be created in the browser on first access.",
            setup_script,
        )
        self.assertIn(
            'LOGIN_OTP_CODE="$LOGIN_OTP_CODE"',
            setup_script,
        )

    def test_initial_admin_bootstrap_uses_the_canonical_public_source_root(self) -> None:
        setup_script = (
            PUBLIC_SOURCE_ROOT / "server_tools/setup_local_dev_environment.sh"
        ).read_text(encoding="utf-8")

        # The source root is the physical parent of the script's own folder; the
        # option terminator and silenced utility errors keep paths out of output.
        self.assertRegex(
            setup_script,
            r'FILTEREST_SOURCE_ROOT="\$\(cd (-- )?"\$SCRIPT_DIR/\.\."( 2>/dev/null)? && pwd -P( 2>/dev/null)?\)"',
        )
        self.assertNotIn('$PROJECT_ROOT/filterest/go.mod', setup_script)
        self.assertIn(
            'go -C "$FILTEREST_SOURCE_ROOT" run ./server_tools/initial_admin_bootstrap',
            setup_script,
        )
        self.assertNotIn(
            'go run "$FILTEREST_SOURCE_ROOT/server_tools/initial_admin_bootstrap"',
            setup_script,
        )
        self.assertNotIn(
            "go run ./server_tools/initial_admin_bootstrap",
            setup_script,
        )

    def test_nested_setup_uses_the_resolved_protected_keys_home(self) -> None:
        lifecycle_scripts = (
            "install_filterest.sh",
            "run_filterest_admin.sh",
            "scaffold.sh",
            "setup_local_dev_environment.sh",
            "update_filterest.sh",
        )
        for script_name in lifecycle_scripts:
            source = (PUBLIC_SOURCE_ROOT / "server_tools" / script_name).read_text(
                encoding="utf-8"
            )
            self.assertIn(
                'protected_runtime_root="$FILTEREST_KEYS_HOME/filterest_runtime"',
                source,
                script_name,
            )
            self.assertNotIn(
                'protected_runtime_root="$INSTALLATION_ROOT/keys/filterest_runtime"',
                source,
                script_name,
            )

    def test_public_setup_exposes_private_bootstrap_only_as_generic_optional_hook(self) -> None:
        setup_script = (
            PUBLIC_SOURCE_ROOT / "server_tools/setup_local_dev_environment.sh"
        ).read_text(encoding="utf-8")

        self.assertIn("FILTEREST_PRIVATE_BOOTSTRAP_LIB", setup_script)
        self.assertNotIn("filterest_private/", setup_script)

    def test_local_database_setup_never_requests_sudo_or_installs_os_packages(self) -> None:
        setup_script = (
            PUBLIC_SOURCE_ROOT / "server_tools/setup_local_dev_environment.sh"
        ).read_text(encoding="utf-8")

        self.assertNotIn("sudo -n", setup_script)
        self.assertNotIn("apt-get install", setup_script)
        self.assertIn(
            "OS packages are never installed by database setup",
            setup_script,
        )


if __name__ == "__main__":
    unittest.main()
