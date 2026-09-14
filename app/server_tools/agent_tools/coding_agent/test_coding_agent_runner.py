"""Verify real isolated job execution, restart receipts and socket boundaries.
Uses a disposable Git repository and fake CLI; no model, account or site calls.
"""
import http.client
import importlib.util
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
from coding_agent_jobs import CodingJobs, JobError, atomic_json
from coding_agent_runner import RunnerServer, load_config, readiness


@pytest.fixture
def config(tmp_path):
    repo = tmp_path / "repository"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    (repo / "example.py").write_text("value = 1\n")
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"], check=True)
    revision = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
    executable = tmp_path / "fake-codex"
    executable.write_text("""#!/usr/bin/env python3
import os,sys,time
from pathlib import Path
if '--version' in sys.argv: print('fixture-cli');sys.exit(0)
if sys.argv[1:3] == ['login','status']: sys.exit(int(os.environ.get('FAKE_AUTH_EXIT','0')))
time.sleep(float(os.environ.get('FAKE_SLEEP','0')))
Path('example.py').write_text('value = 2\\n')
Path(sys.argv[sys.argv.index('--output-last-message')+1]).write_text('Edited example.py and verified value = 2.')
if os.environ.get('DATABASE_PASSWORD'): sys.exit(7)
""")
    executable.chmod(0o755)
    maintenance = tmp_path / "fixed-maintenance"
    maintenance.write_text("#!/bin/sh\nprintf '%s\\n' \"$@\"\n")
    maintenance.chmod(0o755)
    return dict(socket=str(tmp_path / "runner.sock"), site_id="fixture-site", allowed_web_uids=[os.getuid()],
                repository=str(repo), source_revision=revision, jobs_root=str(tmp_path / "jobs"),
                codex_command=[str(executable)], maintenance_actions={
                    "plan": [str(maintenance), "--plan", "{version}"],
                    "apply": [str(maintenance), "--apply", "{version}"]}, timeout_seconds=10)


def wait_finished(jobs, job_id):
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        state = jobs.read(job_id)
        if state["status"] not in ("queued", "running"):
            return state
        time.sleep(.02)
    raise AssertionError("fixture job did not finish")


def payload():
    return dict(request_id=str(uuid.uuid4()), dataset="fixture", query="Change example value to 2", messages=[])


def test_config_and_readiness_never_start_model(config, tmp_path):
    path = tmp_path / "config.json"
    path.write_text(json.dumps(config))
    with pytest.raises(ValueError, match="different Unix users"):
        load_config(path)
    distinct = dict(config, allowed_web_uids=[os.getuid() + 10000])
    path.write_text(json.dumps(distinct))
    assert load_config(path) == distinct
    assert readiness(config)["runner_ready"] is True
    assert not Path(config["jobs_root"]).exists()
    missing = dict(config, maintenance_actions={})
    assert readiness(missing)["reason_code"] == "maintenance_not_configured"
    config["environment"] = {"FAKE_AUTH_EXIT": "1"}
    assert readiness(config)["reason_code"] == "runner_authentication_required"
    config["codex_command"] = ["/missing-cli"]
    assert readiness(config)["reason_code"] == "runner_tools_missing"


def test_real_job_edits_only_its_worktree_and_survives_web_disconnect(config, monkeypatch):
    monkeypatch.setenv("DATABASE_PASSWORD", "not-forwarded-fixture")
    jobs = CodingJobs(config)
    request = payload()
    try:
        accepted = jobs.submit(42, request)
        assert accepted["status"] == "queued"
        # The submitting HTTP connection is not part of this worker lifecycle.
        result = wait_finished(jobs, request["request_id"])
        assert result["status"] == "completed"
        assert "example.py" in result["changed_files"]
        assert (Path(config["repository"]) / "example.py").read_text() == "value = 1\n"
        assert (jobs.path(request["request_id"]) / "workspace/example.py").read_text() == "value = 2\n"
        assert jobs.submit(42, request)["job_id"] == request["request_id"]
        with pytest.raises(JobError):
            jobs.read(request["request_id"], 43, "fixture")
        with pytest.raises(JobError):
            jobs.read(request["request_id"], 42, "other")
    finally:
        jobs.close()
    reopened = CodingJobs(config)
    try:
        assert reopened.read(request["request_id"], 42, "fixture")["status"] == "completed"
    finally:
        reopened.close()


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
        assert request("POST", "/v1/jobs/" + str(uuid.uuid4()) + "/maintenance", {"action": "apply", "version": "9.3.8"})[0] == 404
        body = payload()
        status, result = request("POST", "/v1/jobs", body)
        assert status == 202
        wait_finished(server.jobs, result["job_id"])
        assert request("GET", "/v1/jobs/" + result["job_id"] + "?dataset=fixture")[1]["status"] == "completed"
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
