#!/usr/bin/env python3
"""Publish verified standalone Filterest assets through an explicit local command.

Binds reviewed Git history, final binaries, account policy and GitHub readback.
Planning is read-only; publication preserves existing tags and releases and
reports partial remote progress without deleting or overwriting remote state.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from server_tools.release.github_actions_policy import GitHubRead, audit_account_policy

OWNER = "kanilmari"
REPOSITORY = OWNER + "/filterest"
BRANCH = "main"
REMOTE = "origin"
ACTIONS_EXCEPTIONS = {OWNER + "/try_it_html"}
SHA = re.compile(r"[0-9a-f]{40}\Z")


class PublicationError(ValueError):
    """A failed publication boundary, optionally carrying partial remote state."""

    def __init__(self, message, remote_state=None):
        super().__init__(message)
        self.remote_state = remote_state


def command(arguments, *, text=True, input=None):
    return subprocess.run(arguments, check=True, capture_output=True, text=text,
                          input=input, timeout=300, env={**os.environ, "GOWORK": "off", "GH_HOST": "github.com",
                                                        "GIT_TERMINAL_PROMPT": "0", "GH_PROMPT_DISABLED": "1"})


def git(root, *arguments):
    return command(["git", "-C", str(root), *arguments]).stdout.strip()


class GitHub(GitHubRead):
    """The GitHub boundary; each operation names its host and repository."""

    def __init__(self):
        super().__init__(command)

    def upload(self, tag, paths):
        command(["gh", "release", "upload", tag, *map(str, paths),
                 "--repo", "github.com/" + REPOSITORY])

    def download(self, asset_id):
        return command(["gh", "api", "--hostname", "github.com",
                        "-H", "Accept: application/octet-stream",
                        f"repos/{REPOSITORY}/releases/assets/{asset_id}"], text=False).stdout


def audit_actions(github):
    return audit_account_policy(OWNER, ACTIONS_EXCEPTIONS, github=github,
                                required_repositories={REPOSITORY})


def inspect_local(root, expected_commit, expected_version, assets_dir):
    """Bind final release history and every distributed byte before network work."""
    from server_tools.release.asset_verifier import verify_assets
    from server_tools.release.promote_release import validate_published_source

    if not SHA.fullmatch(expected_commit):
        raise PublicationError("--published-commit must be a full lowercase Git commit")
    if Path(git(root, "rev-parse", "--show-toplevel")).resolve() != root:
        raise PublicationError("target must own the standalone Git repository")
    if git(root, "branch", "--show-current") != BRANCH:
        raise PublicationError("publication requires the approved main branch")
    allowed_urls = {
        f"https://github.com/{REPOSITORY}", f"https://github.com/{REPOSITORY}.git",
        f"git@github.com:{REPOSITORY}.git", f"ssh://git@github.com/{REPOSITORY}.git",
    }
    for options in (["--all"], ["--all", "--push"]):
        urls = git(root, "remote", "get-url", *options, REMOTE).splitlines()
        if len(urls) != 1 or urls[0] not in allowed_urls:
            raise PublicationError("origin must have one approved GitHub fetch and push URL")
    if git(root, "config", "--type=bool", "--default=false", "--get", "remote.origin.mirror") != "false":
        raise PublicationError("origin mirror pushes are not permitted for release publication")
    history = validate_published_source(root, expected_commit)
    local_tag = "refs/tags/v" + expected_version
    if git(root, "for-each-ref", "--format=%(refname)", local_tag):
        raise PublicationError("local release tag already exists; existing tags are never replaced")
    version = (root / "app/VERSION_APP").read_text().strip()
    if version != expected_version:
        raise PublicationError("--expect-version does not match the final published source")
    assets = verify_assets(root, assets_dir, expected_commit)
    if assets.get("app_version") != version or assets.get("source_commit") != expected_commit:
        raise PublicationError("asset verification does not identify the final version and commit")
    notes = (root / "app/docs/publication/RELEASE_NOTES.md").read_text(encoding="utf-8")
    if not notes.strip():
        raise PublicationError("reviewed release notes must not be empty")
    return {"repository": REPOSITORY, "branch": BRANCH, "published_commit": expected_commit,
            "version": version, "tag": "v" + version, "history": history, "verified_assets": assets,
            "release_notes": notes}


def read_remote_refs(root, tag):
    result = git(root, "ls-remote", REMOTE, "refs/heads/" + BRANCH,
                 "refs/tags/" + tag, "refs/tags/" + tag + "^{}")
    refs = {}
    expected = {"refs/heads/" + BRANCH, "refs/tags/" + tag, "refs/tags/" + tag + "^{}"}
    for line in result.splitlines():
        fields = line.split()
        if len(fields) != 2 or not SHA.fullmatch(fields[0]) or fields[1] not in expected or fields[1] in refs:
            raise PublicationError("Git remote returned malformed or unexpected refs")
        refs[fields[1]] = fields[0]
    if "refs/heads/" + BRANCH not in refs:
        raise PublicationError("approved remote main branch is missing")
    return refs


def inspect_remote(root, local, github):
    """Reject existing release/tag state and any branch that cannot fast-forward."""
    policy = audit_actions(github)
    repository = github.api("repos/" + REPOSITORY)
    if (not isinstance(repository, dict) or repository.get("full_name") != REPOSITORY
            or not isinstance(repository.get("owner"), dict) or repository["owner"].get("login") != OWNER
            or repository.get("private") is not False or repository.get("archived") is not False
            or repository.get("disabled") is not False or not isinstance(repository.get("permissions"), dict)
            or repository["permissions"].get("push") is not True):
        raise PublicationError("GitHub target must be the approved public active repository with push permission")
    refs = read_remote_refs(root, local["tag"])
    if any(ref.startswith("refs/tags/") for ref in refs):
        raise PublicationError("release tag already exists; existing tags are never replaced")
    remote_commit = refs["refs/heads/" + BRANCH]
    try:
        git(root, "merge-base", "--is-ancestor", remote_commit, local["published_commit"])
    except subprocess.CalledProcessError as error:
        raise PublicationError("remote main is ahead, divergent, or unavailable locally; fetch and reconcile before publication") from error
    releases = github.pages(f"repos/{REPOSITORY}/releases?per_page=100")
    for release in releases:
        if not isinstance(release, dict) or not isinstance(release.get("tag_name"), str):
            raise PublicationError("GitHub release inventory is malformed")
        if release["tag_name"] == local["tag"]:
            raise PublicationError("GitHub release already exists; existing releases are never replaced")
    return {"main_commit": remote_commit, "actions_policy": policy}


def verify_refs(root, local):
    refs = read_remote_refs(root, local["tag"])
    commit = local["published_commit"]
    if refs.get("refs/heads/" + BRANCH) != commit:
        raise PublicationError("remote main no longer identifies the published commit")
    target = refs.get("refs/tags/" + local["tag"] + "^{}", refs.get("refs/tags/" + local["tag"]))
    if target != commit:
        raise PublicationError("remote release tag does not identify the published commit")
    return refs


def verify_release(github, release_id, local, *, draft):
    """Download every remote asset; names and hashes must equal the local set."""
    release = github.api(f"repos/{REPOSITORY}/releases/{release_id}")
    if (not isinstance(release, dict) or release.get("id") != release_id
            or release.get("tag_name") != local["tag"] or release.get("name") != "Filterest " + local["version"]
            or release.get("draft") is not draft or release.get("prerelease") is not False):
        raise PublicationError("GitHub release identity or maturity changed")
    if release.get("body") != local["release_notes"]:
        raise PublicationError("GitHub release notes differ from reviewed source")
    assets = github.pages(f"repos/{REPOSITORY}/releases/{release_id}/assets?per_page=100")
    actual = {}
    for asset in assets:
        if (not isinstance(asset, dict) or not isinstance(asset.get("name"), str)
                or type(asset.get("id")) is not int or asset["id"] <= 0
                or asset.get("state") != "uploaded" or asset["name"] in actual or asset["id"] in actual.values()):
            raise PublicationError("GitHub release asset inventory is incomplete or malformed")
        actual[asset["name"]] = asset["id"]
    expected = local["verified_assets"]["assets"]
    if set(actual) != set(expected):
        raise PublicationError("GitHub release asset names differ from the complete verified local set")
    hashes = {name: hashlib.sha256(github.download(asset_id)).hexdigest() for name, asset_id in sorted(actual.items())}
    if hashes != expected:
        raise PublicationError("GitHub release asset bytes differ from the verified local build")
    return {"release_id": release_id, "url": release.get("html_url"), "asset_sha256": hashes}


def publish(args, github=None):
    """Plan by default, or publish once after repeating all local/remote guards."""
    github = github or GitHub()
    root, assets_dir = args.target.resolve(), args.assets_dir.resolve()
    local = inspect_local(root, args.published_commit, args.expect_version, assets_dir)
    remote = inspect_remote(root, local, github)
    report = {key: value for key, value in local.items() if key != "release_notes"}
    report.update({"mode": "plan", "remote": remote, "publication_verified": False})
    if not args.apply:
        return report

    state = {"phase": "preflight", "repository": REPOSITORY, "tag": local["tag"],
             "published_commit": args.published_commit, "release_id": None}
    try:
        refreshed = inspect_local(root, args.published_commit, args.expect_version, assets_dir)
        if refreshed != local:
            raise PublicationError("local publication inputs changed after planning")
        remote = inspect_remote(root, local, github)
        state["phase"] = "push_requested"
        # Explicit refs avoid push.default and automatic followed tags. Mirror
        # configuration is refused in preflight. No local tag is created;
        # --atomic prevents a branch-only Git push result.
        git(root, "-c", "push.followTags=false", "push", "--atomic", REMOTE,
            local["published_commit"] + ":refs/heads/" + BRANCH,
            local["published_commit"] + ":refs/tags/" + local["tag"])
        state["phase"] = "refs_pushed"
        verify_refs(root, local)
        state["phase"] = "draft_creation_requested"
        draft = github.api(f"repos/{REPOSITORY}/releases", method="POST", payload={
            "tag_name": local["tag"], "target_commitish": local["published_commit"],
            "name": "Filterest " + local["version"], "body": local["release_notes"],
            "draft": True, "prerelease": False,
        })
        if not isinstance(draft, dict) or type(draft.get("id")) is not int or draft["id"] <= 0:
            raise PublicationError("GitHub did not identify the created draft")
        state.update({"phase": "draft_created", "release_id": draft["id"]})
        release_id = draft["id"]
        # Verify identity before upload; contents are checked after all uploads.
        if draft.get("tag_name") != local["tag"] or draft.get("draft") is not True:
            raise PublicationError("created draft does not identify the selected release")
        state["phase"] = "asset_upload_requested"
        github.upload(local["tag"], [assets_dir / name for name in sorted(local["verified_assets"]["assets"])])
        state["phase"] = "assets_uploaded"
        verify_release(github, release_id, local, draft=True)
        verify_refs(root, local)
        # Recheck final bytes and source before making the verified draft public.
        if inspect_local(root, args.published_commit, args.expect_version, assets_dir) != local:
            raise PublicationError("local publication inputs changed during upload")
        audit_actions(github)
        state["phase"] = "publication_requested"
        github.api(f"repos/{REPOSITORY}/releases/{release_id}", method="PATCH",
                   payload={"draft": False})
        state["phase"] = "release_published"
        readback = verify_release(github, release_id, local, draft=False)
        refs = verify_refs(root, local)
        state["phase"] = "verified"
        report.update({"mode": "published", "publication_verified": True,
                       "remote": remote, "remote_state": state, "readback": readback, "remote_refs": refs})
        return report
    except Exception as error:
        raise PublicationError(str(error), state) from error


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--target", type=Path, default=APP_ROOT.parent)
    parser.add_argument("--expect-version", required=True)
    parser.add_argument("--published-commit", required=True)
    parser.add_argument("--assets-dir", type=Path, required=True)
    parser.add_argument("--apply", action="store_true", help="Publish the verified new release")
    parser.add_argument("--json", action="store_true")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    try:
        report = publish(args)
    except Exception as error:
        failure = {"error": str(error), "publication_verified": False,
                   "remote_state": getattr(error, "remote_state", None)}
        print(json.dumps(failure, indent=2), file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"Filterest {report['version']}: {report['mode']}")
        print(f"Target: {REPOSITORY} {report['tag']} at {report['published_commit']}")
        print("Publication verified: " + str(report["publication_verified"]).lower())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
