"""Verify one assistant job end to end with a fake engine and a fake site.

No model request, no network, no credentials: the fake engine writes the calls a
real model would make through the job's own API tool, and the fake site answers.
"""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
import urllib.parse

import pytest

DIRECTORY = Path(__file__).parent
sys.path.insert(0, str(DIRECTORY))


def load(name):
    specification = importlib.util.spec_from_file_location(name, DIRECTORY / (name + ".py"))
    module = importlib.util.module_from_spec(specification)
    sys.modules[name] = module
    specification.loader.exec_module(module)
    return module


jobs_module = load("site_assistant_jobs")
tool_module = load("site_assistant_api_tool")


class FakeSession:
    """Answers like a delegated site session: reads succeed, writes need approval."""

    def __init__(self, base_url, approved=()):
        self.base_url = base_url
        self.approved = set(approved)
        self.exchanged = None
        self.calls = []
        self.attempted_writes = []

    def exchange(self, code):
        self.exchanged = code
        return {"authenticated": True, "delegation_id": "abc"}

    def api_catalog(self, route=None):
        return "# Fake API\n- read_rows: GET /api/get-results"

    def call(self, method, path, query=None, body=None):
        self.calls.append({"method": method, "path": path, "query": query, "body": body})
        if method == "GET":
            return {"method": method, "path": path, "status": 200, "body": {"data": [{"id": 1}]}}
        if path in self.approved:
            return {"method": method, "path": path, "status": 200, "body": {"updated": 1}}
        approval = {
            "method": method,
            "path": path,
            "query": urllib.parse.urlencode(sorted((query or {}).items())),
            "body_sha256": "c" * 64,
        }
        self.attempted_writes.append({"approval": approval, "query": query or {}, "body": body})
        return {"method": method, "path": path, "status": 403, "needs_approval": True, "approval": approval}

    def planned_writes(self):
        return list(self.attempted_writes)


class FakeJobs:
    """The smallest job store the assistant run needs."""

    def __init__(self, root, config):
        self.root = Path(root)
        self.config = config
        self.state = {"job_id": "job", "status": "running", "dataset": "app_notes", "actor": 42}

    def path(self, _job_id):
        return self.root

    def read(self, _job_id, *_args, **_kwargs):
        return dict(self.state)

    def update(self, _job_id, **changes):
        self.state.update(changes)
        return dict(self.state)


def prepare_job(tmp_path, request_extra=None):
    directory = tmp_path / "job"
    directory.mkdir(parents=True)
    payload = {
        "dataset": "app_notes",
        "query": "Correct the Finnish label of row 1",
        "lang": "fi",
        "messages": [],
        "site_assistant": {
            "delegation_code": "fsa1_code",
            "site_base_url": "http://127.0.0.1:8193",
            "api_catalog_route": "/api/admin/site-assistant/api-catalog",
        },
    }
    payload.update(request_extra or {})
    (directory / "request.json").write_text(json.dumps(payload))
    config = {"codex_command": ["/usr/bin/true"], "assistant_timeout_seconds": 30}
    return FakeJobs(directory, config), directory


def engine_that_calls(*tool_arguments_list):
    """A fake engine that uses the job's API tool exactly like a model would."""

    def runner(command, prompt, workspace, environment, directory, timeout_seconds):
        Path(directory, "prompt-seen.txt").write_text(prompt)
        import os
        previous = os.environ.get("FILTEREST_SITE_ASSISTANT_INBOX")
        os.environ["FILTEREST_SITE_ASSISTANT_INBOX"] = environment["FILTEREST_SITE_ASSISTANT_INBOX"]
        try:
            for arguments in tool_arguments_list:
                tool_module.main(arguments)
        finally:
            if previous is None:
                os.environ.pop("FILTEREST_SITE_ASSISTANT_INBOX", None)
            else:
                os.environ["FILTEREST_SITE_ASSISTANT_INBOX"] = previous
        answer_index = command.index("--output-last-message") + 1
        Path(command[answer_index]).write_text("I read the row and prepared one change.")
        return 0

    return runner


def test_job_reads_live_data_and_returns_a_plan_for_writes(tmp_path):
    jobs, directory = prepare_job(tmp_path)
    session = FakeSession("http://127.0.0.1:8193")

    jobs_module.run_site_assistant_job(
        jobs, "job",
        session_factory=lambda base_url: session,
        run_engine=engine_that_calls(
            ["--method", "GET", "--path", "/api/get-results", "--query", "dataset=app_notes"],
            ["--method", "POST", "--path", "/api/update-row", "--query", "dataset=app_notes",
             "--body", '{"id": 1, "updates": [{"column": "fi", "value": "Muistiinpano"}]}'],
        ),
    )

    assert session.exchanged == "fsa1_code"
    assert jobs.state["status"] == "awaiting_approval"
    assert jobs.state["answer"].startswith("I read the row")
    plan = jobs.state["pending_changes"]
    assert len(plan) == 1 and plan[0]["path"] == "/api/update-row" and plan[0]["status"] == "pending"
    assert plan[0]["approval_query"] == "dataset=app_notes"
    assert plan[0]["body"]["updates"][0]["value"] == "Muistiinpano"
    assert [call["path"] for call in jobs.state["api_calls"]] == ["/api/get-results", "/api/update-row"]

    prompt = (directory / "prompt-seen.txt").read_text()
    assert "site_assistant_api_tool.py" in prompt and "# This installation's API" in prompt
    assert "Correct the Finnish label" in prompt


def test_read_only_job_completes_without_a_plan(tmp_path):
    jobs, _ = prepare_job(tmp_path)
    session = FakeSession("http://127.0.0.1:8193")

    jobs_module.run_site_assistant_job(
        jobs, "job",
        session_factory=lambda base_url: session,
        run_engine=engine_that_calls(["--method", "GET", "--path", "/api/dataset-names"]),
    )

    assert jobs.state["status"] == "completed" and jobs.state.get("pending_changes") == []


def test_engine_failure_and_timeout_are_recorded(tmp_path):
    jobs, _ = prepare_job(tmp_path)

    def failing(*_args, **_kwargs):
        return 1

    jobs_module.run_site_assistant_job(jobs, "job",
                                       session_factory=lambda base_url: FakeSession(base_url),
                                       run_engine=failing)
    assert jobs.state["status"] == "failed" and jobs.state["error_code"] == "assistant_command_failed"

    jobs2, _ = prepare_job(tmp_path / "second")

    def timing_out(*_args, **_kwargs):
        raise subprocess.TimeoutExpired("engine", 1)

    jobs_module.run_site_assistant_job(jobs2, "job",
                                       session_factory=lambda base_url: FakeSession(base_url),
                                       run_engine=timing_out)
    assert jobs2.state["status"] == "failed" and jobs2.state["error_code"] == "assistant_timeout"


def test_approved_plan_runs_without_a_new_model_request(tmp_path):
    jobs, _ = prepare_job(tmp_path)
    jobs.state["pending_changes"] = [
        {"method": "POST", "path": "/api/update-row", "body_sha256": "c" * 64,
         "query": {"dataset": "app_notes"}, "body": {"id": 1}, "status": "pending"},
    ]
    session = FakeSession("http://127.0.0.1:8193", approved=["/api/update-row"])

    result = jobs_module.apply_site_assistant_plan(
        jobs, "job",
        {"delegation_code": "fsa1_second", "site_base_url": "http://127.0.0.1:8193"},
        session_factory=lambda base_url: session,
    )

    assert result["status"] == "applied" and jobs.state["status"] == "applied"
    assert jobs.state["pending_changes"][0]["status"] == "done"
    assert session.calls[0]["body"] == {"id": 1}


def test_apply_failure_keeps_remainder_and_retry_skips_completed(tmp_path):
    jobs, _ = prepare_job(tmp_path)
    jobs.state["pending_changes"] = [
        {"method": "POST", "path": "/api/update-row", "query": {}, "body": {"id": 1}, "status": "pending"},
        {"method": "POST", "path": "/api/delete-rows", "query": {}, "body": {"ids": [1]}, "status": "pending"},
        {"method": "POST", "path": "/api/add-row", "query": {}, "body": {"title": "Later"}, "status": "pending"},
    ]
    session = FakeSession("http://127.0.0.1:8193", approved=["/api/update-row"])

    result = jobs_module.apply_site_assistant_plan(
        jobs, "job",
        {"delegation_code": "fsa1_second", "site_base_url": "http://127.0.0.1:8193"},
        session_factory=lambda base_url: session,
    )

    assert result["status"] == "apply_failed" and jobs.state["status"] == "apply_failed"
    assert [entry["status"] for entry in jobs.state["pending_changes"]] == ["done", "failed", "pending"]
    assert [call["path"] for call in session.calls] == ["/api/update-row", "/api/delete-rows"]

    retry_session = FakeSession(
        "http://127.0.0.1:8193", approved=["/api/delete-rows", "/api/add-row"])
    retried = jobs_module.apply_site_assistant_plan(
        jobs, "job",
        {"delegation_code": "fsa1_third", "site_base_url": "http://127.0.0.1:8193"},
        session_factory=lambda base_url: retry_session,
    )

    assert retried["status"] == "applied" and jobs.state["status"] == "applied"
    assert [entry["status"] for entry in jobs.state["pending_changes"]] == ["done", "done", "done"]
    assert [call["path"] for call in retry_session.calls] == ["/api/delete-rows", "/api/add-row"]


def test_engine_command_and_environment_come_from_configuration(tmp_path):
    config = {
        "codex_command": ["/usr/bin/codex"],
        "codex_home": "/var/lib/codex",
        "environment": {"PATH": "/usr/bin"},
    }
    command = jobs_module.build_engine_command(config, tmp_path, tmp_path / "answer.txt",
                                               images=[tmp_path / "attachment-1.png"])
    assert command[0] == "/usr/bin/codex"
    assert "--cd" in command and str(tmp_path) in command
    assert command[-3:] == ["--image", str(tmp_path / "attachment-1.png"), "-"]
    assert "sandbox_workspace_write.network_access=false" in command

    environment = jobs_module.engine_environment(config, tmp_path / "inbox")
    assert environment["CODEX_HOME"] == "/var/lib/codex"
    assert environment["FILTEREST_SITE_ASSISTANT_INBOX"] == str(tmp_path / "inbox")
    assert "DB_PASSWORD" not in environment

    with pytest.raises(ValueError):
        jobs_module.build_engine_command({"codex_command": ["codex"]}, tmp_path, tmp_path / "a.txt")
    with pytest.raises(ValueError):
        jobs_module.build_engine_command(
            {"assistant_engine": {"name": "claude", "command": ["/usr/bin/claude"]}},
            tmp_path, tmp_path / "a.txt")


def test_another_engine_runs_from_its_configured_template(tmp_path):
    config = {"assistant_engine": {
        "name": "claude",
        "command": ["/usr/bin/claude"],
        "argv_template": ["-p", "--add-dir", "{workspace}", "--output-file", "{answer_file}"],
        "home_variable": "CLAUDE_CONFIG_DIR",
        "home": "/var/lib/claude",
    }}
    command = jobs_module.build_engine_command(config, tmp_path, tmp_path / "answer.txt")
    assert command == ["/usr/bin/claude", "-p", "--add-dir", str(tmp_path),
                       "--output-file", str(tmp_path / "answer.txt")]
    assert jobs_module.engine_environment(config, tmp_path)["CLAUDE_CONFIG_DIR"] == "/var/lib/claude"


def test_attached_images_are_copied_into_the_workspace(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    picture = tmp_path / "picture.PNG"
    picture.write_bytes(b"\x89PNG fixture")
    outside_link = tmp_path / "link.png"
    outside_link.symlink_to(picture)

    images = jobs_module.store_attached_images(
        {"images": [{"path": str(picture)}, {"path": str(outside_link)}, {"path": "relative.png"}]},
        workspace)

    assert [image.name for image in images] == ["attachment-1.png"]
    assert images[0].read_bytes() == b"\x89PNG fixture"


def test_runner_applies_a_plan_only_for_its_owner_and_retryable_state(tmp_path, monkeypatch):
    """CodingJobs.apply_plan guards ownership, retry state and fresh access."""
    jobs_store = load("coding_agent_jobs")
    root = tmp_path / "jobs"
    root.mkdir()
    store = jobs_store.CodingJobs({"jobs_root": str(root)})
    job_id = "00000000-0000-0000-0000-00000000000a"
    directory = root / job_id
    directory.mkdir()
    jobs_store.atomic_json(directory / "status.json", {
        "job_id": job_id, "actor": 42, "dataset": "app_notes", "status": "awaiting_approval",
        "pending_changes": [{"method": "POST", "path": "/api/update-row", "query": {}, "body": {"id": 1}, "status": "pending"}],
    })
    access = {"delegation_code": "fsa1_second", "site_base_url": "http://127.0.0.1:8193"}
    applied = []

    def fake_apply(jobs, requested_job, requested_access):
        applied.append((requested_job, requested_access))
        jobs.update(requested_job, status="applied")
        return {"status": "applied"}

    monkeypatch.setitem(sys.modules, "site_assistant_jobs", jobs_module)
    monkeypatch.setattr(jobs_module, "apply_site_assistant_plan", fake_apply)

    with pytest.raises(jobs_store.JobError):
        store.apply_plan(job_id, 43, "app_notes", access)
    with pytest.raises(jobs_store.JobError):
        store.apply_plan(job_id, 42, "app_notes", {"delegation_code": "fsa1_second"})

    result = store.apply_plan(job_id, 42, "app_notes", access)
    assert applied == [(job_id, access)]
    assert result["status"] == "applied"

    store.update(job_id, status="apply_failed")
    retried = store.apply_plan(job_id, 42, "app_notes", access)
    assert applied == [(job_id, access), (job_id, access)]
    assert retried["status"] == "applied"

    with pytest.raises(jobs_store.JobError):
        store.apply_plan(job_id, 42, "app_notes", access)
    store.close()
