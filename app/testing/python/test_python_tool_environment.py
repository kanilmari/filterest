"""Exercise public command Python selection without installed packages or databases.

Small temporary launcher fixtures keep the test independent of operator settings,
active services and whatever unrelated Python happens to be on the caller's PATH.
"""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[2]
INSTALLATION = SOURCE.parent


class PythonToolEnvironmentTest(unittest.TestCase):
    def fixture(self, root, *, installed):
        app = root / "app"
        (app / "server_tools/lib").mkdir(parents=True)
        (app / "server_tools/ctl/lib").mkdir(parents=True)
        for relative in ("filterest", "server_tools/lib/project_python_venv.sh", "server_tools/lib/python_bytecode_cache.sh"):
            shutil.copy2(SOURCE / relative, app / relative)
        shutil.copy2(INSTALLATION / "filterest", root / "filterest")
        (app / "go.mod").write_text("module fixture\n")
        (app / "VERSION_APP").write_text("1.0.0\n")
        (app / "server_tools/ctl/lib/resolve_env.sh").write_text(":\n")
        fallback = root / "host-bin"
        fallback.mkdir()
        self.python_stub(fallback / "python3", "host")
        if installed:
            own_python = root / "data/runtime/python/venv/bin/python3"
            own_python.parent.mkdir(parents=True)
            self.python_stub(own_python, "installation")
        return fallback

    def python_stub(self, target, owner):
        target.write_text('#!/bin/sh\nprintf \'{"owner":"' + owner + '","script":"%s","argument":"%s"}\\n\' "$1" "${2:-}"\n')
        target.chmod(0o755)

    def run_command(self, root, fallback, command, environment=None):
        env = {"HOME": str(root), "PATH": str(fallback) + ":/usr/bin:/bin", "LANG": "C.UTF-8"}
        env.update(environment or {})
        return subprocess.run([str(root / "filterest"), command, "--help"], cwd="/tmp", env=env, text=True, capture_output=True)

    def test_commands_use_installed_python_without_shell_activation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fallback = self.fixture(root, installed=True)
            for command in ("database", "status", "timestamp"):
                with self.subTest(command=command):
                    result = self.run_command(root, fallback, command)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(json.loads(result.stdout)["owner"], "installation")
                    self.assertIn(str(root / "app/server_tools"), json.loads(result.stdout)["script"])

    def test_admin_install_without_venv_keeps_host_python(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fallback = self.fixture(root, installed=False)
            result = self.run_command(root, fallback, "database")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["owner"], "host")
            self.assertFalse((root / "data/runtime/python/venv").exists())

    def test_standalone_install_does_not_borrow_another_venv(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fallback = self.fixture(root, installed=True)
            result = self.run_command(root, fallback, "database", {"FILTEREST_PROJECT_VENV_DIR": str(root / "unrelated"), "EASELECT_PROJECT_VENV_DIR": str(root / "unrelated"), "VIRTUAL_ENV": str(root / "unrelated")})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["owner"], "installation")


if __name__ == "__main__":
    unittest.main()
