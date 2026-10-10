"""recovery_native_runtime.py: checked, detached native recovery startup.

Connect the finite admin launcher with its server and the actual live scanner.
Private control pipes report failures and a drained readiness checkpoint.
Long-lived processes close every inherited operator/output descriptor.
"""
from __future__ import annotations

import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import time

from database_recovery_packet_io import _diagnostic_key, prime_diagnostic_key
from recovery_key_safety import KeySafeWriter, private_temporary_path, reject_key_name
from recovery_content_stream import transfer

FAILURE = "Recovery live log refused or failed; server stopped; safe log prefix retained.\n"


def _stop_server(server, pid_file):
    """Stop only our new process group, then remove only its matching PID record."""
    if server is None:
        return
    try:
        os.killpg(server.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        server.wait(timeout=2)
    except subprocess.TimeoutExpired:
        os.killpg(server.pid, signal.SIGKILL)
        server.wait(timeout=2)
    try:
        if pid_file.read_bytes() == f"{server.pid}\n".encode():
            pid_file.unlink()
    except FileNotFoundError:
        pass


def _detach_descriptors(keep):
    """Native Linux: discard unknown inherited pipes, including prompt/lock FDs."""
    descriptor = os.open(os.devnull, os.O_RDWR)
    for destination in (0, 1, 2):
        os.dup2(descriptor, destination)
    for name in os.listdir("/proc/self/fd"):
        number = int(name)
        if number > 2 and number not in keep:
            try:
                os.close(number)
            except OSError:
                pass


def _supervise(root, binary, log_file, pid_file, requests, replies):
    server = None
    stage = None

    def cancel(signum, frame):
        raise KeyboardInterrupt

    try:
        os.setsid()
        _detach_descriptors((requests, replies))
        os.umask(0o077)
        signal.signal(signal.SIGTERM, cancel)
        signal.signal(signal.SIGINT, cancel)
        signal.signal(signal.SIGHUP, signal.SIG_IGN)
        prime_diagnostic_key(root)
        key = _diagnostic_key.get()
        for name in (binary, log_file, pid_file):
            for path in (Path(name), Path(name).absolute(), Path(name).resolve()):
                reject_key_name(path, key)
        if pid_file.is_symlink() or (pid_file.exists() and not pid_file.is_file()):
            raise RuntimeError("Recovery PID destination refused")
        # Both server and scanner are independent of the finite command's pipes.
        server = subprocess.Popen([binary], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, close_fds=True, start_new_session=True)
        os.write(replies, server.pid.to_bytes(8, "big"))
        descriptor, temporary = private_temporary_path(pid_file.parent, key,
                                                       prefix=pid_file.name + ".partial.")
        stage = Path(temporary)
        with KeySafeWriter(os.fdopen(descriptor, "wb"), key) as output:
            output.write(f"{server.pid}\n".encode())
        os.replace(stage, pid_file)
        stage = None
        # transfer expects the usual buffered stdin interface.
        class Input:
            buffer = server.stdout
        sys.stdin = Input()
        transfer(root, "live-append", [str(log_file)], startup_fds=(requests, replies))
        _stop_server(server, pid_file)
    except BaseException:
        # A refusal after readiness stops the server too: no unlogged runtime
        # remains running. Startup gets this fixed explanation synchronously.
        try:
            _stop_server(server, pid_file)
            if stage is not None:
                stage.unlink(missing_ok=True)
        finally:
            try:
                os.write(replies, b"FAILED\n")
            except OSError:
                pass
    finally:
        os._exit(1)


def _reply(descriptor, timeout):
    if not select.select([descriptor], [], [], timeout)[0]:
        raise RuntimeError("Recovery startup scanner did not answer")
    result = os.read(descriptor, 64)
    if result not in (b"STARTED\n", b"READY\n"):
        raise RuntimeError("Recovery startup scanner failed")
    return result


def _server_identity(pid):
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(") ", 1)[1].split()
        return None if fields[0] == "Z" else fields[19]
    except FileNotFoundError:
        return None


def _stop_after_scanner_crash(pid, identity, pid_file):
    """The finite controller also retires the server if its supervisor crashes."""
    if identity is not None and _server_identity(pid) == identity:
        for action in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(pid, action)
            except ProcessLookupError:
                break
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline and _server_identity(pid) == identity:
                time.sleep(.01)
            if _server_identity(pid) != identity:
                break
    try:
        if Path(pid_file).read_bytes() == f"{pid}\n".encode():
            Path(pid_file).unlink()
    except FileNotFoundError:
        pass


def start(root, binary, log_file, pid_file, port):
    """Return success only for readiness plus the live scanner's checkpoint."""
    request_read, request_write = os.pipe()
    reply_read, reply_write = os.pipe()
    daemon = None
    server_pid = None
    server_identity = None
    def cancel(signum, frame):
        raise KeyboardInterrupt

    previous_term = signal.signal(signal.SIGTERM, cancel)
    try:
        daemon = os.fork()
        if daemon == 0:
            _supervise(root, binary, Path(log_file), Path(pid_file), request_read, reply_write)
        os.close(request_read)
        os.close(reply_write)
        encoded_pid = b""
        while len(encoded_pid) < 8:
            if not select.select([reply_read], [], [], 10)[0]:
                raise RuntimeError("Recovery server did not start")
            chunk = os.read(reply_read, 8 - len(encoded_pid))
            if not chunk:
                raise RuntimeError("Recovery server did not start")
            encoded_pid += chunk
        server_pid = int.from_bytes(encoded_pid, "big")
        server_identity = _server_identity(server_pid)
        if _reply(reply_read, 10) != b"STARTED\n":
            raise RuntimeError("Recovery startup scanner failed")
        for _ in range(60):
            if select.select([reply_read], [], [], 0)[0]:
                raise RuntimeError("Recovery startup scanner stopped")
            ready = subprocess.run(["curl", "--insecure", "--silent", "--fail", "--max-time", "1",
                                    f"https://localhost:{port}/system/ready"],
                                   stdout=subprocess.DEVNULL, timeout=2).returncode == 0
            if ready:
                os.write(request_write, b"R")
                if _reply(reply_read, 5) != b"READY\n":
                    raise RuntimeError("Recovery startup log failed")
                print(f"Filterest is ready: https://localhost:{port}/first-run")
                return 0
            # Wait for a failure while respecting the ordinary probe rate limit.
            if select.select([reply_read], [], [], 1)[0]:
                raise RuntimeError("Recovery startup scanner stopped")
        raise RuntimeError("Recovery server did not become ready")
    except BaseException:
        if daemon:
            try:
                os.kill(daemon, signal.SIGTERM)
            except ProcessLookupError:
                pass
            os.waitpid(daemon, 0)
        if server_pid is not None:
            _stop_after_scanner_crash(server_pid, server_identity, pid_file)
        sys.stderr.write(FAILURE)
        sys.stderr.flush()
        return 1
    finally:
        signal.signal(signal.SIGTERM, previous_term)
        for descriptor in (request_write, reply_read):
            os.close(descriptor)
        if daemon is None:
            os.close(request_read)
            os.close(reply_write)
