"""test_runtime_contract_status.py
What: Verifies local runtime evidence, redaction and existing status dispatch.
Between what: Exercises real path resolution and isolated CLI entrypoints.
Why: Configuration inspection must not become a probe, initializer or secret dump.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest

from server_tools.agent_tools import dev_status
from server_tools.lib import runtime_contract_status as runtime
from server_tools.lib.dev_status_path_resolver import resolve_dev_status_paths

APP_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def installation(tmp_path):
    root = tmp_path / "filterest"
    app = root / "app"
    app.mkdir(parents=True)
    (app / "go.mod").write_text("module example.invalid/filterest\n")
    (app / "VERSION_APP").write_text("9.3.7\n")
    return root, resolve_dev_status_paths(app, {})


@pytest.mark.parametrize("configured,state", [
    ("admin", "configured"), ("development", "configured"), ("docker", "configured"),
    ("", "not_configured"), ("unrecognized-private-value", "unknown"),
])
def test_profile_is_configuration_not_a_db_host_inference(installation, configured, state):
    _, paths = installation
    report = runtime.collect_runtime_contract(paths, {
        "FILTEREST_INSTALL_PROFILE": configured, "DB_HOST": "db",
    })
    assert report["profile"]["state"] == state
    assert report["profile"]["configured"] == (configured if state == "configured" else None)
    assert report["readiness"]["status"] == "not_checked"
    assert report["running_identity"]["status"] == "not_checked"
    if state == "unknown":
        assert configured not in json.dumps(report)


def test_five_roles_expose_presence_without_credentials(installation, capsys):
    _, paths = installation
    environment = {"UNRELATED_API_TOKEN": "never-return-this-token", "DB_HOST": "db",
                   "DB_PORT": "5432", "DB_NAME": "filterest", "ENVIRONMENT_TYPE": "dev"}
    secrets = [environment["UNRELATED_API_TOKEN"]]
    for index, role in enumerate(runtime.DATABASE_ROLES):
        user = f"private-user-{index}"
        password = f"private-password-{index}"
        secrets.extend([user, password])
        environment[f"DB_{role.upper()}_USER"] = user
        environment[f"DB_{role.upper()}_PASSWORD"] = password if index % 2 == 0 else ""
    report = runtime.collect_runtime_contract(paths, environment)
    assert set(report["database"]["role_credentials"]) == set(runtime.DATABASE_ROLES)
    for index, role in enumerate(runtime.DATABASE_ROLES):
        assert report["database"]["role_credentials"][role] == {
            "user_present": True, "password_present": index % 2 == 0,
        }
    assert report["database"]["target"] == {
        "host": "db", "port": "5432", "name": "filterest", "sslmode": "disable",
    }
    runtime.print_runtime_contract(report)
    output = json.dumps(report) + capsys.readouterr().out
    assert all(secret not in output for secret in secrets)


def test_unset_database_target_is_not_claimed_as_active(installation):
    _, paths = installation
    report = runtime.collect_runtime_contract(paths, {})
    assert report["database"]["target"] == {
        "host": None, "port": None, "name": None, "sslmode": "require",
    }
    assert all(not any(flags.values()) for flags in report["database"]["role_credentials"].values())


@pytest.mark.parametrize("sslmode,environment_type,expected", [
    ("", "dev", "disable"), ("", "production", "require"),
    ("verify-full", "dev", "verify-full"), ("", " dev ", "disable"),
])
def test_ssl_default_preserves_existing_status_rule(sslmode, environment_type, expected):
    environment = {"DB_SSLMODE": sslmode, "ENVIRONMENT_TYPE": environment_type}
    assert dev_status.resolve_sslmode(environment) == expected
    assert runtime.resolve_database_sslmode(environment) == expected


def test_malformed_public_target_does_not_echo_uri_credentials(installation):
    _, paths = installation
    report = runtime.collect_runtime_contract(paths, {
        "DB_HOST": "postgres://someone:secret-password@host/db",
        "DB_PORT": "port=5432 password=secret-port",
        "DB_NAME": "dbname=prod password=secret-name",
        "DB_SSLMODE": "require password=secret-ssl",
    })
    output = json.dumps(report)
    for secret in ("secret-password", "secret-port", "secret-name", "secret-ssl"):
        assert secret not in output
    assert all(value == "(redacted invalid value)" for value in report["database"]["target"].values())


def test_real_resolvers_keep_missing_homes_and_files_unchanged(installation, monkeypatch):
    root, paths = installation
    (root / "config").mkdir()
    (root / "config/filterest.paths").write_text(
        "schema_version=1\nprojects_home=operator-projects\nkeys_home=operator-keys\n"
    )
    before = sorted(str(path.relative_to(root)) for path in root.rglob("*"))
    def forbidden(*args, **kwargs):
        raise AssertionError("runtime status attempted a write or probe")
    for operation in ("mkdir", "write_text", "write_bytes", "unlink"):
        monkeypatch.setattr(Path, operation, forbidden)
    monkeypatch.setattr(subprocess, "run", forbidden)
    monkeypatch.setattr(dev_status.psycopg2, "connect", forbidden)
    report = runtime.collect_runtime_contract(paths, {"FILTEREST_RUNTIME_DATA_HOME": "custom-runtime"})
    assert "error" not in report
    assert report["paths_evidence"] == "tooling_and_layout_configuration"
    assert report["paths"]["application"]["resolved"] == str(root / "app")
    assert report["paths"]["project"]["resolved"] == str(root)
    assert report["paths"]["projects_home"] == {"resolved": str(root / "operator-projects"), "exists": False}
    assert report["paths"]["keys_home"] == {"resolved": str(root / "operator-keys"), "exists": False}
    assert report["paths"]["runtime_data_home"]["resolved"] == str(root / "custom-runtime")
    assert report["paths"]["storage"]["resolved"] == str(root / "data/storage")
    assert report["paths"]["storage_deleted"]["resolved"] == str(root / "data/storage_deleted")
    assert sorted(str(path.relative_to(root)) for path in root.rglob("*")) == before


def test_path_error_is_redacted(installation, monkeypatch, capsys):
    _, paths = installation
    def broken(*args):
        raise ValueError("bad path contains secret-value")
    monkeypatch.setattr(runtime, "resolve_filterest_homes", broken)
    report = runtime.collect_runtime_contract(paths, {})
    assert report["error"] == runtime.CONFIGURATION_ERROR
    runtime.print_runtime_contract(report)
    assert "secret-value" not in json.dumps(report) + capsys.readouterr().out


def test_environment_precedence_is_runtime_then_development_then_process(tmp_path, monkeypatch):
    runtime_file = tmp_path / "runtime.env"
    dev_file = tmp_path / "development.env"
    runtime_file.write_text("ONLY_RUNTIME=one\nSHARED=runtime\nFROM_DEVELOPMENT=runtime\n")
    dev_file.write_text("ONLY_DEVELOPMENT=two\nSHARED=development\nFROM_DEVELOPMENT=development\n")
    monkeypatch.setattr(dev_status, "resolve_easelect_private_paths", lambda root: SimpleNamespace(
        runtime_env_file=runtime_file, development_env_file=dev_file,
    ))
    monkeypatch.setattr(dev_status, "os", SimpleNamespace(environ={"SHARED": "process"}))
    assert dev_status.resolve_environment() == {
        "ONLY_RUNTIME": "one", "ONLY_DEVELOPMENT": "two",
        "SHARED": "process", "FROM_DEVELOPMENT": "development",
    }


def test_runtime_only_main_does_not_enter_live_status(installation, monkeypatch, capsys):
    _, paths = installation
    monkeypatch.setattr(dev_status, "STATUS_PATHS", paths)
    monkeypatch.setattr(dev_status, "resolve_environment", lambda: {})
    monkeypatch.setattr(sys, "argv", ["dev_status", "--runtime-only", "--json"])
    def forbidden():
        raise AssertionError("live collector called")
    monkeypatch.setattr(dev_status, "collect_status", forbidden)
    monkeypatch.setattr(dev_status, "collect_shared_dev_storage_status", forbidden)
    assert dev_status.main() == 0
    output = json.loads(capsys.readouterr().out)
    assert output["evidence"] == "configured_environment"
    assert output["readiness"]["status"] == "not_checked"


@pytest.mark.parametrize("as_json", [False, True])
def test_runtime_environment_exception_is_redacted(installation, monkeypatch, capsys, as_json):
    def broken():
        raise ValueError("private-key-path-and-password")
    monkeypatch.setattr(dev_status, "resolve_environment", broken)
    monkeypatch.setattr(sys, "argv", ["dev_status", "--runtime-only"] + (["--json"] if as_json else []))
    assert dev_status.main() == 1
    captured = capsys.readouterr()
    assert "private-key-path-and-password" not in captured.out + captured.err
    assert runtime.CONFIGURATION_ERROR in captured.out


@pytest.mark.parametrize("status,strict,expected", [
    ({"checks": [], "warnings": []}, False, 0),
    ({"checks": [], "warnings": ["old warning"]}, False, 0),
    ({"checks": [], "warnings": ["old warning"]}, True, 2),
    ({"error": "old error", "warnings": []}, False, 1),
])
def test_normal_status_main_keeps_output_and_exit_codes(monkeypatch, capsys, status, strict, expected):
    monkeypatch.setattr(sys, "argv", ["dev_status", "--json"] + (["--strict"] if strict else []))
    monkeypatch.setattr(dev_status, "collect_status", lambda: status)
    def forbidden():
        raise AssertionError("runtime-only collector used by normal dispatch")
    monkeypatch.setattr(dev_status, "resolve_environment", forbidden)
    assert dev_status.main() == expected
    assert json.loads(capsys.readouterr().out) == status


def test_normal_human_dispatch_and_exception_keep_existing_behavior(capsys):
    args = runtime.parse_status_args([])
    seen = []
    assert runtime.run_status_cli(args, lambda: {"checks": []}, seen.append, lambda: None) == 0
    assert seen == [{"checks": []}]
    def broken():
        raise RuntimeError("existing collector failure")
    assert runtime.run_status_cli(args, broken, seen.append, lambda: None) == 1
    assert capsys.readouterr().err == "error: existing collector failure\n"


def test_normal_collector_adds_configuration_without_changing_its_db_target(installation, monkeypatch):
    _, paths = installation
    monkeypatch.setattr(dev_status, "STATUS_PATHS", paths)
    monkeypatch.setattr(dev_status, "resolve_environment", lambda: {"DB_READONLY_PASSWORD": "private-password"})
    monkeypatch.setattr(dev_status, "read_current_app_version", lambda: ("9.3.7", "VERSION_APP"))
    monkeypatch.setattr(dev_status, "read_required_text", lambda path: "9.7.14")
    monkeypatch.setattr(dev_status, "read_current_manifest_row", lambda version: {"target_db_version": "9.7.14"})
    monkeypatch.setattr(dev_status, "collect_shared_dev_storage_status", lambda env: {"legacy": True})
    attempts = []
    def failed_connection(**kwargs):
        attempts.append(kwargs)
        raise RuntimeError("test connection stopped")
    monkeypatch.setattr(dev_status.psycopg2, "connect", failed_connection)
    report = dev_status.collect_status()
    assert report["runtime_contract"]["readiness"]["status"] == "not_checked"
    assert report["database_target"] == {
        "host": "localhost", "port": "5432", "name": "easelect",
        "readonly_user": "readeronly", "sslmode": "require",
    }
    assert report["shared_dev_storage"] == {"legacy": True}
    assert attempts[0]["password"] == "private-password"
    assert "private-password" not in json.dumps(report)
    assert report["error"] == "Database connection failed: test connection stopped"


@pytest.mark.parametrize("entrypoint", ["script", "module", "launcher"])
def test_cli_runtime_only_works_from_another_directory(installation, tmp_path, entrypoint):
    root, _ = installation
    elsewhere = tmp_path / "unrelated"
    elsewhere.mkdir()
    environment = {
        "PATH": os.environ["PATH"], "HOME": str(tmp_path),
        "PYTHONPATH": str(APP_ROOT), "PYTHONDONTWRITEBYTECODE": "1",
        "FILTEREST_PROJECT_ROOT_OVERRIDE": str(root), "FILTEREST_INSTALL_PROFILE": "development",
        "DB_ADMIN_USER": "never-show-cli-user", "DB_ADMIN_PASSWORD": "never-show-cli-password",
    }
    if entrypoint == "module":
        command = [sys.executable, "-B", "-m", "server_tools.agent_tools.dev_status"]
    elif entrypoint == "launcher":
        # Public launcher is real; a fixture venv selects the same tested Python.
        venv_bin = root / "data/runtime/python/venv/bin"
        venv_bin.mkdir(parents=True)
        (venv_bin / "python3").symlink_to(sys.executable)
        command = ["bash", str(APP_ROOT / "filterest"), "status"]
    else:
        command = [sys.executable, "-B", str(APP_ROOT / "server_tools/agent_tools/dev_status.py")]
    before = sorted(str(path.relative_to(root)) for path in root.rglob("*"))
    result = subprocess.run(command + ["--runtime-only", "--json"], cwd=elsewhere,
                            env=environment, capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr
    output = json.loads(result.stdout)
    assert output["profile"]["configured"] == "development"
    assert output["paths"]["project"]["resolved"] == str(root)
    assert output["readiness"]["status"] == "not_checked"
    assert "never-show-cli" not in result.stdout + result.stderr
    assert sorted(str(path.relative_to(root)) for path in root.rglob("*")) == before


def test_runtime_strict_reports_missing_homes(installation, capsys):
    _, paths = installation
    args = runtime.parse_status_args(["--runtime-only", "--strict", "--json"])
    assert runtime.run_status_cli(args, lambda: None, lambda value: None,
                                  lambda: runtime.collect_runtime_contract(paths, {})) == 2
    assert json.loads(capsys.readouterr().out)["warnings"]
