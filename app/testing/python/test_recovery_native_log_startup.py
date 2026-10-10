"""test_recovery_native_log_startup.py: actual native recovery startup evidence.

Run the real admin launcher and updater start step around a local log producer.
Readiness transport is synthetic; scanners, wrappers and descriptor lifetimes are real.
No database, network or Docker daemon is accessed.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

import pytest

from test_recovery_synchronous_diagnostics import copy_launchers

ROOT = Path(__file__).resolve().parents[3]
KEY = hashlib.sha256(b"E17 synthetic native log key").digest()


def executable(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    path.chmod(0o700)


@pytest.fixture
def native(tmp_path):
    root = tmp_path / "installation"
    root.mkdir(mode=0o755)
    copy_launchers(root)
    launcher = root / "app/server_tools/run_filterest_admin.sh"
    shutil.copy2(ROOT / "app/server_tools/run_filterest_admin.sh", launcher)
    keys = root / "keys"
    keys.mkdir(mode=0o700)
    (keys / "database_recovery.hmac.key").write_text(KEY.hex() + "\n")
    (keys / "database_recovery.hmac.key").chmod(0o600)
    settings = keys / "filterest_runtime/runtime_environment.env"
    settings.parent.mkdir(mode=0o700)
    settings.write_text("APP_PORT=18899\n")
    settings.chmod(0o600)
    (root / "data/runtime/logs").mkdir(parents=True, mode=0o755)
    tools = root / "tools"
    executable(tools / "ss", "#!/bin/bash\nexit 0\n")
    executable(tools / "curl", f"#!{sys.executable}\n" + '''
import os, pathlib, time
root = pathlib.Path(os.environ['FILTEREST_ROOT'])
for _ in range(200):
    if (root / 'producer-ready').exists(): break
    time.sleep(.01)
else: raise SystemExit(1)
if os.environ.get('E17_DURING_READY'):
    (root / 'emit-key').touch()
    for _ in range(200):
        if (root / 'key-emitted').exists(): break
        time.sleep(.01)
''')
    executable(root / "data/runtime/bin/filterest-server", f"#!{sys.executable}\n" + '''
import json, os, pathlib, time
root = pathlib.Path(os.environ['FILTEREST_ROOT'])
(root / 'producer.pid').write_text(str(os.getpid()))
descriptors = {}
for name in os.listdir('/proc/self/fd'):
    try: descriptors[name] = os.readlink('/proc/self/fd/' + name)
    except OSError: pass
(root / 'server-descriptors.json').write_text(json.dumps(descriptors))
payload = os.environ.get('E17_LOG_PAYLOAD', 'ordinary native startup')
print(payload, flush=True)
(root / 'producer-ready').touch()
while True:
    if (root / 'emit-key').exists() and not (root / 'key-emitted').exists():
        print(os.environ['E17_KEY'], flush=True)
        (root / 'key-emitted').touch()
    if (root / 'emit-safe').exists() and not (root / 'safe-emitted').exists():
        print('ordinary log after launcher return', flush=True)
        (root / 'safe-emitted').touch()
    time.sleep(.01)
''')
    environment = dict(os.environ, PATH=f"{tools}:{os.environ['PATH']}", FILTEREST_ROOT=str(root),
                       FILTEREST_PROJECT_ROOT_OVERRIDE=str(root), PYTHONDONTWRITEBYTECODE="1",
                       FILTEREST_RECOVERY_OUTPUT="1", FILTEREST_RECOVERY_CONTENT_ROOT=str(root))
    yield root, launcher, environment
    # Each server has its own process group. Always retire the synthetic producer.
    if (root / "producer.pid").exists():
        pid = int((root / "producer.pid").read_text())
        try: os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError: pass


def alive(pid):
    try:
        os.kill(pid, 0)
        return Path(f"/proc/{pid}/stat").read_text().split(") ", 1)[1][0] != "Z"
    except (ProcessLookupError, FileNotFoundError):
        return False


def wait_for(predicate, seconds=3):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate(): return
        time.sleep(.01)
    assert predicate()


def launch(native, route):
    root, launcher, environment = native
    if route == "launcher":
        command = ["/bin/bash", str(launcher), "start"]
    elif route == "output-wrapper":
        command = ["/bin/bash", "-c", 'source "$1"; filterest_recovery_output "$2" "$3" start',
                   "probe", str(root / "app/server_tools/lib/installation_records.sh"), str(root), str(launcher)]
    elif route == "whole-boundary":
        command = [sys.executable, "-I", "-B", "-c",
                   'import sys;sys.path.insert(0,sys.argv[1]);'
                   'from recovery_process_boundary import shell_entrypoint;'
                   'import os;sys.exit(shell_entrypoint(sys.argv[2],sys.argv[3],["start"],'
                   'b"\\0".join(os.fsencode(k+"="+v) for k,v in os.environ.items())))',
                   str(root / "app/server_tools/lib"), str(launcher), str(root / "app")]
    else:
        # Source the actual updater and replace only its final dispatch in the
        # temporary copy. All startup initialization, traps and wrappers remain.
        updater = root / "app/server_tools/update_filterest.sh"
        content = updater.read_text()
        assert content.endswith('main "$@"\n')
        content = content[:-len('main "$@"\n')] + '''
PROFILE=admin
TARGET_VERSION=fixture
BACKUP_DIR=fixture
start_updated_runtime
'''
        updater.write_text(content)
        # The real final status dispatch needs no network for this fixture.
        executable(root / "filterest", "#!/bin/bash\nprintf 'status checked\\n'\n")
        command = ["/bin/bash", str(updater)]
    # Include an unknown inherited pipe in addition to stdout/stderr and the
    # whole-process boundary's prompt descriptors. EOF must arrive on all of them.
    read_descriptor, write_descriptor = os.pipe()
    started = time.monotonic()
    child = subprocess.Popen(command, cwd=root, env=environment, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE,
                             pass_fds=(write_descriptor,) if environment.get("FILTEREST_RECOVERY_CONTENT_ROOT") else ())
    os.close(write_descriptor)
    try:
        output, errors = child.communicate(timeout=8)
        elapsed = time.monotonic() - started
        assert __import__('select').select([read_descriptor], [], [], 1)[0], "inherited pipe retained"
        assert os.read(read_descriptor, 1) == b""
    except BaseException:
        child.kill()
        child.wait()
        raise
    finally:
        os.close(read_descriptor)
    return child.returncode, output, errors, elapsed


@pytest.mark.parametrize("route", ("launcher", "output-wrapper", "whole-boundary", "updater"))
def test_ready_start_returns_with_server_and_live_log_running(native, route):
    root, _, _ = native
    status, output, errors, elapsed = launch(native, route)
    assert status == 0, errors
    assert b"Filterest is ready" in output and not errors
    assert elapsed < 8
    pid = int((root / "data/runtime/filterest-admin.pid").read_text())
    assert alive(pid)
    log = root / "data/runtime/logs/filterest-admin.log"
    assert b"ordinary native startup\n" in log.read_bytes()
    assert log.stat().st_mode & 0o777 == 0o600
    (root / "emit-safe").touch()
    wait_for(lambda: b"ordinary log after launcher return\n" in log.read_bytes())
    assert alive(pid)
    if route == "updater":
        assert b"status checked" in output
        assert (root / "data/runtime/filterest-setup-complete").exists()


@pytest.mark.parametrize("route", ("launcher", "output-wrapper", "whole-boundary", "updater"))
@pytest.mark.parametrize("timing", ("startup", "during-ready", "old-log", "destination"))
def test_log_refusal_is_synchronous_and_fails_start_and_update(native, route, timing):
    root, _, environment = native
    environment["E17_KEY"] = KEY.hex()
    if timing == "startup": environment["E17_LOG_PAYLOAD"] = KEY.hex()
    if timing == "during-ready": environment["E17_DURING_READY"] = "1"
    log = root / "data/runtime/logs/filterest-admin.log"
    if timing == "old-log": log.write_text(KEY.hex() + "\n")
    if timing == "destination": log.mkdir()
    status, output, errors, _ = launch(native, route)
    assert status != 0
    assert b"Recovery live log refused or failed" in errors
    assert b"server stopped" in errors
    assert b"Filterest is ready" not in output
    assert KEY.hex().encode() not in output + errors
    assert not (root / "data/runtime/filterest-admin.pid").exists()
    assert not (root / "data/runtime/filterest-setup-complete").exists()
    if (root / "producer.pid").exists():
        assert not alive(int((root / "producer.pid").read_text()))
    if timing not in ("old-log", "destination"):
        assert not log.exists() or KEY.hex().encode() not in log.read_bytes()


def test_refusal_after_success_stops_server_and_retains_safe_reason(native):
    root, _, environment = native
    environment["E17_KEY"] = KEY.hex()
    assert launch(native, "launcher")[0] == 0
    pid = int((root / "data/runtime/filterest-admin.pid").read_text())
    (root / "emit-key").touch()
    wait_for(lambda: not alive(pid))
    wait_for(lambda: not (root / "data/runtime/filterest-admin.pid").exists())
    log = (root / "data/runtime/logs/filterest-admin.log").read_bytes()
    assert KEY.hex().encode() not in log
    assert b"Recovery live log refused or failed" in log


def test_scanner_crash_during_start_stops_its_server_and_fails_update(native):
    root, _, _ = native
    scanner = root / "app/server_tools/lib/recovery_content_stream.py"
    content = scanner.read_text()
    content = content.replace('os.write(replies, b"STARTED\\n")', 'os._exit(37)')
    scanner.write_text(content)
    status, output, errors, _ = launch(native, "updater")
    assert status != 0 and b"Recovery live log refused or failed" in errors
    assert b"Filterest is ready" not in output
    assert not (root / "data/runtime/filterest-setup-complete").exists()
    assert not (root / "data/runtime/filterest-admin.pid").exists()
    if (root / "producer.pid").exists():
        assert not alive(int((root / "producer.pid").read_text()))


@pytest.mark.parametrize("baseline", ("current", "4cf2aa4"))
def test_ordinary_start_matches_4cf2aa4(native, baseline):
    root, launcher, environment = native
    environment.pop("FILTEREST_RECOVERY_CONTENT_ROOT")
    environment.pop("FILTEREST_RECOVERY_OUTPUT")
    if baseline == "4cf2aa4":
        supplied = os.environ.get("FILTEREST_E15_BASELINE_ROOT")
        content = (Path(supplied) / "app/server_tools/run_filterest_admin.sh").read_bytes() if supplied else \
            subprocess.check_output(["git", "show", "4cf2aa4:app/server_tools/run_filterest_admin.sh"], cwd=ROOT)
        launcher.write_bytes(content)
    status, output, errors, _ = launch(native, "launcher")
    assert (status, output, errors) == (0, b"Filterest is ready: https://localhost:18899/first-run\n", b"")
    assert alive(int((root / "data/runtime/filterest-admin.pid").read_text()))
