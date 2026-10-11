"""disposable_postgres.py
Allocate worker-local PostgreSQL resources and confirm exit before removing them.
Connect the opt-in SQL fixtures to one xdist isolation and cleanup boundary.
Serial runs retain their original ports, temporary-directory prefixes and layout.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import os
from pathlib import Path
import re
import select
import shutil
import signal
import socket
import subprocess
import tempfile


PORT_BASE = 20000
PORTS_PER_WORKER = 256
STOP_TIMEOUT = 5
EXIT_TIMEOUT = 1
# Process-local leases also separate nested clusters in the same worker. There
# is no shared lock/file: PostgreSQL listens only in each cluster's own socket dir.
_leased_ports: set[int] = set()


def worker_port_range(worker: str) -> range:
    """Give each gwN a disjoint range, including replacement workers after crashes."""
    match = re.fullmatch(r"gw(0|[1-9][0-9]*)", worker)
    if match is None:
        raise ValueError(f"invalid xdist worker ID: {worker!r}")
    start = PORT_BASE + int(match[1]) * PORTS_PER_WORKER
    if start + PORTS_PER_WORKER > 65536:
        raise ValueError(f"xdist worker port range exceeds 65535: {worker}")
    return range(start, start + PORTS_PER_WORKER)


def port_available(port: int) -> bool:
    """Avoid ports already bound by a local TCP service; never connect to it."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


@dataclass
class PostgresResources:
    base: Path
    data: Path
    socket: Path
    port: str
    # Close the deletion gate before pg_ctl can spawn anything. Only confirmed
    # postmaster exit may reopen it, including during exception unwinding.
    cleanup_confirmed: bool = True


class PostgresCleanupError(RuntimeError):
    """Report retained cluster files when the helper cannot establish safe cleanup."""

    def __init__(self, resources: PostgresResources, pid: int | str, reason: str):
        super().__init__(
            f"disposable PostgreSQL cleanup failed; kept {resources.base}; "
            f"postmaster PID {pid}: {reason}"
        )


@dataclass
class _Postmaster:
    pid: int
    pidfd: int | None
    exited: bool = False

    def wait_for_exit(self, timeout: float) -> bool:
        if self.exited:
            return True
        if self.pidfd is None:
            # A raw-PID probe cannot establish this process's identity after
            # reuse. Without a handle, only exit observed at capture is known.
            return False
        # A pidfd stays attached to this process even if its PID is reused.
        self.exited = bool(select.select([self.pidfd], [], [], timeout)[0])
        return self.exited


def _read_postmaster(pg_bin: Path, resources: PostgresResources) -> _Postmaster:
    """Capture only this private cluster's PID, with a stable handle when available."""
    pid: int | str = "unknown"
    try:
        lines = (resources.data / "postmaster.pid").read_text().splitlines()
        pid = int(lines[0])
        if pid <= 1 or pid == os.getpid() or Path(lines[1]).resolve() != resources.data.resolve():
            raise ValueError("PID file does not identify this cluster's postmaster")
    except (OSError, ValueError, IndexError) as error:
        raise PostgresCleanupError(resources, pid, f"cannot identify owned process: {error}") from error
    try:
        postmaster = _Postmaster(pid, os.pidfd_open(pid))
    except ProcessLookupError:
        return _Postmaster(pid, None, exited=True)
    except (AttributeError, OSError):
        # No raw-PID fallback, including exit probes: that number can be reused.
        postmaster = _Postmaster(pid, None)
    try:
        if not postmaster.wait_for_exit(0) and Path("/proc").is_dir():
            # A stale PID file must not turn a recycled number into ownership.
            # PostgreSQL writes postmaster.pid after changing into its data dir.
            cwd = Path(os.readlink(f"/proc/{pid}/cwd")).resolve()
            executable = Path(os.readlink(f"/proc/{pid}/exe")).resolve()
            if cwd != resources.data.resolve() or executable != (pg_bin / "postgres").resolve():
                raise ValueError("PID belongs to a process outside this cluster")
    except (OSError, ValueError) as error:
        try:
            exited = postmaster.wait_for_exit(0)
        except (OSError, ValueError):
            exited = False
        if exited:
            return postmaster
        if postmaster.pidfd is not None:
            os.close(postmaster.pidfd)
        raise PostgresCleanupError(resources, pid, f"cannot confirm process ownership: {error}") from error
    return postmaster


def _stop_postmaster(resources: PostgresResources, postmaster: _Postmaster) -> None:
    """Signal and observe only the captured process; retain paths until exit."""
    failures = []
    try:
        # PostgreSQL's postmaster signals: fast, immediate, then last resort.
        # pg_ctl stop rereads postmaster.pid and can target a replaced/reused PID;
        # the pidfd keeps every escalation attached to our original postmaster.
        for mode, shutdown_signal, timeout in (
            ("fast", signal.SIGINT, STOP_TIMEOUT),
            ("immediate", signal.SIGQUIT, STOP_TIMEOUT),
            ("last-resort", signal.SIGKILL, EXIT_TIMEOUT),
        ):
            if postmaster.wait_for_exit(0):
                return
            if postmaster.pidfd is None:
                raise PostgresCleanupError(
                    resources, postmaster.pid,
                    "no stable process handle; refusing a raw-PID signal; exit unconfirmed",
                )
            try:
                signal.pidfd_send_signal(postmaster.pidfd, shutdown_signal)
            except (AttributeError, OSError) as error:
                failures.append(f"{mode} signal: {error}")
            # Even ESRCH must be followed by exit evidence from this same handle
            # before removal. Signal success alone does not open the deletion gate.
            if postmaster.wait_for_exit(timeout):
                return
        raise PostgresCleanupError(resources, postmaster.pid, "; ".join(failures) or "exit unconfirmed")
    finally:
        if postmaster.pidfd is not None:
            os.close(postmaster.pidfd)


@contextmanager
def postgres_resources(*, prefix: str, port: int):
    """Lease a port and private data/socket/log paths for exactly one cluster."""
    worker = os.environ.get("PYTEST_XDIST_WORKER")
    parallel = worker not in (None, "master")
    leased = None
    if parallel:
        for candidate in worker_port_range(worker):
            if candidate not in _leased_ports and port_available(candidate):
                leased = candidate
                break
        if leased is None:
            raise RuntimeError(f"no free disposable PostgreSQL ports for {worker}")
        _leased_ports.add(leased)
    try:
        # mkdtemp randomness separates concurrent runs and repeated/nested fixtures
        # too. Keep paths short enough for PostgreSQL's Unix socket filename limit.
        # Explicit removal has no TemporaryDirectory finalizer that could delete
        # retained files later during garbage collection or interpreter exit.
        base = Path(tempfile.mkdtemp(prefix=f"{prefix}{worker}-" if parallel else prefix))
        resources = PostgresResources(base, base / "pgdata", base / "socket", str(leased if parallel else port))
        try:
            unix_socket = base / "socket"
            unix_socket.mkdir(mode=0o700)
            yield resources
        finally:
            if resources.cleanup_confirmed:
                shutil.rmtree(base)
    finally:
        if leased is not None:
            _leased_ports.remove(leased)


@contextmanager
def disposable_postgres(pg_bin: Path, *, prefix: str, port: int, user: str):
    """Start a socket-only server and clean up after setup, test or startup failure."""
    with postgres_resources(prefix=prefix, port=port) as resources:
        start_attempted = False
        postmaster = None
        try:
            subprocess.run(
                [str(pg_bin / "initdb"), "-D", str(resources.data), "-A", "trust", "-U", user,
                 "--no-locale", "--encoding=UTF8"], check=True, capture_output=True,
            )
            resources.cleanup_confirmed = False
            start_attempted = True
            try:
                subprocess.run(
                    [str(pg_bin / "pg_ctl"), "-D", str(resources.data), "-l", str(resources.base / "postgres.log"),
                     "-o", f"-h '' -k '{resources.socket}' -p {resources.port}", "-w", "start"],
                    check=True, capture_output=True,
                )
            except subprocess.CalledProcessError as error:
                log = resources.base / "postgres.log"
                if log.is_file():
                    error.stderr = (error.stderr or b"") + log.read_bytes()
                raise
            postmaster = _read_postmaster(pg_bin, resources)
            yield resources
        finally:
            if start_attempted:
                # Failed start can still leave a live postmaster. Missing or
                # unreadable PID evidence keeps the paths and reports uncertainty.
                if postmaster is None:
                    postmaster = _read_postmaster(pg_bin, resources)
                try:
                    _stop_postmaster(resources, postmaster)
                except PostgresCleanupError:
                    raise
                except Exception as error:
                    raise PostgresCleanupError(resources, postmaster.pid, f"exit check failed: {error}") from error
                resources.cleanup_confirmed = True
