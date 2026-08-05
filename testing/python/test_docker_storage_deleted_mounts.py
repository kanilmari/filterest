"""test_docker_storage_deleted_mounts.py
Verifies Docker runtimes persist both active and recoverable media roots.
Bridges Compose bind mounts and instance-directory scaffolding.
Exists so container rebuilds cannot discard media archived after a database deletion.
"""

from pathlib import Path
import subprocess
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class DockerStorageDeletedMountTests(unittest.TestCase):
    def test_every_app_compose_mounts_recoverable_media(self) -> None:
        expected_mounts = {
            "docker/docker-compose.yml": "../storage_deleted:/app/storage_deleted",
            "docker/docker-compose.dev.yml": "../storage_deleted:/app/storage_deleted",
            "docker/docker-compose.mcp.yml": "../storage_deleted:/app/storage_deleted",
            "docker/docker-compose.instance.yml": (
                "../instances/${INSTANCE:-default}/storage_deleted:/app/storage_deleted"
            ),
        }

        for relative_path, expected_mount in expected_mounts.items():
            with self.subTest(compose=relative_path):
                compose_text = (PROJECT_ROOT / relative_path).read_text(encoding="utf-8")
                self.assertIn(expected_mount, compose_text)

    def test_instance_scaffolding_creates_recoverable_media_root(self) -> None:
        create_source = (
            PROJECT_ROOT / "server_tools/ctl/lib/instance_crud.sh"
        ).read_text(encoding="utf-8")
        helper_source = (
            PROJECT_ROOT / "server_tools/ctl/lib/instance_helpers.sh"
        ).read_text(encoding="utf-8")

        self.assertIn("{storage,storage_deleted,backups}", create_source)
        self.assertIn("for storage_name in storage storage_deleted", helper_source)

    def test_vps_deploy_preserves_and_backs_up_recoverable_media(self) -> None:
        deploy_source = (
            PROJECT_ROOT / "server_tools/deploy_docker_vps.sh"
        ).read_text(encoding="utf-8")

        self.assertIn('"--filter=P instances/*/storage_deleted/"', deploy_source)
        self.assertIn('"--filter=- instances/*/storage_deleted/"', deploy_source)
        self.assertIn(
            'storage_deleted_dir="instances/\\${instance}/storage_deleted"',
            deploy_source,
        )
        self.assertIn(
            "storage_deleted_pre_upgrade_\\${backup_ts}.tar.gz",
            deploy_source,
        )
        self.assertIn(
            'mkdir -p "\\${backup_dir}" "\\${storage_dir}" "\\${storage_deleted_dir}"',
            deploy_source,
        )
        self.assertIn(".easelect-host-write-probe", deploy_source)
        self.assertIn(".easelect-container-write-probe", deploy_source)
        self.assertIn("Docker storage ownership does not match runtime", deploy_source)

    def test_container_runtime_identity_matches_host_storage_owner(self) -> None:
        for dockerfile_name in (
            "docker/Dockerfile",
            "docker/Dockerfile.dev",
            "docker/Dockerfile.mcp",
        ):
            with self.subTest(dockerfile=dockerfile_name):
                dockerfile = (PROJECT_ROOT / dockerfile_name).read_text(encoding="utf-8")
                self.assertIn("ARG EASELECT_RUNTIME_UID=1000", dockerfile)
                self.assertIn("ARG EASELECT_RUNTIME_GID=1000", dockerfile)
                self.assertIn('adduser -u "${EASELECT_RUNTIME_UID}"', dockerfile)
                self.assertNotIn("adduser -u 1001", dockerfile)

        for compose_name in (
            "docker/docker-compose.yml",
            "docker/docker-compose.mcp.yml",
            "docker/docker-compose.instance.yml",
        ):
            with self.subTest(compose=compose_name):
                compose = (PROJECT_ROOT / compose_name).read_text(encoding="utf-8")
                self.assertIn(
                    "EASELECT_RUNTIME_UID: ${EASELECT_RUNTIME_UID:-1000}",
                    compose,
                )
                self.assertIn(
                    "EASELECT_RUNTIME_GID: ${EASELECT_RUNTIME_GID:-1000}",
                    compose,
                )

        helper_source = (
            PROJECT_ROOT / "server_tools/ctl/lib/instance_helpers.sh"
        ).read_text(encoding="utf-8")
        self.assertIn('${configured_runtime_uid:-$(id -u)}', helper_source)
        self.assertIn('${configured_runtime_gid:-$(id -g)}', helper_source)
        self.assertIn("chmod -R u+rwX,g+rwX,o-rwx", helper_source)
        self.assertIn("validate_docker_runtime_identity", helper_source)
        self.assertIn(".easelect-write-probe.XXXXXX", helper_source)
        self.assertNotIn("chmod -R u+rwX,g+rwX,o-rwx \"$instance_storage\" 2>/dev/null || true", helper_source)

    def test_local_docker_uses_compose_v2_and_protected_host_mounts(self) -> None:
        docker_source = (
            PROJECT_ROOT / "server_tools/ctl/lib/docker.sh"
        ).read_text(encoding="utf-8")
        compose_source = (
            PROJECT_ROOT / "docker/docker-compose.dev.yml"
        ).read_text(encoding="utf-8")

        self.assertIn("docker compose --env-file", docker_source)
        self.assertNotIn("docker-compose --env-file", docker_source)
        self.assertIn("prepare_local_docker_storage", docker_source)
        self.assertIn(
            'for storage_name in storage storage_deleted db_backups',
            docker_source,
        )
        self.assertIn("Docker bind-mount ownership does not match runtime", docker_source)
        self.assertIn(
            "easelect_full_dump.sql 2>/dev/null | head -1 || true)",
            docker_source,
        )
        self.assertIn("FROM pg_depend AS d", docker_source)
        self.assertIn("AND d.deptype = 'e'", docker_source)
        self.assertIn('stream_bootstrap_schema_sql "${bootstrap_tmp_dir}/schema.sql" "1"', docker_source)
        self.assertIn('_local_docker_compose up -d db', docker_source)
        self.assertEqual(docker_source.count('_local_docker_compose up -d app'), 2)
        self.assertNotIn('_local_docker_compose restart app', docker_source)
        self.assertIn(
            "${APP_BIND_HOST:-127.0.0.1}:${APP_PORT:-8082}:8082",
            compose_source,
        )
        self.assertIn(
            "${DB_BIND_HOST:-127.0.0.1}:${DB_PORT:-5433}:5432",
            compose_source,
        )
        self.assertIn("path: ${EASELECT_RUNTIME_ENV_FILE}", compose_source)
        self.assertIn("path: ${EASELECT_DEV_ENV_FILE}", compose_source)
        self.assertIn(
            "${FILTEREST_PROJECTS_HOME}:${FILTEREST_PROJECTS_HOME}",
            compose_source,
        )
        self.assertNotIn(
            "${FILTEREST_PROJECTS_HOME}:/filterest-projects",
            compose_source,
        )
        self.assertIn(
            "${EASELECT_TLS_CERT_FILE}:/run/easelect-private/localhost_certificate.crt:ro",
            compose_source,
        )
        self.assertIn(
            "${EASELECT_TLS_KEY_FILE}:/run/easelect-private/localhost_private_key.key:ro",
            compose_source,
        )
        self.assertIn(
            'for private_file in "$EASELECT_TLS_CERT_FILE" "$EASELECT_TLS_KEY_FILE"',
            docker_source,
        )
        self.assertIn("VITE_DEV_PORT=5173", compose_source)
        self.assertIn("VITE_HMR_PORT=${VITE_PORT:-5173}", compose_source)
        self.assertIn(
            'npm run dev -- --host 0.0.0.0 & go run .',
            compose_source,
        )
        self.assertNotIn(
            'npm run dev -- --host 0.0.0.0 & go run main.go',
            compose_source,
        )

    def test_dev_docker_tracks_supported_node_major_release(self) -> None:
        dockerfile = (PROJECT_ROOT / "docker/Dockerfile.dev").read_text(
            encoding="utf-8"
        )

        self.assertIn("nodejs~24", dockerfile)
        self.assertIn("npm~11", dockerfile)
        self.assertNotIn("nodejs=24.17.0-r0", dockerfile)

    def test_app_docker_images_declare_the_admin_runtime_mode(self) -> None:
        for relative_path in (
            "docker/Dockerfile",
            "docker/Dockerfile.dev",
            "docker/Dockerfile.mcp",
        ):
            with self.subTest(dockerfile=relative_path):
                dockerfile = (PROJECT_ROOT / relative_path).read_text(encoding="utf-8")
                self.assertIn("ENV EASELECT_RUNTIME_MODE=docker", dockerfile)

    def test_dev_docker_keeps_source_edits_out_of_recursive_chown_layer(self) -> None:
        dockerfile = (PROJECT_ROOT / "docker/Dockerfile.dev").read_text(
            encoding="utf-8"
        )

        self.assertIn(
            "RUN npm ci && chown -R easelect:easelect /app/node_modules",
            dockerfile,
        )
        self.assertIn("COPY --chown=easelect:easelect . .", dockerfile)
        self.assertNotIn("chown -R easelect:easelect /app\n", dockerfile)

    def test_docker_success_message_uses_actual_host_port_overrides(self) -> None:
        common_source = (PROJECT_ROOT / "server_tools/ctl/lib/common.sh").read_text(
            encoding="utf-8"
        )
        docker_source = (PROJECT_ROOT / "server_tools/ctl/lib/docker.sh").read_text(
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
                """
                PROJECT_ROOT="$1"
                EASELECT_PORT=8082
                APP_PORT=18082
                export PROJECT_ROOT EASELECT_PORT APP_PORT
                source "$PROJECT_ROOT/server_tools/ctl/lib/common.sh"
                source "$PROJECT_ROOT/server_tools/ctl/lib/docker.sh"
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
            PROJECT_ROOT / "server_tools/ctl/lib/docker.sh"
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
                """
                PROJECT_ROOT="$1"
                export PROJECT_ROOT
                source "$PROJECT_ROOT/server_tools/ctl/lib/docker.sh"
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
        for relative_path in (
            "server_tools/db_init/01_init_extensions.sh",
            "server_tools/shared_dev_db/stack/db_init/01_init_extensions.sh",
        ):
            with self.subTest(initializer=relative_path):
                initializer = (PROJECT_ROOT / relative_path).read_text(encoding="utf-8")
                self.assertIn("CREATE SCHEMA IF NOT EXISTS postgis", initializer)
                self.assertIn(
                    "CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA postgis",
                    initializer,
                )

    def test_healthcheck_and_default_database_binding_are_safe(self) -> None:
        for dockerfile_name in ("docker/Dockerfile", "docker/Dockerfile.mcp"):
            with self.subTest(dockerfile=dockerfile_name):
                dockerfile = (PROJECT_ROOT / dockerfile_name).read_text(encoding="utf-8")
                self.assertIn("http://localhost:8082/health", dockerfile)
                self.assertNotIn("http://localhost:8082/api/health", dockerfile)

        compose = (PROJECT_ROOT / "docker/docker-compose.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            "${DB_BIND_HOST:-127.0.0.1}:${DB_PORT:-5432}:5432",
            compose,
        )
        self.assertNotIn('"5432:5432"', compose)


if __name__ == "__main__":
    unittest.main()
