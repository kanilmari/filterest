"""test_installation_conformance.py
Verify bounded offline verdicts using synthetic saved site-shape evidence.
Connect public Compose rendering, launcher dispatch and shared deployment policy.
Protect unknown evidence, exact identities, independent findings and read-only operation.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys

import pytest

from server_tools.installation_conformance import compose_standard as standard
from server_tools.installation_conformance.check_installation import CHECKS, check_installation
from server_tools.lib.docker_compose_contract import compose_options, edge_scheme

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = Path(__file__).parent / "fixtures/installation_conformance"
CLI = ROOT / "app/server_tools/installation_conformance/check_installation.py"


def fixture(name):
    return json.loads((FIXTURES / name).read_text().replace("{INSTALLATION_SOURCE_ROOT}", str(ROOT)))


def section(snapshot, name):
    return json.loads(snapshot["sections"][name]["text"])


def replace_section(snapshot, name, value):
    snapshot["sections"][name] = {"exit": 0, "text": json.dumps(value, sort_keys=True)}


def run_check(tmp_path, snapshot=None, parameters=None):
    snapshot_file = tmp_path / "saved.json"
    parameters_file = tmp_path / "deployment.json"
    snapshot_file.write_text(json.dumps(snapshot if snapshot is not None else fixture("default_snapshot.json")))
    parameters_file.write_text(json.dumps(parameters if parameters is not None else fixture("default_parameters.json")))
    return check_installation(snapshot_file, parameters_file)


def results(verdict):
    return {check["id"]: check["result"] for check in verdict["checks"]}


@pytest.fixture
def default_renderer(monkeypatch):
    rendered = fixture("default_compose.json")
    monkeypatch.setattr("server_tools.installation_conformance.check_installation.render_standard",
                        lambda settings: copy.deepcopy(rendered))
    return rendered


def test_default_saved_contract_has_deterministic_numbered_verdict(tmp_path, default_renderer):
    first, status = run_check(tmp_path)
    second, second_status = run_check(tmp_path)
    assert first == second and status == second_status == 0
    assert first["counts"] == {"matched": 13, "differs": 0, "unknown": 0}
    assert first["execution_ready"] is False
    assert first["observed_at"] == "2026-10-04T12:00:00Z"
    assert [check["number"] for check in first["checks"]] == list(range(1, 14))
    assert first["snapshot_sha256"] == hashlib.sha256((tmp_path / "saved.json").read_bytes()).hexdigest()
    assert first["source"]["sha256"] == standard.digest(first["source"]["files"])
    assert first["exclusions"]


@pytest.mark.skipif(not shutil.which("docker"), reason="config-only Docker CLI required")
@pytest.mark.parametrize("stem", ["default", "proxy_private_pinned"])
def test_real_config_renderer_matches_saved_synthetic_contract(tmp_path, stem):
    verdict, status = run_check(tmp_path, fixture(stem + "_snapshot.json"), fixture(stem + "_parameters.json"))
    assert status == 0, verdict["errors"]
    assert verdict["counts"]["matched"] == 13


@pytest.mark.skipif(not shutil.which("docker"), reason="config-only Docker CLI required")
@pytest.mark.parametrize("edge", ["local-tls", "host-proxy"])
@pytest.mark.parametrize("published", [True, False])
@pytest.mark.parametrize("pinned", [True, False])
def test_all_deployment_fragment_combinations_render(edge, published, pinned):
    parameters = fixture("default_parameters.json")
    parameters.update(FILTEREST_EDGE=edge, FILTEREST_PUBLISH_DB_PORT=published, APP_PORT=18123, DB_PORT=55435)
    if pinned:
        parameters["FILTEREST_NETWORK_SUBNET"] = "172.30.99.0/24"
    settings = standard.validate_parameters(parameters)
    rendered = standard.render_standard(settings)
    facts = standard.standard_facts(rendered, settings)
    assert bool(facts["db_ports"]) == published
    assert facts["app_ports"][0]["published"] == 18123
    assert facts["network_addressing"]["allocation"] == ("pinned" if pinned else "automatic")
    assert rendered["services"]["app"]["environment"]["FILTEREST_LOCAL_TLS"] == ("false" if edge == "host-proxy" else "true")
    if pinned:
        assert facts["network_addressing"]["config"][0]["gateway"] == "172.30.99.1"


@pytest.mark.skipif(not shutil.which("docker"), reason="config-only Docker CLI required")
@pytest.mark.parametrize("identity", ["My Site", "site:prod", "'My Site'", '"site:prod"', "Site_$1"])
def test_established_instance_identity_is_preserved_in_comparison(identity):
    parameters = {**fixture("default_parameters.json"), "INSTANCE_NAME": identity}
    settings = standard.validate_parameters(parameters)
    rendered = standard.render_standard(settings)
    facts = standard.standard_facts(rendered, settings)
    assert facts["application_identity"]["sha256"] == standard.digest({
        "INSTANCE_NAME": identity, "SESSION_COOKIE_MODE": "isolated", "SESSION_COOKIE_NAME": ""})


@pytest.mark.parametrize("role,identifier", [("app", "C01"), ("db", "C02")])
@pytest.mark.parametrize("change", ["legacy", "extra", "access"])
def test_mount_layout_and_access_differences_are_exact(tmp_path, default_renderer, role, identifier, change):
    snapshot = fixture("default_snapshot.json")
    container = section(snapshot, role + "_inspect")
    if change == "legacy":
        container["mounts"][0]["Destination"] = "/app/storage"
        container["mounts"][0]["Source"] = "/srv/legacy/storage"
    elif change == "extra":
        container["mounts"].append({"Type": "bind", "Source": "/srv/extra", "Destination": "/extra", "RW": True})
    else:
        container["mounts"][0]["RW"] = not container["mounts"][0]["RW"]
    replace_section(snapshot, role + "_inspect", container)
    verdict, status = run_check(tmp_path, snapshot)
    assert status == 1 and results(verdict)[identifier] == "differs"
    assert verdict["counts"]["matched"] == 12


@pytest.mark.parametrize("label", ["project", "service", "project.working_dir", "project.config_files"])
def test_foreign_compose_authority_never_normalizes_identity(tmp_path, default_renderer, label):
    snapshot = fixture("default_snapshot.json")
    container = section(snapshot, "app_inspect")
    container["labels"]["com.docker.compose." + label] = "foreign" if label in ("project", "service") else "/srv/foreign/compose.yml"
    replace_section(snapshot, "app_inspect", container)
    if label == "service":
        shape = section(snapshot, "compose_shape")
        shape["services"]["foreign"] = shape["services"].pop("app")
        replace_section(snapshot, "compose_shape", shape)
    verdict, status = run_check(tmp_path, snapshot)
    assert status == 1 and results(verdict)["C07"] == "differs"
    assert results(verdict)["C10"] == "matched"


def test_ports_hardening_environment_and_cookie_differences_survive_together(tmp_path, default_renderer):
    snapshot = fixture("default_snapshot.json")
    app = section(snapshot, "app_inspect")
    app["host_config"]["ReadonlyRootfs"] = False
    app["host_config"]["PortBindings"]["8082/tcp"][0]["HostPort"] = "18200"
    replace_section(snapshot, "app_inspect", app)
    shape = section(snapshot, "compose_shape")
    shape["services"]["app"]["environment"]["FILTEREST_MANAGER_ENABLED"] = "literal"
    replace_section(snapshot, "compose_shape", shape)
    identity = section(snapshot, "application_identity")
    identity["INSTANCE_NAME"] = "Another.Site"
    replace_section(snapshot, "application_identity", identity)
    verdict, status = run_check(tmp_path, snapshot)
    assert status == 1
    assert {key for key, value in results(verdict).items() if value == "differs"} == {"C03", "C09", "C10", "C12"}
    assert "Another.Site" not in json.dumps(verdict)


@pytest.mark.parametrize("change", ["allocation", "gateway", "container", "malformed", "missing"])
def test_network_addressing_requires_consistent_allocation_and_gateway(tmp_path, default_renderer, change):
    snapshot = fixture("default_snapshot.json")
    network = section(snapshot, "network/synthetic_default")
    if change == "allocation":
        shape = section(snapshot, "compose_shape")
        shape["networks"]["default"] = {"ipam": {"config": [{"subnet": "172.30.88.0/24"}]}}
        replace_section(snapshot, "compose_shape", shape)
    elif change == "gateway":
        network["IPAM"]["Config"][0]["Gateway"] = "172.30.88.255"
    elif change == "container":
        app = section(snapshot, "app_inspect")
        app["networks"]["synthetic_default"]["Gateway"] = "172.30.88.254"
        replace_section(snapshot, "app_inspect", app)
    elif change == "malformed":
        network["IPAM"]["Config"][0]["Subnet"] = "sensitive-invalid-subnet"
    else:
        network["IPAM"]["Config"][0].pop("Gateway")
    replace_section(snapshot, "network/synthetic_default", network)
    verdict, status = run_check(tmp_path, snapshot)
    assert status == (2 if change in ("malformed", "missing") else 1)
    assert results(verdict)["C06"] == ("unknown" if status == 2 else "differs")
    assert "sensitive-invalid-subnet" not in json.dumps(verdict)


def test_runtime_key_coverage_and_added_capabilities_are_checked(tmp_path, default_renderer):
    snapshot = fixture("default_snapshot.json")
    app = section(snapshot, "app_inspect")
    app["env_keys"].remove("DB_PASSWORD")
    app["host_config"]["CapAdd"] = ["SYS_ADMIN"]
    replace_section(snapshot, "app_inspect", app)
    verdict, status = run_check(tmp_path, snapshot)
    assert status == 1 and results(verdict)["C09"] == results(verdict)["C10"] == "differs"


def test_optional_passthrough_and_image_environment_keys_do_not_create_false_differences(tmp_path, default_renderer):
    snapshot = fixture("default_snapshot.json")
    app = section(snapshot, "app_inspect")
    assert "EASELECT_MIGRATION_FILE_ALLOWLIST" not in app["env_keys"]
    app["env_keys"].extend(["PATH", "HOSTNAME"])
    replace_section(snapshot, "app_inspect", app)
    verdict, status = run_check(tmp_path, snapshot)
    assert status == 0 and results(verdict)["C10"] == "matched"


def test_partial_hardening_keeps_known_difference_and_reports_unknown_field(tmp_path, default_renderer):
    snapshot = fixture("default_snapshot.json")
    app = section(snapshot, "app_inspect")
    app["host_config"]["ReadonlyRootfs"] = False
    app["host_config"].pop("Tmpfs")
    replace_section(snapshot, "app_inspect", app)
    verdict, status = run_check(tmp_path, snapshot)
    assert status == 2 and results(verdict)["C09"] == "differs"
    assert verdict["unknowns"] == [{"check_id": "C09", "fields": ["tmpfs"],
                                   "reason": "Hardening evidence missing or invalid"}]


def test_tmpfs_inspection_representation_is_checked_once(tmp_path, default_renderer):
    snapshot = fixture("default_snapshot.json")
    app = section(snapshot, "app_inspect")
    app["mounts"].append({"Type": "tmpfs", "Source": "", "Destination": "/tmp", "RW": True})
    replace_section(snapshot, "app_inspect", app)
    verdict, status = run_check(tmp_path, snapshot)
    assert status == 0 and verdict["counts"]["matched"] == 13


@pytest.mark.parametrize("section_name,check_id", [("app_inspect", "C01"), ("db_inspect", "C02"),
    ("network/synthetic_default", "C06"), ("compose_shape", "C10"),
    ("application_identity", "C12"), ("effective_configuration", "C13")])
@pytest.mark.parametrize("failure", ["missing", "failed", "malformed", "duplicate"])
def test_bad_sections_are_unknown_with_independent_differences(tmp_path, default_renderer, section_name, check_id, failure):
    snapshot = fixture("default_snapshot.json")
    app = section(snapshot, "app_inspect")
    app["host_config"]["ReadonlyRootfs"] = False
    replace_section(snapshot, "app_inspect", app)
    if failure == "missing":
        snapshot["sections"].pop(section_name)
    else:
        snapshot["sections"][section_name] = {"exit": 1 if failure == "failed" else 0,
            "text": '{"secret":"hidden","secret":"hidden"}' if failure == "duplicate" else "hidden-invalid-section"}
    verdict, status = run_check(tmp_path, snapshot)
    assert status == 2 and results(verdict)[check_id] == "unknown"
    if section_name != "app_inspect":
        assert results(verdict)["C09"] == "differs"
    assert "hidden" not in json.dumps(verdict)


@pytest.mark.parametrize("field", ["schema", "collected_at", "sections", "domain", "ssh_target"])
def test_missing_snapshot_metadata_refuses_success(tmp_path, default_renderer, field):
    snapshot = fixture("default_snapshot.json")
    snapshot.pop(field)
    verdict, status = run_check(tmp_path, snapshot)
    assert status == 2 and verdict["errors"]


@pytest.mark.parametrize("text", ['{"schema":1,"schema":1}', 'not-json-secret', '[1]', '{"schema":NaN}', '{'])
def test_invalid_inputs_keep_digests_and_fixed_diagnostics(tmp_path, default_renderer, text):
    snapshot_file = tmp_path / "saved.json"
    parameters_file = tmp_path / "deployment.json"
    snapshot_file.write_text(text)
    parameters_file.write_text(json.dumps(fixture("default_parameters.json")))
    verdict, status = check_installation(snapshot_file, parameters_file)
    assert status == 2
    assert verdict["snapshot_sha256"] == hashlib.sha256(text.encode()).hexdigest()
    assert "not-json-secret" not in json.dumps(verdict)
    assert len(verdict["checks"]) == len(CHECKS)


@pytest.mark.parametrize("parameters", [[], {"DB_ADMIN_PASSWORD": "secret"},
    {"FILTEREST_DB_PORTS_FILE": "/foreign.yml"}, {"APP_PORT": 0}, {"APP_PORT": "$SECRET"},
    {"installation_root": "/srv/../foreign"}, {"FILTEREST_NETWORK_GATEWAY": "172.30.99.1"}])
def test_parameters_reject_credentials_selectors_and_malformed_values(tmp_path, default_renderer, parameters):
    supplied = parameters if isinstance(parameters, list) else {**fixture("default_parameters.json"), **parameters}
    verdict, status = run_check(tmp_path, parameters=supplied)
    assert status == 2 and verdict["errors"]
    assert '"secret"' not in json.dumps(verdict)


def test_duplicate_parameter_keys_are_refused_without_discarding_observations(tmp_path, default_renderer):
    snapshot_file = tmp_path / "saved.json"
    parameters_file = tmp_path / "deployment.json"
    snapshot_file.write_text(json.dumps(fixture("default_snapshot.json")))
    parameters_file.write_text('{"INSTANCE_NAME":"hidden-value","INSTANCE_NAME":"hidden-value"}')
    verdict, status = check_installation(snapshot_file, parameters_file)
    assert status == 2 and "Duplicate JSON keys" in verdict["errors"][0]
    assert verdict["checks"][0]["observed"] is not None
    assert "hidden-value" not in json.dumps(verdict)


def test_no_cli_is_a_clear_refusal_with_safe_observed_facts(tmp_path, monkeypatch):
    monkeypatch.setattr(standard.shutil, "which", lambda command: None)
    verdict, status = run_check(tmp_path)
    assert status == 2 and "docker compose CLI is required" in verdict["errors"][0]
    assert verdict["checks"][0]["observed"] is not None
    assert verdict["source"]["sha256"]


def test_renderer_uses_only_config_and_scrubs_polluted_environment(monkeypatch):
    for key in ("COMPOSE_FILE", "COMPOSE_ENV_FILES", "DOCKER_CONFIG", "HTTP_PROXY", "FILTEREST_NETWORK_FILE",
                "DB_ADMIN_PASSWORD", "INSTANCE_NAME", "FILTEREST_LOCAL_TLS"):
        monkeypatch.setenv(key, "polluted-secret")
    calls = []
    monkeypatch.setattr(standard.shutil, "which", lambda command: "/usr/bin/docker")
    def config_only(arguments, **kwargs):
        calls.append((arguments, kwargs))
        return subprocess.CompletedProcess(arguments, 0, json.dumps(fixture("default_compose.json")), "")
    monkeypatch.setattr(standard.subprocess, "run", config_only)
    standard.render_standard(standard.validate_parameters(fixture("default_parameters.json")))
    arguments, options = calls[0]
    assert arguments == ["/usr/bin/docker", "compose", "--file", str(ROOT / "compose.yml"),
                         "--env-file", os.devnull, "--project-name", "synthetic", "config", "--format", "json"]
    assert "polluted-secret" not in json.dumps(options["env"])
    assert options["env"]["DB_ADMIN_PASSWORD"] == "synthetic-conformance-secret"
    assert "COMPOSE_FILE" not in options["env"] and "HTTP_PROXY" not in options["env"]


def test_failed_config_never_echoes_subprocess_secret(tmp_path, monkeypatch):
    monkeypatch.setattr(standard.shutil, "which", lambda command: "/usr/bin/docker")
    monkeypatch.setattr(standard.subprocess, "run", lambda *args, **kwargs:
                        subprocess.CompletedProcess(args[0], 1, "secret-stdout", "secret-stderr"))
    verdict, status = run_check(tmp_path)
    assert status == 2 and "secret-stdout" not in json.dumps(verdict) and "secret-stderr" not in json.dumps(verdict)


@pytest.mark.parametrize("name", ["default_snapshot.json", "proxy_private_pinned_snapshot.json"])
def test_fixture_contains_no_site_registry_or_real_secret(name):
    saved = fixture(name)
    assert "registry_profile" not in saved and saved["domain"].endswith(".invalid")


def test_shared_policy_preserves_default_and_explicit_reset_behavior():
    assert compose_options() == {}
    assert edge_scheme("") == edge_scheme("local-tls") == "https"
    assert edge_scheme("host-proxy") == "http"
    assert compose_options(previous_ports="legacy", previous_network="legacy") == {
        "FILTEREST_DB_PORTS_FILE": "docker-compose.db-published.yml",
        "FILTEREST_NETWORK_FILE": "docker-compose.network-auto.yml"}
    assert compose_options("false", "172.30.99.0/24")["FILTEREST_NETWORK_GATEWAY"] == "172.30.99.1"


@pytest.mark.parametrize("launcher", [ROOT / "filterest", ROOT / "app/filterest"])
def test_launchers_use_offline_dispatch_without_writes_or_settings(tmp_path, launcher):
    # The supervisor writes worker logs in the real runtime while this test runs.
    # An isolated installation lets every file change belong to this command.
    installation = tmp_path / "installation"
    application = installation / "app"
    application.mkdir(parents=True)
    for relative in ("filterest", "app/filterest", "app/go.mod", "app/VERSION_APP", "compose.yml"):
        shutil.copy2(ROOT / relative, installation / relative)
    for directory in ("lib", "installation_conformance"):
        shutil.copytree(ROOT / "app/server_tools" / directory,
                        application / "server_tools" / directory, ignore=shutil.ignore_patterns("__pycache__"))
    (application / "docker").mkdir()
    for source in (ROOT / "app/docker").glob("docker-compose*.yml"):
        shutil.copy2(source, application / "docker" / source.name)
    fake_docker = tmp_path / "docker"
    rendered_file = tmp_path / "rendered.json"
    rendered_file.write_text(json.dumps(fixture("default_compose.json")).replace(str(ROOT), str(installation)))
    fake_docker.write_text("#!/bin/sh\nexec /bin/cat -- " + shlex.quote(str(rendered_file)) + "\n")
    fake_docker.chmod(0o755)
    environment = {**os.environ, "PATH": str(tmp_path) + ":" + os.environ["PATH"],
        "COMPOSE_FILE": "/forbidden.yml", "DB_ADMIN_PASSWORD": "operator-secret",
        "PYTHONPYCACHEPREFIX": "relative-invalid-cache", "FILTEREST_RUNTIME_ROOT_OVERRIDE": str(tmp_path),
        "FILTEREST_RESOLVE_ENV_LIB": "/forbidden-settings", "PYTHONPATH": "/forbidden-pythonpath"}
    def inventory():
        return {str(path): (path.stat().st_size, path.stat().st_mtime_ns)
                for path in tmp_path.rglob("*") if path.is_file()}
    before = inventory()
    arguments = [str(installation / launcher.relative_to(ROOT)), "conform", "--snapshot", str(FIXTURES / "default_snapshot.json"),
                 "--parameters", str(FIXTURES / "default_parameters.json")]
    completed = subprocess.run(arguments, cwd=installation, env=environment, capture_output=True, text=True)
    assert completed.returncode == 0, completed.stderr + completed.stdout
    assert completed.stderr == "" and len(completed.stdout.splitlines()) == 1
    assert json.loads(completed.stdout)["execution_ready"] is False
    assert "operator-secret" not in completed.stdout
    assert inventory() == before


@pytest.mark.skipif(not shutil.which("docker"), reason="config-only Docker CLI required")
def test_python_boundary_denies_all_writes_and_any_key_reads():
    # Audit the command process itself, after imports, so test setup may write its
    # own fixtures. The external renderer is separately constrained to config.
    program = '''
import os, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from server_tools.installation_conformance.check_installation import main
def guard(event, arguments):
    if event == 'open':
        path, mode, flags = arguments
        if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
            raise RuntimeError('write denied')
        if isinstance(path, str) and 'keys' in Path(path).parts:
            raise RuntimeError('key read denied')
sys.addaudithook(guard)
raise SystemExit(main(sys.argv[2:]))
'''
    completed = subprocess.run([sys.executable, "-I", "-B", "-c", program, str(ROOT / "app"),
        "--snapshot", str(FIXTURES / "default_snapshot.json"),
        "--parameters", str(FIXTURES / "default_parameters.json")], capture_output=True, text=True)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert json.loads(completed.stdout)["counts"]["matched"] == 13


def test_cli_malformed_arguments_and_sections_never_print_tracebacks(tmp_path):
    bad = tmp_path / "sensitive-name.json"
    bad.write_text('{"schema":1,"sections":{},"collected_at":"2026-10-04T12:00:00Z"}')
    for arguments in (["--unknown", "typed-secret"], ["--snapshot", str(bad), "--parameters", str(bad)]):
        completed = subprocess.run([sys.executable, "-I", "-B", str(CLI), *arguments], capture_output=True, text=True)
        assert completed.returncode == 2 and completed.stderr == ""
        verdict = json.loads(completed.stdout)
        assert verdict["execution_ready"] is False
        assert "typed-secret" not in completed.stdout and "sensitive-name" not in completed.stdout
        assert "Traceback" not in completed.stdout


def test_missing_conformance_library_produces_a_numbered_json_refusal(tmp_path):
    destination = tmp_path / "app/server_tools/installation_conformance/check_installation.py"
    destination.parent.mkdir(parents=True)
    shutil.copy2(CLI, destination)
    completed = subprocess.run([sys.executable, "-I", "-B", str(destination)], capture_output=True, text=True)
    assert completed.returncode == 2 and completed.stderr == ""
    verdict = json.loads(completed.stdout)
    assert len(verdict["checks"]) == 13 and verdict["counts"]["unknown"] == 13
    assert "Traceback" not in completed.stdout and str(tmp_path) not in completed.stdout
