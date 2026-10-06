"""WL124 cold-restore lifecycle tests; Docker/readiness calls are local shell stubs."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]


class RuntimeGrantRestoreBarrierTests(unittest.TestCase):
    def restore(self, import_status=0, ready_status=0, compressed=False, verify_status=0, swap_status=0, function_status=0, settings_status=0):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "instances/proof").mkdir(parents=True)
            (root / "instances/proof/.env").write_text("DB_ADMIN_USER=fixture\nDB_NAME=fixture\nAPP_PORT=1\n")
            dump = root / ("dump.sql.gz" if compressed else "dump.sql")
            if compressed:
                import gzip
                dump.write_bytes(gzip.compress(b"SELECT 1;\n"))
            else:
                dump.write_text("SELECT 1;\n")
            script = r'''
source "$FILTEREST_TEST_SOURCE/app/server_tools/ctl/lib/instance_backup.sh"
project_default_db_name() { printf fixture; }
docker() {
    printf '%s\n' "$*" >> commands
    if [[ "$1" == exec ]]; then
        cat > current.sql
        if [[ "$*" == *"-d filterest_restore_"* ]] && grep -q '^SELECT 1;' current.sql; then
            cp current.sql imported.sql
            return "$IMPORT_STATUS"
        fi
        cat current.sql >> lifecycle.sql
        if grep -q 'backup has no complete Filterest catalogue' current.sql; then return "$VERIFY_STATUS"; fi
        if grep -q 'unmatched SECURITY DEFINER function' current.sql; then return "$FUNCTION_STATUS"; fi
        if grep -q 'database settings verification differs' current.sql; then return "$SETTINGS_STATUS"; fi
        if grep -q 'ALLOW_CONNECTIONS false' current.sql; then return "$SWAP_STATUS"; fi
    fi
    return 0
}
wait_for_instance_app() { printf 'readiness\n' >> commands; return "$READY_STATUS"; }
restore_instance proof "$DUMP_FILE"
'''
            env = dict(os.environ, FILTEREST_TEST_SOURCE=str(ROOT), EASELECT_RESTORE_CONFIRM="yes",
                       IMPORT_STATUS=str(import_status), READY_STATUS=str(ready_status), DUMP_FILE=str(dump),
                       VERIFY_STATUS=str(verify_status), SWAP_STATUS=str(swap_status),
                       FUNCTION_STATUS=str(function_status), SETTINGS_STATUS=str(settings_status))
            result = subprocess.run(["bash", "-c", script], cwd=root, env=env, capture_output=True, text=True)
            evidence = list((root / "instances/proof/backups").glob("restore_*.txt"))
            self.assertEqual(len(evidence), 1)
            evidence_text = evidence[0].read_text()
            self.assertIn("recovery=filterest_recovery_", evidence_text)
            if import_status or ready_status or verify_status or swap_status or function_status or settings_status:
                self.assertNotIn("phase=ready\n", evidence_text)
            else:
                self.assertIn("phase=ready\n", evidence_text)
            if function_status:
                self.assertIn("phase=function_security_failed", evidence_text)
            if settings_status:
                self.assertIn("phase=database_settings_failed", evidence_text)
            return result, (root / "commands").read_text(), (root / "lifecycle.sql").read_text()

    def test_cold_restore_stops_imports_reconciles_before_success(self):
        for compressed in (False, True):
            result, commands, imported = self.restore(compressed=compressed)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertLess(commands.index("stop --time 30"), commands.index("exec -i"))
            self.assertLess(commands.index("exec -i"), commands.index("start easelect-proof-app"))
            self.assertLess(commands.index("start easelect-proof-app"), commands.index("readiness"))
            self.assertIn("-v ON_ERROR_STOP=1", commands)
            self.assertIn("-d filterest_restore_", commands)
            self.assertIn("CREATE DATABASE %I TEMPLATE template0", imported)
            self.assertIn("ALTER DATABASE %I ALLOW_CONNECTIONS false", imported)
            self.assertIn("ALTER DATABASE %I RENAME TO %I", imported)
            self.assertNotIn("DROP DATABASE", imported)
            self.assertIn("restored and reconciled", result.stdout)

    def test_import_failure_leaves_site_stopped(self):
        result, commands, _ = self.restore(import_status=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("start easelect-proof-app", commands)
        self.assertNotIn("readiness", commands)

    def test_reconcile_failure_stops_site_and_never_reports_ready(self):
        result, commands, _ = self.restore(ready_status=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands.count("stop --time 30 easelect-proof-app"), 2)
        self.assertNotIn("restored and reconciled", result.stdout)

    def test_wrong_backup_is_refused_before_touching_populated_target(self):
        result, commands, imported = self.restore(verify_status=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("ALLOW_CONNECTIONS false", imported)
        self.assertNotIn("start easelect-proof-app", commands)

    def test_function_or_database_security_failure_refuses_before_swap(self):
        for statuses in ({"function_status": 1}, {"settings_status": 1}):
            result, commands, imported = self.restore(**statuses)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn("ALLOW_CONNECTIONS false", imported)
            self.assertNotIn("start easelect-proof-app", commands)

    def test_swap_failure_never_starts_the_site(self):
        result, commands, _ = self.restore(swap_status=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("start easelect-proof-app", commands)
        self.assertIn("retained database names", result.stderr)

    def test_unverified_merge_is_gated_before_any_access(self):
        script = f'source "{ROOT}/app/server_tools/ctl/lib/instance_sync.sh"\nsync_instance proof\n'
        result = subprocess.run(["bash", "-c", script], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Seed merge is unavailable", result.stderr)

    def test_readiness_requires_new_policy_marker(self):
        for body, expected in (("{\"status\":\"ok\"}", 1), ("{\"status\":\"ok\",\"runtime_grants\":\"reconciled\"}", 0)):
            script = f'source "{ROOT}/app/server_tools/ctl/lib/instance_helpers.sh"\ncurl() {{ printf "%s" "$HEALTH_BODY"; }}\nsleep() {{ :; }}\nwait_for_instance_app proof 1 1\n'
            result = subprocess.run(["bash", "-c", script], env=dict(os.environ, HEALTH_BODY=body), capture_output=True, text=True)
            self.assertEqual(result.returncode, expected, result.stderr)


if __name__ == "__main__":
    unittest.main()
