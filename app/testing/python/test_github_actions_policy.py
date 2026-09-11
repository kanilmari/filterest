"""Keep the public GitHub Actions account audit complete and fail-closed.

All GitHub responses are fixtures. Unknown permissions, pagination, ownership
and authentication must stop publication without changing repository settings.
"""
import json
from pathlib import Path
import subprocess
import sys

import pytest

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))
from server_tools.release import github_actions_policy as policy


class FixtureAPI:
    def __init__(self):
        self.account = "owner"
        self.scopes = ["repo"]
        self.repositories = [{"full_name": "owner/product", "owner": {"login": "owner"}, "archived": True},
                             {"full_name": "owner/pages", "owner": {"login": "owner"}}]
        self.states = {"owner/product": False, "owner/pages": True}
        self.calls = []

    def owner_visibility(self):
        self.calls.append("user-with-oauth-scope-headers")
        return {"account": {"login": self.account}, "oauth_scopes": self.scopes}

    def api(self, path):
        self.calls.append(path)
        if path == "user":
            return {"login": self.account}
        return {"enabled": self.states[path.removeprefix("repos/").removesuffix("/actions/permissions")]}

    def pages(self, path):
        self.calls.append(path)
        return self.repositories


def test_account_audit_includes_archived_and_private_inventory():
    api = FixtureAPI()
    result = policy.audit_account_policy("owner", {"owner/pages"}, github=api, required_repositories={"owner/product"})
    assert result["repositories_checked"] == ["owner/pages", "owner/product"]
    assert "user/repos?affiliation=owner&per_page=100" in api.calls
    assert result["enabled_exceptions"] == ["owner/pages"]


@pytest.mark.parametrize("state", [None, "false", 0, 1, {}, []])
def test_unknown_permission_is_not_reported_disabled(state):
    api = FixtureAPI()
    api.states["owner/product"] = state
    with pytest.raises(policy.ActionsPolicyError, match="unknown"):
        policy.audit_account_policy("owner", {"owner/pages"}, github=api)


@pytest.mark.parametrize("kind", ["wrong_account", "unexpected_enabled", "missing_exception", "duplicate", "wrong_owner", "empty"])
def test_incomplete_or_noncompliant_account_fails_closed(kind):
    api = FixtureAPI()
    if kind == "wrong_account":
        api.account = "someone"
    elif kind == "unexpected_enabled":
        api.states["owner/product"] = True
    elif kind == "missing_exception":
        api.repositories.pop()
    elif kind == "duplicate":
        api.repositories.append(dict(api.repositories[0]))
    elif kind == "wrong_owner":
        api.repositories[0]["owner"]["login"] = "someone"
    else:
        api.repositories.clear()
    with pytest.raises(policy.ActionsPolicyError):
        policy.audit_account_policy("owner", {"owner/pages"}, github=api)


def test_pagination_uses_all_pages_and_explicit_host():
    calls = []
    def run(args, **kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, json.dumps([[{"page": 1}], [{"page": 2}]]), "")
    api = policy.GitHubRead(run)
    assert api.pages("user/repos?per_page=100") == [{"page": 1}, {"page": 2}]
    assert calls == [["gh", "api", "--hostname", "github.com", "--paginate", "--slurp", "user/repos?per_page=100"]]


@pytest.mark.parametrize("payload", [{}, [], [None], [{"incomplete": True}], "bad"])
def test_unknown_pagination_shape_fails(payload):
    def run(args, **kwargs):
        return subprocess.CompletedProcess(args, 0, json.dumps(payload), "")
    with pytest.raises(policy.ActionsPolicyError):
        policy.GitHubRead(run).pages("user/repos?per_page=100")


def test_network_auth_failure_is_not_an_empty_repository_list():
    def run(args, **kwargs):
        raise subprocess.CalledProcessError(1, args, stderr="authentication required")
    with pytest.raises(subprocess.CalledProcessError):
        policy.GitHubRead(run).pages("user/repos?per_page=100")


def test_policy_cli_preserves_owner_and_exception_arguments(monkeypatch, capsys):
    calls = []
    def audit(owner, allowed):
        calls.append((owner, allowed))
        return {"account": owner}
    monkeypatch.setattr(policy, "audit_account_policy", audit)
    assert policy.main(["--owner", "owner", "--allow-enabled", "owner/pages"]) == 0
    assert calls == [("owner", ["owner/pages"])]
    assert "GitHub Actions account policy OK" in capsys.readouterr().out


def test_audit_subprocess_disables_prompts_and_bounds_reads(monkeypatch):
    calls = []
    def run(arguments, **kwargs):
        calls.append(kwargs)
        return subprocess.CompletedProcess(arguments, 0, "{}", "")
    monkeypatch.setattr(policy.subprocess, "run", run)
    policy.run_command(["gh", "api", "user"])
    assert calls[0]["timeout"] == 60
    assert calls[0]["env"]["GH_PROMPT_DISABLED"] == "1"
    assert calls[0]["env"]["GIT_TERMINAL_PROMPT"] == "0"


@pytest.mark.parametrize("headers", ["", "X-Accepted-OAuth-Scopes: repo", "X-OAuth-Scopes: public_repo", "X-OAuth-Scopes: read:user", "X-OAuth-Scopes: repo\nX-OAuth-Scopes: repo"])
def test_account_inventory_requires_proof_of_all_private_repository_visibility(headers):
    def run(arguments, **kwargs):
        body = "HTTP/2.0 200 OK\n" + headers + "\n\n" + json.dumps({"login": "owner"})
        return subprocess.CompletedProcess(arguments, 0, body, "")
    with pytest.raises(policy.ActionsPolicyError):
        policy.GitHubRead(run).owner_visibility()


def test_classic_repo_scope_header_is_required_and_only_metadata_is_returned():
    calls = []
    def run(arguments, **kwargs):
        calls.append(arguments)
        body = 'HTTP/2.0 200 OK\r\nX-OAuth-Scopes: read:org, repo\r\n\r\n{"login":"owner"}'
        return subprocess.CompletedProcess(arguments, 0, body, "")
    result = policy.GitHubRead(run).owner_visibility()
    assert result == {"account": {"login": "owner"}, "oauth_scopes": ["read:org", "repo"]}
    assert calls[0] == ["gh", "api", "--hostname", "github.com", "--include", "--method", "GET", "user"]


def test_fine_grained_or_narrow_visibility_never_claims_complete_account_audit():
    api = FixtureAPI()
    api.scopes = []
    with pytest.raises(policy.ActionsPolicyError, match="visibility"):
        policy.audit_account_policy("owner", {"owner/pages"}, github=api)
    assert "user/repos?affiliation=owner&per_page=100" not in api.calls
