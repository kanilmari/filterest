"""Keep ordinary launcher output and recovery startup diagnostics separate.

Connect real launcher/helper chains to local interpreter and dispatch probes.
Detect scanners even when they return no output, without DB or Docker access.
"""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[3]
LIBRARY = ROOT / "app/server_tools/lib/installation_records.sh"
ENTRIES = ("filterest", "app/filterest", "ctl", "app/ctl", "app/server_tools/ctl/ctl_main.sh")


def executable(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/bash\n" + body)
    path.chmod(0o700)


@pytest.fixture
def installation(tmp_path):
    root = tmp_path / "installation"
    app = root / "app"
    app.mkdir(parents=True)
    for entry in ("filterest", "ctl", "app/filterest", "app/ctl", "app/go.mod", "app/VERSION_APP"):
        shutil.copy2(ROOT / entry, root / entry)
    shutil.copytree(ROOT / "app/server_tools/lib", app / "server_tools/lib",
                    ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(ROOT / "app/server_tools/ctl", app / "server_tools/ctl",
                    ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy2(ROOT / "app/server_tools/run_filterest_docker.sh", app / "server_tools/run_filterest_docker.sh")
    commands = tmp_path / "bin"
    log = tmp_path / "scanner.log"
    # The log is a literal path because the real scanner clears its environment.
    executable(commands / "python3", 'if [[ "$1 $2 $3" == "-I -B -c" ]]; then\n'
               f"    printf 'scanner\\n' >> '{log}'\n    exit 29\nfi\n"
               f'exec "{sys.executable}" "$@"\n')
    executable(root / "data/runtime/python/venv/bin/python3",
               "printf 'command stdout\\n'\nprintf 'command stderr\\n' >&2\nexit 23\n")
    environment = {"PATH": f"{commands}:/usr/bin:/bin", "HOME": str(tmp_path), "LANG": "C.UTF-8",
                   "FILTEREST_PROJECT_ROOT_OVERRIDE": str(root), "FILTEREST_PROJECT_VENV_DIR":
                   str(root / "data/runtime/python/venv"), "PYTHONDONTWRITEBYTECODE": "1"}
    return root, environment, log


def launch(installation, entry, *arguments):
    root, environment, _ = installation
    return subprocess.run(["/bin/bash", str(root / entry), *arguments], cwd="/tmp",
                          env=environment, capture_output=True, timeout=30)


def help_bytes(root: Path, entry: str) -> bytes:
    if entry.endswith("filterest"):
        source = (root / "app/filterest").read_bytes()
        return source.split(b"cat <<'USAGE'\n", 1)[1].split(b"\nUSAGE", 1)[0] + b"\n"
    source = (root / "app/server_tools/ctl/ctl_main.sh").read_bytes()
    return source.split(b"cat << 'EOF'\n", 1)[1].split(b"\nEOF", 1)[0] + b"\n"


@pytest.mark.parametrize("entry", ENTRIES)
@pytest.mark.parametrize("noisy", (False, True))
def test_ordinary_launcher_starts_no_scanner_and_preserves_helper_streams(installation, entry, noisy):
    root, _, log = installation
    count = 0
    if noisy:
        helper = root / "app/server_tools/lib/python_bytecode_cache.sh"
        if entry.endswith("ctl_main.sh"):
            helper = root / "app/server_tools/ctl/lib/resolve_env.sh"
        helper.write_text("printf 'startup stdout\\n'\nprintf 'startup stderr\\n' >&2\n" + helper.read_text())
        count = 1
    result = launch(installation, entry, "help" if entry.endswith("filterest") else "--help")
    assert result.returncode == 0
    assert result.stdout == b"startup stdout\n" * count + help_bytes(root, entry)
    assert result.stderr == b"startup stderr\n" * count
    assert not log.exists(), "An ordinary command started the isolated scanner"


@pytest.mark.parametrize("entry", ("filterest", "app/filterest"))
@pytest.mark.parametrize("command", ("database", "data", "status", "timestamp"))
def test_ordinary_python_commands_keep_output_status_and_start_no_scanner(installation, entry, command):
    root, _, log = installation
    if command == "status":
        (root / "keys").mkdir()
        # The internal profile value is consumed, without scanning it or turning
        # it into launcher output. Only the known Docker profile selects Docker.
        (root / "keys/docker.env").write_text("FILTEREST_INSTALL_PROFILE=private-profile-value\n")
    result = launch(installation, entry, command)
    assert (result.returncode, result.stdout, result.stderr) == (23, b"command stdout\n", b"command stderr\n")
    assert not log.exists()


def test_public_docker_profile_cannot_inherit_an_unscanned_discovery_mode(installation):
    root, environment, log = installation
    (root / "keys").mkdir()
    (root / "keys/docker.env").write_text("FILTEREST_INSTALL_PROFILE=private-profile-value\n")
    environment.update(FILTEREST_RECOVERY_OUTPUT="0", FILTEREST_PROFILE_DISCOVERY_RECOVERY="0")
    result = launch(installation, "app/server_tools/run_filterest_docker.sh", "profile")
    assert result.returncode == 0 and not result.stdout
    assert b"private-profile-value" not in result.stderr
    assert b"sensitive details withheld" in result.stderr and log.exists()


@pytest.mark.parametrize("entry", ("app/filterest", "app/server_tools/ctl/ctl_main.sh"))
def test_recovery_helper_cannot_disable_scanning_for_later_helpers(installation, entry):
    root, _, log = installation
    if entry.endswith("filterest"):
        first = root / "app/server_tools/lib/python_bytecode_cache.sh"
        second = root / "app/server_tools/lib/project_python_venv.sh"
        executable(root / "app/server_tools/update_filterest.sh", "exit 23\n")
        arguments = ("update",)
    else:
        first = root / "app/server_tools/ctl/lib/resolve_env.sh"
        second = root / "app/server_tools/ctl/lib/env_permissions.sh"
        arguments = ("--backup", "--help")
    first.write_text("FILTEREST_RECOVERY_OUTPUT=0\n" + first.read_text())
    second.write_text("printf 'private later helper stdout\\n'\nprintf 'private later helper stderr\\n' >&2\n" + second.read_text())
    result = launch(installation, entry, *arguments)
    assert b"private later helper" not in result.stdout + result.stderr
    assert b"sensitive details withheld" not in result.stdout
    assert b"sensitive details withheld" in result.stderr and log.exists()


@pytest.mark.parametrize("entry", ENTRIES)
def test_silent_recovery_startup_prints_nothing_extra_and_starts_no_scanner(installation, entry):
    root, environment, log = installation
    # An inherited ordinary declaration must not select an ordinary recovery path.
    environment["FILTEREST_RECOVERY_OUTPUT"] = "0"
    if entry.endswith("filterest"):
        executable(root / "app/server_tools/update_filterest.sh", "exit 23\n")
        arguments, status, stdout = ("update",), 23, b""
    elif entry.endswith("ctl_main.sh"):
        arguments, status, stdout = ("--restore-db", "--help"), 0, help_bytes(root, entry)
    else:
        executable(root / "app/server_tools/ctl/ctl_main.sh", "exit 23\n")
        arguments, status, stdout = ("--backup",), 23, b""
    result = launch(installation, entry, *arguments)
    assert (result.returncode, result.stdout, result.stderr) == (status, stdout, b"")
    assert not log.exists(), "Empty startup diagnostics started a scanner"


@pytest.mark.parametrize("entry", ENTRIES)
def test_recovery_startup_diagnostics_ignore_inherited_ordinary_mode(installation, entry):
    root, environment, log = installation
    environment.update(FILTEREST_RECOVERY_OUTPUT="0", FILTEREST_PROFILE_DISCOVERY_RECOVERY="0")
    helper = root / "app/server_tools/lib/python_bytecode_cache.sh"
    if entry.endswith("ctl_main.sh"):
        helper = root / "app/server_tools/ctl/lib/resolve_env.sh"
    helper.write_text("printf 'private startup stdout\\n'\nprintf 'private startup stderr\\n' >&2\n" + helper.read_text())
    if entry.endswith("filterest"):
        executable(root / "app/server_tools/update_filterest.sh", "exit 23\n")
        arguments = ("update",)
    else:
        arguments = ("--backup", "--help")
    result = launch(installation, entry, *arguments)
    assert result.returncode == (23 if entry.endswith("filterest") else 0)
    assert b"private startup" not in result.stdout + result.stderr
    assert b"sensitive details withheld" in result.stderr and log.exists()
    assert result.stdout == (b"" if entry.endswith("filterest") else help_bytes(root, entry))


@pytest.mark.parametrize("entry", ("filterest", "app/filterest"))
@pytest.mark.parametrize("arguments", (("restore-database", "--help"), ("verify-update-backup", "--help"),
    ("extract-update-backup", "--help"), ("docker", "dump-database", "--help"),
    ("docker", "restore-database", "--help"), ("docker", "profile"),
    ("docker", "start", "--for-update", "--help")))
def test_recovery_actions_select_protection_before_startup_helpers(installation, entry, arguments):
    root, environment, log = installation
    environment.update(FILTEREST_RECOVERY_OUTPUT="0", FILTEREST_PROFILE_DISCOVERY_RECOVERY="0")
    helper = root / "app/server_tools/lib/python_bytecode_cache.sh"
    helper.write_text("printf 'private startup stdout\\n'\nprintf 'private startup stderr\\n' >&2\n" + helper.read_text())
    result = launch(installation, entry, *arguments)
    assert b"private startup" not in result.stdout + result.stderr
    assert b"sensitive details withheld" not in result.stdout
    assert b"sensitive details withheld" in result.stderr and log.exists()


@pytest.mark.parametrize("entry", ("filterest", "app/filterest"))
@pytest.mark.parametrize("arguments", (("status",), ("docker", "status"), ("docker", "logs"), ("docker", "stop")))
def test_ordinary_docker_dispatch_starts_no_scanner(installation, entry, arguments):
    root, environment, log = installation
    (root / "keys").mkdir()
    (root / "keys/docker.env").write_text("FILTEREST_INSTALL_PROFILE=docker\n")
    (root / "compose.yml").write_text("services: {}\n")
    commands = Path(environment["PATH"].split(":", 1)[0])
    executable(commands / "docker", 'if [[ "$1 $2 $3" == "compose version --short" ]]; then '
               "printf '2.40.3\\n'; exit 0; fi\n"
               "printf 'command stdout\\n'\nprintf 'command stderr\\n' >&2\nexit 23\n")
    result = launch(installation, entry, *arguments)
    assert (result.returncode, result.stdout, result.stderr) == (23, b"command stdout\n", b"command stderr\n")
    assert not log.exists()


@pytest.mark.parametrize("payload", (b"", b"private diagnostic", b"\x00private diagnostic"))
def test_scanner_fallback_uses_stderr_and_empty_input_starts_nothing(installation, payload):
    root, environment, log = installation
    result = subprocess.run(["/bin/bash", "-c", 'source "$1"; filterest_redact_recovery_diagnostics "$2"',
                             "probe", str(LIBRARY), str(root)], env=environment,
                            input=payload, capture_output=True, timeout=30)
    assert result.returncode == 0 and result.stdout == b""
    assert result.stderr == (b"Recovery diagnostic unavailable; sensitive details withheld.\n" if payload else b"")
    assert log.exists() == bool(payload)
    if payload:
        assert log.read_bytes() == b"scanner\n"


@pytest.mark.parametrize("payload", (b"no newline", b"\n", b"\x00", b"\x00a\x00b\xff\n", b"a\x00b"))
def test_scanner_empty_probe_preserves_nonempty_bytes(tmp_path, payload):
    environment = dict(os.environ)
    environment.pop("FILTEREST_RECOVERY_OUTPUT", None)
    result = subprocess.run(["/bin/bash", "-c", 'source "$1"; filterest_redact_recovery_diagnostics "$2"',
                             "probe", str(LIBRARY), str(tmp_path)], env=environment,
                            input=payload, capture_output=True, timeout=30)
    assert (result.returncode, result.stdout, result.stderr) == (0, payload, b"")
