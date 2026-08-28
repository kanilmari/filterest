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

        self.assertEqual(setup_script.count('stream_bootstrap_schema_sql "$'), 5)
        self.assertNotIn("sed 's/postgis\\.geometry(Point,4326)/text/g'", setup_script)

    def test_setup_grants_public_schema_create_to_configured_admin(self) -> None:
        setup_script = (
            PUBLIC_SOURCE_ROOT / "server_tools/setup_local_dev_environment.sh"
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

        self.assertIn(
            'npm --prefix "$NODE_DEPENDENCY_ROOT" ci --silent',
            setup_script,
        )
        self.assertNotIn("npm install --silent", setup_script)

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

        self.assertIn(
            'FILTEREST_SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"',
            setup_script,
        )
        self.assertNotIn('$PROJECT_ROOT/filterest/go.mod', setup_script)
        self.assertIn(
            'go run "$FILTEREST_SOURCE_ROOT/server_tools/initial_admin_bootstrap"',
            setup_script,
        )
        self.assertNotIn(
            "go run ./server_tools/initial_admin_bootstrap",
            setup_script,
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
