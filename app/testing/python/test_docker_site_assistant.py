"""Verify the optional public Docker link to a separately owned site runner.

Exercise real setup with fake Docker, offline Compose rendering and backup archives.
No database, Docker engine, runner account or model request is used.
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import tarfile

import pytest

from server_tools.installation_conformance import compose_standard as standard
from server_tools.lib import recovery_archives
from server_tools.lib.docker_compose_contract import compose_options
from server_tools.lib.docker_site_assistant import (
    ASSISTANT_KEYS, ASSISTANT_SELECTOR, DISABLED_FRAGMENT, ENABLED_FRAGMENT,
    SOCKET_TARGET, assistant_options,
)
import test_filterest_docker_runner as runner_tests


def assistant_settings(parent: Path) -> dict[str, str]:
    return dict(zip(ASSISTANT_KEYS, (
        str(parent / "runner-socket"), "12345", "example.invalid",
        "http://127.0.0.1:18123", str(parent / "runner-uploads"),
    )))


@pytest.fixture
def installation():
    fixture = runner_tests.FilterestDockerRunnerTests()
    fixture.setUp()
    settings = assistant_settings(fixture.root.parent)
    for key in (ASSISTANT_KEYS[0], ASSISTANT_KEYS[-1]):
        Path(settings[key]).mkdir()
    file = fixture.root / "keys/docker.env"
    file.parent.mkdir()
    file.write_text("FILTEREST_EDGE=host-proxy\n" + "".join(f"{key}={value}\n" for key, value in settings.items()))
    try:
        yield fixture, settings, file
    finally:
        fixture.doCleanups()


def run(fixture, action, environment=None):
    return subprocess.run(["bash", str(runner_tests.RUNNER), action],
                          env=fixture.environment(environment), capture_output=True, text=True)


def test_absent_settings_leave_defaults_and_old_selection_can_be_disabled():
    assert compose_options() == {}
    assert assistant_options({ASSISTANT_SELECTOR: ENABLED_FRAGMENT}) == {
        ASSISTANT_SELECTOR: DISABLED_FRAGMENT}


@pytest.mark.parametrize("missing", ASSISTANT_KEYS)
def test_partial_connection_is_refused_before_any_settings_change(installation, missing):
    fixture, settings, file = installation
    del settings[missing]
    file.write_text("".join(f"{key}={value}\n" for key, value in settings.items()))
    before = file.read_bytes()
    result = run(fixture, "setup")
    assert result.returncode != 0 and "together" in result.stderr
    assert file.read_bytes() == before
    assert not fixture.docker_log.exists()


@pytest.mark.parametrize("key,value", [
    ("FILTEREST_CODING_AGENT_SOCKET_DIR", "/"),
    ("FILTEREST_CODING_AGENT_SOCKET_DIR", "/run"),
    ("FILTEREST_CODING_AGENT_SOCKET_DIR", "/run/../secret"),
    ("FILTEREST_CODING_AGENT_SOCKET_DIR", "/run//runner"),
    ("FILTEREST_CODING_AGENT_SOCKET_DIR", "//run/runner"),
    ("FILTEREST_CODING_AGENT_SOCKET_DIR", "/run/$RUNNER"),
    ("FILTEREST_CODING_AGENT_SOCKET_DIR", "relative"),
    ("FILTEREST_CODING_AGENT_IPC_GID", "0"),
    ("FILTEREST_CODING_AGENT_IPC_GID", "-1"),
    ("FILTEREST_CODING_AGENT_IPC_GID", "999999999999"),
    ("FILTEREST_CODING_AGENT_SITE_ID", "other/site"),
    ("FILTEREST_SITE_ASSISTANT_BASE_URL", "http://public.example"),
    ("FILTEREST_SITE_ASSISTANT_BASE_URL", "http://[::1]:18123"),
    ("FILTEREST_SITE_ASSISTANT_BASE_URL", "https://user:password@example.invalid"),
    ("FILTEREST_SITE_ASSISTANT_BASE_URL", "https://@example.invalid"),
    ("FILTEREST_SITE_ASSISTANT_BASE_URL", "http://localhost:99999"),
    ("FILTEREST_SITE_ASSISTANT_BASE_URL", "http://localhost:8082/api"),
    ("FILTEREST_SITE_ASSISTANT_BASE_URL", "http://localhost:8082?token=hidden"),
    ("FILTEREST_CODING_AGENT_UPLOAD_DIR", "/filterest/data/uploads"),
    ("FILTEREST_CODING_AGENT_UPLOAD_DIR", "/etc/config"),
    ("FILTEREST_CODING_AGENT_UPLOAD_DIR", SOCKET_TARGET + "/uploads"),
])
def test_unsafe_inputs_are_refused_without_echoing_their_values(tmp_path, key, value):
    settings = {**assistant_settings(tmp_path), key: value}
    with pytest.raises(ValueError) as error:
        assistant_options(settings, str(tmp_path / "installation"))
    assert value not in str(error.value)


@pytest.mark.parametrize("kind", ["socket-inside", "upload-inside", "socket-parent", "overlap"])
def test_external_mounts_cannot_include_installation_or_each_other(tmp_path, kind):
    root = tmp_path / "installation"
    settings = assistant_settings(tmp_path)
    if kind == "socket-inside":
        settings[ASSISTANT_KEYS[0]] = str(root / "data/socket")
    elif kind == "upload-inside":
        settings[ASSISTANT_KEYS[-1]] = str(root / "data/uploads")
    elif kind == "socket-parent":
        settings[ASSISTANT_KEYS[0]] = str(tmp_path)
    else:
        settings[ASSISTANT_KEYS[-1]] = settings[ASSISTANT_KEYS[0]] + "/uploads"
    with pytest.raises(ValueError):
        assistant_options(settings, str(root))


@pytest.mark.parametrize("kind", ["missing", "symlink", "file"])
def test_setup_requires_existing_real_external_directories(installation, kind):
    fixture, settings, file = installation
    directory = Path(settings[ASSISTANT_KEYS[0]])
    directory.rmdir()
    if kind == "symlink":
        directory.symlink_to(settings[ASSISTANT_KEYS[-1]], target_is_directory=True)
    elif kind == "file":
        directory.write_text("not a directory")
    before = file.read_bytes()
    result = run(fixture, "setup")
    assert result.returncode != 0 and "Assistant directories" in result.stderr
    assert file.read_bytes() == before and not fixture.docker_log.exists()


def test_setup_selects_and_preserves_complete_connection_without_touching_runner(installation):
    fixture, settings, file = installation
    sentinel = Path(settings[ASSISTANT_KEYS[0]]) / "runner-owned"
    sentinel.write_text("leave unchanged")
    before = sentinel.stat()
    for _ in range(2):
        result = run(fixture, "setup")
        assert result.returncode == 0, result.stderr
        stored = fixture.settings()
        assert stored[ASSISTANT_SELECTOR] == ENABLED_FRAGMENT
        assert all(stored[key] == value for key, value in settings.items())
        assert stored["FILTEREST_RUNTIME_UID"] == str(os.getuid())
    assert sentinel.read_text() == "leave unchanged"
    assert sentinel.stat().st_mtime_ns == before.st_mtime_ns
    # Removing the five public inputs lets setup reset its maintained selector.
    file.write_text("\n".join(line for line in file.read_text().splitlines()
                              if line.split("=", 1)[0] not in ASSISTANT_KEYS) + "\n")
    result = run(fixture, "setup")
    assert result.returncode == 0, result.stderr
    assert fixture.settings()[ASSISTANT_SELECTOR] == DISABLED_FRAGMENT


@pytest.mark.parametrize("key", (*ASSISTANT_KEYS, ASSISTANT_SELECTOR))
def test_inherited_assistant_override_is_refused_before_setup_writes(installation, key):
    fixture, _, file = installation
    before = file.read_bytes()
    result = run(fixture, "setup", {key: "unreviewed-override"})
    assert result.returncode != 0 and "Inherited " + key in result.stderr
    assert file.read_bytes() == before


@pytest.mark.skipif(not shutil.which("docker"), reason="config-only Docker CLI required")
def test_real_compose_and_conformance_share_exact_optional_mounts(tmp_path):
    parameters = {
        "installation_root": str(tmp_path / "installation"), "COMPOSE_PROJECT_NAME": "assistant-fixture",
        "FILTEREST_EDGE": "host-proxy", **assistant_settings(tmp_path),
    }
    # These paths need not exist: conformance never reads runner state or credentials.
    settings = standard.validate_parameters(parameters)
    rendered = standard.render_standard(settings)
    assert set(rendered["services"]) == {"app", "db"}
    app = rendered["services"]["app"]
    assert app["group_add"] == [parameters["FILTEREST_CODING_AGENT_IPC_GID"]]
    assert app["environment"]["FILTEREST_CODING_AGENT_SOCKET"] == SOCKET_TARGET + "/runner.sock"
    for key in ASSISTANT_KEYS[2:]:
        assert app["environment"][key] == parameters[key]
    facts = standard.standard_facts(rendered, settings)
    mounts = {mount["target"]: mount for mount in facts["app_mounts"]}
    assert mounts[SOCKET_TARGET] == {
        "type": "bind", "source": parameters[ASSISTANT_KEYS[0]], "target": SOCKET_TARGET, "read_only": True}
    assert mounts[parameters[ASSISTANT_KEYS[-1]]]["source"] == parameters[ASSISTANT_KEYS[-1]]
    assert mounts[parameters[ASSISTANT_KEYS[-1]]]["read_only"] is False
    assert all(mount["bind"]["create_host_path"] is False for mount in app["volumes"]
               if mount["target"] in (SOCKET_TARGET, parameters[ASSISTANT_KEYS[-1]]))
    assert "app/docker/" + ENABLED_FRAGMENT in standard.source_identity(settings)["files"]
    with pytest.raises(standard.EvidenceError, match="escaped"):
        standard.installation_path(str(tmp_path / "unselected-directory"), settings)
    disabled = standard.validate_parameters({key: value for key, value in parameters.items() if key not in ASSISTANT_KEYS})
    with pytest.raises(standard.EvidenceError, match="escaped"):
        standard.installation_path(parameters[ASSISTANT_KEYS[0]], disabled)


def test_update_archives_keep_external_socket_credentials_and_uploads_outside(tmp_path):
    root = tmp_path / "installation"
    (root / "keys").mkdir(parents=True)
    settings = assistant_settings(tmp_path)
    socket_directory = Path(settings[ASSISTANT_KEYS[0]])
    upload_directory = Path(settings[ASSISTANT_KEYS[-1]])
    socket_directory.mkdir()
    upload_directory.mkdir()
    (socket_directory / "credentials-sentinel").write_text("must not be archived")
    (upload_directory / "image-sentinel").write_text("temporary attachment")
    (root / "keys/docker.env").write_text("".join(f"{key}={value}\n" for key, value in settings.items()))
    archive = tmp_path / "backup"
    archive.mkdir()
    # A FIFO is a special-file sentinel like a socket: traversing this external
    # directory would make the installation archiver refuse the entire backup.
    # It needs no listening socket or network permission in an agent sandbox.
    os.mkfifo(socket_directory / "special-runner-state")
    assistant_options(settings, str(root), check_paths=True)
    recovery_archives.create_archives(root, archive, b"synthetic-recovery-authentication-key", "docker")
    with tarfile.open(archive / "installation_settings.tar.gz") as packet:
        assert packet.getnames() == ["keys", "keys/docker.env"]
        content = packet.extractfile("keys/docker.env").read().decode()
        assert settings[ASSISTANT_KEYS[0]] in content
        assert "must not be archived" not in content
