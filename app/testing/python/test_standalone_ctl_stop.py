"""Verify standalone ctl stops only listeners owned by its installation.

Bridges the public root wrapper, default ports, and identity-safe shutdown.
Exists so Easelect-like sibling processes survive standalone Filterest control.
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time


APP_ROOT = Path(__file__).resolve().parents[2]
PRODUCT_ROOT = APP_ROOT.parent


def _listener(
    port: int,
    *,
    executable: Path,
    cwd: Path,
    vite_marker: bool = False,
) -> subprocess.Popen[bytes]:
    listener_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
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
    listener_socket.close()
    return process


def _free_port() -> int:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    return port


def test_standalone_stop_uses_8100_and_preserves_hostile_sibling(
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
    sibling_port = _free_port()

    sibling = _listener(sibling_port, executable=Path(sys.executable), cwd=sibling_cwd)
    backend = _listener(8100, executable=runtime_binary, cwd=installation_root)
    vite = _listener(
        9100,
        executable=Path(sys.executable),
        cwd=application_root,
        vite_marker=True,
    )
    unrelated_backend: subprocess.Popen[bytes] | None = None
    try:
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

        unrelated_backend = _listener(
            8100,
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
