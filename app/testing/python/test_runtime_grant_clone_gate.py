"""test_runtime_grant_clone_gate.py
Execute supported bootstrap and refused development clone with shell stubs.
No seed/database/network operation may happen after development dispatch.
The committed management import must reach its reconciliation/readiness check.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]


class RuntimeGrantCloneGateTests(unittest.TestCase):
    def test_development_clone_refuses_before_access(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "instances/proof").mkdir(parents=True)
            (root / "instances/proof/.env").write_text("# profile only\n")
            script = r'''
source "$SOURCE/app/server_tools/ctl/lib/instance_sync.sh"
instance_seed_profile_from_env() { printf development; }
read_seed_db_config() { echo forbidden-access >> touched; return 1; }
docker() { echo forbidden-docker >> touched; return 1; }
init_instance proof
'''
            result = subprocess.run(["bash", "-c", script], cwd=root,
                                    env=dict(os.environ, SOURCE=str(ROOT)), capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Development-seed clone is unverified", result.stderr)
            self.assertFalse((root / "touched").exists())

    def test_management_dispatch_imports_committed_bootstrap(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "instances/proof").mkdir(parents=True)
            (root / "instances/proof/.env").write_text("DB_ADMIN_USER=fixture\nDB_NAME=fixture\n")
            script = r'''
source "$SOURCE/app/server_tools/ctl/lib/instance_sync.sh"
instance_seed_profile_from_env() { printf management; }
current_bootstrap_seed_zip_path() { printf committed.zip; }
read_bootstrap_seed_password() { printf synthetic; }
extract_bootstrap_seed_zip() { printf 'SELECT 1;\n' > "$2/schema.sql"; printf 'SELECT 2;\n' > "$2/seed_data.sql"; }
prepare_instance_compose_env() { :; }
compose_cmd() { printf compose; }
compose() { printf 'compose %s\n' "$*" >> touched; }
wait_for_instance_db() { return 0; }
detect_instance_postgis_schema() { printf postgis; }
docker() {
    printf 'docker %s\n' "$*" >> touched
    if [[ "$1" == ps ]]; then printf 'easelect-proof-db\n'; fi
    if [[ "$*" == *"COUNT(*)"* ]]; then printf 0; fi
    if [[ "$*" == *"SELECT text_value"* ]]; then printf management; fi
}
import_bootstrap_package() { printf 'import %s\n' "$*" >> touched; }
wait_for_instance_app() { printf 'readiness\n' >> touched; }
init_instance proof
'''
            result = subprocess.run(["bash", "-c", script], cwd=root,
                                    env=dict(os.environ, SOURCE=str(ROOT)), capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            calls = (root / "touched").read_text()
            self.assertIn("import ", calls)
            self.assertLess(calls.index("import "), calls.index("compose up -d app"))
            self.assertLess(calls.index("compose up -d app"), calls.index("readiness"))


if __name__ == "__main__":
    unittest.main()
