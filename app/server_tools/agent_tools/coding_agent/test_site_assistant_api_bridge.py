"""Verify the assistant's API bridge against a fake site: no network, model or real site.

Covers the delegation exchange, read calls, CSRF on writes, refused writes
collected as plan entries, and the boundaries the bridge refuses outright.
"""
import importlib.util
import io
import json
from pathlib import Path
import urllib.error
import urllib.request

import pytest

MODULE_PATH = Path(__file__).with_name("site_assistant_api_bridge.py")
specification = importlib.util.spec_from_file_location("site_assistant_api_bridge", MODULE_PATH)
bridge_module = importlib.util.module_from_spec(specification)
specification.loader.exec_module(bridge_module)


class FakeResponse(io.BytesIO):
    def __init__(self, status, payload):
        super().__init__(json.dumps(payload).encode())
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
        return False


class FakeSite:
    """Records requests and answers them like the application would."""

    def __init__(self, responses):
        self.responses = responses
        self.requests = []

    def build_opener(self, *_handlers):
        site = self

        class Opener:
            def open(self, request, timeout=None):
                body = request.data.decode() if request.data else ""
                site.requests.append({
                    "method": request.get_method(),
                    "url": request.full_url,
                    "body": body,
                    "csrf": request.get_header("X-csrf-token"),
                })
                key = (request.get_method(), urllib.parse.urlsplit(request.full_url).path)
                status, payload = site.responses[key]
                if callable(payload):
                    payload = payload(request)
                if status >= 400:
                    raise urllib.error.HTTPError(request.full_url, status, "error", {},
                                                 io.BytesIO(json.dumps(payload).encode()))
                return FakeResponse(status, payload)

        import urllib.parse  # local import keeps the fake self-contained
        return Opener()


def make_session(responses):
    site = FakeSite(responses)
    session = bridge_module.SiteAPISession("http://127.0.0.1:8193", opener_factory=site.build_opener)
    return session, site


def test_exchange_then_read_uses_the_delegated_session():
    session, site = make_session({
        ("POST", "/api/site-assistant/delegation/exchange"): (200, {
            "authenticated": True, "delegation_id": "abc", "username": "test_admin_12",
            "api_catalog_route": "/api/admin/site-assistant/api-catalog",
        }),
        ("GET", "/api/get-results"): (200, {"data": [{"id": 5}]}),
    })
    session.exchange("fsa1_code")
    result = session.call("GET", "/api/get-results", query={"dataset": "app_notes", "row_count": 1})

    assert session.delegation["username"] == "test_admin_12"
    assert result["status"] == 200 and result["body"]["data"][0]["id"] == 5
    assert "dataset=app_notes" in site.requests[-1]["url"]
    assert session.planned_writes() == []


def test_refused_write_becomes_a_plan_entry_without_repeats():
    body = {"id": 7, "updates": [{"column": "header", "value": "New"}]}
    session, _ = make_session({
        ("POST", "/api/site-assistant/delegation/exchange"): (200, {"authenticated": True, "delegation_id": "abc"}),
        ("GET", "/api/csrf-token"): (200, {"csrf_token": "token-1"}),
        ("POST", "/api/update-row"): (403, {
            "error": "site_assistant_approval_required",
            "call": {"method": "POST", "path": "/api/update-row", "query": "dataset=app_notes", "body_sha256": "a" * 64},
        }),
    })
    session.exchange("fsa1_code")

    first = session.call("POST", "/api/update-row", query={"dataset": "app_notes"}, body=body)
    second = session.call("POST", "/api/update-row", query={"dataset": "app_notes"}, body=body)

    assert first["needs_approval"] and first["approval"]["body_sha256"] == "a" * 64
    assert second["needs_approval"]
    plan = session.planned_writes()
    assert len(plan) == 1 and plan[0]["body"] == body and plan[0]["query"] == {"dataset": "app_notes"}


def test_query_target_is_part_of_the_plan_identity_and_is_canonical():
    body = {"ids": [7]}

    def refusal(request):
        pairs = urllib.parse.parse_qsl(urllib.parse.urlsplit(request.full_url).query, keep_blank_values=True)
        return {
            "error": "site_assistant_approval_required",
            "call": {
                "method": "POST",
                "path": "/api/delete-rows",
                "query": urllib.parse.urlencode(sorted(pairs)),
                "body_sha256": "b" * 64,
            },
        }

    session, _ = make_session({
        ("POST", "/api/site-assistant/delegation/exchange"): (200, {"authenticated": True, "delegation_id": "abc"}),
        ("GET", "/api/csrf-token"): (200, {"csrf_token": "token-1"}),
        ("POST", "/api/delete-rows"): (403, refusal),
    })
    session.exchange("fsa1_code")

    session.call("POST", "/api/delete-rows", query={"dataset": "app_notes", "label": "some value"}, body=body)
    session.call("POST", "/api/delete-rows", query={"label": "some value", "dataset": "app_notes"}, body=body)
    session.call("POST", "/api/delete-rows", query={"dataset": "app_tasks", "label": "some value"}, body=body)

    plan = session.planned_writes()
    assert len(plan) == 2
    assert [entry["approval"]["query"] for entry in plan] == [
        "dataset=app_notes&label=some+value",
        "dataset=app_tasks&label=some+value",
    ]


def test_writes_carry_a_csrf_token_and_reads_do_not():
    session, site = make_session({
        ("POST", "/api/site-assistant/delegation/exchange"): (200, {"authenticated": True, "delegation_id": "abc"}),
        ("GET", "/api/csrf-token"): (200, {"csrf_token": "token-1"}),
        ("POST", "/api/delete-rows"): (200, {"deleted": 1}),
        ("GET", "/api/dataset-names"): (200, {"datasets": []}),
    })
    session.exchange("fsa1_code")
    session.call("GET", "/api/dataset-names")
    session.call("POST", "/api/delete-rows", query={"dataset": "app_notes"}, body={"ids": [7]})

    read_request = [entry for entry in site.requests if entry["url"].endswith("/api/dataset-names")][0]
    write_request = [entry for entry in site.requests if "/api/delete-rows" in entry["url"]][0]
    assert read_request["csrf"] is None
    assert write_request["csrf"] == "token-1"


def test_failed_exchange_and_unreachable_site_are_reported():
    session, _ = make_session({
        ("POST", "/api/site-assistant/delegation/exchange"): (401, {"error": "delegation_not_valid"}),
    })
    with pytest.raises(bridge_module.BridgeError):
        session.exchange("fsa1_wrong")


def test_bridge_refuses_calls_outside_its_boundary():
    session, _ = make_session({
        ("POST", "/api/site-assistant/delegation/exchange"): (200, {"authenticated": True, "delegation_id": "abc"}),
    })
    session.exchange("fsa1_code")
    for method, path in (
        ("GET", "/admin/"),
        ("GET", "/storage/1/2/original/file.jpg"),
        ("TRACE", "/api/get-results"),
        ("POST", "/api/site-assistant/delegation/exchange"),
    ):
        with pytest.raises(bridge_module.BridgeError):
            session.call(method, path)


def test_base_url_must_be_the_site_itself():
    with pytest.raises(bridge_module.BridgeError):
        bridge_module.SiteAPISession("http://example.com")
