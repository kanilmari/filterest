#!/usr/bin/env python3
"""Audit GitHub Actions settings for the authenticated repository owner.

Provides the public account policy boundary used before release publication.
Strict pagination and typed responses prevent unknown or inaccessible settings
from being reported as disabled. The audit performs no GitHub writes.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys


class ActionsPolicyError(ValueError):
    """The account's complete Actions policy could not be verified."""


def run_command(arguments, *, input=None):
    return subprocess.run(arguments, check=True, capture_output=True, text=True,
                          input=input, timeout=60, env={**os.environ, "GH_HOST": "github.com",
                                                       "GIT_TERMINAL_PROMPT": "0", "GH_PROMPT_DISABLED": "1"})


class GitHubRead:
    """Read complete JSON responses from the explicitly selected GitHub host."""

    def __init__(self, runner=None):
        self.run = runner or run_command

    def api(self, endpoint, *, method="GET", payload=None):
        arguments = ["gh", "api", "--hostname", "github.com", "--method", method, endpoint]
        if payload is not None:
            arguments.extend(["--input", "-"])
        result = self.run(arguments, input=json.dumps(payload) if payload is not None else None)
        return json.loads(result.stdout)

    def owner_visibility(self):
        """Require a classic/OAuth repo scope that can enumerate private ownership."""
        result = self.run(["gh", "api", "--hostname", "github.com", "--include", "--method", "GET", "user"])
        parts = result.stdout.replace("\r\n", "\n").split("\n\n", 1)
        if len(parts) != 2 or not re.fullmatch(r"HTTP/\S+ 200(?: .*)?", parts[0].splitlines()[0]):
            raise ActionsPolicyError("GitHub account visibility requires a successful response with headers")
        scope_headers = [line.split(":", 1)[1].strip() for line in parts[0].splitlines()[1:]
                         if ":" in line and line.split(":", 1)[0].lower() == "x-oauth-scopes"]
        if len(scope_headers) != 1:
            raise ActionsPolicyError("complete account visibility is unproved: OAuth scope header is missing or ambiguous")
        scopes = [value.strip() for value in scope_headers[0].split(",") if value.strip()]
        if "repo" not in scopes:
            raise ActionsPolicyError("complete account visibility requires a classic/OAuth token with repo scope")
        return {"account": json.loads(parts[1]), "oauth_scopes": scopes}

    def pages(self, endpoint):
        result = self.run(["gh", "api", "--hostname", "github.com", "--paginate", "--slurp", endpoint])
        pages = json.loads(result.stdout)
        if not isinstance(pages, list) or not pages or any(not isinstance(page, list) for page in pages):
            raise ActionsPolicyError("GitHub pagination did not return complete JSON pages")
        return [item for page in pages for item in page]


def audit_account_policy(owner, allowed_enabled, *, github=None, required_repositories=()):
    """Verify all owned repositories, including private and archived repositories."""
    if not isinstance(owner, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*", owner):
        raise ActionsPolicyError("invalid GitHub account name")
    allowed_enabled, required_repositories = set(allowed_enabled), set(required_repositories)
    for name in allowed_enabled | required_repositories:
        if not isinstance(name, str) or not re.fullmatch(re.escape(owner) + r"/[A-Za-z0-9_.-]+", name):
            raise ActionsPolicyError("configured repository does not belong to the selected owner")
    github = github or GitHubRead()
    visibility = github.owner_visibility()
    if (not isinstance(visibility, dict) or not isinstance(visibility.get("oauth_scopes"), list)
            or "repo" not in visibility["oauth_scopes"]):
        raise ActionsPolicyError("complete account visibility is unproved")
    account = visibility.get("account")
    if not isinstance(account, dict) or account.get("login") != owner:
        raise ActionsPolicyError("GitHub authentication must identify the approved account " + owner)
    repositories = github.pages("user/repos?affiliation=owner&per_page=100")
    names = []
    for repository in repositories:
        if not isinstance(repository, dict) or not isinstance(repository.get("owner"), dict):
            raise ActionsPolicyError("GitHub repository inventory contains malformed ownership")
        name = repository.get("full_name")
        if (repository["owner"].get("login") != owner or not isinstance(name, str)
                or not re.fullmatch(re.escape(owner) + r"/[A-Za-z0-9_.-]+", name)):
            raise ActionsPolicyError("GitHub repository inventory contains unexpected ownership")
        if name in names:
            raise ActionsPolicyError("GitHub repository inventory contains duplicate repositories")
        names.append(name)
    if not names or not (allowed_enabled | required_repositories).issubset(names):
        raise ActionsPolicyError("GitHub inventory omits the release repository or configured Actions exception")
    enabled = []
    for name in sorted(names):
        settings = github.api(f"repos/{name}/actions/permissions")
        if not isinstance(settings, dict) or type(settings.get("enabled")) is not bool:
            raise ActionsPolicyError("GitHub Actions state is unknown for " + name)
        if settings["enabled"]:
            enabled.append(name)
    unexpected = set(enabled) - allowed_enabled
    if unexpected:
        raise ActionsPolicyError("GitHub Actions is enabled outside the approved exception: " + ", ".join(sorted(unexpected)))
    return {"account": owner, "repositories_checked": sorted(names), "enabled_exceptions": sorted(enabled),
            "completeness_basis": "classic-or-oauth-repo-scope"}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--owner", required=True)
    parser.add_argument("--allow-enabled", action="append", default=[])
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        result = audit_account_policy(args.owner, args.allow_enabled)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print("GitHub Actions policy audit failed: " + str(error), file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        exceptions = ", ".join(args.allow_enabled) or "none"
        print(f"GitHub Actions account policy OK: all owned repositories are disabled except approved entries ({exceptions}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
