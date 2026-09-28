"""Verifies that ./filterest start, status and setup honour a Docker installation.
Bridges the root launcher, the shared installation-record rule and the Docker runner.
Exists so a Docker folder never falls through to the native installer, which would
install host packages and PostgreSQL, and so a folder recording both is refused.
Native lifecycle commands are recorders here; the fake Docker records its arguments.
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess

import pytest

from installation_fixture_files import LIFECYCLE_LIBRARY_FILES


SOURCE_ROOT = Path(__file__).resolve().parents[2]

# The launchers, the real Docker runner, and the libraries they read at start.
COPIED_APP_FILES = (
    "filterest",
    "server_tools/run_filterest_docker.sh",
    "server_tools/lib/python_bytecode_cache.sh",
    "server_tools/lib/project_python_venv.sh",
    *LIFECYCLE_LIBRARY_FILES,
    ".env.example",
    "go.mod",
    "VERSION_APP",
    "VERSION_DB",
)

# Every native path the launcher can take ends in one of these.
NATIVE_RECORDERS = (
    "server_tools/install_filterest.sh",
    "server_tools/run_filterest_admin.sh",
    "ctl",
)

RECORD_CALL = (
    "#!/usr/bin/env bash\n"
    "printf '%s %s\\n' \"$(basename \"$0\")\" \"$*\" >> \"$FILTEREST_TEST_LOG\"\n"
)

RECORD_STATUS = (
    "import os, sys\n"
    "with open(os.environ['FILTEREST_TEST_LOG'], 'a', encoding='utf-8') as log:\n"
    "    log.write(' '.join(['dev_status.py', *sys.argv[1:]]) + '\\n')\n"
)

FAKE_DOCKER = (
    "#!/bin/sh\n"
    "printf 'docker %s\\n' \"$*\" >> \"$FILTEREST_TEST_LOG\"\n"
    # No earlier named volumes exist, so start migrates nothing.
    "if [ \"${1:-}\" = volume ] && [ \"${2:-}\" = inspect ]; then exit 1; fi\n"
    "exit 0\n"
)


def build_installation(tmp_path: Path) -> dict[str, Path]:
    """Create one standalone installation folder with recorders on every native path."""

    root = tmp_path / "filterest"
    app_root = root / "app"
    for relative_path in COPIED_APP_FILES:
        destination = app_root / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SOURCE_ROOT / relative_path, destination)
    shutil.copy2(SOURCE_ROOT.parent / "filterest", root / "filterest")
    shutil.copy2(SOURCE_ROOT.parent / "compose.yml", root / "compose.yml")
    (app_root / "docker").mkdir()
    (app_root / "docker/docker-compose.yml").write_text("services: {}\n", encoding="utf-8")
    for relative_path in NATIVE_RECORDERS:
        recorder = app_root / relative_path
        recorder.write_text(RECORD_CALL, encoding="utf-8")
        recorder.chmod(0o755)
    status_tool = app_root / "server_tools/agent_tools/dev_status.py"
    status_tool.parent.mkdir(parents=True)
    status_tool.write_text(RECORD_STATUS, encoding="utf-8")

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    (fake_bin / "docker").write_text(FAKE_DOCKER, encoding="utf-8")
    (fake_bin / "docker").chmod(0o755)
    return {"root": root, "app": app_root, "bin": fake_bin, "log": tmp_path / "calls.log"}


def launcher_environment(installation: dict[str, Path]) -> dict[str, str]:
    environment = {
        name: value
        for name, value in os.environ.items()
        if not name.startswith(("FILTEREST_", "EASELECT_"))
        and name not in {"APP_PORT", "PORT", "PYTHONPYCACHEPREFIX"}
    }
    environment["PATH"] = f"{installation['bin']}:{environment['PATH']}"
    environment["FILTEREST_TEST_LOG"] = str(installation["log"])
    return environment


def run_filterest(
    installation: dict[str, Path],
    *arguments: str,
    environment: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(installation["root"] / "filterest"), *arguments],
        cwd=installation["root"],
        env=environment or launcher_environment(installation),
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )


def calls(installation: dict[str, Path]) -> list[str]:
    log = installation["log"]
    return log.read_text(encoding="utf-8").splitlines() if log.exists() else []


def set_up_docker(installation: dict[str, Path]) -> None:
    environment = launcher_environment(installation)
    environment["FILTEREST_PROJECT_ROOT_OVERRIDE"] = str(installation["root"])
    subprocess.run(
        ["bash", str(installation["app"] / "server_tools/run_filterest_docker.sh"), "setup"],
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    installation["log"].unlink(missing_ok=True)


def native_settings(installation: dict[str, Path], name: str) -> Path:
    return installation["root"] / "keys/filterest_runtime" / name


def write_native_settings(installation: dict[str, Path], name: str, text: str) -> Path:
    settings = native_settings(installation, name)
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(text, encoding="utf-8")
    settings.chmod(0o600)
    return settings


def setup_marker(installation: dict[str, Path]) -> Path:
    return installation["root"] / "data/runtime/filterest-setup-complete"


def write_setup_marker(installation: dict[str, Path], profile: str) -> Path:
    marker = setup_marker(installation)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(
        f"profile={profile}\napp_version=8.50.0\ndb_version=9.0.0\n", encoding="utf-8"
    )
    return marker


def native_calls(installation: dict[str, Path]) -> list[str]:
    return [
        call
        for call in calls(installation)
        if call.startswith(("install_filterest.sh", "run_filterest_admin.sh", "ctl", "dev_status.py"))
    ]


def docker_calls(installation: dict[str, Path]) -> list[str]:
    return [call for call in calls(installation) if call.startswith("docker")]


def test_start_and_status_run_the_docker_stack_of_a_docker_installation(
    tmp_path: Path,
) -> None:
    installation = build_installation(tmp_path)
    set_up_docker(installation)
    root = installation["root"]
    compose = (
        f"docker compose --project-directory {root} --file {root / 'compose.yml'} "
        f"--env-file {root / 'keys/docker.env'}"
    )

    started = run_filterest(installation, "start")
    status = run_filterest(installation, "status")

    assert started.returncode == 0, started.stderr
    assert status.returncode == 0, status.stderr
    assert f"{compose} up --build --detach --wait" in calls(installation)
    assert f"{compose} ps" in calls(installation)
    assert "Welcome to Filterest" not in started.stdout
    assert native_calls(installation) == []


@pytest.mark.parametrize(
    ("arguments", "advice"),
    (
        (("setup",), "./filterest docker setup"),
        (("setup", "--profile", "admin", "--yes"), "./filterest docker setup"),
        (("ctl", "--stop"), "./filterest docker stop"),
        (("start", "--stop"), "./filterest docker stop"),
    ),
)
def test_native_only_commands_refuse_a_docker_installation_with_its_command(
    tmp_path: Path, arguments: tuple[str, ...], advice: str
) -> None:
    installation = build_installation(tmp_path)
    set_up_docker(installation)

    refused = run_filterest(installation, *arguments)

    assert refused.returncode == 2
    assert "this installation runs in Docker" in refused.stderr
    assert advice in refused.stderr
    assert calls(installation) == []


@pytest.mark.parametrize(
    "native_record",
    ("marker", "empty-marker", "broken-marker-link", "development-settings", "runtime-settings"),
)
@pytest.mark.parametrize("command", ("start", "status", "setup"))
def test_a_folder_recording_docker_and_native_installations_is_refused(
    tmp_path: Path, native_record: str, command: str
) -> None:
    installation = build_installation(tmp_path)
    set_up_docker(installation)
    if native_record == "marker":
        record = write_setup_marker(installation, "admin")
    elif native_record == "empty-marker":
        record = setup_marker(installation)
        record.parent.mkdir(parents=True, exist_ok=True)
        record.write_text("", encoding="utf-8")
    elif native_record == "broken-marker-link":
        record = setup_marker(installation)
        record.parent.mkdir(parents=True, exist_ok=True)
        record.symlink_to(tmp_path / "missing-marker")
    elif native_record == "development-settings":
        record = write_native_settings(
            installation,
            "development_environment.env",
            "FILTEREST_INSTALL_PROFILE=development\nDB_PASSWORD=native-only-secret\n",
        )
    else:
        # The Docker runner writes this file too; only a profile makes it native.
        record = native_settings(installation, "runtime_environment.env")
        record.write_text(
            record.read_text(encoding="utf-8") + "FILTEREST_INSTALL_PROFILE=admin\n",
            encoding="utf-8",
        )

    refused = run_filterest(installation, command)

    assert refused.returncode != 0
    assert "records both a Docker installation (keys/docker.env)" in refused.stderr
    assert str(record) in refused.stderr
    assert "native-only-secret" not in refused.stderr
    assert calls(installation) == []


def test_docker_settings_runtime_file_alone_is_not_a_native_record(tmp_path: Path) -> None:
    installation = build_installation(tmp_path)
    set_up_docker(installation)
    assert native_settings(installation, "runtime_environment.env").is_file()

    started = run_filterest(installation, "start")

    assert started.returncode == 0, started.stderr
    assert native_calls(installation) == []


@pytest.mark.parametrize("damage", ("symbolic-link", "directory"))
@pytest.mark.parametrize("command", ("start", "setup", "status"))
def test_unreadable_docker_settings_stop_the_command_instead_of_installing(
    tmp_path: Path, damage: str, command: str
) -> None:
    installation = build_installation(tmp_path)
    settings = installation["root"] / "keys/docker.env"
    settings.parent.mkdir(parents=True)
    if damage == "symbolic-link":
        target = tmp_path / "elsewhere.env"
        target.write_text("FILTEREST_INSTALL_PROFILE=docker\n", encoding="utf-8")
        settings.symlink_to(target)
    else:
        settings.mkdir()

    refused = run_filterest(installation, command)

    assert refused.returncode != 0
    assert "Docker settings path must be a regular file" in refused.stderr
    assert calls(installation) == []


def test_native_installations_keep_their_native_commands(tmp_path: Path) -> None:
    installation = build_installation(tmp_path)
    write_native_settings(
        installation, "development_environment.env", "FILTEREST_INSTALL_PROFILE=admin\n"
    )
    write_setup_marker(installation, "admin")

    started = run_filterest(installation, "start")
    status = run_filterest(installation, "status")
    setup = run_filterest(installation, "setup", "--dry-run")

    assert started.returncode == 0, started.stderr
    assert status.returncode == 0, status.stderr
    assert setup.returncode == 0, setup.stderr
    assert calls(installation) == [
        "run_filterest_admin.sh ",
        "dev_status.py",
        "install_filterest.sh --dry-run",
    ]


@pytest.mark.parametrize(
    ("settings_profile", "marker_profile", "expected_setup"),
    (
        # Settings written, setup interrupted before its completion marker.
        ("development", None, "install_filterest.sh --profile development"),
        # A marker without the settings profile resumes the marker's profile.
        (None, "admin", "install_filterest.sh --profile admin"),
    ),
)
def test_an_unfinished_native_installation_resumes_its_setup(
    tmp_path: Path,
    settings_profile: str | None,
    marker_profile: str | None,
    expected_setup: str,
) -> None:
    installation = build_installation(tmp_path)
    if settings_profile:
        write_native_settings(
            installation,
            "development_environment.env",
            f"FILTEREST_INSTALL_PROFILE={settings_profile}\n",
        )
    if marker_profile:
        write_setup_marker(installation, marker_profile)

    started = run_filterest(installation, "start")

    assert started.returncode == 0, started.stderr
    assert "Welcome to Filterest" in started.stdout
    assert calls(installation) == [expected_setup]


def test_embedded_easelect_root_without_docker_settings_stays_native(tmp_path: Path) -> None:
    installation = build_installation(tmp_path)
    easelect_root = tmp_path / "easelect"
    (easelect_root / ".git").mkdir(parents=True)
    (easelect_root / "VERSION_EASELECT").write_text("9.3.19\n", encoding="utf-8")
    # The composition's own source list, which the shared path resolver requires.
    (easelect_root / "filterest.source-roots").write_text("filterest_private\n", encoding="utf-8")
    (easelect_root / "filterest.source-roots").chmod(0o644)
    environment = launcher_environment(installation)
    environment["FILTEREST_PROJECT_ROOT_OVERRIDE"] = str(easelect_root)

    status = subprocess.run(
        [str(installation["app"] / "filterest"), "status"],
        cwd=installation["app"],
        env=environment,
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )

    assert status.returncode == 0, status.stderr
    assert calls(installation) == ["dev_status.py"]
    assert not (easelect_root / "keys/docker.env").exists()
