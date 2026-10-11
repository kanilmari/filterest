"""test_disposable_postgres.py
Prove worker isolation and confirmed-exit cleanup without starting PostgreSQL.
Exercise the resource allocator, subprocess boundary and existing SQL fixtures.
Keep parallel installation coverage verifiable in a socket-restricted sandbox.
"""
from contextlib import ExitStack
import importlib
import inspect
from pathlib import Path
import shutil
import signal
import subprocess
from types import SimpleNamespace

import pytest

import disposable_postgres as pg


@pytest.mark.parametrize("module_name", [
    "server_tools.release.audit_public_root_files",
    "server_tools.release.audit_source_boundary",
    "server_tools.release.verify_source",
    "server_tools.installation_conformance.compose_standard",
])
def test_tool_imports_stay_inside_this_checkout(module_name):
    module = importlib.import_module(module_name)
    assert Path(module.__file__).resolve().is_relative_to(Path(__file__).resolve().parents[2])


@pytest.fixture
def allocator(monkeypatch):
    monkeypatch.setattr(pg, "_leased_ports", set())
    monkeypatch.setattr(pg, "port_available", lambda port: True)
    return pg.postgres_resources


@pytest.mark.parametrize("worker", [None, "master"])
@pytest.mark.parametrize("port", [15458, 15461, 15471, 15476, 15483])
def test_serial_ports_and_directory_layout_are_unchanged(monkeypatch, worker, port):
    if worker is None:
        monkeypatch.delenv("PYTEST_XDIST_WORKER", raising=False)
    else:
        monkeypatch.setenv("PYTEST_XDIST_WORKER", worker)
    monkeypatch.setattr(pg, "port_available", lambda port: pytest.fail("serial run probed a port"))
    with pg.postgres_resources(prefix="original-test-", port=port) as resource:
        assert resource.port == str(port)
        assert resource.base.name.startswith("original-test-")
        assert resource.data == resource.base / "pgdata"
        assert resource.socket == resource.base / "socket"
        assert resource.socket.stat().st_mode & 0o777 == 0o700
    assert not resource.base.exists()


def test_workers_and_nested_clusters_never_share_ports_or_paths(allocator, monkeypatch):
    resources = []
    with ExitStack() as stack:
        for worker in ("gw0", "gw1", "gw11", "gw12", "gw176", "gw0"):
            monkeypatch.setenv("PYTEST_XDIST_WORKER", worker)
            resource = stack.enter_context(allocator(prefix="proof-", port=15483))
            assert int(resource.port) in pg.worker_port_range(worker)
            assert f"-{worker}-" in resource.base.name
            resources.append(resource)
        assert len({r.port for r in resources}) == len(resources)
        for attribute in ("base", "data", "socket"):
            assert len({getattr(r, attribute) for r in resources}) == len(resources)
    assert not pg._leased_ports
    assert all(not r.base.exists() for r in resources)


def test_every_supported_worker_range_is_disjoint():
    ranges = [set(pg.worker_port_range(f"gw{index}")) for index in range(177)]
    assert len(set.union(*ranges)) == 177 * pg.PORTS_PER_WORKER


@pytest.mark.parametrize("worker", ["gw177", "gw-1", "gw01", "other", "gw0/../gw1"])
def test_invalid_workers_never_fall_back_to_a_serial_port(worker):
    with pytest.raises(ValueError):
        pg.worker_port_range(worker)


def test_busy_ports_are_skipped_and_exhaustion_is_explicit(allocator, monkeypatch):
    monkeypatch.setenv("PYTEST_XDIST_WORKER", "gw1")
    ports = pg.worker_port_range("gw1")
    monkeypatch.setattr(pg, "port_available", lambda port: port >= ports.start + 2)
    with allocator(prefix="proof-", port=15483) as resource:
        assert int(resource.port) == ports.start + 2
    monkeypatch.setattr(pg, "port_available", lambda port: False)
    with pytest.raises(RuntimeError, match="no free.*gw1"):
        with allocator(prefix="proof-", port=15483):
            pytest.fail("accepted exhausted port range")
    assert not pg._leased_ports


@pytest.mark.parametrize("busy", [False, True])
def test_free_port_probe_binds_loopback_and_closes(monkeypatch, busy):
    events = []
    class Probe:
        def __enter__(self):
            return self
        def bind(self, address):
            events.append(address)
            if busy:
                raise OSError("address in use")
        def __exit__(self, *args):
            events.append("closed")
    monkeypatch.setattr(pg.socket, "socket", lambda *args: Probe())
    assert pg.port_available(20000) is not busy
    assert events == [("127.0.0.1", 20000), "closed"]


@pytest.fixture
def fake_server(allocator, monkeypatch):
    """Model handle identity separately from PID files, recycled PIDs and exit."""
    monkeypatch.setenv("PYTEST_XDIST_WORKER", "gw0")

    class Server:
        pid = 424242
        pidfd = 4242
        base = None
        alive = False
        initdb_fails = False
        start_fails = False
        write_pid = True
        other_pid = 999999
        other_alive = True
        pid_reused = False
        before_signal = None
        inspection_fails = False
        executable = Path("/fixture/bin/postgres")

        def __init__(self):
            self.signal_outcomes = {signal.SIGINT: "exit", signal.SIGQUIT: "exit", signal.SIGKILL: "exit"}
            self.calls = []
            self.signals = []
            self.delivered_signals = []
            self.other_signals = []
            self.waits = []
            self.events = []
            self.handles_closed = []
            self.removals = []

        def assert_folders_present(self):
            assert self.base.is_dir()
            assert (self.base / "pgdata").is_dir()
            assert (self.base / "socket").is_dir()
            assert (self.base / "postgres.log").is_file()

        def run(self, command, **options):
            executable = Path(command[0]).name
            if executable not in ("pg_ctl", "initdb"):
                return subprocess.CompletedProcess(command, 0, stdout="fixture\n", stderr="")
            stage = "initdb" if executable == "initdb" else command[-1]
            data = Path(command[command.index("-D") + 1])
            self.base = data.parent
            self.executable = Path(command[0]).parent / "postgres"
            self.calls.append(stage if stage != "stop" else command[command.index("-m") + 1])
            if stage == "initdb":
                data.mkdir()
                if self.initdb_fails:
                    raise subprocess.CalledProcessError(1, command, stderr=b"initdb failure")
            elif stage == "start":
                self.alive = True
                if self.write_pid:
                    (data / "postmaster.pid").write_text(f"{self.pid}\n{data}\n")
                (self.base / "postgres.log").write_bytes(b"startup diagnostic")
                if self.start_fails:
                    raise subprocess.CalledProcessError(1, command, stderr=b"start failure ")
            else:
                # Keep pg_ctl's real target selection in the fake for round-B
                # counterproof: it reads the PID file at signal time, after the
                # helper's preliminary checks. Round C must never enter here.
                self.assert_folders_present()
                mode = command[command.index("-m") + 1]
                received_signal = signal.SIGINT if mode == "fast" else signal.SIGQUIT
                self.run_before_signal(received_signal)
                target = int((data / "postmaster.pid").read_text().splitlines()[0])
                if target == self.other_pid or (target == self.pid and self.pid_reused):
                    self.other_signals.append((target, received_signal))
                    self.other_alive = False
                else:
                    try:
                        self.deliver_signal(received_signal)
                    except OSError as error:
                        raise subprocess.CalledProcessError(1, command, stderr=str(error).encode()) from error
            return subprocess.CompletedProcess(command, 0)

        def open_pidfd(self, pid):
            assert pid == self.pid
            if not self.alive:
                self.events.append(("capture_exit", 0))
                raise ProcessLookupError("postmaster exited before handle capture")
            return self.pidfd

        def signal_pidfd(self, descriptor, received_signal):
            self.assert_folders_present()
            assert descriptor == self.pidfd
            self.signals.append((descriptor, received_signal))
            self.events.append(("signal", received_signal))
            self.run_before_signal(received_signal)
            self.deliver_signal(received_signal)

        def run_before_signal(self, received_signal):
            if self.before_signal is not None:
                self.before_signal(received_signal)

        def deliver_signal(self, received_signal):
            if not self.alive:
                raise ProcessLookupError("captured postmaster already exited")
            outcome = self.signal_outcomes[received_signal]
            if outcome == "error":
                raise PermissionError("signal refused")
            self.delivered_signals.append(received_signal)
            if outcome.startswith("exit"):
                self.alive = False
            if outcome == "exit_error":
                raise ProcessLookupError("postmaster exited during signal delivery")

        def probe_pid(self, pid, received_signal):
            pytest.fail(f"raw-PID signal/probe: {(pid, received_signal)}")

    server = Server()
    original_close = pg.os.close
    original_readlink = pg.os.readlink
    original_select = pg.select.select if hasattr(pg, "select") else None
    original_rmtree = shutil.rmtree

    def close(descriptor):
        if descriptor == server.pidfd:
            server.handles_closed.append(descriptor)
        else:
            original_close(descriptor)

    def readlink(path, *args, **options):
        if str(path) == f"/proc/{server.pid}/cwd":
            return str(server.base / "pgdata")
        if str(path) == f"/proc/{server.pid}/exe":
            return str(server.executable)
        return original_readlink(path, *args, **options)

    def select(read, write, error, timeout):
        if read == [server.pidfd]:
            server.waits.append((server.pidfd, timeout))
            server.events.append(("wait", timeout))
            if server.inspection_fails:
                raise PermissionError("exit inspection unavailable")
            return ([] if server.alive else read), [], []
        return original_select(read, write, error, timeout)

    def rmtree(path, *args, **options):
        if server.base is not None and Path(path) == server.base:
            assert not server.alive, "removed a running postmaster's folders"
            if not server.initdb_fails:
                assert server.events[-1][0] in ("wait", "capture_exit"), "removal needs observed exit"
            server.removals.append(Path(path))
        return original_rmtree(path, *args, **options)

    monkeypatch.setattr(pg.subprocess, "run", server.run)
    monkeypatch.setattr(pg.os, "pidfd_open", server.open_pidfd)
    monkeypatch.setattr(pg.os, "kill", server.probe_pid)
    monkeypatch.setattr(pg.os, "close", close)
    monkeypatch.setattr(pg.os, "readlink", readlink)
    monkeypatch.setattr(signal, "pidfd_send_signal", server.signal_pidfd)
    if original_select is not None:
        monkeypatch.setattr(pg.select, "select", select)
    monkeypatch.setattr(shutil, "rmtree", rmtree)
    try:
        yield server
    finally:
        # The fake represents no OS process; retire it before clearing test debris.
        server.alive = False
        if server.base is not None and server.base.exists():
            original_rmtree(server.base)


def _exercise_server():
    return pg.disposable_postgres(Path("/fixture/bin"), prefix="proof-", port=15483, user="owner")


def _assert_removed_and_lease_reusable(server, allocator):
    assert not server.alive
    assert not server.base.exists()
    assert server.removals == [server.base]
    if not server.initdb_fails:
        assert server.handles_closed == [server.pidfd]
    assert not pg._leased_ports
    with allocator(prefix="proof-", port=15483) as resources:
        assert resources.port == str(pg.PORT_BASE)


def _assert_signal_sequence(server, *signals):
    assert server.other_signals == [], "shutdown reached an unrelated process"
    assert server.other_alive
    assert server.calls == ["initdb", "start"], "shutdown must not invoke pg_ctl"
    assert server.signals == [(server.pidfd, received) for received in signals]
    for index, event in enumerate(server.events):
        if event[0] == "signal":
            timeout = pg.EXIT_TIMEOUT if event[1] == signal.SIGKILL else pg.STOP_TIMEOUT
            assert server.events[index - 1] == ("wait", 0)
            assert server.events[index + 1] == ("wait", timeout)


def test_normal_stop_removes_folders_only_after_confirmed_exit(fake_server, allocator):
    with _exercise_server():
        fake_server.assert_folders_present()
        assert fake_server.alive
    _assert_signal_sequence(fake_server, signal.SIGINT)
    _assert_removed_and_lease_reusable(fake_server, allocator)


@pytest.mark.parametrize("failure", ["initdb", "test"])
def test_setup_and_test_errors_preserve_the_original_error(fake_server, allocator, failure):
    fake_server.initdb_fails = failure == "initdb"
    exception = subprocess.CalledProcessError if failure == "initdb" else RuntimeError
    with pytest.raises(exception):
        with _exercise_server():
            raise RuntimeError("test failed")
    if failure == "initdb":
        assert fake_server.calls == ["initdb"]
        assert fake_server.signals == []
    else:
        _assert_signal_sequence(fake_server, signal.SIGINT)
    _assert_removed_and_lease_reusable(fake_server, allocator)


@pytest.mark.parametrize("fast_outcome", ["error", "alive"])
def test_fast_stop_failure_uses_immediate_fallback_before_removing_folders(
    fake_server, allocator, fast_outcome,
):
    fake_server.signal_outcomes[signal.SIGINT] = fast_outcome
    with _exercise_server():
        pass
    _assert_signal_sequence(fake_server, signal.SIGINT, signal.SIGQUIT)
    _assert_removed_and_lease_reusable(fake_server, allocator)


def test_stop_error_after_process_exit_needs_no_fallback(fake_server, allocator):
    fake_server.signal_outcomes[signal.SIGINT] = "exit_error"
    with _exercise_server():
        pass
    _assert_signal_sequence(fake_server, signal.SIGINT)
    _assert_removed_and_lease_reusable(fake_server, allocator)


@pytest.mark.parametrize("start_fails", [False, True])
def test_failed_shutdown_fallback_terminates_only_through_the_owned_handle(fake_server, allocator, start_fails):
    fake_server.start_fails = start_fails
    fake_server.signal_outcomes.update({signal.SIGINT: "error", signal.SIGQUIT: "alive"})
    if start_fails:
        with pytest.raises(subprocess.CalledProcessError):
            with _exercise_server():
                pytest.fail("failed start yielded a server")
    else:
        with _exercise_server():
            pass
    _assert_signal_sequence(fake_server, signal.SIGINT, signal.SIGQUIT, signal.SIGKILL)
    _assert_removed_and_lease_reusable(fake_server, allocator)


@pytest.mark.parametrize("start_fails", [False, True])
@pytest.mark.parametrize("kill_outcome", ["error", "alive"])
def test_fallback_failure_keeps_live_folders_and_reports_path_and_pid(
    fake_server, allocator, start_fails, kill_outcome,
):
    fake_server.start_fails = start_fails
    fake_server.signal_outcomes = {
        signal.SIGINT: "alive", signal.SIGQUIT: "error", signal.SIGKILL: kill_outcome,
    }
    with pytest.raises(pg.PostgresCleanupError) as error:
        with _exercise_server():
            pass
    assert str(fake_server.base) in str(error.value)
    assert str(fake_server.pid) in str(error.value)
    _assert_signal_sequence(fake_server, signal.SIGINT, signal.SIGQUIT, signal.SIGKILL)
    assert fake_server.alive
    fake_server.assert_folders_present()
    assert fake_server.removals == []
    assert fake_server.handles_closed == [fake_server.pidfd]
    assert not pg._leased_ports
    with allocator(prefix="proof-", port=15483) as resources:
        assert resources.port == str(pg.PORT_BASE)


@pytest.mark.parametrize("fast_outcome", ["exit", "alive"])
def test_partial_start_confirms_exit_and_preserves_startup_diagnostics(fake_server, allocator, fast_outcome):
    fake_server.start_fails = True
    fake_server.signal_outcomes[signal.SIGINT] = fast_outcome
    with pytest.raises(subprocess.CalledProcessError) as error:
        with _exercise_server():
            pytest.fail("failed start yielded a server")
    assert b"start failure" in error.value.stderr
    assert b"startup diagnostic" in error.value.stderr
    _assert_signal_sequence(fake_server, *(
        (signal.SIGINT,) if fast_outcome == "exit" else (signal.SIGINT, signal.SIGQUIT)
    ))
    _assert_removed_and_lease_reusable(fake_server, allocator)


def test_missing_pid_after_partial_start_keeps_folders_and_reports_unknown_pid(fake_server):
    fake_server.start_fails = True
    fake_server.write_pid = False
    with pytest.raises(RuntimeError, match="postmaster PID unknown") as error:
        with _exercise_server():
            pass
    assert str(fake_server.base) in str(error.value)
    assert fake_server.alive
    fake_server.assert_folders_present()
    assert fake_server.signals == []
    assert not pg._leased_ports


def test_removed_pid_file_is_not_evidence_of_exit(fake_server, allocator):
    with _exercise_server() as resources:
        (resources.data / "postmaster.pid").unlink()
    _assert_signal_sequence(fake_server, signal.SIGINT)
    _assert_removed_and_lease_reusable(fake_server, allocator)


def test_replaced_pid_file_never_signals_the_replacement_process(fake_server, allocator):
    with _exercise_server() as resources:
        (resources.data / "postmaster.pid").write_text(f"999999\n{resources.data}\n")
    _assert_signal_sequence(fake_server, signal.SIGINT)
    _assert_removed_and_lease_reusable(fake_server, allocator)


SHUTDOWN_SIGNALS = (signal.SIGINT, signal.SIGQUIT, signal.SIGKILL)


@pytest.mark.parametrize("at_signal", SHUTDOWN_SIGNALS, ids=["fast", "immediate", "kill"])
@pytest.mark.parametrize("exit_observable", [True, False], ids=["exit-confirmed", "exit-unconfirmed"])
def test_exit_and_pid_reuse_between_preliminary_check_and_signal_never_reaches_other_process(
    fake_server, allocator, at_signal, exit_observable,
):
    attempted = SHUTDOWN_SIGNALS[:SHUTDOWN_SIGNALS.index(at_signal) + 1]
    fake_server.signal_outcomes = dict.fromkeys(SHUTDOWN_SIGNALS, "alive")
    raced = []

    def exit_and_reuse(received_signal):
        if received_signal == at_signal and not raced:
            # select just reported the captured process alive; before the kernel
            # handles the signal, it exits without unlinking its PID file and
            # another process acquires that same numeric PID.
            assert fake_server.waits[-1] == (fake_server.pidfd, 0)
            fake_server.alive = False
            fake_server.pid_reused = True
            fake_server.inspection_fails = not exit_observable
            raced.append(received_signal)

    with ExitStack() as stack:
        if not exit_observable:
            error = stack.enter_context(pytest.raises(pg.PostgresCleanupError, match="exit check failed"))
        with _exercise_server():
            fake_server.before_signal = exit_and_reuse
    assert raced == [at_signal]
    _assert_signal_sequence(fake_server, *attempted)
    assert fake_server.delivered_signals == list(attempted[:-1])
    if exit_observable:
        _assert_removed_and_lease_reusable(fake_server, allocator)
    else:
        assert str(fake_server.base) in str(error.value)
        assert str(fake_server.pid) in str(error.value)
        fake_server.assert_folders_present()
        assert fake_server.removals == []
        assert fake_server.handles_closed == [fake_server.pidfd]
        assert not pg._leased_ports
        with allocator(prefix="proof-", port=15483) as resources:
            assert resources.port == str(pg.PORT_BASE)


@pytest.mark.parametrize("at_signal", SHUTDOWN_SIGNALS, ids=["fast", "immediate", "kill"])
def test_pid_file_replacement_after_preliminary_check_is_ignored_by_handle_signals(
    fake_server, allocator, at_signal,
):
    attempted = SHUTDOWN_SIGNALS[:SHUTDOWN_SIGNALS.index(at_signal) + 1]
    fake_server.signal_outcomes.update(dict.fromkeys(attempted[:-1], "alive"))
    replaced = []

    def replace_pid_file(received_signal):
        if received_signal == at_signal and not replaced:
            assert fake_server.waits[-1] == (fake_server.pidfd, 0)
            data = fake_server.base / "pgdata"
            (data / "postmaster.pid").write_text(f"{fake_server.other_pid}\n{data}\n")
            replaced.append(received_signal)

    with _exercise_server():
        fake_server.before_signal = replace_pid_file
    assert replaced == [at_signal]
    _assert_signal_sequence(fake_server, *attempted)
    assert fake_server.delivered_signals == list(attempted)
    _assert_removed_and_lease_reusable(fake_server, allocator)


def test_shutdown_never_rereads_pid_file_after_handle_capture(fake_server, allocator, monkeypatch):
    read_text = Path.read_text
    with _exercise_server() as resources:
        def refuse_pid_read(path, *args, **options):
            assert path != resources.data / "postmaster.pid", "shutdown reread PID file"
            return read_text(path, *args, **options)
        monkeypatch.setattr(Path, "read_text", refuse_pid_read)
        fake_server.signal_outcomes.update({signal.SIGINT: "alive", signal.SIGQUIT: "alive"})
    _assert_signal_sequence(fake_server, *SHUTDOWN_SIGNALS)
    _assert_removed_and_lease_reusable(fake_server, allocator)


def test_already_exited_captured_process_needs_no_shutdown_signals(fake_server, allocator):
    with _exercise_server():
        fake_server.alive = False
    _assert_signal_sequence(fake_server)
    _assert_removed_and_lease_reusable(fake_server, allocator)


def test_exit_before_handle_capture_needs_no_signals_and_allows_cleanup(fake_server, monkeypatch):
    run = fake_server.run
    def exit_after_start(command, **options):
        result = run(command, **options)
        if command[-1] == "start":
            fake_server.alive = False
        return result
    monkeypatch.setattr(pg.subprocess, "run", exit_after_start)
    with _exercise_server():
        pass
    _assert_signal_sequence(fake_server)
    assert fake_server.handles_closed == []
    assert fake_server.removals == [fake_server.base]
    assert not fake_server.base.exists()
    assert not pg._leased_ports


@pytest.mark.parametrize("unavailable_kind", ["unsupported", "missing"])
def test_unavailable_process_handle_keeps_live_folders_without_any_signals(
    fake_server, monkeypatch, unavailable_kind,
):
    def unavailable(pid):
        raise OSError("pidfds unavailable")
    if unavailable_kind == "unsupported":
        monkeypatch.setattr(pg.os, "pidfd_open", unavailable)
    else:
        monkeypatch.delattr(pg.os, "pidfd_open")
    with pytest.raises(pg.PostgresCleanupError, match="refusing a raw-PID signal"):
        with _exercise_server():
            pass
    assert fake_server.alive
    fake_server.assert_folders_present()
    assert fake_server.signals == []
    assert fake_server.calls == ["initdb", "start"]
    assert fake_server.handles_closed == []
    assert not pg._leased_ports


@pytest.mark.parametrize("phase", ["capture", "cleanup"])
@pytest.mark.parametrize("error_class", [PermissionError, ValueError])
def test_exit_inspection_failure_keeps_folders_and_names_the_owned_pid(
    fake_server, monkeypatch, phase, error_class,
):
    def unavailable(*args):
        raise error_class("exit inspection unavailable")
    if phase == "capture":
        monkeypatch.setattr(pg.select, "select", unavailable)
    with pytest.raises(pg.PostgresCleanupError) as error:
        with _exercise_server():
            monkeypatch.setattr(pg.select, "select", unavailable)
    assert str(fake_server.base) in str(error.value)
    assert str(fake_server.pid) in str(error.value)
    assert fake_server.alive
    fake_server.assert_folders_present()
    assert fake_server.handles_closed == [fake_server.pidfd] * (2 if phase == "capture" else 1)
    assert not pg._leased_ports


def test_stale_pid_file_cannot_adopt_an_unrelated_process(fake_server, monkeypatch):
    run = fake_server.run
    def start_with_unrelated_process(command, **options):
        result = run(command, **options)
        if command[-1] == "start":
            fake_server.executable = Path("/unrelated/process")
        return result
    monkeypatch.setattr(pg.subprocess, "run", start_with_unrelated_process)
    with pytest.raises(pg.PostgresCleanupError, match="outside this cluster") as error:
        with _exercise_server():
            pass
    assert str(fake_server.base) in str(error.value)
    assert str(fake_server.pid) in str(error.value)
    assert fake_server.calls == ["initdb", "start"]
    assert fake_server.signals == []
    fake_server.assert_folders_present()
    assert not pg._leased_ports


FIXTURES = [
    ("test_field_settings_language_seed", "database", 15458),
    ("test_revoked_sign_in_store", "database", 15461),
    ("test_public_schema_table_creation", "cluster", 15471),
    ("test_system_foreign_key_restoration", "cluster", 15476),
    ("row_actor_support_contracts", "cluster", 15483),
]


@pytest.mark.parametrize("worker", [None, "gw1"])
@pytest.mark.parametrize("module_name,fixture_name,serial_port", FIXTURES)
def test_existing_fixtures_use_the_allocated_port_and_always_stop(
    fake_server, monkeypatch, tmp_path, worker, module_name, fixture_name, serial_port,
):
    if worker is None:
        monkeypatch.delenv("PYTEST_XDIST_WORKER", raising=False)
    else:
        monkeypatch.setenv("PYTEST_XDIST_WORKER", worker)
    monkeypatch.setenv("FILTEREST_TEST_DISPOSABLE_POSTGRES", "1")
    monkeypatch.setenv("PG_TEST_BIN", str(tmp_path))
    (tmp_path / "initdb").touch()
    commands = []
    def run(command, **options):
        commands.append(command)
        return fake_server.run(command, **options)
    monkeypatch.setattr(pg.subprocess, "run", run)
    module = importlib.import_module(module_name)
    generator = getattr(module, fixture_name).__wrapped__()
    try:
        query = next(generator)
        query("SELECT 1")
        port = str(serial_port) if worker is None else str(pg.worker_port_range(worker).start)
        start = next(command for command in commands if command[-1] == "start")
        assert start[start.index("-o") + 1].endswith(f" -p {port}")
        assert "-h ''" in start[start.index("-o") + 1]
        clients = [command for command in commands if Path(command[0]).name == "psql"]
        assert clients
        assert all(command[command.index("-p") + 1] == port for command in clients)
        if module_name == "row_actor_support_contracts":
            assert inspect.getclosurevars(query).nonlocals["port"] == port
    finally:
        generator.close()
    assert not any(command[-1] == "stop" for command in commands)
    _assert_signal_sequence(fake_server, signal.SIGINT)
    assert not Path(commands[0][commands[0].index("-D") + 1]).parent.exists()


@pytest.mark.parametrize("profile", ["native", "docker"])
def test_recovery_transports_use_the_cluster_port(monkeypatch, tmp_path, profile):
    from test_database_recovery_postgres import site
    from test_recovery_content_postgres import legacy_site
    pg_bin, socket, port = tmp_path / "bin", tmp_path / "socket", "20257"
    def cluster(sql, database="postgres", check=True):
        # Deliberately expose the real fixture's closure contract to recovery.
        return pg_bin, socket, port
    fixture = site.__wrapped__(cluster, tmp_path, SimpleNamespace(param=profile))
    assert f"DB_PORT={port}\n" in fixture["settings"].read_text()
    events = []
    def run(command, **options):
        events.append((command, options))
        return subprocess.CompletedProcess(command, 0)
    monkeypatch.setattr(subprocess, "run", run)
    fixture["run"]("backup")
    fixture["reader_connection"]("site")
    if profile == "docker":
        assert events[0][1]["env"]["PGPORT"] == port
    assert events[1][0][events[1][0].index("-p") + 1] == port
    _, _, environment, _ = legacy_site.__wrapped__(fixture)
    assert environment["PGPORT"] == port
