"""test_filterest_docker_runner.py
Verifies the portable Filterest Docker command without starting real containers.
Bridges a copied source root, generated local secrets, and the Docker Compose call.
Exists so browser-ready setup stays one command and never exposes generated secrets.
The fake Docker executable records only command arguments in an isolated test folder.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import tempfile
import time
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
        for compose_source in (SOURCE_ROOT / "docker").glob("docker-compose*.yml"):
            shutil.copy2(compose_source, self.app_root / "docker" / compose_source.name)
        (self.app_root / "VERSION_APP").write_text("8.42.1\n", encoding="utf-8")
        (self.app_root / "VERSION_DB").write_text("9.6.7\n", encoding="utf-8")

        self.fake_bin = self.root / "fake-bin"
        self.fake_bin.mkdir()
        self.docker_log = self.root / "docker-arguments.log"
        fake_docker = self.fake_bin / "docker"
        fake_docker.write_text(
            "#!/bin/sh\n"
            "printf '%s\\n' \"$*\" >> \"$FILTEREST_DOCKER_TEST_LOG\"\n"
            "if [ \"${1:-}\" = compose ] && [ \"${2:-}\" = version ]; then\n"
            "    printf '%s\\n' \"${FILTEREST_DOCKER_TEST_COMPOSE_VERSION:-2.40.3}\"\n"
            "    exit \"${FILTEREST_DOCKER_TEST_COMPOSE_VERSION_STATUS:-0}\"\n"
            "fi\n"
            "if [ \"${1:-}\" = network ]; then\n"
            "    case \"${2:-}\" in\n"
            "        ls) printf '%b' \"${FILTEREST_DOCKER_TEST_NETWORK_IDS:-}\"; "
            "exit \"${FILTEREST_DOCKER_TEST_NETWORK_LIST_STATUS:-0}\" ;;\n"
            "        inspect) printf '%s' \"${FILTEREST_DOCKER_TEST_NETWORKS:-[]}\"; "
            "exit \"${FILTEREST_DOCKER_TEST_NETWORK_INSPECT_STATUS:-0}\" ;;\n"
            "    esac\n"
            "fi\n"
            "if [ \"${1:-}\" = volume ] && [ \"${2:-}\" = inspect ]; then\n"
            "    [ -n \"${FILTEREST_DOCKER_TEST_EXISTING_VOLUME:-}\" ] && "
            "[ \"${3:-}\" = \"$FILTEREST_DOCKER_TEST_EXISTING_VOLUME\" ]\n"
            "    exit $?\n"
            "fi\n"
            "if [ \"${1:-}\" = ps ]; then\n"
            "    if [ \"${2:-}\" = --all ]; then\n"
            "        printf '%b' \"${FILTEREST_DOCKER_TEST_CONTAINER_IDS:-}\"\n"
            "        exit \"${FILTEREST_DOCKER_TEST_CONTAINER_LIST_STATUS:-0}\"\n"
            "    fi\n"
            "    printf '%s' \"${FILTEREST_DOCKER_TEST_RUNNING:-}\"\n"
            "    exit 0\n"
            "fi\n"
            "if [ \"${1:-}\" = container ] && [ \"${2:-}\" = inspect ]; then\n"
            "    printf '%s' \"${FILTEREST_DOCKER_TEST_CONTAINERS:-[]}\"\n"
            "    exit \"${FILTEREST_DOCKER_TEST_CONTAINER_INSPECT_STATUS:-0}\"\n"
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
            # Compose calls carry --project-directory, --file and --env-file first.
            "if [ \"${1:-}\" = compose ] && [ \"${2:-}\" = --project-directory ]; then\n"
            "    shift 7\n"
            # Runs the database container's own shell command against a fake
            # container pg_dump, so the argument boundaries are the real ones.
            "    if [ -n \"${FILTEREST_DOCKER_TEST_CONTAINER_BIN:-}\" ] && "
            "[ \"$1 $2 $3 $4 $5\" = 'exec -T db sh -c' ]; then\n"
            "        shift 4\n"
            "        POSTGRES_USER=container_owner POSTGRES_DB=container_database "
            "POSTGRES_PASSWORD=container-only-password "
            "PATH=\"$FILTEREST_DOCKER_TEST_CONTAINER_BIN:$PATH\" exec sh \"$@\"\n"
            "    fi\n"
            "    case \"$*\" in\n"
            "        'down')\n"
            "            printf 'down-environment FILTEREST_NETWORK_FILE=%s\\n' "
            "\"${FILTEREST_NETWORK_FILE-<unset>}\" >> \"$FILTEREST_DOCKER_TEST_LOG\" ;;\n"
            "        'ps --status running --services')\n"
            "            printf '%b' \"${FILTEREST_DOCKER_TEST_SERVICES-app\\\\ndb\\\\n}\" ;;\n"
            "        'images --quiet app')\n"
            "            printf '%s\\n' \"${FILTEREST_DOCKER_TEST_IMAGE_ID:-}\" ;;\n"
            "        'exec -T db sh -c '*)\n"
            "            printf '%s' \"${FILTEREST_DOCKER_TEST_DUMP-PGDMP test dump}\"\n"
            "            if [ -n \"${FILTEREST_DOCKER_TEST_DUMP_HANG:-}\" ]; then sleep 30; fi\n"
            "            exit \"${FILTEREST_DOCKER_TEST_DUMP_STATUS:-0}\" ;;\n"
            "        'exec -T db pg_restore --list')\n"
            "            cat > /dev/null\n"
            "            exit \"${FILTEREST_DOCKER_TEST_RESTORE_STATUS:-0}\" ;;\n"
            "        'up '*)\n"
            "            printf 'up-environment ENABLE_SQL_MIGRATIONS=%s "
            "EASELECT_MIGRATION_FILE_ALLOWLIST=%s FILTEREST_APP_VERSION=%s\\n' "
            "\"${ENABLE_SQL_MIGRATIONS-<unset>}\" "
            "\"${EASELECT_MIGRATION_FILE_ALLOWLIST-<unset>}\" "
            "\"${FILTEREST_APP_VERSION-<unset>}\" "
            ">> \"$FILTEREST_DOCKER_TEST_LOG\" ;;\n"
            "    esac\n"
            "fi\n"
            "exit 0\n",
            encoding="utf-8",
        )
        fake_docker.chmod(0o755)

        # Answers /system/ready from numbered files: N.status holds an HTTP
        # status or "refused", N.body the JSON; the last pair repeats. An
        # answer delayed past --max-time times out as the real curl would.
        self.curl_responses = self.root / "curl-responses"
        self.curl_responses.mkdir()
        fake_curl = self.fake_bin / "curl"
        fake_curl.write_text(
            "#!/bin/sh\n"
            "set -eu\n"
            "printf '%s\\n' \"$*\" >> \"$FILTEREST_CURL_TEST_RESPONSES/arguments\"\n"
            "out=''\n"
            "url=''\n"
            "max_time=''\n"
            "while [ \"$#\" -gt 0 ]; do\n"
            "    case \"$1\" in\n"
            "        --output) out=$2; shift 2 ;;\n"
            "        --max-time) max_time=$2; shift 2 ;;\n"
            "        --write-out|--cacert|--connect-timeout) shift 2 ;;\n"
            "        -*) shift ;;\n"
            "        *) url=$1; shift ;;\n"
            "    esac\n"
            "done\n"
            "responses=$FILTEREST_CURL_TEST_RESPONSES\n"
            "count=$(( $(cat \"$responses/count\" 2>/dev/null || echo 0) + 1 ))\n"
            "printf '%s\\n' \"$count\" > \"$responses/count\"\n"
            "printf '%s\\n' \"$url\" >> \"$responses/urls\"\n"
            "printf '%s\\n' \"$max_time\" >> \"$responses/max_times\"\n"
            "delay=${FILTEREST_CURL_TEST_DELAY:-0}\n"
            "if [ \"$delay\" -gt \"$max_time\" ]; then\n"
            "    sleep \"$max_time\"\n"
            "    echo 'curl: (28) Operation timed out' >&2\n"
            "    printf '000'\n"
            "    exit 28\n"
            "fi\n"
            "sleep \"$delay\"\n"
            "number=$count\n"
            "while [ ! -f \"$responses/$number.status\" ] && [ \"$number\" -gt 1 ]; do\n"
            "    number=$((number - 1))\n"
            "done\n"
            "status=$(cat \"$responses/$number.status\")\n"
            "if [ \"$status\" = refused ]; then\n"
            "    echo 'curl: (7) Failed to connect to localhost' >&2\n"
            "    printf '000'\n"
            "    exit 7\n"
            "fi\n"
            "cat \"$responses/$number.body\" > \"$out\"\n"
            "printf '%s' \"$status\"\n",
            encoding="utf-8",
        )
        fake_curl.chmod(0o755)

    def environment(
        self, extra: dict[str, str] | None = None
    ) -> dict[str, str]:
        # Only process/tool discovery belongs to the caller. Docker settings and
        # fixture control variables must enter explicitly through extra.
        environment = {
            key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "LANG")
            if key in os.environ
        }
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

    def settings(self) -> dict[str, str]:
        return dict(
            line.split("=", 1)
            for line in (self.root / "keys/docker.env").read_text(
                encoding="utf-8"
            ).splitlines()
            if line and not line.startswith("#") and "=" in line
        )

    def run_update_action(
        self,
        *arguments: str,
        extra_environment: dict[str, str] | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        """Runs an update action without an inherited copy of any Docker setting."""

        environment = self.environment()
        for key in self.settings():
            environment.pop(key, None)
        environment["FILTEREST_CURL_TEST_RESPONSES"] = str(self.curl_responses)
        if extra_environment:
            environment.update(extra_environment)
        return subprocess.run(
            ["bash", str(RUNNER), *arguments],
            check=check,
            capture_output=True,
            text=True,
            env=environment,
        )

    def add_ready_response(self, number: int, status: str, body: object = "") -> None:
        (self.curl_responses / f"{number}.status").write_text(status, encoding="utf-8")
        (self.curl_responses / f"{number}.body").write_text(
            body if isinstance(body, str) else json.dumps(body), encoding="utf-8"
        )

    def ready_body(self, **overrides: object) -> dict[str, object]:
        body: dict[str, object] = {
            "ready": True,
            "status": "ready",
            "reasons": [],
            "db_compatible": True,
            "app_version": "8.43.0",
            "instance_id": self.settings()["INSTANCE_NAME"],
        }
        body.update(overrides)
        return body

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
        runtime_keys = self.root / "keys/filterest_runtime"
        runtime_environment = runtime_keys / "runtime_environment.env"
        self.assertEqual(stat.S_IMODE(runtime_keys.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(runtime_environment.stat().st_mode), 0o600)
        self.assertIn(
            "OPENAI_API_KEY=",
            runtime_environment.read_text(encoding="utf-8").splitlines(),
        )
        self.assertFalse((self.app_root / ".env").exists())
        self.assertFalse((self.app_root / "keys").exists())
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
            "data/bootstrap",
            "data/storage",
            "data/storage_deleted",
            "data/runtime",
            "data/postgres",
            "backups",
        ):
            self.assertTrue((self.root / relative_path).is_dir(), relative_path)
        self.assertEqual(
            stat.S_IMODE((self.root / "data/bootstrap").stat().st_mode), 0o700
        )

    def test_setup_moves_existing_openai_key_outside_immutable_app(self) -> None:
        legacy_secret = "test-docker-openai-key"
        keys_root = self.root / "keys"
        keys_root.mkdir(mode=0o700)
        docker_environment = keys_root / "docker.env"
        docker_environment.write_text(
            (SOURCE_ROOT / ".env.example")
            .read_text(encoding="utf-8")
            .replace("OPENAI_API_KEY=", f"OPENAI_API_KEY={legacy_secret}"),
            encoding="utf-8",
        )
        docker_environment.chmod(0o600)

        completed = self.run_runner("setup")

        runtime_environment = (
            self.root / "keys/filterest_runtime/runtime_environment.env"
        )
        runtime_settings = runtime_environment.read_text(encoding="utf-8")
        docker_settings = docker_environment.read_text(encoding="utf-8")
        self.assertIn(f"OPENAI_API_KEY={legacy_secret}", runtime_settings)
        self.assertIn("OPENAI_API_KEY=\n", docker_settings)
        self.assertNotIn(f"OPENAI_API_KEY={legacy_secret}", docker_settings)
        self.assertNotIn(legacy_secret, completed.stdout)
        self.assertFalse((self.app_root / ".env").exists())
        self.assertFalse((self.app_root / "keys").exists())

        replacement_secret = "test-key-saved-through-admin"
        runtime_environment.write_text(
            runtime_settings.replace(legacy_secret, replacement_secret),
            encoding="utf-8",
        )
        runtime_environment.chmod(0o600)
        self.run_runner("setup")
        self.assertIn(
            f"OPENAI_API_KEY={replacement_secret}",
            runtime_environment.read_text(encoding="utf-8"),
        )

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

    def test_repeated_setup_preserves_identity_secrets_and_bootstrap_state(self) -> None:
        self.run_runner("setup")
        first_settings = (self.root / "keys/docker.env").read_bytes()
        bootstrap_marker = (
            self.root / "data/bootstrap/public-bootstrap-media-r1.complete.json"
        )
        bootstrap_marker.write_text("operator-owned marker\n", encoding="utf-8")
        bootstrap_marker.chmod(0o600)

        self.run_runner("setup")

        self.assertEqual((self.root / "keys/docker.env").read_bytes(), first_settings)
        self.assertEqual(
            bootstrap_marker.read_text(encoding="utf-8"), "operator-owned marker\n"
        )
        self.assertEqual(stat.S_IMODE(bootstrap_marker.stat().st_mode), 0o600)

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

    def test_setup_rejects_a_symbolic_link_as_the_runtime_secret_target(self) -> None:
        outside_file = self.root / "outside-runtime.env"
        outside_file.write_text("sentinel\n", encoding="utf-8")
        runtime_keys = self.root / "keys/filterest_runtime"
        runtime_keys.mkdir(parents=True)
        (runtime_keys / "runtime_environment.env").symlink_to(outside_file)

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

    def test_setup_rejects_duplicate_runtime_openai_key_without_migration(self) -> None:
        first_secret = "test-first-runtime-key"
        second_secret = "test-second-runtime-key"
        runtime_keys = self.root / "keys/filterest_runtime"
        runtime_keys.mkdir(parents=True)
        runtime_environment = runtime_keys / "runtime_environment.env"
        runtime_environment.write_text(
            f"OPENAI_API_KEY={first_secret}\n"
            f"export OPENAI_API_KEY={second_secret}\n",
            encoding="utf-8",
        )
        runtime_environment.chmod(0o600)

        completed = subprocess.run(
            ["bash", str(RUNNER), "setup"],
            check=False,
            capture_output=True,
            text=True,
            env=self.environment(),
        )

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("duplicate OPENAI_API_KEY declarations", completed.stderr)
        self.assertNotIn(first_secret, completed.stderr)
        self.assertNotIn(second_secret, completed.stderr)

    def test_setup_migrates_into_one_export_prefixed_runtime_key(self) -> None:
        legacy_secret = "test-export-migration-key"
        keys_root = self.root / "keys"
        runtime_keys = keys_root / "filterest_runtime"
        runtime_keys.mkdir(parents=True)
        docker_environment = keys_root / "docker.env"
        docker_environment.write_text(
            (SOURCE_ROOT / ".env.example")
            .read_text(encoding="utf-8")
            .replace("OPENAI_API_KEY=", f"OPENAI_API_KEY={legacy_secret}"),
            encoding="utf-8",
        )
        docker_environment.chmod(0o600)
        runtime_environment = runtime_keys / "runtime_environment.env"
        runtime_environment.write_text(
            "  export OPENAI_API_KEY =\nKEEP_ME=yes\n",
            encoding="utf-8",
        )
        runtime_environment.chmod(0o600)

        completed = self.run_runner("setup")

        runtime_lines = runtime_environment.read_text(encoding="utf-8").splitlines()
        self.assertEqual(runtime_lines.count(f"OPENAI_API_KEY={legacy_secret}"), 1)
        self.assertFalse(
            any("export OPENAI_API_KEY" in line for line in runtime_lines)
        )
        self.assertIn("KEEP_ME=yes", runtime_lines)
        self.assertNotIn(legacy_secret, completed.stdout)
        self.assertIn(
            "OPENAI_API_KEY=\n",
            docker_environment.read_text(encoding="utf-8"),
        )

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

    def test_setup_opens_database_bootstrap_sources_to_the_database_container(self) -> None:
        # A checkout made under umask 077 leaves both mounted sources private to
        # their owner, which the PostgreSQL image's postgres user is not.
        sources = [
            self.app_root / "server_tools" / name
            for name in ("db_init", "public_bootstrap")
        ]
        for source in sources:
            source.mkdir(parents=True)
            script = source / "01_example.sh"
            script.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
            script.chmod(0o700)
            data = source / "example.sql"
            data.write_text("SELECT 1;\n", encoding="utf-8")
            data.chmod(0o600)
            source.chmod(0o700)

        completed = self.run_runner("setup")

        for source in sources:
            self.assertEqual(stat.S_IMODE(source.stat().st_mode), 0o705)
            self.assertEqual(
                stat.S_IMODE((source / "01_example.sh").stat().st_mode), 0o705
            )
            self.assertEqual(
                stat.S_IMODE((source / "example.sql").stat().st_mode), 0o604
            )
        self.assertIn("readable for the database container", completed.stdout)

        repeated = self.run_runner("setup")
        self.assertNotIn("readable for the database container", repeated.stdout)

    def test_dry_run_does_not_create_settings_or_call_docker(self) -> None:
        completed = self.run_runner("start", "--dry-run")

        self.assertFalse((self.root / "keys").exists())
        self.assertFalse(self.docker_log.exists())
        self.assertIn("prepare", completed.stdout)
        self.assertIn("docker compose", completed.stdout)

    def test_profile_reads_the_docker_profile_without_changing_anything(self) -> None:
        self.assertEqual(self.run_runner("profile").stdout, "")
        self.assertFalse((self.root / "keys").exists())

        self.run_runner("setup")
        settings_before = (self.root / "keys/docker.env").read_bytes()
        completed = self.run_runner("profile")

        self.assertEqual(completed.stdout, "docker\n")
        self.assertEqual((self.root / "keys/docker.env").read_bytes(), settings_before)
        self.assertFalse(self.docker_log.exists())

    def test_update_actions_refuse_inherited_values_that_compose_would_prefer(self) -> None:
        shutil.copy2(
            SOURCE_ROOT / "docker/docker-compose.yml",
            self.app_root / "docker/docker-compose.yml",
        )
        self.run_runner("setup")
        settings = self.settings()

        refused = self.run_update_action(
            "update-preflight",
            "--dry-run",
            extra_environment={
                "DB_NAME": "another_database",
                "COMPOSE_PROJECT_NAME": "another-stack",
                # Matching today, but the update rewrites it before it restarts.
                "FILTEREST_APP_VERSION": settings["FILTEREST_APP_VERSION"],
            },
            check=False,
        )

        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("COMPOSE_PROJECT_NAME DB_NAME FILTEREST_APP_VERSION", refused.stderr)
        self.assertNotIn("another_database", refused.stderr)
        self.assertNotIn("another-stack", refused.stderr)
        self.assertFalse(self.docker_log.exists())

        accepted = self.run_update_action(
            "update-preflight",
            "--dry-run",
            extra_environment={
                # A key Compose never substitutes, and the two migration
                # switches the update sets itself, are harmless.
                "PORT": "3000",
                "ENABLE_SQL_MIGRATIONS": "true",
                "EASELECT_MIGRATION_FILE_ALLOWLIST": "",
            },
        )
        self.assertIn("keys/docker.env as written", accepted.stdout)
        self.assertFalse(self.docker_log.exists())

    def test_update_preflight_requires_a_running_database_container(self) -> None:
        self.run_runner("setup")

        refused = self.run_update_action(
            "update-preflight",
            extra_environment={"FILTEREST_DOCKER_TEST_SERVICES": "app\\n"},
            check=False,
        )
        accepted = self.run_update_action(
            "update-preflight",
            extra_environment={"FILTEREST_DOCKER_TEST_SERVICES": "app\\ndb\\n"},
        )

        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("database container is not running", refused.stderr)
        self.assertIn("ready for the update", accepted.stdout)
        docker_calls = self.docker_log.read_text(encoding="utf-8")
        self.assertIn("compose version", docker_calls)
        self.assertIn("ps --status running --services", docker_calls)

    def test_stop_app_stops_only_the_application_container(self) -> None:
        self.run_runner("setup")

        image = self.run_update_action(
            "app-image-id",
            extra_environment={"FILTEREST_DOCKER_TEST_IMAGE_ID": "sha256:current-app"},
        )
        stopped = self.run_update_action("stop-app")

        docker_calls = self.docker_log.read_text(encoding="utf-8")
        self.assertEqual(image.stdout, "sha256:current-app\n")
        self.assertIn("images --quiet app", docker_calls)
        self.assertIn("stop app", docker_calls)
        self.assertNotIn(" down", docker_calls)
        self.assertIn("database keeps running", stopped.stdout)

    def test_dump_database_writes_a_read_back_owner_only_file(self) -> None:
        self.run_runner("setup")
        settings = self.settings()
        target = self.root / "backups/database.dump"

        completed = self.run_update_action("dump-database", "--output", str(target))

        self.assertEqual(target.read_text(encoding="utf-8"), "PGDMP test dump")
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        self.assertEqual([path.name for path in target.parent.iterdir()], ["database.dump"])
        docker_calls = self.docker_log.read_text(encoding="utf-8")
        self.assertIn("exec -T db sh -c", docker_calls)
        self.assertIn("exec -T db pg_restore --list", docker_calls)
        self.assertNotIn("--no-privileges", docker_calls)
        for key in ("DB_ADMIN_PASSWORD", "DB_PASSWORD", "SESSION_SECRET_KEY"):
            for output in (docker_calls, completed.stdout, completed.stderr):
                self.assertNotIn(settings[key], output, key)

        repeated = self.run_update_action(
            "dump-database", "--output", str(target), check=False
        )
        self.assertNotEqual(repeated.returncode, 0)
        self.assertIn("already exists", repeated.stderr)
        self.assertEqual(target.read_text(encoding="utf-8"), "PGDMP test dump")

    def test_dump_database_keeps_privileges_and_passes_each_option_separately(self) -> None:
        self.run_runner("setup")
        settings = self.settings()
        container_bin = self.root / "container-bin"
        container_bin.mkdir()
        pg_dump_log = self.root / "container-pg_dump.log"
        container_pg_dump = container_bin / "pg_dump"
        container_pg_dump.write_text(
            "#!/bin/sh\n"
            "for argument in \"$@\"; do\n"
            "    printf 'argument %s\\n' \"$argument\" >> \"$FILTEREST_DOCKER_TEST_PG_DUMP_LOG\"\n"
            "done\n"
            "printf 'password %s\\n' \"${PGPASSWORD:+set}\" >> \"$FILTEREST_DOCKER_TEST_PG_DUMP_LOG\"\n"
            "printf 'PGDMP container dump'\n",
            encoding="utf-8",
        )
        container_pg_dump.chmod(0o755)
        target = self.root / "backups/database.dump"

        self.run_update_action(
            "dump-database",
            "--output",
            str(target),
            extra_environment={
                "FILTEREST_DOCKER_TEST_CONTAINER_BIN": str(container_bin),
                "FILTEREST_DOCKER_TEST_PG_DUMP_LOG": str(pg_dump_log),
            },
        )

        # One line per argument: an option glued to its neighbour, or the first
        # option taken as the shell's $0, would show here.
        self.assertEqual(
            pg_dump_log.read_text(encoding="utf-8").splitlines(),
            [
                "argument --format=custom",
                "argument --no-owner",
                "argument --username=container_owner",
                "argument --dbname=container_database",
                "password set",
            ],
        )
        self.assertEqual(target.read_text(encoding="utf-8"), "PGDMP container dump")
        docker_calls = self.docker_log.read_text(encoding="utf-8")
        self.assertNotIn("container-only-password", docker_calls)
        self.assertNotIn(settings["DB_ADMIN_PASSWORD"], docker_calls)

    def test_dump_database_leaves_nothing_when_the_dump_is_empty_or_unreadable(self) -> None:
        self.run_runner("setup")
        target = self.root / "backups/database.dump"

        for failure in (
            {"FILTEREST_DOCKER_TEST_DUMP": ""},
            {"FILTEREST_DOCKER_TEST_DUMP_STATUS": "1"},
            {"FILTEREST_DOCKER_TEST_RESTORE_STATUS": "1"},
        ):
            with self.subTest(failure=failure):
                failed = self.run_update_action(
                    "dump-database",
                    "--output",
                    str(target),
                    extra_environment=failure,
                    check=False,
                )
                self.assertNotEqual(failed.returncode, 0)
                self.assertIn("nothing was written", failed.stderr)
                self.assertEqual(list(target.parent.iterdir()), [])

    def test_start_for_update_returns_without_the_health_wait(self) -> None:
        self.run_runner("setup")

        completed = self.run_update_action(
            "start",
            "--for-update",
            extra_environment={
                "ENABLE_SQL_MIGRATIONS": "true",
                "EASELECT_MIGRATION_FILE_ALLOWLIST": "",
            },
        )

        docker_calls = self.docker_log.read_text(encoding="utf-8")
        self.assertIn("up --build --detach\n", docker_calls)
        self.assertNotIn("--wait", docker_calls)
        self.assertIn(
            "up-environment ENABLE_SQL_MIGRATIONS=true EASELECT_MIGRATION_FILE_ALLOWLIST= "
            "FILTEREST_APP_VERSION=<unset>\n",
            docker_calls,
        )
        self.assertNotIn("first-run", completed.stdout)

        misplaced = self.run_update_action("stop", "--for-update", check=False)
        self.assertNotEqual(misplaced.returncode, 0)
        self.assertIn("--for-update applies only to start", misplaced.stderr)

    def test_ready_check_waits_until_this_installation_reports_the_version(self) -> None:
        self.run_runner("setup")
        self.add_ready_response(
            1,
            "503",
            self.ready_body(
                ready=False, db_compatible=False, reasons=["db_version_incompatible"]
            ),
        )
        self.add_ready_response(2, "200", self.ready_body())

        completed = self.run_update_action(
            "ready-check", "--expect-version", "8.43.0", "--timeout", "30"
        )

        self.assertIn("8.43.0 is ready", completed.stdout)
        self.assertEqual(
            (self.curl_responses / "urls").read_text(encoding="utf-8").splitlines(),
            [f"https://localhost:{self.settings()['APP_PORT']}/system/ready"] * 2,
        )

    def test_update_actions_read_quoted_settings_as_compose_does(self) -> None:
        shutil.copy2(
            SOURCE_ROOT / "docker/docker-compose.yml",
            self.app_root / "docker/docker-compose.yml",
        )
        self.run_runner("setup")
        secret = self.settings()["DB_ADMIN_PASSWORD"]
        env_file = self.root / "keys/docker.env"
        quoted = {
            "FILTEREST_INSTALL_PROFILE": '"docker"',
            "APP_PORT": "'18123'",
            "INSTANCE_NAME": '  "quoted-instance"  # set by hand',
            "DB_ADMIN_PASSWORD": f"{secret}  # generated",
        }
        env_file.write_text(
            "".join(
                f"{key}={quoted[key]}\n" if key in quoted else f"{line}\n"
                for line in env_file.read_text(encoding="utf-8").splitlines()
                for key in [line.split("=", 1)[0]]
            ),
            encoding="utf-8",
        )
        self.add_ready_response(
            1, "200", self.ready_body(instance_id="quoted-instance")
        )

        profile = self.run_runner("profile")
        preflight = self.run_update_action("update-preflight", "--dry-run")
        ready = self.run_update_action(
            "ready-check", "--expect-version", "8.43.0", "--timeout", "1"
        )

        self.assertEqual(profile.stdout, "docker\n")
        self.assertIn("as written", preflight.stdout)
        self.assertIn("8.43.0 is ready", ready.stdout)
        for output in (profile.stdout, preflight.stdout, ready.stdout, ready.stderr):
            self.assertNotIn(secret, output)
        self.assertEqual(
            (self.curl_responses / "urls").read_text(encoding="utf-8"),
            "https://localhost:18123/system/ready\n",
        )

    def test_start_for_update_refuses_an_inherited_copy_before_writing_settings(self) -> None:
        shutil.copy2(
            SOURCE_ROOT / "docker/docker-compose.yml",
            self.app_root / "docker/docker-compose.yml",
        )
        self.run_runner("setup")
        settings_before = (self.root / "keys/docker.env").read_bytes()
        installed_version = self.settings()["FILTEREST_APP_VERSION"]
        (self.app_root / "VERSION_APP").write_text("8.43.0\n", encoding="utf-8")

        refused = self.run_update_action(
            "start",
            "--for-update",
            extra_environment={"FILTEREST_APP_VERSION": installed_version},
            check=False,
        )

        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("FILTEREST_APP_VERSION", refused.stderr)
        self.assertEqual((self.root / "keys/docker.env").read_bytes(), settings_before)
        self.assertFalse(self.docker_log.exists())

    def test_ready_check_never_waits_for_an_answer_past_its_deadline(self) -> None:
        self.run_runner("setup")
        self.add_ready_response(1, "200", self.ready_body())

        started = time.monotonic()
        failed = self.run_update_action(
            "ready-check",
            "--expect-version",
            "8.43.0",
            "--timeout",
            "2",
            extra_environment={"FILTEREST_CURL_TEST_DELAY": "8"},
            check=False,
        )
        elapsed = time.monotonic() - started

        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("curl: (28)", failed.stderr)
        self.assertLess(elapsed, 6)
        [max_time] = (self.curl_responses / "max_times").read_text(encoding="utf-8").split()
        self.assertLessEqual(int(max_time), 2)

    def test_ready_check_starts_no_request_at_its_deadline(self) -> None:
        self.run_runner("setup")
        self.add_ready_response(
            1, "503", self.ready_body(ready=False, reasons=["database_unavailable"])
        )
        # Would succeed, but only after the deadline has passed.
        self.add_ready_response(2, "200", self.ready_body())

        failed = self.run_update_action(
            "ready-check", "--expect-version", "8.43.0", "--timeout", "3", check=False
        )

        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("HTTP 503 (database_unavailable)", failed.stderr)
        self.assertEqual(
            (self.curl_responses / "count").read_text(encoding="utf-8").strip(), "1"
        )

    def test_dump_database_removes_its_partial_file_when_interrupted(self) -> None:
        self.run_runner("setup")
        backups = self.root / "backups"
        environment = self.environment()
        for key in self.settings():
            environment.pop(key, None)
        environment["FILTEREST_DOCKER_TEST_DUMP_HANG"] = "1"

        dump = subprocess.Popen(
            ["bash", str(RUNNER), "dump-database", "--output", str(backups / "database.dump")],
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        try:
            deadline = time.monotonic() + 10
            while not list(backups.glob("database.dump.partial.*")):
                self.assertLess(time.monotonic(), deadline, "the dump never started")
                time.sleep(0.05)
            os.killpg(dump.pid, signal.SIGTERM)
            returncode = dump.wait(timeout=10)
        finally:
            if dump.poll() is None:
                os.killpg(dump.pid, signal.SIGKILL)
                dump.wait()

        self.assertNotEqual(returncode, 0)
        self.assertEqual(list(backups.iterdir()), [])

    def test_ready_check_rejects_another_version_installation_or_answer(self) -> None:
        self.run_runner("setup")

        for status, body, expected_error in (
            ("refused", "", "no response (curl: (7)"),
            ("503", self.ready_body(ready=False, reasons=["database_unavailable"]),
             "HTTP 503 (database_unavailable)"),
            ("200", "not json", "without a JSON readiness object"),
            ("200", self.ready_body(db_compatible=False), "not ready"),
            ("200", self.ready_body(app_version="8.42.1"), "version '8.42.1' answered"),
            ("200", self.ready_body(instance_id="another-installation"),
             "installation 'another-installation' answered"),
        ):
            with self.subTest(expected_error=expected_error):
                for response in self.curl_responses.iterdir():
                    response.unlink()
                self.add_ready_response(1, status, body)
                failed = self.run_update_action(
                    "ready-check",
                    "--expect-version",
                    "8.43.0",
                    "--timeout",
                    "1",
                    check=False,
                )
                self.assertNotEqual(failed.returncode, 0)
                self.assertIn("did not report ready within 1 seconds", failed.stderr)
                self.assertIn(expected_error, failed.stderr)


if __name__ == "__main__":
    unittest.main()
