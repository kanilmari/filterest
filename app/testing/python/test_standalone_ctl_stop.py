"""test_standalone_ctl_stop.py
Verify standalone ctl stops only listeners owned by its installation.
Bridge the public root wrapper, installation defaults, and identity-safe shutdown.
Exists so Easelect-like sibling processes survive standalone Filterest control.
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys

import pytest


APP_ROOT = Path(__file__).resolve().parents[2]
PRODUCT_ROOT = APP_ROOT.parent


def _listener(
    port: int,
    *,
    executable: Path,
    cwd: Path,
    vite_marker: bool = False,
) -> tuple[subprocess.Popen[bytes], int]:
    listener_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        listener_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener_socket.bind(("127.0.0.1", port))
        listener_socket.listen()
        code = """
import signal
import socket
import sys
listener = socket.socket(fileno=int(sys.argv[1]))
signal.signal(signal.SIGTERM, lambda *_args: sys.exit(0))
signal.pause()
"""
        args = [str(executable), "-c", code, str(listener_socket.fileno())]
        if vite_marker:
            args.append("node_modules/vite/bin/vite.js")
        process = subprocess.Popen(
            args,
            cwd=cwd,
            pass_fds=(listener_socket.fileno(),),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return process, listener_socket.getsockname()[1]
    finally:
        listener_socket.close()


@pytest.mark.parametrize("spawn_fails", [False, True])
def test_listener_inherits_allocated_port_before_closing_parent_socket(monkeypatch, tmp_path, spawn_fails):
    events = []
    child = object()

    class Socket:
        def setsockopt(self, *args):
            pass
        def bind(self, address):
            assert address == ("127.0.0.1", 0)
            events.append("bound")
        def listen(self):
            pass
        def fileno(self):
            return 42
        def getsockname(self):
            return ("127.0.0.1", 32123)
        def close(self):
            events.append("closed")

    def spawn(args, **options):
        assert events == ["bound"]
        assert options["pass_fds"] == (42,)
        assert options["cwd"] == tmp_path
        assert args[-1] == "node_modules/vite/bin/vite.js"
        events.append("inherited")
        if spawn_fails:
            raise OSError("spawn failed")
        return child

    monkeypatch.setattr(socket, "socket", lambda *args: Socket())
    monkeypatch.setattr(subprocess, "Popen", spawn)
    if spawn_fails:
        with pytest.raises(OSError, match="spawn failed"):
            _listener(0, executable=Path(sys.executable), cwd=tmp_path, vite_marker=True)
    else:
        assert _listener(0, executable=Path(sys.executable), cwd=tmp_path, vite_marker=True) == (child, 32123)
    assert events == ["bound", "inherited", "closed"]


def test_standalone_stop_uses_installation_defaults_and_preserves_hostile_sibling(
    tmp_path: Path,
) -> None:
    installation_root = tmp_path / "filterest"
    application_root = installation_root / "app"
    (application_root / "server_tools").mkdir(parents=True)
    shutil.copy2(PRODUCT_ROOT / "ctl", installation_root / "ctl")
    shutil.copy2(APP_ROOT / "ctl", application_root / "ctl")
    shutil.copy2(APP_ROOT / "go.mod", application_root / "go.mod")
    shutil.copy2(APP_ROOT / "VERSION_APP", application_root / "VERSION_APP")
    shutil.copytree(
        APP_ROOT / "server_tools/ctl",
        application_root / "server_tools/ctl",
    )
    shutil.copytree(
        APP_ROOT / "server_tools/lib",
        application_root / "server_tools/lib",
    )

    runtime_binary = installation_root / "data/runtime/bin/easelect_dev"
    runtime_binary.parent.mkdir(parents=True)
    shutil.copy2(sys.executable, runtime_binary)
    runtime_binary.chmod(0o755)
    sibling_cwd = tmp_path / "easelect-sibling"
    sibling_cwd.mkdir()
    sibling = backend = vite = None
    unrelated_backend: subprocess.Popen[bytes] | None = None
    try:
        # Keep each port bound from allocation through child inheritance; there
        # is no free-port probe/rebind race between concurrent suite invocations.
        sibling, sibling_port = _listener(0, executable=Path(sys.executable), cwd=sibling_cwd)
        backend, backend_port = _listener(0, executable=runtime_binary, cwd=installation_root)
        vite, vite_port = _listener(
            0, executable=Path(sys.executable), cwd=application_root, vite_marker=True,
        )
        # Change only this temporary installation's defaults. Hostile ambient
        # port overrides must still lose to them during standalone shutdown.
        defaults = application_root / "server_tools/lib/native_development_ports.env"
        defaults.write_text(f"FILTEREST_NATIVE_PORT={backend_port}\nEASELECT_NATIVE_PORT={sibling_port}\n")
        for launcher in (installation_root / "ctl", application_root / "ctl"):
            source = launcher.read_text()
            assignment = "export FILTEREST_STANDALONE_DEFAULT_VITE_PORT=9100"
            assert source.count(assignment) == 1
            launcher.write_text(source.replace(
                assignment, f"export FILTEREST_STANDALONE_DEFAULT_VITE_PORT={vite_port}",
            ))
        environment = os.environ.copy()
        environment.update(
            {
                "EASELECT_PORT": str(sibling_port),
                "APP_PORT": str(sibling_port),
                "PORT": str(sibling_port),
                "VITE_DEV_PORT": str(sibling_port),
                "FILTEREST_GO_RUN_PROCESS_PATTERN": "hostile-easelect-pattern",
            }
        )
        completed = subprocess.run(
            [str(installation_root / "ctl"), "--stop"],
            cwd=tmp_path,
            env=environment,
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )

        output = completed.stdout + completed.stderr
        assert completed.returncode == 0, output
        backend.wait(timeout=5)
        vite.wait(timeout=5)
        assert sibling.poll() is None
        assert "Standalone Filterest backend stopped" in output
        assert "Standalone Filterest vite stopped" in output

        unrelated_backend, _ = _listener(
            backend_port,
            executable=Path(sys.executable),
            cwd=sibling_cwd,
        )
        refused = subprocess.run(
            [str(installation_root / "ctl"), "--stop"],
            cwd=tmp_path,
            env=environment,
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert refused.returncode != 0
        assert "refusing to stop unrelated listener" in (
            refused.stdout + refused.stderr
        )
        assert unrelated_backend.poll() is None
    finally:
        for process in (backend, vite, sibling, unrelated_backend):
            if process is None:
                continue
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
