"""test_docker_storage_deleted_mounts.py
Verifies portable Filterest Docker storage, bootstrap, and runtime contracts.
Bridges the public Compose definitions and instance-directory scaffolding.
Exists so container rebuilds cannot discard media archived after a database deletion.
"""

import json
from pathlib import Path
import shutil
import subprocess
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
INSTALLATION_ROOT = PROJECT_ROOT.parent
PUBLIC_SOURCE_ROOT = (
    PROJECT_ROOT / "filterest"
    if (PROJECT_ROOT / "filterest/go.mod").is_file()
    else PROJECT_ROOT
)


class DockerStorageDeletedMountTests(unittest.TestCase):
    def test_instance_scaffolding_creates_recoverable_media_root(self) -> None:
        create_source = (
            PUBLIC_SOURCE_ROOT / "server_tools/ctl/lib/instance_crud.sh"
        ).read_text(encoding="utf-8")
        helper_source = (
            PUBLIC_SOURCE_ROOT / "server_tools/ctl/lib/instance_helpers.sh"
        ).read_text(encoding="utf-8")

        self.assertIn("{storage,storage_deleted,backups}", create_source)
        self.assertIn("for storage_name in storage storage_deleted", helper_source)

    def test_docker_success_message_uses_actual_host_port_overrides(self) -> None:
        common_source = (PUBLIC_SOURCE_ROOT / "server_tools/ctl/lib/common.sh").read_text(
            encoding="utf-8"
        )
        docker_source = (PUBLIC_SOURCE_ROOT / "server_tools/ctl/lib/docker.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn('vite_port="${VITE_PORT:-$vite_port}"', common_source)
        self.assertIn('db_host="${DB_BIND_HOST:-127.0.0.1}"', common_source)
        self.assertIn('db_port="${DB_PORT:-$db_port}"', common_source)
        self.assertIn("resolve_local_docker_host_port", docker_source)
        self.assertLess(
            docker_source.index("prepare_local_docker_storage"),
            docker_source.index("check_port_available"),
        )

        result = subprocess.run(
            [
                "bash",
                "-c",
                f"""
                PROJECT_ROOT="$1"
                EASELECT_PORT=8082
                APP_PORT=18082
                export PROJECT_ROOT EASELECT_PORT APP_PORT
                source "{PUBLIC_SOURCE_ROOT}/server_tools/ctl/lib/common.sh"
                source "{PUBLIC_SOURCE_ROOT}/server_tools/ctl/lib/docker.sh"
                resolve_local_docker_host_port
                printf '%s|%s' "$PORT" "$APP_PORT"
                """,
                "bash",
                str(PROJECT_ROOT),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual("18082|18082", result.stdout)

    def test_local_docker_restore_tolerates_preinitialized_postgis_schema(self) -> None:
        docker_source = (
            PUBLIC_SOURCE_ROOT / "server_tools/ctl/lib/docker.sh"
        ).read_text(encoding="utf-8")

        self.assertIn("stream_local_docker_restore_sql", docker_source)
        self.assertIn(
            "CREATE SCHEMA IF NOT EXISTS postgis;",
            docker_source,
        )

        result = subprocess.run(
            [
                "bash",
                "-c",
                f"""
                PROJECT_ROOT="$1"
                export PROJECT_ROOT
                source "{PUBLIC_SOURCE_ROOT}/server_tools/ctl/lib/docker.sh"
                printf '%s\n' \
                    'CREATE SCHEMA apps;' \
                    'CREATE SCHEMA postgis;' \
                    'CREATE TABLE public.example (id integer);' \
                    | stream_local_docker_restore_sql
                """,
                "bash",
                str(PROJECT_ROOT),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            "CREATE SCHEMA apps;\n"
            "CREATE SCHEMA IF NOT EXISTS postgis;\n"
            "CREATE TABLE public.example (id integer);\n",
            result.stdout,
        )

    def test_docker_database_initializers_use_the_canonical_postgis_schema(self) -> None:
        initializer = (
            PUBLIC_SOURCE_ROOT / "server_tools/db_init/01_init_extensions.sh"
        ).read_text(encoding="utf-8")

        self.assertIn("CREATE SCHEMA IF NOT EXISTS postgis", initializer)
        self.assertIn(
            "CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA postgis",
            initializer,
        )

    def test_standalone_database_compose_owns_complete_public_bootstrap(self) -> None:
        compose = (
            PUBLIC_SOURCE_ROOT / "docker/docker-compose.db.yml"
        ).read_text(encoding="utf-8")
        importer = (
            PUBLIC_SOURCE_ROOT / "server_tools/db_init/02_import_public_bootstrap.sh"
        ).read_text(encoding="utf-8")
        roles = (
            PUBLIC_SOURCE_ROOT / "server_tools/db_init/03_create_roles.sh"
        ).read_text(encoding="utf-8")

        self.assertIn("dockerfile: docker/Dockerfile.db", compose)
        self.assertIn("source: ../../data/postgres", compose)
        self.assertIn("target: /var/lib/postgresql/data", compose)
        self.assertIn("source: ../server_tools/db_init", compose)
        self.assertIn("target: /docker-entrypoint-initdb.d", compose)
        self.assertIn("source: ../server_tools/public_bootstrap", compose)
        self.assertIn("target: /filterest-public-bootstrap", compose)
        self.assertNotIn("create_host_path: true", compose)
        self.assertIn('--file "$schema_file"', importer)
        self.assertIn('--file "$seed_file"', importer)
        initializer_names = sorted(
            path.name for path in (PUBLIC_SOURCE_ROOT / "server_tools/db_init").glob("*.sh")
        )
        self.assertLess(
            initializer_names.index("02_import_public_bootstrap.sh"),
            initializer_names.index("03_create_roles.sh"),
        )
        for variable_name in (
            "DB_READONLY_USER",
            "DB_CONFIDENTIAL_USER",
            "DB_BASIC_USER",
            "DB_GUEST_USER",
        ):
            self.assertIn(variable_name, compose)
            self.assertIn(variable_name, roles)

    def test_standalone_application_stack_is_owned_by_public_source(self) -> None:
        dockerfile = (PUBLIC_SOURCE_ROOT / "docker/Dockerfile").read_text(
            encoding="utf-8"
        )
        compose = (PUBLIC_SOURCE_ROOT / "docker/docker-compose.yml").read_text(
            encoding="utf-8"
        )
        entrypoint = (
            PUBLIC_SOURCE_ROOT / "docker/docker-entrypoint.sh"
        ).read_text(encoding="utf-8")

        self.assertIn("COPY backend/ ./backend/", dockerfile)
        self.assertIn("-o filterest .", dockerfile)
        self.assertNotIn("COPY apps/", dockerfile)
        self.assertNotIn("filterest_projects", dockerfile)
        self.assertIn("WORKDIR /filterest/app", dockerfile)
        self.assertIn(
            'ENTRYPOINT ["/filterest/app/docker/docker-entrypoint.sh"]', dockerfile
        )
        self.assertIn('CMD ["/filterest/app/filterest"]', dockerfile)
        self.assertIn("COPY go.mod ./go.mod", dockerfile)
        self.assertIn("USER filterest", dockerfile)
        self.assertNotIn("chown -R filterest:filterest", dockerfile)
        self.assertNotIn("/app/storage", dockerfile)
        self.assertIn("https://127.0.0.1:8082/health", dockerfile)
        self.assertNotIn("openssl req", entrypoint)
        self.assertIn("local TLS identity is incomplete", entrypoint)
        self.assertIn("exec \"$@\"", entrypoint)

        self.assertIn("context: ..", compose)
        self.assertIn("dockerfile: docker/Dockerfile", compose)
        self.assertIn("${APP_BIND_HOST:-127.0.0.1}:${APP_PORT:-8100}:8082", compose)
        self.assertIn("FILTEREST_LOCAL_TLS: ${FILTEREST_LOCAL_TLS:-true}", compose)
        self.assertIn("FILTEREST_ROOT: /filterest", compose)
        self.assertIn("read_only: true", compose)
        self.assertIn("no-new-privileges:true", compose)
        for source, target in (
            ("../../config", "/filterest/config"),
            ("../../keys/tls", "/filterest/keys/tls"),
            ("../../projects", "/filterest/projects"),
            ("../../data/storage", "/filterest/data/storage"),
            ("../../data/storage_deleted", "/filterest/data/storage_deleted"),
            ("../../data/runtime", "/filterest/data/runtime"),
            ("../../backups", "/filterest/backups"),
            ("../../data/postgres", "/var/lib/postgresql/data"),
            ("../server_tools/db_init", "/docker-entrypoint-initdb.d"),
            ("../server_tools/public_bootstrap", "/filterest-public-bootstrap"),
        ):
            self.assertIn(f"source: {source}", compose)
            self.assertIn(f"target: {target}", compose)
        self.assertNotIn("create_host_path: true", compose)
        self.assertNotIn("/app/storage", compose)
        self.assertNotIn("/app/storage_deleted", compose)
        self.assertNotIn("/app/runtime", compose)
        self.assertNotIn("filterest_postgres_data", compose)
        self.assertNotIn("filterest_projects", compose)
        self.assertNotIn("instances_and_cloud", compose)

        root_compose = (INSTALLATION_ROOT / "compose.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("path: app/docker/docker-compose.yml", root_compose)

    @unittest.skipUnless(shutil.which("docker"), "Docker CLI is not installed")
    def test_standalone_compose_build_context_is_exactly_immutable_app(self) -> None:
        completed = subprocess.run(
            [
                "docker",
                "compose",
                "--file",
                str(INSTALLATION_ROOT / "compose.yml"),
                "config",
                "--no-interpolate",
                "--format",
                "json",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        rendered = json.loads(completed.stdout)
        expected_context = str(PROJECT_ROOT.resolve())

        for service_name in ("app", "db"):
            self.assertEqual(
                rendered["services"][service_name]["build"]["context"],
                expected_context,
            )

        app_service = rendered["services"]["app"]
        self.assertTrue(app_service["read_only"])
        app_mounts = {mount["target"]: mount for mount in app_service["volumes"]}
        self.assertEqual(
            set(app_mounts),
            {
                "/filterest/config",
                "/filterest/keys/tls",
                "/filterest/projects",
                "/filterest/data/storage",
                "/filterest/data/storage_deleted",
                "/filterest/data/runtime",
                "/filterest/backups",
            },
        )
        for mount in app_mounts.values():
            self.assertFalse(mount["target"].startswith("/filterest/app/"), mount)
            self.assertFalse(mount["bind"]["create_host_path"], mount)
        for protected_target in (
            "/filterest/config",
            "/filterest/keys/tls",
            "/filterest/backups",
        ):
            self.assertTrue(app_mounts[protected_target]["read_only"])

        database_mounts = {
            mount["target"]: mount for mount in rendered["services"]["db"]["volumes"]
        }
        self.assertEqual(
            database_mounts["/var/lib/postgresql/data"]["source"],
            str((INSTALLATION_ROOT / "data/postgres").resolve()),
        )
        for mount in database_mounts.values():
            self.assertFalse(mount["bind"]["create_host_path"], mount)

    def test_installation_ignore_contract_excludes_all_mutable_siblings(self) -> None:
        gitignore = (INSTALLATION_ROOT / ".gitignore").read_text(encoding="utf-8")
        root_dockerignore = (INSTALLATION_ROOT / ".dockerignore").read_text(
            encoding="utf-8"
        )

        for mutable_root in ("config", "keys", "projects", "data", "backups"):
            self.assertIn(f"/{mutable_root}/", gitignore)
            self.assertIn(f"/{mutable_root}/", root_dockerignore)

if __name__ == "__main__":
    unittest.main()
