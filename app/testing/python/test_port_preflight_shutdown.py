"""Verify identity-safe shutdown of an obsolete standalone Filterest server.

Bridges the public installer port preflight with a real listening process.
Exists so freeing a port cannot be mistaken for completing process shutdown.
"""

from __future__ import annotations

import errno
import os
import pty
import select
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest


APP_ROOT = Path(__file__).resolve().parents[2]
PORT_HELPER = APP_ROOT / "server_tools/lib/filterest_port_preflight.sh"


def read_pty_until(
    master_fd: int,
    process: subprocess.Popen[bytes],
    needle: bytes,
) -> bytes:
    output = bytearray()
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and needle not in output:
        ready, _, _ = select.select([master_fd], [], [], 0.1)
        if ready:
            try:
                output.extend(os.read(master_fd, 4096))
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                break
        if process.poll() is not None:
            break
    return bytes(output)


@pytest.mark.parametrize(
    ("runtime_root", "cwd_root"),
    (("data/runtime", "app"), ("runtime", ".")),
    ids=("nested", "legacy"),
)
def test_stale_listener_shutdown_waits_for_process_after_port_closes(
    tmp_path: Path,
    runtime_root: str,
    cwd_root: str,
) -> None:
    installation_root = tmp_path / "filterest"
    binary = installation_root / runtime_root / "bin/filterest-server"
    binary.parent.mkdir(parents=True)
    process_cwd = installation_root / cwd_root
    process_cwd.mkdir(parents=True, exist_ok=True)
    shutil.copy2(sys.executable, binary)
    binary.chmod(0o755)
    ready = tmp_path / "ready"
    port_closed = tmp_path / "port-closed"
    shutdown_complete = tmp_path / "shutdown-complete"

    listener_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener_socket.bind(("127.0.0.1", 0))
    listener_socket.listen()
    port = listener_socket.getsockname()[1]
    child_code = """
import pathlib
import signal
import socket
import sys
import time

listener = socket.socket(fileno=int(sys.argv[1]))
ready = pathlib.Path(sys.argv[2])
port_closed = pathlib.Path(sys.argv[3])
shutdown_complete = pathlib.Path(sys.argv[4])

def stop(*_args):
    listener.close()
    port_closed.write_text("closed\\n", encoding="utf-8")
    time.sleep(0.8)
    shutdown_complete.write_text("complete\\n", encoding="utf-8")
    raise SystemExit(0)

signal.signal(signal.SIGTERM, stop)
ready.write_text("ready\\n", encoding="utf-8")
signal.pause()
"""
    process = subprocess.Popen(
        [
            str(binary),
            "-c",
            child_code,
            str(listener_socket.fileno()),
            str(ready),
            str(port_closed),
            str(shutdown_complete),
        ],
        cwd=process_cwd,
        pass_fds=(listener_socket.fileno(),),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    listener_socket.close()
    deadline = time.monotonic() + 5
    while not ready.is_file() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert ready.is_file()
    binary.unlink()

    started_at = time.monotonic()
    try:
        completed = subprocess.run(
            [
                "bash",
                "-c",
                'set -euo pipefail; source "$1"; '
                'filterest_preflight_stale_checkout_listener "$2" "$3" 1',
                "filterest-port-test",
                str(PORT_HELPER),
                str(port),
                str(installation_root),
            ],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            check=False,
            text=True,
            timeout=15,
        )
        elapsed = time.monotonic() - started_at

        output = completed.stdout + completed.stderr
        assert completed.returncode == 0, output
        assert port_closed.is_file()
        assert shutdown_complete.is_file()
        assert elapsed >= 0.7
        assert "captured process exited" in output
        process.wait(timeout=5)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def test_interactive_shutdown_rejects_process_changed_during_prompt(
    tmp_path: Path,
) -> None:
    initial_cwd = tmp_path / "initial"
    replacement_cwd = tmp_path / "replacement"
    initial_cwd.mkdir()
    replacement_cwd.mkdir()
    ready_marker = tmp_path / "ready-interactive"
    moved_marker = tmp_path / "moved-interactive"

    listener_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener_socket.bind(("127.0.0.1", 0))
    listener_socket.listen()
    port = listener_socket.getsockname()[1]
    child_code = """
import os
import pathlib
import signal
import socket
import sys

listener = socket.socket(fileno=int(sys.argv[1]))
replacement_cwd = sys.argv[2]
ready_marker = pathlib.Path(sys.argv[3])
moved_marker = pathlib.Path(sys.argv[4])

def move(*_args):
    os.chdir(replacement_cwd)
    moved_marker.write_text("moved\\n", encoding="utf-8")

signal.signal(signal.SIGUSR1, move)
signal.signal(signal.SIGTERM, lambda *_args: (_ for _ in ()).throw(SystemExit(0)))
ready_marker.write_text("ready\\n", encoding="utf-8")
while True:
    signal.pause()
"""
    listener = subprocess.Popen(
        [
            sys.executable,
            "-c",
            child_code,
            str(listener_socket.fileno()),
            str(replacement_cwd),
            str(ready_marker),
            str(moved_marker),
        ],
        cwd=initial_cwd,
        pass_fds=(listener_socket.fileno(),),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    listener_socket.close()
    deadline = time.monotonic() + 5
    while not ready_marker.is_file() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert ready_marker.is_file()

    master_fd, slave_fd = pty.openpty()
    preflight = subprocess.Popen(
        [
            "bash",
            "-c",
            'set -euo pipefail; source "$1"; filterest_preflight_port "$2"',
            "filterest-port-test",
            str(PORT_HELPER),
            str(port),
        ],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
    )
    os.close(slave_fd)
    try:
        output = bytearray(read_pty_until(master_fd, preflight, b"[y/N]"))
        assert b"[y/N]" in output
        listener.send_signal(signal.SIGUSR1)
        deadline = time.monotonic() + 5
        while not moved_marker.is_file() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert moved_marker.is_file()
        os.write(master_fd, b"y\n")
        output.extend(read_pty_until(master_fd, preflight, b"changed after capture"))
        preflight.wait(timeout=5)

        rendered = output.decode("utf-8", errors="replace")
        assert preflight.returncode != 0
        assert "working directory, or executable changed after capture" in rendered
        assert listener.poll() is None
    finally:
        os.close(master_fd)
        if preflight.poll() is None:
            preflight.terminate()
            preflight.wait(timeout=5)
        if listener.poll() is None:
            listener.kill()
            listener.wait(timeout=5)
