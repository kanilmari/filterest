"""Verify the assistant job's file bridge: one answer per request, no symlink escape, no network.

Uses a fake delegated session, so no model, site or credential is involved.
"""
import importlib.util
import json
import os
from pathlib import Path
import threading
import time

import pytest

DIRECTORY = Path(__file__).parent


def load(name):
    specification = importlib.util.spec_from_file_location(name, DIRECTORY / (name + ".py"))
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


inbox_module = load("site_assistant_inbox")
tool_module = load("site_assistant_api_tool")


class FakeSession:
    def __init__(self, answers=None, failures=()):
        self.answers = answers or {}
        self.failures = set(failures)
        self.calls = []

    def call(self, method, path, query=None, body=None):
        self.calls.append((method, path, query, body))
        if path in self.failures:
            raise RuntimeError("assistant calls must target an /api/ path")
        return dict(self.answers.get(path, {"status": 200, "body": {"ok": True}}),
                    method=method, path=path)


def serve_once(session, inbox, iterations=40):
    """Run the inbox server until it has answered, then stop it."""
    stop = threading.Event()
    calls = []
    worker = threading.Thread(target=inbox_module.serve_inbox,
                              args=(session, inbox, stop, calls.append), daemon=True)
    worker.start()
    for _ in range(iterations):
        if calls:
            break
        time.sleep(0.02)
    stop.set()
    worker.join(2)
    return calls


def write_request(inbox, request_id, payload):
    (inbox / (request_id + ".request.json")).write_text(json.dumps(payload))


def test_request_is_answered_once_and_recorded(tmp_path, monkeypatch):
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    session = FakeSession({"/api/get-results": {"status": 200, "body": {"data": []}}})
    monkeypatch.setenv("FILTEREST_SITE_ASSISTANT_INBOX", str(inbox))

    results = {}

    def run_tool():
        results["exit"] = tool_module.main(["--method", "GET", "--path", "/api/get-results",
                                            "--query", "dataset=app_notes"])

    tool = threading.Thread(target=run_tool, daemon=True)
    tool.start()
    calls = serve_once(session, inbox, iterations=200)
    tool.join(5)

    assert results["exit"] == 0
    assert len(calls) == 1 and calls[0]["path"] == "/api/get-results"
    assert session.calls[0][2] == {"dataset": "app_notes"}
    assert not list(inbox.glob("*.request.json"))


def test_refused_write_is_reported_as_needing_approval(tmp_path, monkeypatch):
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    session = FakeSession({"/api/update-row": {
        "status": 403, "needs_approval": True,
        "approval": {"method": "POST", "path": "/api/update-row", "body_sha256": "b" * 64},
    }})
    monkeypatch.setenv("FILTEREST_SITE_ASSISTANT_INBOX", str(inbox))
    results = {}

    def run_tool():
        results["exit"] = tool_module.main(["--method", "POST", "--path", "/api/update-row",
                                            "--body", '{"id": 3}'])

    tool = threading.Thread(target=run_tool, daemon=True)
    tool.start()
    calls = serve_once(session, inbox, iterations=200)
    tool.join(5)

    assert results["exit"] == 2, "the model must not treat an unapproved write as done"
    assert calls[0]["needs_approval"] is True


def test_invalid_and_symlinked_requests_are_left_unexecuted(tmp_path):
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    outside = tmp_path / "outside.json"
    outside.write_text(json.dumps({"method": "POST", "path": "/api/delete-rows"}))
    os.symlink(outside, inbox / "11111111-1111-1111-1111-111111111111.request.json")
    write_request(inbox, "22222222-2222-2222-2222-222222222222", {"path": "/api/x", "unexpected": 1})
    (inbox / "not-a-request.json").write_text("{}")
    session = FakeSession()

    calls = serve_once(session, inbox, iterations=25)

    assert calls == [] and session.calls == []


def test_bridge_failures_are_returned_as_data(tmp_path):
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    session = FakeSession(failures=["/api/forbidden"])
    write_request(inbox, "33333333-3333-3333-3333-333333333333",
                  {"method": "GET", "path": "/api/forbidden", "query": {}, "body": None})

    calls = serve_once(session, inbox, iterations=200)

    assert calls[0]["error"] == "call_refused" and calls[0]["status"] == 0


def test_tool_refuses_calls_outside_its_boundary(tmp_path, monkeypatch):
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    monkeypatch.setenv("FILTEREST_SITE_ASSISTANT_INBOX", str(inbox))
    for argv in (
        ["--path", "/admin/"],
        ["--method", "TRACE", "--path", "/api/get-results"],
        ["--method", "GET", "--path", "/api/get-results", "--body", "{}"],
    ):
        with pytest.raises(SystemExit):
            tool_module.main(argv)

    monkeypatch.delenv("FILTEREST_SITE_ASSISTANT_INBOX")
    with pytest.raises(SystemExit):
        tool_module.main(["--path", "/api/get-results"])
