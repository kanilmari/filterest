"""Verify runner configuration, modes, restart receipts and socket boundaries.
Uses a disposable Git checkout and a fake CLI; no model, account or site calls.
"""
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import uuid
import pytest

sys.path.insert(0, str(Path(__file__).parent))
from codex_engine import PINNED_CODEX_VERSION
from coding_agent_jobs import CodingJobs, JobError, atomic_json, requested_mode
from coding_agent_runner import RunnerServer, load_config, readiness, validate_config

FAKE_CLI = """#!/usr/bin/env python3
import json,os,sys,time
from pathlib import Path
if '--version' in sys.argv: print(os.environ.get('FAKE_VERSION','codex-cli PINNED'));sys.exit(0)
if sys.argv[1:3] == ['login','status']: sys.exit(int(os.environ.get('FAKE_AUTH_EXIT','0')))
Path(os.environ.get('FAKE_CAPTURE', os.devnull)).write_text(json.dumps({'args': sys.argv[1:], 'environment': dict(os.environ)}))
time.sleep(float(os.environ.get('FAKE_SLEEP','0')))
Path('example.py').write_text('value = 2\\n')
Path(sys.argv[sys.argv.index('--output-last-message')+1]).write_text('Edited example.py and verified value = 2.')
if os.environ.get('DATABASE_PASSWORD') or os.environ.get('SESSION_SECRET_KEY'): sys.exit(7)
""".replace("PINNED", PINNED_CODEX_VERSION)


def fake_cli(directory):
    executable = directory / "fake-codex"
    executable.write_text(FAKE_CLI)
    executable.chmod(0o755)
    return executable


@pytest.fixture
def repository(tmp_path):
    repo = tmp_path / "repository"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    (repo / "example.py").write_text("value = 1\n")
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                    "commit", "-qm", "fixture"], check=True)
    return repo


@pytest.fixture
def config(tmp_path, repository):
    """A developer machine's runner: the same user as the web server, both modes."""
    return dict(socket=str(tmp_path / "runner.sock"), site_id="fixture-site",
                identity="same_user_workstation", allowed_web_uids=[os.getuid()],
                jobs_root=str(tmp_path / "jobs"), codex_command=[str(fake_cli(tmp_path))],
                modes={"code_workspace": {"workspace": str(repository)}, "site_assistant": {}},
                timeout_seconds=10)


def wait_finished(jobs, job_id):
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        state = jobs.read(job_id)
        if state["status"] not in ("queued", "running"):
            return state
        time.sleep(.02)
    raise AssertionError("fixture job did not finish")


def payload(mode="code_workspace"):
    return dict(request_id=str(uuid.uuid4()), dataset="fixture", query="Change example value to 2",
                messages=[], mode=mode)


def test_config_and_readiness_never_start_model(config, tmp_path):
    path = tmp_path / "config.json"
    path.write_text(json.dumps(config))
    assert load_config(path) == config
    state = readiness(config)
    assert state["runner_ready"] is True and state["modes"] == ["code_workspace", "site_assistant"]
    assert state["codex_version"] == PINNED_CODEX_VERSION
    assert not Path(config["jobs_root"]).exists()
    config["environment"] = {"FAKE_VERSION": "codex-cli 0.1.0"}
    assert readiness(config)["reason_code"] == "runner_version_mismatch"
    config["environment"] = {"FAKE_AUTH_EXIT": "1"}
    assert readiness(config)["reason_code"] == "runner_authentication_required"
    config["codex_command"] = ["/missing-cli"]
    assert readiness(config)["reason_code"] == "runner_tools_missing"


def test_production_runner_can_never_offer_code_work(config):
    dedicated = dict(config, identity="dedicated", allowed_web_uids=[os.getuid() + 10000])
    with pytest.raises(ValueError, match="same-user workstation"):
        validate_config(dedicated)
    site_only = dict(dedicated, modes={"site_assistant": {}})
    assert validate_config(site_only)["modes"] == {"site_assistant": {}}
    with pytest.raises(ValueError, match="different Unix users"):
        validate_config(dict(site_only, allowed_web_uids=[os.getuid()]))
    with pytest.raises(ValueError, match="own user"):
        validate_config(dict(config, allowed_web_uids=[os.getuid() + 10000]))


@pytest.mark.parametrize("change,message", [
    ({"modes": {}}, "modes must offer"),
    ({"modes": {"isolated_copy": {}}}, "modes must offer"),
    ({"source_revision": "a" * 40}, "source-copy variant was removed"),
    ({"maintenance_actions": {}}, "source-copy variant was removed"),
    ({"identity": "root"}, "identity must be"),
])
def test_invalid_or_outdated_configuration_is_rejected(config, change, message):
    with pytest.raises(ValueError, match=message):
        validate_config({**config, **change})


def test_job_storage_inside_the_checkout_is_rejected(config, repository):
    with pytest.raises(ValueError, match="outside the source checkout"):
        validate_config(dict(config, jobs_root=str(repository / "jobs")))


@pytest.mark.parametrize("change,code", [
    ({"mode": "isolated_copy"}, 400),
    ({"mode": ""}, 400),
    ({"mode": "site_assistant"}, 400),
    ({"site_assistant": {"delegation_code": "x", "site_base_url": "http://127.0.0.1:1"}}, 400),
])
def test_every_job_names_a_valid_mode(config, change, code):
    jobs = CodingJobs(config)
    try:
        with pytest.raises(JobError) as refused:
            jobs.submit(42, {**payload(), **change})
        assert refused.value.code == code
        with pytest.raises(JobError) as unoffered:
            requested_mode(dict(config, modes={"site_assistant": {}}), payload())
        assert unoffered.value.code == 403
        assert not any(Path(config["jobs_root"]).glob("*/status.json"))
    finally:
        jobs.close()


def test_one_writer_and_request_identity(config):
    config["environment"] = {"FAKE_SLEEP": ".2"}
    jobs = CodingJobs(config)
    request = payload()
    try:
        jobs.submit(42, request)
        with pytest.raises(JobError) as busy:
            jobs.submit(42, payload())
        assert busy.value.code == 429
        with pytest.raises(JobError) as reused:
            jobs.submit(42, {**request, "query": "different"})
        assert reused.value.code == 409
        assert wait_finished(jobs, request["request_id"])["status"] == "completed"
    finally:
        jobs.close()


def test_interrupted_status_is_truthful_after_runner_restart(config):
    jobs = CodingJobs(config)
    job_id = str(uuid.uuid4())
    directory = jobs.path(job_id)
    directory.mkdir()
    atomic_json(directory / "status.json", dict(job_id=job_id, status="running", actor=42, dataset="fixture"))
    jobs.close()
    restored = CodingJobs(config)
    try:
        state = restored.read(job_id)
        assert state["status"] == "interrupted"
        assert state["error_code"] == "runner_restarted"
    finally:
        restored.close()


class UnixHTTP(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("runner", timeout=10)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(self.path)


def test_socket_site_actor_and_job_status_contract(config):
    server = RunnerServer(config)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    def request(method, path, body=None, site="fixture-site", actor="42"):
        connection = UnixHTTP(config["socket"])
        try:
            connection.request(method, path, json.dumps(body) if body is not None else None,
                               {"X-Filterest-Site": site, "X-Filterest-Actor": actor, "Content-Type": "application/json"})
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()
    try:
        assert request("GET", "/v1/capabilities", site="other")[0] == 403
        assert request("GET", "/v1/capabilities", actor="1")[0] == 403
        assert request("GET", "/v1/capabilities")[1]["runner_ready"]
        # The removed source-copy variant's maintenance route stays gone.
        assert request("POST", "/v1/jobs/" + str(uuid.uuid4()) + "/maintenance", {"action": "apply", "version": "9.3.8"})[0] == 404
        assert request("POST", "/v1/jobs", {**payload(), "mode": "isolated_copy"})[0] == 400
        body = payload()
        status, result = request("POST", "/v1/jobs", body)
        assert status == 202
        wait_finished(server.jobs, result["job_id"])
        finished = request("GET", "/v1/jobs/" + result["job_id"] + "?dataset=fixture")[1]
        assert finished["status"] == "completed" and finished["mode"] == "code_workspace"
        assert request("GET", "/v1/jobs/" + result["job_id"] + "?dataset=fixture", actor="43")[0] == 404
        config["allowed_web_uids"] = [os.getuid() + 10000]
        assert request("GET", "/v1/capabilities")[0] == 403
    finally:
        server.shutdown()
        server.server_close()
        server.jobs.close()
        Path(config["socket"]).unlink(missing_ok=True)

def test_timeout_ends_spawned_tool_group(tmp_path):
    from coding_agent_jobs import run_timed
    marker = tmp_path / "late-write"
    child = "import time;from pathlib import Path;time.sleep(.5);Path(" + repr(str(marker)) + ").write_text('alive')"
    parent = "import subprocess,sys,time;subprocess.Popen([sys.executable,'-c'," + repr(child) + "]);time.sleep(10)"
    with pytest.raises(subprocess.TimeoutExpired):
        run_timed([sys.executable, "-c", parent], timeout=.1)
    time.sleep(.6)
    assert not marker.exists()


def test_cancelled_operation_never_spawns_a_process(monkeypatch):
    from coding_agent_jobs import run_timed
    cancelled = threading.Event()
    cancelled.set()
    def forbidden(*_args, **_kwargs):
        raise AssertionError("cancelled operation started a process")
    monkeypatch.setattr(subprocess, "Popen", forbidden)
    with pytest.raises(InterruptedError):
        run_timed(["must-not-run"], timeout=1, cancel_event=cancelled)


def test_restart_replaces_only_owned_stale_socket(config):
    path = Path(config["socket"])
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as dead:
        dead.bind(str(path))
    parent_identity = path.parent.stat().st_ino
    server = RunnerServer(config)
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
            probe.connect(str(path))
        assert path.parent.stat().st_ino == parent_identity
    finally:
        server.server_close()
        server.jobs.close()
    assert not path.exists()
    assert path.parent.stat().st_ino == parent_identity


def test_live_socket_without_new_lock_is_not_removed(config):
    path = Path(config["socket"])
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as live:
        live.bind(str(path))
        live.listen()
        identity = path.stat().st_ino
        with pytest.raises(ValueError, match="live runner"):
            RunnerServer(config)
        assert path.stat().st_ino == identity


def test_second_runner_cannot_replace_or_unlock_first_socket(config):
    first = RunnerServer(config)
    path = Path(config["socket"])
    identity = path.stat().st_ino
    try:
        for _ in range(2):
            with pytest.raises(ValueError, match="another runner owns"):
                RunnerServer(config)
            assert path.stat().st_ino == identity
    finally:
        first.server_close()
        first.jobs.close()


@pytest.mark.parametrize("kind", ["regular", "symlink", "directory"])
def test_non_socket_endpoint_is_never_removed(config, kind, tmp_path):
    path = Path(config["socket"])
    target = tmp_path / "protected"
    target.write_text("keep")
    if kind == "regular":
        path.write_text("keep endpoint")
    elif kind == "symlink":
        path.symlink_to(target)
    else:
        path.mkdir()
    with pytest.raises(ValueError, match="socket owned"):
        RunnerServer(config)
    assert path.exists()
    assert target.read_text() == "keep"


def test_foreign_owned_socket_is_never_removed(config, monkeypatch):
    path = Path(config["socket"])
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as dead:
        dead.bind(str(path))
    original = os.stat
    def foreign_stat(name, *args, **kwargs):
        info = original(name, *args, **kwargs)
        if name == path.name and kwargs.get("dir_fd") is not None:
            fields = list(info)
            fields[4] = os.getuid() + 10000
            return os.stat_result(fields)
        return info
    monkeypatch.setattr(os, "stat", foreign_stat)
    with pytest.raises(ValueError, match="socket owned"):
        RunnerServer(config)
    assert path.exists()


def test_shutdown_keeps_socket_replaced_by_another_owner(config):
    server = RunnerServer(config)
    path = Path(config["socket"])
    path.unlink()
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as replacement:
        replacement.bind(str(path))
        replacement.listen()
        identity = path.stat().st_ino
        try:
            server.server_close()
            assert path.stat().st_ino == identity
        finally:
            server.jobs.close()


def test_socket_lock_symlink_is_rejected(config, tmp_path):
    target = tmp_path / "keep"
    target.write_text("do not change")
    path = Path(config["socket"])
    (path.parent / ("." + path.name + ".lock")).symlink_to(target)
    with pytest.raises(OSError):
        RunnerServer(config)
    assert target.read_text() == "do not change"


def launch_runner(config, tmp_path):
    configuration = tmp_path / "service-config.json"
    configuration.write_text(json.dumps(config))
    process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("coding_agent_runner.py")),
                                "--config", str(configuration)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(process.communicate()[1].decode())
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
                probe.connect(config["socket"])
            return process
        except OSError:
            time.sleep(.02)
    process.kill()
    process.wait()
    raise AssertionError("runner socket did not become available")


@pytest.mark.skipif(os.getuid() == 0, reason="production runner intentionally rejects root")
def test_sigterm_cleans_socket_and_normal_restart_preserves_directory(config, tmp_path):
    path = Path(config["socket"])
    identity = path.parent.stat().st_ino
    for _ in range(2):
        process = launch_runner(config, tmp_path)
        try:
            process.terminate()
            assert process.wait(timeout=5) == 0
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
        assert not path.exists()
        assert path.parent.stat().st_ino == identity


@pytest.mark.skipif(os.getuid() == 0, reason="production runner intentionally rejects root")
def test_sigkill_stale_socket_recovers_on_restart(config, tmp_path):
    path = Path(config["socket"])
    identity = path.parent.stat().st_ino
    first = launch_runner(config, tmp_path)
    first.kill()
    first.wait(timeout=5)
    assert path.exists()
    second = launch_runner(config, tmp_path)
    try:
        assert path.parent.stat().st_ino == identity
        second.terminate()
        assert second.wait(timeout=5) == 0
    finally:
        if second.poll() is None:
            second.kill()
            second.wait()
    assert not path.exists()


def test_bound_socket_before_listen_is_not_mistaken_for_stale(config):
    path = Path(config["socket"])
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as live:
        live.bind(str(path))
        identity = path.stat().st_ino
        with pytest.raises(ValueError, match="live process has bound"):
            RunnerServer(config)
        assert path.stat().st_ino == identity


def test_a_dropped_poll_connection_is_not_an_error():
    """A reloaded page abandons its poll; the reply must end quietly, not raise twice."""
    from coding_agent_runner import RunnerRequest

    class Gone:
        def write(self, _data):
            raise BrokenPipeError(32, "Broken pipe")

    handler = RunnerRequest.__new__(RunnerRequest)
    handler.request_version, handler.requestline, handler.command = "HTTP/1.1", "GET /v1/jobs HTTP/1.1", "GET"
    handler.client_address, handler.wfile, handler.close_connection = ("runner", 0), Gone(), False
    handler.reply(200, {"status": "running"})
    assert handler.close_connection is True
