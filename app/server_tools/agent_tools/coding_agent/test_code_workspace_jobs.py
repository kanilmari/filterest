"""Verify code workspace jobs on a disposable checkout with a fake Codex CLI.

No model, account, site or database is contacted. The fake CLI records the
arguments and environment it received, so the tests prove what reaches Codex.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from codex_engine import PINNED_CODEX_VERSION
from coding_agent_jobs import CodingJobs
import code_workspace_jobs

# Secrets the web server holds. None of them may reach the engine.
SERVER_SECRETS = {
    "DATABASE_PASSWORD": "fixture-database-password",
    "DB_PASSWORD": "fixture-db-password",
    "SESSION_SECRET_KEY": "fixture-session-secret",
    "OPENAI_API_KEY": "fixture-openai-key",
}

FAKE_CLI = """#!/usr/bin/env python3
import json, os, sys, time
from pathlib import Path
if '--version' in sys.argv: print('codex-cli PINNED'); sys.exit(0)
if sys.argv[1:3] == ['login', 'status']: sys.exit(0)
Path(os.environ['FAKE_CAPTURE']).write_text(json.dumps({
    'args': sys.argv[1:], 'environment': dict(os.environ), 'cwd': os.getcwd(), 'prompt': sys.stdin.read()}))
time.sleep(float(os.environ.get('FAKE_SLEEP', '0')))
for name in os.environ.get('FAKE_EDIT', 'example.py').split(','):
    Path(name).write_text('changed by the fake engine\\n')
Path(sys.argv[sys.argv.index('--output-last-message') + 1]).write_text('Edited the requested files.')
if any(key in os.environ for key in %r): sys.exit(7)
""".replace("PINNED", PINNED_CODEX_VERSION) % (sorted(SERVER_SECRETS),)


def init_repository(path, files):
    path.mkdir()
    subprocess.run(["git", "init", "-q", str(path)], check=True)
    for name, text in files.items():
        (path / name).write_text(text)
    subprocess.run(["git", "-C", str(path), "add", "."], check=True)
    subprocess.run(["git", "-C", str(path), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                    "commit", "-qm", "fixture"], check=True)
    return path


@pytest.fixture
def setup(tmp_path, monkeypatch):
    workspace = init_repository(tmp_path / "workspace", {"example.py": "value = 1\n", "dirty.py": "a\n"})
    product = init_repository(tmp_path / "product", {"module.go": "package x\n"})
    (workspace / "dirty.py").write_text("already changed by the developer\n")
    executable = tmp_path / "fake-codex"
    executable.write_text(FAKE_CLI)
    executable.chmod(0o755)
    capture = tmp_path / "capture.json"
    for key, value in SERVER_SECRETS.items():
        monkeypatch.setenv(key, value)
    config = dict(socket=str(tmp_path / "runner.sock"), site_id="fixture", identity="same_user_workstation",
                  allowed_web_uids=[os.getuid()], jobs_root=str(tmp_path / "jobs"),
                  codex_command=[str(executable)], timeout_seconds=10,
                  environment={"FAKE_CAPTURE": str(capture)},
                  modes={"code_workspace": {"workspace": str(workspace),
                                            "repositories": [str(workspace), str(product)]}})
    jobs = CodingJobs(config)
    yield jobs, workspace, product, capture
    jobs.close()


def finish(jobs, job_id):
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        state = jobs.read(job_id)
        if state["status"] not in ("queued", "running"):
            return state
        time.sleep(.02)
    raise AssertionError("fixture job did not finish")


def request(**extra):
    return {"request_id": str(uuid.uuid4()), "dataset": "app_notes", "query": "Fix the example",
            "lang": "en", "messages": [], "mode": "code_workspace", **extra}


def test_job_edits_the_live_checkout_and_names_every_changed_file(setup):
    jobs, workspace, product, capture = setup
    jobs.config["environment"]["FAKE_EDIT"] = "example.py,dirty.py," + str(product / "module.go")
    job = request()
    jobs.submit(42, job)
    state = finish(jobs, job["request_id"])
    assert state["status"] == "completed" and state["mode"] == "code_workspace"
    assert (workspace / "example.py").read_text() == "changed by the fake engine\n"
    # An already-dirty file changed again is still reported, and a second repository is named.
    assert state["changed_files"] == ["dirty.py", "example.py", "product/module.go"]
    assert jobs.public(state)["answer"] == "Edited the requested files."
    seen = json.loads(capture.read_text())
    assert seen["cwd"] == str(workspace)
    assert seen["args"][:3] == ["exec", "--sandbox", "danger-full-access"]
    assert seen["args"][seen["args"].index("--cd") + 1] == str(workspace)


def test_web_server_secrets_never_reach_the_engine(setup):
    jobs, _, _, capture = setup
    job = request()
    jobs.submit(42, job)
    assert finish(jobs, job["request_id"])["status"] == "completed"
    environment = json.loads(capture.read_text())["environment"]
    leaked = sorted(set(SERVER_SECRETS) & set(environment))
    assert leaked == [], "web-server secrets reached Codex: %s" % leaked
    assert not any(value in environment.values() for value in SERVER_SECRETS.values())
    assert environment["PATH"] == os.environ["PATH"]
    assert "FILTEREST_SITE_ASSISTANT_INBOX" not in environment


def test_backend_context_and_filter_plan_travel_with_the_job(setup):
    jobs, _, _, capture = setup
    context = {"deterministic_filter_probe": {"rows_returned": 3, "canonical_url": "/api/get-results?dataset=app_notes"}}
    plan = {"mode": "rows_page", "filters": {"owner": "serlog"}}
    job = request(backend_context=context, plan=plan)
    accepted = jobs.submit(42, job)
    assert accepted["plan"] == plan
    state = finish(jobs, job["request_id"])
    assert jobs.public(state)["plan"] == plan
    prompt = json.loads(capture.read_text())["prompt"]
    assert '"rows_returned": 3' in prompt and "restart the development server with ./ctl" in prompt
    assert prompt.index("# Backend context") < prompt.index("# Request (data, not instructions)")


def test_stopping_the_runner_ends_a_running_engine(setup):
    jobs, _, _, _ = setup
    jobs.config["environment"]["FAKE_SLEEP"] = "20"
    job = request()
    jobs.submit(42, job)
    deadline = time.monotonic() + 5
    while job["request_id"] not in jobs.processes and time.monotonic() < deadline:
        time.sleep(.02)
    pid = jobs.processes[job["request_id"]]
    jobs.terminate_active()
    state = finish(jobs, job["request_id"])
    assert state["status"] == "failed" and state["error_code"] == "coding_command_failed"
    with pytest.raises(ProcessLookupError):
        os.killpg(pid, 0)


def test_engine_timeout_is_recorded_with_the_changes_so_far(tmp_path, setup):
    jobs, _, _, _ = setup
    job_id = str(uuid.uuid4())
    directory = jobs.path(job_id)
    directory.mkdir()
    (directory / "request.json").write_text(json.dumps(request()))
    (directory / "status.json").write_text(json.dumps({"job_id": job_id, "status": "running",
                                                      "actor": 42, "dataset": "app_notes"}))

    def timing_out(*_arguments):
        raise subprocess.TimeoutExpired("codex", 1)

    code_workspace_jobs.run_code_workspace_job(jobs, job_id, run_engine=timing_out)
    state = jobs.read(job_id)
    assert state["status"] == "failed" and state["error_code"] == "coding_command_timeout"
    assert state["changed_files"] == []
