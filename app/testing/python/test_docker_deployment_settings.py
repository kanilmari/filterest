"""test_docker_deployment_settings.py
Verify opt-in public Docker deployment settings and unchanged generated defaults.
Connect shell setup/readiness and Compose contracts to synthetic Docker inventories.
Exercise the real runner without Docker, network requests or database access.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
import stat
import subprocess
import unittest

import test_filterest_docker_runner as runner_tests

RUNNER = runner_tests.RUNNER
SOURCE_ROOT = runner_tests.SOURCE_ROOT


class DockerDeploymentSettingsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = runner_tests.FilterestDockerRunnerTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root
        self.env_file = self.root / "keys/docker.env"

    def write_settings(self, **settings: str) -> None:
        self.env_file.parent.mkdir(exist_ok=True)
        self.env_file.write_text(
            "".join(f"{key}={value}\n" for key, value in settings.items()), encoding="utf-8"
        )

    def run_unchecked(self, *arguments: str, **environment: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(RUNNER), *arguments], check=False, capture_output=True,
            text=True, env=self.fixture.environment(environment),
        )

    def network_environment(self, *networks: dict) -> dict[str, str]:
        return {
            "FILTEREST_DOCKER_TEST_NETWORK_IDS": "".join(f"id-{i}\n" for i in range(len(networks))),
            "FILTEREST_DOCKER_TEST_NETWORKS": json.dumps(networks),
        }

    def network(self, subnet: str, gateway: str = "", project: str = "") -> dict:
        return {
            "Name": "synthetic-network",
            "Labels": {"com.docker.compose.project": project, "com.docker.compose.network": "default"},
            "IPAM": {"Config": [{"Subnet": subnet, "Gateway": gateway}]},
        }

    def test_no_new_settings_matches_pre_change_generated_files_and_calls(self) -> None:
        # Captured from base a60cffa before editing the runner. Only randomness,
        # certificate bytes and the installing user's IDs are made deterministic.
        environment = self.fixture.environment({
            "FILTEREST_DOCKER_RUNNER_LIBRARY_ONLY": "1", "RUNNER_PATH": str(RUNNER),
        })
        environment.pop("COMPOSE_PROJECT_NAME", None)
        environment.pop("INSTANCE_NAME", None)
        completed = subprocess.run(["bash", "-c", '''source "$RUNNER_PATH"
random_hex() { printf '%048d' 0; }
prepare_tls_identity() {
 printf 'test certificate\\n' > "$TLS_DIRECTORY/localhost.crt"
 printf 'test private key\\n' > "$TLS_DIRECTORY/localhost.key"
 chmod 0644 "$TLS_DIRECTORY/localhost.crt"
 chmod 0600 "$TLS_DIRECTORY/localhost.key"
}
main setup
main start
'''], env=environment, capture_output=True, text=True, check=True)
        expected = json.loads((Path(__file__).parent / "fixtures/docker_runner_defaults.json").read_text())
        actual = {"files": {}, "directories": {}}
        for home in ("config", "keys", "projects", "data", "backups"):
            for path in [self.root / home, *(self.root / home).rglob("*")]:
                relative = str(path.relative_to(self.root))
                mode = oct(stat.S_IMODE(path.stat().st_mode))
                if path.is_dir():
                    actual["directories"][relative] = mode
                else:
                    content = path.read_text().replace(
                        f"FILTEREST_RUNTIME_UID={os.getuid()}", "FILTEREST_RUNTIME_UID=<uid>"
                    ).replace(f"FILTEREST_RUNTIME_GID={os.getgid()}", "FILTEREST_RUNTIME_GID=<gid>")
                    actual["files"][relative] = {"content": content, "mode": mode}
        # The golden freezes launch behaviour, not the new read-only safety
        # inspections. Keep the current template outside this fixture: unrelated
        # scaffold additions must still pass through setup without rewriting.
        template = (SOURCE_ROOT / ".env.example").read_text()
        overrides = expected["files"]["keys/docker.env"].pop("overrides")
        for key, value in overrides.items():
            pattern = rf"^{key}=.*$"
            if re.search(pattern, template, flags=re.MULTILINE):
                template = re.sub(pattern, f"{key}={value}", template, flags=re.MULTILINE)
            else:
                template += f"{key}={value}\n"
        expected["files"]["keys/docker.env"]["content"] = template
        calls = self.fixture.docker_log.read_text().replace(str(self.root), "<root>")
        actual["docker_calls"] = "".join(
            line.replace("compose version --short", "compose version") + "\n"
            for line in calls.splitlines()
            if not line.startswith(("network ls --quiet", "network inspect ", "ps --all --quiet ", "container inspect "))
        )
        # Validation and the launch path both enforce the version gate.
        actual["docker_calls"] = actual["docker_calls"].replace("compose version\ncompose version\n", "compose version\n")
        self.assertEqual(actual, expected)
        self.assertIn("https://localhost:8100/first-run", completed.stdout)

    def test_host_proxy_setup_start_and_readiness_use_http_without_certificates(self) -> None:
        self.write_settings(
            FILTEREST_EDGE="host-proxy", APP_PORT="18123", BASE_URL="https://example.invalid",
            COMPOSE_PROJECT_NAME="operator-site", INSTANCE_NAME="Site_1.example",
        )
        self.fixture.run_runner("setup")
        settings_before = self.env_file.read_bytes()
        started = self.fixture.run_runner("start")
        self.assertEqual(self.env_file.read_bytes(), settings_before)
        self.assertEqual(self.fixture.settings()["FILTEREST_LOCAL_TLS"], "false")
        self.assertEqual(list((self.root / "keys/tls").iterdir()), [])
        self.assertIn("https://example.invalid/first-run", started.stdout)
        self.fixture.add_ready_response(1, "200", self.fixture.ready_body())
        self.fixture.run_update_action("ready-check", "--expect-version", "8.43.0", "--timeout", "1")
        self.assertEqual((self.fixture.curl_responses / "urls").read_text(), "http://localhost:18123/system/ready\n")
        self.assertNotIn("--cacert", (self.fixture.curl_responses / "arguments").read_text())
        dry_run = self.fixture.run_update_action("ready-check", "--expect-version", "8.43.0", "--dry-run")
        self.assertIn("http://localhost:18123/system/ready", dry_run.stdout)

    def test_explicit_local_tls_and_return_from_proxy_generate_https_identity(self) -> None:
        self.write_settings(FILTEREST_EDGE="local-tls", APP_PORT="18124")
        self.fixture.run_runner("setup")
        self.assertEqual(self.fixture.settings()["FILTEREST_LOCAL_TLS"], "true")
        self.assertTrue((self.root / "keys/tls/localhost.crt").is_file())
        self.fixture.add_ready_response(1, "200", self.fixture.ready_body())
        self.fixture.run_update_action("ready-check", "--expect-version", "8.43.0", "--timeout", "1")
        self.assertIn("--cacert", (self.fixture.curl_responses / "arguments").read_text())
        self.assertEqual((self.fixture.curl_responses / "urls").read_text(), "https://localhost:18124/system/ready\n")

    def test_proxy_preserves_an_existing_certificate_and_can_switch_back(self) -> None:
        self.fixture.run_runner("setup")
        certificate = self.root / "keys/tls/localhost.crt"
        before = certificate.read_bytes()
        with self.env_file.open("a") as file:
            file.write("FILTEREST_EDGE=host-proxy\n")
        self.fixture.run_runner("setup")
        self.assertEqual(certificate.read_bytes(), before)
        self.assertEqual(self.fixture.settings()["BASE_URL"], "http://localhost:8100")
        self.env_file.write_text(self.env_file.read_text().replace("FILTEREST_EDGE=host-proxy", "FILTEREST_EDGE=local-tls"))
        self.fixture.run_runner("setup")
        self.assertEqual(certificate.read_bytes(), before)
        self.assertEqual(self.fixture.settings()["BASE_URL"], "https://localhost:8100")

    def test_operator_identity_from_flags_is_persisted_and_conflicts_are_refused(self) -> None:
        self.fixture.run_runner("setup", "--project-name", "my-site_1", "--instance-name", "Site_1.example")
        first_settings = self.env_file.read_bytes()
        self.fixture.run_runner("setup")
        self.fixture.run_runner("start")
        self.assertEqual(first_settings, self.env_file.read_bytes())
        for flag in ("--project-name", "--instance-name"):
            refused = self.run_unchecked("setup", flag, "different")
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn("will not replace", refused.stderr)
            self.assertEqual(first_settings, self.env_file.read_bytes())

    def test_operator_identity_from_environment_is_persisted(self) -> None:
        self.fixture.run_runner("setup", extra_environment={"COMPOSE_PROJECT_NAME": "env-site", "INSTANCE_NAME": "Env.site"})
        self.assertEqual(self.fixture.settings()["COMPOSE_PROJECT_NAME"], "env-site")
        self.assertEqual(self.fixture.settings()["INSTANCE_NAME"], "Env.site")

    def test_template_placeholder_is_regenerated_unless_installation_is_established(self) -> None:
        self.write_settings(COMPOSE_PROJECT_NAME="filterest-local", INSTANCE_NAME="filterest-local")
        self.fixture.run_runner("setup")
        self.assertRegex(self.fixture.settings()["COMPOSE_PROJECT_NAME"], r"^filterest-[0-9a-f]{8}$")
        self.assertEqual(self.fixture.settings()["INSTANCE_NAME"], self.fixture.settings()["COMPOSE_PROJECT_NAME"])
        for project in ("filterest-local", "operator-project"):
            for instance in (None, "", "filterest-local"):
                with self.subTest(project=project, instance=instance):
                    settings = {"FILTEREST_INSTALL_PROFILE": "docker", "COMPOSE_PROJECT_NAME": project}
                    if instance is not None:
                        settings["INSTANCE_NAME"] = instance
                    self.write_settings(**settings)
                    self.fixture.run_runner("setup")
                    self.assertEqual(self.fixture.settings()["COMPOSE_PROJECT_NAME"], project)
                    self.assertEqual(self.fixture.settings()["INSTANCE_NAME"], "filterest-local")
        self.write_settings(COMPOSE_PROJECT_NAME="operator-project")
        self.fixture.run_runner("setup")
        self.assertEqual(self.fixture.settings()["INSTANCE_NAME"], "operator-project")

    def test_invalid_identity_edge_ports_and_proxy_binding_are_refused(self) -> None:
        for settings, error in (
            ({"COMPOSE_PROJECT_NAME": "Uppercase"}, "COMPOSE_PROJECT_NAME"),
            ({"COMPOSE_PROJECT_NAME": "../escape"}, "COMPOSE_PROJECT_NAME"),
            ({"INSTANCE_NAME": "space name"}, "INSTANCE_NAME"),
            ({"INSTANCE_NAME": "bad$name"}, "INSTANCE_NAME"),
            ({"FILTEREST_EDGE": "unknown"}, "FILTEREST_EDGE"),
            ({"APP_PORT": "0"}, "APP_PORT"),
            ({"APP_PORT": "18446744073709559716"}, "APP_PORT"),
            ({"DB_PORT": "65536"}, "DB_PORT"),
            ({"FILTEREST_EDGE": "host-proxy", "APP_BIND_HOST": "0.0.0.0"}, "loopback"),
            ({"FILTEREST_PUBLISH_DB_PORT": "maybe"}, "FILTEREST_PUBLISH_DB_PORT"),
            ({"BASE_URL": "javascript:bad"}, "BASE_URL"),
        ):
            with self.subTest(settings=settings):
                self.write_settings(**settings)
                failed = self.run_unchecked("setup")
                self.assertNotEqual(failed.returncode, 0)
                self.assertIn(error, failed.stderr)
        self.assertFalse(self.fixture.docker_log.exists())

    def test_removing_network_settings_returns_to_docker_allocation(self) -> None:
        self.write_settings(FILTEREST_NETWORK_SUBNET="172.30.99.0/24", FILTEREST_EDGE="host-proxy")
        self.fixture.run_runner("setup")
        settings = self.fixture.settings()
        settings["FILTEREST_NETWORK_SUBNET"] = ""
        settings["FILTEREST_NETWORK_GATEWAY"] = ""
        self.write_settings(**settings)
        self.fixture.docker_log.unlink()
        self.fixture.run_runner("setup")
        self.assertEqual(self.fixture.settings()["FILTEREST_NETWORK_FILE"], "docker-compose.network-auto.yml")
        self.assertNotIn(" up ", self.fixture.docker_log.read_text())

    def test_proxy_port_override_preserves_the_public_base_url(self) -> None:
        self.write_settings(FILTEREST_EDGE="host-proxy", BASE_URL="https://example.invalid/app/")
        self.fixture.run_runner("setup", "--app-port", "18125")
        self.assertEqual(self.fixture.settings()["BASE_URL"], "https://example.invalid/app/")
        self.fixture.run_runner("start", "--app-port", "18126")
        self.assertEqual(self.fixture.settings()["BASE_URL"], "https://example.invalid/app/")
        self.fixture.run_runner("setup", "--base-url", "https://new.example.invalid")
        self.assertEqual(self.fixture.settings()["BASE_URL"], "https://new.example.invalid")

    def test_proxy_without_a_base_url_derives_http_from_the_loopback_port(self) -> None:
        self.write_settings(FILTEREST_EDGE="host-proxy")
        self.fixture.run_runner("setup", "--app-port", "18127")
        self.assertEqual(self.fixture.settings()["BASE_URL"], "http://localhost:18127")

    def test_database_publication_is_opt_in_configurable_and_reversible(self) -> None:
        self.write_settings(FILTEREST_PUBLISH_DB_PORT="false", FILTEREST_EDGE="host-proxy")
        self.fixture.run_runner("setup")
        selected = self.fixture.settings()["FILTEREST_DB_PORTS_FILE"]
        self.assertEqual(selected, "docker-compose.db-private.yml")
        private = (SOURCE_ROOT / "docker" / selected).read_text()
        self.assertIn("    ports: []\n", private)
        self.assertIn("file: docker-compose.db-base.yml\n      service: db", private)
        self.fixture.run_runner("start")
        self.assertEqual(self.fixture.settings()["FILTEREST_DB_PORTS_FILE"], selected)
        self.env_file.write_text(self.env_file.read_text().replace("FILTEREST_PUBLISH_DB_PORT=false", "FILTEREST_PUBLISH_DB_PORT=true"))
        self.fixture.run_runner("setup", "--db-port", "55435")
        self.assertEqual(self.fixture.settings()["FILTEREST_DB_PORTS_FILE"], "docker-compose.db-published.yml")
        self.assertEqual(self.fixture.settings()["DB_PORT"], "55435")
        published = (SOURCE_ROOT / "docker/docker-compose.db-published.yml").read_text()
        self.assertIn('    ports:\n      - "${DB_BIND_HOST:-127.0.0.1}:${DB_PORT:-5433}:5432"', published)
        compose = (SOURCE_ROOT / "docker/docker-compose.yml").read_text()
        self.assertIn("path: ${FILTEREST_DB_PORTS_FILE:-docker-compose.db-published.yml}", compose)

    def test_pinned_network_uses_derived_or_explicit_gateway_and_no_default_ipam(self) -> None:
        self.write_settings(FILTEREST_NETWORK_SUBNET="172.30.99.0/24", FILTEREST_EDGE="host-proxy")
        self.fixture.run_runner("setup")
        self.assertEqual(self.fixture.settings()["FILTEREST_NETWORK_GATEWAY"], "172.30.99.1")
        self.assertEqual(self.fixture.settings()["FILTEREST_NETWORK_FILE"], "docker-compose.network-pinned.yml")
        self.write_settings(FILTEREST_NETWORK_SUBNET="172.30.99.0/24", FILTEREST_NETWORK_GATEWAY="172.30.99.254")
        self.fixture.run_runner("setup")
        self.assertEqual(self.fixture.settings()["FILTEREST_NETWORK_GATEWAY"], "172.30.99.254")
        pinned = (SOURCE_ROOT / "docker/docker-compose.network-pinned.yml").read_text()
        self.assertIn("networks:\n  default:\n    ipam:\n      config:\n", pinned)
        self.assertIn("- subnet: ${FILTEREST_NETWORK_SUBNET:?Set FILTEREST_NETWORK_SUBNET}", pinned)
        self.assertIn("gateway: ${FILTEREST_NETWORK_GATEWAY:?Run ./filterest docker setup}", pinned)
        auto = (SOURCE_ROOT / "docker/docker-compose.network-auto.yml").read_text()
        self.assertEqual("\n".join(line for line in auto.splitlines() if not line.startswith("#")), "networks:\n  default: {}")
        compose = (SOURCE_ROOT / "docker/docker-compose.yml").read_text()
        self.assertIn("path: ${FILTEREST_NETWORK_FILE:-docker-compose.network-auto.yml}", compose)

    def test_pinned_network_refuses_foreign_overlap_containment_and_exact_match(self) -> None:
        self.write_settings(FILTEREST_NETWORK_SUBNET="172.30.99.0/24", FILTEREST_EDGE="host-proxy", COMPOSE_PROJECT_NAME="my-site")
        for subnet, project in (("172.30.0.0/16", "other"), ("172.30.99.128/25", "other"),
                                ("172.30.99.0/24", "other"), ("172.30.99.0/24", "")):
            with self.subTest(subnet=subnet, project=project):
                failed = self.run_unchecked("start", **self.network_environment(self.network(subnet, "172.30.99.1", project)))
                self.assertNotEqual(failed.returncode, 0)
                self.assertIn("overlaps", failed.stderr)
        self.assertNotIn(" up ", self.fixture.docker_log.read_text())

    def test_pinned_network_checks_again_on_start_and_allows_unchanged_own_network(self) -> None:
        self.write_settings(FILTEREST_NETWORK_SUBNET="172.30.99.0/24", COMPOSE_PROJECT_NAME="my-site")
        self.fixture.run_runner("setup")
        environment = self.network_environment(
            self.network("172.30.99.0/24", "172.30.99.1", "my-site"),
            self.network("172.30.100.0/24", "172.30.100.1", "other"),
            self.network("2001:db8::/64", "2001:db8::1", "other"),
        )
        self.fixture.run_runner("start", extra_environment=environment)
        calls = self.fixture.docker_log.read_text()
        self.assertIn("network inspect id-0 id-1 id-2", calls)
        self.assertLess(calls.index("network inspect"), calls.index(" up "))
        failed = self.run_unchecked("start", **self.network_environment(self.network("172.30.99.0/24", "172.30.99.2", "my-site")))
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("different IPAM settings", failed.stderr)

    def test_network_inventory_failures_are_not_reported_as_success(self) -> None:
        self.write_settings(FILTEREST_NETWORK_SUBNET="172.30.99.0/24")
        for environment in (
            {"FILTEREST_DOCKER_TEST_NETWORK_LIST_STATUS": "1"},
            {"FILTEREST_DOCKER_TEST_NETWORK_IDS": "id-0", "FILTEREST_DOCKER_TEST_NETWORK_INSPECT_STATUS": "1"},
            {"FILTEREST_DOCKER_TEST_NETWORK_IDS": "id-0", "FILTEREST_DOCKER_TEST_NETWORKS": "not json"},
        ):
            with self.subTest(environment=environment):
                failed = self.run_unchecked("start", **environment)
                self.assertNotEqual(failed.returncode, 0)
                self.assertNotIn("Filterest is ready", failed.stdout)
        self.assertNotIn(" up ", self.fixture.docker_log.read_text())

    def test_invalid_subnets_and_gateways_are_refused_before_docker(self) -> None:
        for subnet, gateway in (("172.30.99.7/24", ""), ("not-a-network", ""),
                                ("172.30.99.0/30", ""), ("172.30.99.0/31", ""), ("2001:db8::/64", ""),
                                ("172.30.99.0/24", "172.30.99.0"), ("172.30.99.0/24", "172.30.99.255"),
                                ("172.30.99.0/24", "172.30.100.1"), ("", "172.30.99.1")):
            with self.subTest(subnet=subnet, gateway=gateway):
                self.write_settings(FILTEREST_NETWORK_SUBNET=subnet, FILTEREST_NETWORK_GATEWAY=gateway)
                failed = self.run_unchecked("setup")
                self.assertNotEqual(failed.returncode, 0)
                self.assertIn("network" if subnet else "FILTEREST_NETWORK_GATEWAY", failed.stderr)
        self.assertFalse(self.fixture.docker_log.exists())

    def test_inherited_compose_values_cannot_bypass_proxy_or_network_checks(self) -> None:
        self.write_settings(FILTEREST_EDGE="host-proxy", FILTEREST_NETWORK_SUBNET="172.30.99.0/24")
        for key, value in (("FILTEREST_LOCAL_TLS", "true"), ("FILTEREST_NETWORK_SUBNET", "172.30.100.0/24"),
                           ("FILTEREST_NETWORK_FILE", "docker-compose.network-auto.yml")):
            with self.subTest(key=key):
                failed = self.run_unchecked("start", **{key: value})
                self.assertNotEqual(failed.returncode, 0)
                self.assertIn(f"Inherited {key}", failed.stderr)
        self.assertFalse(self.fixture.docker_log.exists())

    def existing_settings(self, **overrides: str) -> str:
        fixture = (Path(__file__).parent / "fixtures/docker_runner_v9_3_21.env").read_text()
        fixture = fixture.replace("<uid>", str(os.getuid())).replace("<gid>", str(os.getgid()))
        for key, value in overrides.items():
            fixture = re.sub(rf"^{key}=.*$", f"{key}={value}", fixture, flags=re.MULTILINE)
        self.env_file.parent.mkdir(exist_ok=True)
        self.env_file.write_text(fixture)
        (self.root / "app/VERSION_APP").write_text("9.3.21\n")
        (self.root / "app/VERSION_DB").write_text("9.9.2\n")
        return fixture

    def test_existing_v9_3_21_golden_preserves_file_identities_secrets_and_launch(self) -> None:
        for identity in ("filterest-abc12345", "filterest-local"):
            with self.subTest(identity=identity):
                before = self.existing_settings(COMPOSE_PROJECT_NAME=identity, INSTANCE_NAME=identity)
                self.fixture.run_runner("setup")
                self.fixture.run_runner("start")
                self.assertEqual(self.env_file.read_text(), before)
                self.assertEqual(stat.S_IMODE(self.env_file.stat().st_mode), 0o600)
                self.assertIn(f"label=com.docker.compose.project={identity}", self.fixture.docker_log.read_text())
                self.assertIn(" up --build --detach --wait\n", self.fixture.docker_log.read_text())
                self.assertNotIn("FILTEREST_NETWORK_FILE", self.env_file.read_text())
                self.assertNotIn("FILTEREST_DB_PORTS_FILE", self.env_file.read_text())
                self.env_file.write_text(before)
                self.fixture.run_update_action("start", "--for-update")
                self.assertEqual(self.env_file.read_text(), before)
                self.assertIn(" up --build --detach\n", self.fixture.docker_log.read_text())

    def test_update_keeps_effective_empty_or_absent_instance_identity(self) -> None:
        for instance in ("empty", "absent"):
            with self.subTest(instance=instance):
                before = self.existing_settings(INSTANCE_NAME="")
                if instance == "absent":
                    before = re.sub(r"^INSTANCE_NAME=\n", "", before, flags=re.MULTILINE)
                    self.env_file.write_text(before)
                previous = self.fixture.settings()
                self.fixture.run_update_action("start", "--for-update")
                current = self.fixture.settings()
                self.assertEqual(current["INSTANCE_NAME"], "filterest-local")
                for key, value in previous.items():
                    if key != "INSTANCE_NAME":
                        self.assertEqual(current[key], value)
                self.assertEqual(current["COMPOSE_PROJECT_NAME"], "filterest-abc12345")

    def test_default_port_changes_keep_custom_url_and_refresh_local_defaults(self) -> None:
        for url, expected in (("https://public.example.invalid", "https://public.example.invalid"),
                              ("", "https://localhost:18199"),
                              ("https://localhost:8100", "https://localhost:18199")):
            with self.subTest(url=url):
                self.existing_settings(BASE_URL=url, APP_PORT="18198")
                self.fixture.run_runner("setup", "--app-port", "18199")
                self.assertEqual(self.fixture.settings()["BASE_URL"], expected)
        for url in ("https://localhost:8100", ""):
            with self.subTest(stored_url=url):
                before = self.existing_settings(BASE_URL=url, APP_PORT="18198")
                for action in ("setup", "start"):
                    self.fixture.run_runner(action)
                    self.assertEqual(self.fixture.settings().get("BASE_URL", ""), url)
                self.assertEqual(self.env_file.read_text(), before)

    def test_update_accepts_legacy_stored_instance_names_and_base_urls(self) -> None:
        for instance in ("My Site", "site:prod", "'My Site'", '"site:prod"'):
            with self.subTest(instance=instance):
                before = self.existing_settings(INSTANCE_NAME=instance, BASE_URL="HTTPS://legacy.example.invalid/app?old=1")
                self.fixture.run_update_action("update-preflight", "--dry-run")
                self.fixture.run_update_action("start", "--for-update")
                self.assertEqual(self.env_file.read_text(), before)
        # The same text introduced through a new file or a flag remains invalid.
        for arguments, settings in (
            (("setup", "--instance-name", "My Site"), {}),
            (("setup", "--base-url", "HTTPS://legacy.example.invalid"), {}),
            (("setup",), {"INSTANCE_NAME": "site:prod"}),
            (("setup",), {"BASE_URL": "HTTPS://legacy.example.invalid"}),
        ):
            self.write_settings(**settings)
            before = self.env_file.read_bytes()
            self.assertNotEqual(self.run_unchecked(*arguments).returncode, 0)
            self.assertEqual(self.env_file.read_bytes(), before)

    def container_environment(self, project: str, directory: str | None) -> dict[str, str]:
        labels = {"com.docker.compose.project": project}
        if directory is not None:
            labels["com.docker.compose.project.working_dir"] = directory
        return {
            "FILTEREST_DOCKER_TEST_CONTAINER_IDS": "container-1\n",
            "FILTEREST_DOCKER_TEST_CONTAINERS": json.dumps([{"Config": {"Labels": labels}}]),
        }

    def test_same_project_in_another_folder_is_refused_for_containers_and_networks(self) -> None:
        for identity_source in ("file", "flag", "shell"):
            for resource in ("container", "network"):
                with self.subTest(identity_source=identity_source, resource=resource):
                    settings = {"FILTEREST_EDGE": "host-proxy"}
                    arguments = ["start"]
                    environment = {}
                    if identity_source == "file":
                        settings["COMPOSE_PROJECT_NAME"] = "shared-site"
                    elif identity_source == "flag":
                        arguments += ["--project-name", "shared-site"]
                    else:
                        environment["COMPOSE_PROJECT_NAME"] = "shared-site"
                    self.write_settings(**settings)
                    before = self.env_file.read_bytes()
                    if resource == "container":
                        environment.update(self.container_environment("shared-site", str(self.root.parent / "another-installation")))
                    else:
                        network = self.network("172.30.99.0/24", "172.30.99.1", "shared-site")
                        network["Labels"]["com.docker.compose.project.working_dir"] = str(self.root.parent / "another-installation")
                        environment.update(self.network_environment(network))
                    refused = self.run_unchecked(*arguments, **environment)
                    self.assertNotEqual(refused.returncode, 0)
                    self.assertIn("different installation folder", refused.stderr)
                    self.assertEqual(self.env_file.read_bytes(), before)
        self.assertNotIn(" up ", self.fixture.docker_log.read_text())

    def test_same_project_in_this_folder_is_allowed_including_stopped_containers(self) -> None:
        self.existing_settings()
        self.fixture.run_runner("start", extra_environment=self.container_environment("filterest-abc12345", str(self.root)))
        calls = self.fixture.docker_log.read_text()
        self.assertIn("ps --all --quiet", calls)
        self.assertLess(calls.index("container inspect"), calls.index(" up "))

    def test_default_start_fails_closed_when_project_inventory_cannot_be_proven(self) -> None:
        for environment in (
            {"FILTEREST_DOCKER_TEST_CONTAINER_LIST_STATUS": "1"},
            {"FILTEREST_DOCKER_TEST_CONTAINER_IDS": "container-1", "FILTEREST_DOCKER_TEST_CONTAINER_INSPECT_STATUS": "1"},
            {"FILTEREST_DOCKER_TEST_CONTAINER_IDS": "container-1", "FILTEREST_DOCKER_TEST_CONTAINERS": "not json"},
            {"FILTEREST_DOCKER_TEST_CONTAINER_IDS": "container-1", "FILTEREST_DOCKER_TEST_CONTAINERS": "[]"},
            self.container_environment("filterest-abc12345", None),
            {"FILTEREST_DOCKER_TEST_NETWORK_LIST_STATUS": "1"},
            {"FILTEREST_DOCKER_TEST_NETWORK_IDS": "network-1", "FILTEREST_DOCKER_TEST_NETWORKS": "[]"},
        ):
            with self.subTest(environment=environment):
                before = self.existing_settings()
                refused = self.run_unchecked("start", **environment)
                self.assertNotEqual(refused.returncode, 0)
                self.assertEqual(self.env_file.read_text(), before)
        self.assertNotIn(" up ", self.fixture.docker_log.read_text())

    def test_inherited_default_selectors_are_checked_on_start_and_update(self) -> None:
        bad_values = {
            "FILTEREST_EDGE": "host-proxy", "FILTEREST_PUBLISH_DB_PORT": "false",
            "FILTEREST_DB_PORTS_FILE": "docker-compose.db-private.yml",
            "FILTEREST_NETWORK_FILE": "docker-compose.network-pinned.yml",
            "FILTEREST_LOCAL_TLS": "false",
        }
        for key, value in bad_values.items():
            for action in ("start", "update-preflight"):
                with self.subTest(key=key, action=action):
                    before = self.existing_settings()
                    refused = self.run_unchecked(action, **{key: value})
                    self.assertNotEqual(refused.returncode, 0)
                    self.assertIn("Inherited", refused.stderr)
                    self.assertIn(key, refused.stderr)
                    self.assertEqual(self.env_file.read_text(), before)
        self.assertFalse(self.fixture.docker_log.exists())
        self.fixture.run_runner("start", extra_environment={
            "FILTEREST_EDGE": "local-tls", "FILTEREST_PUBLISH_DB_PORT": "true",
            "FILTEREST_DB_PORTS_FILE": "docker-compose.db-published.yml",
            "FILTEREST_NETWORK_FILE": "docker-compose.network-auto.yml",
        })

    def test_network_allocation_switch_requires_stop_in_both_directions(self) -> None:
        for previous, subnet in (("pinned", ""), ("auto", "172.30.99.0/24")):
            for action in ("setup", "start"):
                with self.subTest(previous=previous, action=action):
                    self.write_settings(
                        FILTEREST_INSTALL_PROFILE="docker", COMPOSE_PROJECT_NAME="my-site",
                        FILTEREST_NETWORK_FILE=f"docker-compose.network-{previous}.yml",
                        FILTEREST_NETWORK_SUBNET=subnet,
                        FILTEREST_NETWORK_GATEWAY="172.30.99.1" if subnet else "",
                    )
                    before = self.env_file.read_bytes()
                    environment = self.network_environment(self.network("172.30.99.0/24", "172.30.99.1", "my-site"))
                    refused = self.run_unchecked(action, **environment)
                    self.assertNotEqual(refused.returncode, 0)
                    self.assertIn("stop first", refused.stderr)
                    self.assertEqual(self.env_file.read_bytes(), before)
                    self.fixture.run_runner(action)  # After stop removed the network.
                    selected = "pinned" if subnet else "auto"
                    self.assertEqual(self.fixture.settings()["FILTEREST_NETWORK_FILE"], f"docker-compose.network-{selected}.yml")

    def test_stop_remains_usable_after_clearing_pinned_network_values(self) -> None:
        self.existing_settings()
        with self.env_file.open("a") as settings:
            settings.write("FILTEREST_NETWORK_FILE=docker-compose.network-pinned.yml\n"
                           "FILTEREST_NETWORK_SUBNET=\nFILTEREST_NETWORK_GATEWAY=\n")
        before = self.env_file.read_bytes()
        result = self.fixture.run_runner("stop")
        self.assertEqual(self.env_file.read_bytes(), before)
        self.assertIn("Filterest stopped", result.stdout)
        self.assertIn("down-environment FILTEREST_NETWORK_FILE=docker-compose.network-auto.yml", self.fixture.docker_log.read_text())

    def test_reserved_network_ranges_are_refused_and_public_ranges_warn(self) -> None:
        for subnet in ("0.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "224.0.0.0/4",
                       "240.0.0.0/4", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24",
                       "192.88.99.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
                       "126.0.0.0/7"):
            with self.subTest(subnet=subnet):
                self.write_settings(FILTEREST_NETWORK_SUBNET=subnet)
                before = self.env_file.read_bytes()
                refused = self.run_unchecked("setup")
                self.assertNotEqual(refused.returncode, 0)
                self.assertIn("reserved/special-use", refused.stderr)
                self.assertEqual(self.env_file.read_bytes(), before)
        self.assertFalse(self.fixture.docker_log.exists())
        self.write_settings(FILTEREST_NETWORK_SUBNET="8.8.8.0/24")
        warned = self.fixture.run_runner("setup")
        self.assertIn("outside private RFC 1918", warned.stderr)

    def test_refused_setup_keeps_settings_and_tls_unchanged(self) -> None:
        for settings, arguments, environment in (
            ({"COMPOSE_PROJECT_NAME": "stored-project"}, ("--project-name", "new-project", "--app-port", "18199"), {}),
            ({"INSTANCE_NAME": "stored-instance"}, ("--instance-name", "new-instance", "--base-url", "https://new.invalid"), {}),
            ({"FILTEREST_PUBLISH_DB_PORT": "invalid"}, ("--app-port", "18199"), {}),
            ({"FILTEREST_NETWORK_SUBNET": "127.0.0.0/8"}, ("--base-url", "https://new.invalid"), {}),
            ({"FILTEREST_EDGE": "host-proxy"}, ("--app-port", "18199"), {"FILTEREST_LOCAL_TLS": "true"}),
        ):
            with self.subTest(settings=settings):
                self.write_settings(**settings)
                self.env_file.chmod(0o640)
                before = self.env_file.read_bytes()
                refused = self.run_unchecked("setup", *arguments, **environment)
                self.assertNotEqual(refused.returncode, 0)
                self.assertEqual(self.env_file.read_bytes(), before)
                self.assertEqual(stat.S_IMODE(self.env_file.stat().st_mode), 0o640)
                self.assertFalse((self.root / "keys/tls").exists())
                self.assertFalse((self.root / "keys/filterest_runtime").exists())

    def test_host_proxy_warns_on_http_or_loopback_public_url(self) -> None:
        for url, warnings in (
            ("", ("Secure", "loopback")), ("http://example.invalid", ("Secure",)),
            ("https://127.0.0.2:18100", ("loopback",)), ("https://localhost", ("loopback",)),
            ("https://[::1]:18100", ("loopback",)), ("https://[0:0::1]", ("loopback",)),
            ("https://[::ffff:127.0.0.1]", ("loopback",)), ("https://example.invalid", ()),
        ):
            with self.subTest(url=url):
                self.write_settings(FILTEREST_EDGE="host-proxy", BASE_URL=url)
                result = self.fixture.run_runner("setup")
                for warning in warnings:
                    self.assertIn(warning, result.stderr)
                if not warnings:
                    self.assertNotIn("warning:", result.stderr)

    def test_compose_version_gate_accepts_documented_minimum_and_newer_majors(self) -> None:
        for version, accepted in (("2.19.9", False), ("1.29.2", False), ("garbage", False),
                                  ("2.19.1+ds1-0ubuntu1~24.04.1", False), ("2.20.0", True), ("2.40.3", True),
                                  ("v5.6.0", True), ("2.40.3+ds1-0ubuntu1~24.04.1", True),
                                  ("2.29.7-desktop.1", True), ("2.26.1-4", True)):
            with self.subTest(version=version):
                before = self.existing_settings()
                result = self.run_unchecked("start", FILTEREST_DOCKER_TEST_COMPOSE_VERSION=version)
                self.assertEqual(result.returncode == 0, accepted)
                self.assertEqual(self.env_file.read_text(), before)
                if not accepted:
                    self.assertIn("2.20.0 or newer", result.stderr)

    def test_identity_conflicts_name_shell_and_new_flags_require_setup_or_start(self) -> None:
        before = self.existing_settings()
        for key in ("COMPOSE_PROJECT_NAME", "INSTANCE_NAME"):
            result = self.run_unchecked("setup", **{key: "different"})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("from the shell", result.stderr)
            self.assertEqual(self.env_file.read_text(), before)
        for action in ("stop", "status", "logs"):
            for flag, value in (("--project-name", "my-site"), ("--instance-name", "my-site"),
                                ("--base-url", "https://example.invalid")):
                with self.subTest(action=action, flag=flag):
                    result = self.run_unchecked(action, flag, value)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("applies only to setup or start", result.stderr)
        self.assertFalse(self.fixture.docker_log.exists())

    def test_new_base_urls_cannot_trigger_compose_dollar_interpolation(self) -> None:
        for url in ("https://$DOMAIN", "https://example.invalid/$PATH", "https://example.invalid/${PATH}"):
            for through_flag in (False, True):
                with self.subTest(url=url, through_flag=through_flag):
                    self.write_settings(**({} if through_flag else {"BASE_URL": url}))
                    before = self.env_file.read_bytes()
                    arguments = ("--base-url", url) if through_flag else ()
                    result = self.run_unchecked("setup", *arguments)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("dollar sign", result.stderr)
                    self.assertEqual(self.env_file.read_bytes(), before)



if __name__ == "__main__":
    unittest.main()
