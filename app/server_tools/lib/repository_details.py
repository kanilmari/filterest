"""Derive repository addresses from the release's single public identity file.

Used by publication tools and the shell lifecycle scripts. This module has no
network or configuration writes; malformed metadata has no fallback owner.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import re
import sys
from urllib.parse import quote

DETAILS_FILE = Path(__file__).resolve().parents[1] / "repo_details.json"
REPOSITORY_DETAILS_DIAGNOSTIC = "Invalid or unavailable repository identity; check app/server_tools/repo_details.json."


class RepositoryDetailsError(ValueError):
    """A metadata failure safe to report without exposing filesystem or input bytes."""


def unique_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate repository identity field")
        result[key] = value
    return result


@dataclass(frozen=True)
class RepositoryDetails:
    host: str
    owner: str
    repo: str

    def __post_init__(self):
        host_label = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
        if not isinstance(self.host, str) or not re.fullmatch(host_label + r"(?:\." + host_label + r")+", self.host):
            raise ValueError("repository host must be a lowercase DNS name without a port or scheme")
        if not isinstance(self.owner, str) or not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?", self.owner):
            raise ValueError("invalid repository owner")
        if not isinstance(self.repo, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", self.repo) or self.repo in {".", ".."}:
            raise ValueError("invalid repository name")

    @property
    def repository(self):
        return self.owner + "/" + self.repo

    @property
    def web_url(self):
        return "https://" + self.host + "/" + self.repository

    @property
    def git_url(self):
        return self.web_url + ".git"

    @property
    def api_url(self):
        base = "https://api.github.com" if self.host == "github.com" else "https://" + self.host + "/api/v3"
        return base + "/repos/" + self.repository

    @property
    def cli_repository(self):
        return self.host + "/" + self.repository

    def remote_urls(self):
        return {self.web_url, self.git_url, "git@" + self.host + ":" + self.repository + ".git",
                "ssh://git@" + self.host + "/" + self.repository + ".git"}

    def release_url(self, tag):
        return self.web_url + "/releases/tag/" + quote(tag, safe="")

    def download_url(self, tag):
        return self.web_url + "/releases/download/" + quote(tag, safe="")

    def release_api_url(self, tag=""):
        return self.api_url + ("/releases/tags/" + quote(tag, safe="") if tag else "/releases/latest")


def load_repository_details(path=DETAILS_FILE):
    try:
        raw = Path(path).read_bytes()
        if len(raw) > 4096:
            raise ValueError("repository identity exceeds its size limit")
        value = json.loads(raw, object_pairs_hook=unique_fields)
        if not isinstance(value, dict) or set(value) != {"host", "owner", "repo"}:
            raise ValueError("repository identity requires exactly host, owner and repo")
        return RepositoryDetails(**value)
    except (OSError, ValueError, TypeError):
        # CLI callers must never receive a path-bearing filesystem diagnostic.
        raise RepositoryDetailsError(REPOSITORY_DETAILS_DIAGNOSTIC) from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("field", choices=["host", "owner", "repo", "repository", "web", "git", "api", "release-api", "release", "download", "validate-remote"])
    parser.add_argument("argument", nargs="?", default="")
    args = parser.parse_args(argv)
    try:
        details = load_repository_details()
        if args.field == "validate-remote":
            if args.argument not in details.remote_urls():
                raise ValueError("origin must identify the repository in repo_details.json")
            return 0
        if args.field in {"release", "download"} and not args.argument:
            raise ValueError("a release tag is required")
        values = {"host": details.host, "owner": details.owner, "repo": details.repo,
                  "repository": details.repository, "web": details.web_url, "git": details.git_url,
                  "api": details.api_url, "release-api": details.release_api_url(args.argument), "release": details.release_url(args.argument),
                  "download": details.download_url(args.argument)}
        print(values[args.field])
        return 0
    except (OSError, ValueError, TypeError):
        # Do not echo malformed operator input in recovery diagnostics.
        print(REPOSITORY_DETAILS_DIAGNOSTIC, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
