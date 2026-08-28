"""Verifies the portable Filterest Docker command without starting real containers.
Bridges a copied source root, generated local secrets, and the Docker Compose call.
Exists so browser-ready setup stays one command and never exposes generated secrets.
The fake Docker executable records only command arguments in an isolated test folder.
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest


SOURCE_ROOT = Path(__file__).resolve().parents[2]
INSTALLATION_ROOT = SOURCE_ROOT.parent
RUNNER = SOURCE_ROOT / "server_tools/run_filterest_docker.sh"


class FilterestDockerRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name) / "filterest"
        self.app_root = self.root / "app"
        (self.app_root / "docker").mkdir(parents=True)
        shutil.copy2(SOURCE_ROOT / ".env.example", self.app_root / ".env.example")
        shutil.copy2(INSTALLATION_ROOT / "compose.yml", self.root / "compose.yml")
        (self.app_root / "docker/docker-compose.yml").write_text(
            "services: {}\n", encoding="utf-8"
        )
        (self.app_root / "VERSION_APP").write_text("8.42.1\n", encoding="utf-8")
        (self.app_root / "VERSION_DB").write_text("9.6.7\n", encoding="utf-8")

        self.fake_bin = self.root / "fake-bin"
        self.fake_bin.mkdir()
        self.docker_log = self.root / "docker-arguments.log"
        fake_docker = self.fake_bin / "docker"
        fake_docker.write_text(
            "#!/bin/sh\n"
            "printf '%s\\n' \"$*\" >> \"$FILTEREST_DOCKER_TEST_LOG\"\n"
            "if [ \"${1:-}\" = volume ] && [ \"${2:-}\" = inspect ]; then\n"
            "    [ -n \"${FILTEREST_DOCKER_TEST_EXISTING_VOLUME:-}\" ] && "
            "[ \"${3:-}\" = \"$FILTEREST_DOCKER_TEST_EXISTING_VOLUME\" ]\n"
            "    exit $?\n"
            "fi\n"
            "if [ \"${1:-}\" = ps ]; then\n"
            "    printf '%s' \"${FILTEREST_DOCKER_TEST_RUNNING:-}\"\n"
            "    exit 0\n"
            "fi\n"
            "if [ \"${1:-}\" = run ] && [ -n \"${FILTEREST_DOCKER_TEST_LEGACY_SOURCE:-}\" ]; then\n"
            "    for argument in \"$@\"; do\n"
            "        case \"$argument\" in\n"
            "            *:/installation)\n"
            "                destination=${argument%:/installation}\n"
            "                cp -a \"$FILTEREST_DOCKER_TEST_LEGACY_SOURCE/.\" \"$destination/\"\n"
            "                ;;\n"
            "        esac\n"
            "    done\n"
            "fi\n"
            "exit 0\n",
            encoding="utf-8",
        )
        fake_docker.chmod(0o755)

    def environment(
        self, extra: dict[str, str] | None = None
    ) -> dict[str, str]:
        environment = os.environ.copy()
        environment["FILTEREST_PROJECT_ROOT_OVERRIDE"] = str(self.root)
        environment["FILTEREST_DOCKER_TEST_LOG"] = str(self.docker_log)
        environment["PATH"] = f"{self.fake_bin}:{environment['PATH']}"
        if extra:
            environment.update(extra)
        return environment

    def run_runner(
        self, *arguments: str, extra_environment: dict[str, str] | None = None
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(RUNNER), *arguments],
            check=True,
            capture_output=True,
            text=True,
            env=self.environment(extra_environment),
        )

    def test_setup_generates_protected_non_placeholder_settings(self) -> None:
        completed = self.run_runner("setup")
        env_file = self.root / "keys/docker.env"
        settings = dict(
            line.split("=", 1)
            for line in env_file.read_text(encoding="utf-8").splitlines()
            if line and not line.startswith("#") and "=" in line
        )

        self.assertEqual(settings["FILTEREST_INSTALL_PROFILE"], "docker")
        self.assertEqual(settings["ENVIRONMENT_TYPE"], "prod")
        self.assertEqual(settings["FILTEREST_LOCAL_TLS"], "true")
        self.assertRegex(settings["COMPOSE_PROJECT_NAME"], r"^filterest-[a-f0-9]{8}$")
        self.assertEqual(settings["INSTANCE_NAME"], settings["COMPOSE_PROJECT_NAME"])
        self.assertEqual(settings["DB_PASSWORD"], settings["DB_ADMIN_PASSWORD"])
        self.assertEqual(settings["FILTEREST_APP_VERSION"], "8.42.1")
        self.assertEqual(settings["FILTEREST_DB_VERSION"], "9.6.7")
        for key in (
            "DB_ADMIN_PASSWORD",
            "DB_READONLY_PASSWORD",
            "DB_CONFIDENTIAL_PASSWORD",
            "DB_BASIC_PASSWORD",
            "DB_GUEST_PASSWORD",
            "SESSION_SECRET_KEY",
            "SESSION_KEY",
        ):
            self.assertRegex(settings[key], r"^[a-f0-9]{48}$", key)
            self.assertNotIn(settings[key], completed.stdout)

        self.assertEqual(stat.S_IMODE(env_file.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((self.root / "keys").stat().st_mode), 0o700)
        self.assertEqual(
            stat.S_IMODE((self.root / "keys/tls/localhost.key").stat().st_mode),
            0o600,
        )
        self.assertEqual(
            stat.S_IMODE((self.root / "keys/tls/localhost.crt").stat().st_mode),
            0o644,
        )
        self.assertEqual(settings["FILTEREST_RUNTIME_UID"], str(os.getuid()))
        self.assertEqual(settings["FILTEREST_RUNTIME_GID"], str(os.getgid()))
        for relative_path in (
            "config",
            "projects",
            "data/storage",
            "data/storage_deleted",
            "data/runtime",
            "data/postgres",
            "backups",
        ):
            self.assertTrue((self.root / relative_path).is_dir(), relative_path)

    def test_start_uses_root_compose_contract_and_waits_for_health(self) -> None:
        completed = self.run_runner(
            "start", "--app-port", "58110", "--db-port", "55434"
        )
        docker_calls = self.docker_log.read_text(encoding="utf-8")
        settings = (self.root / "keys/docker.env").read_text(encoding="utf-8")
        parsed_settings = dict(
            line.split("=", 1)
            for line in settings.splitlines()
            if line and not line.startswith("#") and "=" in line
        )

        self.assertIn("compose version", docker_calls)
        self.assertIn(
            "compose "
            f"--project-directory {self.root} "
            f"--file {self.root / 'compose.yml'} "
            f"--env-file {self.root / 'keys/docker.env'} "
            "up --build --detach --wait",
            docker_calls,
        )
        self.assertIn("APP_PORT=58110", settings)
        self.assertIn("DB_PORT=55434", settings)
        self.assertIn("BASE_URL=https://localhost:58110", settings)
        self.assertIn("https://localhost:58110/first-run", completed.stdout)
        for legacy_volume in (
            "filterest_storage",
            "filterest_storage_deleted",
            "filterest_db_backups",
            "filterest_runtime",
            "filterest_postgres_data",
        ):
            self.assertIn(
                f"volume inspect {parsed_settings['COMPOSE_PROJECT_NAME']}_{legacy_volume}",
                docker_calls,
            )

    def test_repeated_setup_preserves_the_installation_identity_and_secrets(self) -> None:
        self.run_runner("setup")
        first_settings = (self.root / "keys/docker.env").read_bytes()

        self.run_runner("setup")

        self.assertEqual((self.root / "keys/docker.env").read_bytes(), first_settings)

    def test_start_migrates_a_stopped_legacy_volume_and_retains_the_source(self) -> None:
        self.run_runner("setup")
        settings = dict(
            line.split("=", 1)
            for line in (self.root / "keys/docker.env").read_text(
                encoding="utf-8"
            ).splitlines()
            if line and not line.startswith("#") and "=" in line
        )
        legacy_source = Path(self.temporary_directory.name) / "legacy-storage"
        legacy_source.mkdir()
        (legacy_source / "sentinel.txt").write_text("retained\n", encoding="utf-8")
        volume_name = f"{settings['COMPOSE_PROJECT_NAME']}_filterest_storage"

        completed = self.run_runner(
            "start",
            extra_environment={
                "FILTEREST_DOCKER_TEST_EXISTING_VOLUME": volume_name,
                "FILTEREST_DOCKER_TEST_LEGACY_SOURCE": str(legacy_source),
            },
        )

        self.assertEqual(
            (self.root / "data/storage/sentinel.txt").read_text(encoding="utf-8"),
            "retained\n",
        )
        self.assertEqual(
            (legacy_source / "sentinel.txt").read_text(encoding="utf-8"),
            "retained\n",
        )
        self.assertTrue(
            (self.root / "config/docker-named-volume-migration-complete").is_file()
        )
        self.assertIn("original volumes were retained", completed.stdout)

    def test_start_refuses_to_copy_a_running_legacy_database(self) -> None:
        self.run_runner("setup")
        settings = dict(
            line.split("=", 1)
            for line in (self.root / "keys/docker.env").read_text(
                encoding="utf-8"
            ).splitlines()
            if line and not line.startswith("#") and "=" in line
        )
        volume_name = f"{settings['COMPOSE_PROJECT_NAME']}_filterest_postgres_data"

        completed = subprocess.run(
            ["bash", str(RUNNER), "start"],
            check=False,
            capture_output=True,
            text=True,
            env=self.environment(
                {
                    "FILTEREST_DOCKER_TEST_EXISTING_VOLUME": volume_name,
                    "FILTEREST_DOCKER_TEST_RUNNING": "legacy-container-id",
                }
            ),
        )

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("require a stopped stack", completed.stderr)
        self.assertFalse(
            (self.root / "config/docker-named-volume-migration-complete").exists()
        )

    def test_setup_rejects_a_symbolic_link_as_the_settings_target(self) -> None:
        outside_file = self.root / "outside.env"
        outside_file.write_text("sentinel\n", encoding="utf-8")
        (self.root / "keys").mkdir()
        (self.root / "keys/docker.env").symlink_to(outside_file)

        completed = subprocess.run(
            ["bash", str(RUNNER), "setup"],
            check=False,
            capture_output=True,
            text=True,
            env=self.environment(),
        )

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("must not be a symbolic link", completed.stderr)
        self.assertEqual(outside_file.read_text(encoding="utf-8"), "sentinel\n")

    def test_setup_moves_one_safe_legacy_environment_into_keys(self) -> None:
        shutil.copy2(SOURCE_ROOT / ".env.example", self.root / ".env")

        completed = self.run_runner("setup")

        self.assertFalse((self.root / ".env").exists())
        self.assertTrue((self.root / "keys/docker.env").is_file())
        self.assertIn("Moved legacy Docker settings", completed.stdout)

    def test_setup_rejects_mutable_directory_symlink_escape(self) -> None:
        outside_directory = Path(self.temporary_directory.name) / "outside-projects"
        outside_directory.mkdir()
        (self.root / "projects").symlink_to(outside_directory)

        completed = subprocess.run(
            ["bash", str(RUNNER), "setup"],
            check=False,
            capture_output=True,
            text=True,
            env=self.environment(),
        )

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("must not be a symbolic link", completed.stderr)
        self.assertEqual(list(outside_directory.iterdir()), [])

    def test_dry_run_does_not_create_settings_or_call_docker(self) -> None:
        completed = self.run_runner("start", "--dry-run")

        self.assertFalse((self.root / "keys").exists())
        self.assertFalse(self.docker_log.exists())
        self.assertIn("prepare", completed.stdout)
        self.assertIn("docker compose", completed.stdout)


if __name__ == "__main__":
    unittest.main()
