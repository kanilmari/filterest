"""Exercise release publication with a fake GitHub and Git mutation boundary.

Shared history and binary verification have their own fixture tests. These
checks prove exact remote identity, read-only planning, complete asset readback
and truthful partial-failure reporting without contacting GitHub.
"""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))
from server_tools.release import publish_release as release
from server_tools.release import github_actions_policy as policy

P, C = "a" * 40, "b" * 40


class FakeGitHub:
    def __init__(self, content):
        self.content = content
        self.events = []
        self.existing_release = False
        self.draft = None
        self.fail = None
        self.extra_asset = False
        self.corrupt_asset = False
        self.account = release.OWNER
        self.repository = {"full_name": release.REPOSITORY, "owner": {"login": release.OWNER},
                           "private": False, "archived": False, "disabled": False, "permissions": {"push": True}}
        self.enabled = {release.OWNER + "/try_it_html": True}

    def owner_visibility(self):
        self.events.append(("GET", "user-with-oauth-scope-headers"))
        return {"account": {"login": self.account}, "oauth_scopes": ["repo"]}

    def api(self, endpoint, *, method="GET", payload=None):
        self.events.append((method, endpoint))
        if endpoint == "user":
            return {"login": self.account}
        if endpoint == "repos/" + release.REPOSITORY:
            return self.repository
        if endpoint.endswith("/actions/permissions"):
            name = endpoint.removeprefix("repos/").removesuffix("/actions/permissions")
            return {"enabled": self.enabled.get(name, False)}
        if method == "POST":
            if self.fail == "create":
                raise OSError("draft creation interrupted")
            self.draft = {**payload, "id": 7, "html_url": "https://github.com/kanilmari/filterest/releases/tag/v1.2.4"}
            return dict(self.draft)
        if method == "PATCH":
            if self.fail == "publish":
                raise OSError("publication interrupted")
            self.draft.update(payload)
            return dict(self.draft)
        if endpoint.endswith("/releases/7"):
            return dict(self.draft)
        raise AssertionError((endpoint, method))

    def pages(self, endpoint):
        self.events.append(("PAGES", endpoint))
        if endpoint.startswith("user/repos"):
            return [{"full_name": name, "owner": {"login": release.OWNER}, "archived": True}
                    for name in (release.REPOSITORY, release.OWNER + "/try_it_html", release.OWNER + "/private-archive")]
        if endpoint.endswith("/assets?per_page=100"):
            assets = [{"name": name, "id": index, "state": "uploaded"}
                      for index, name in enumerate(sorted(self.content), 1)]
            if self.extra_asset:
                assets.append({"name": "unexpected-secret", "id": 99, "state": "uploaded"})
            return assets
        if endpoint.endswith("/releases?per_page=100"):
            return [{"tag_name": "v1.2.4"}] if self.existing_release else []
        raise AssertionError(endpoint)

    def upload(self, tag, paths):
        self.events.append(("UPLOAD", tag, [path.name for path in paths]))
        if self.fail == "upload":
            raise OSError("upload interrupted")

    def download(self, asset_id):
        self.events.append(("DOWNLOAD", asset_id))
        if self.fail == "download":
            raise OSError("download interrupted")
        if self.corrupt_asset and asset_id == 1:
            return b"corrupted remote bytes"
        return self.content[sorted(self.content)[asset_id - 1]]


@pytest.fixture
def publication(tmp_path, monkeypatch):
    content = {f"asset-{index:02d}": f"verified bytes {index}".encode() for index in range(14)}
    github = FakeGitHub(content)
    local = {"repository": release.REPOSITORY, "branch": "main", "published_commit": P,
             "version": "1.2.4", "tag": "v1.2.4", "release_notes": "# Reviewed release\n",
             "history": {"candidate_commit": C, "published_commit": P},
             "verified_assets": {"source_commit": P, "app_version": "1.2.4",
                                 "assets": {name: hashlib.sha256(data).hexdigest() for name, data in content.items()}}}
    monkeypatch.setattr(release, "inspect_local", lambda *a: copy.deepcopy(local))
    operations = []
    remote = {"main": C, "tag": None, "fail_push": False, "diverged": False}

    def git(root, *arguments):
        operations.append(arguments)
        if arguments[0] == "ls-remote":
            text = remote["main"] + "\trefs/heads/main\n"
            if remote["tag"]:
                text += remote["tag"] + "\trefs/tags/v1.2.4\n"
            return text
        if arguments[0] == "merge-base":
            if remote["diverged"]:
                raise subprocess.CalledProcessError(1, "git merge-base")
            return ""
        if "push" in arguments:
            if remote["fail_push"]:
                raise subprocess.CalledProcessError(1, "git push")
            remote.update(main=P, tag=P)
            return ""
        raise AssertionError(arguments)

    monkeypatch.setattr(release, "git", git)
    args = SimpleNamespace(target=tmp_path, assets_dir=tmp_path / "assets",
                           published_commit=P, expect_version="1.2.4", apply=False)
    return args, github, operations, remote


def test_plan_only_reads_account_remote_and_assets(publication):
    args, github, operations, _ = publication
    result = release.publish(args, github)
    assert result["mode"] == "plan" and not result["publication_verified"]
    assert len(result["verified_assets"]["assets"]) == 14
    assert not any("push" in operation for operation in operations)
    assert all(event[0] in {"GET", "PAGES"} for event in github.events)
    assert release.OWNER + "/private-archive" in result["remote"]["actions_policy"]["repositories_checked"]


def test_apply_uses_atomic_normal_push_then_verified_draft_then_public_readback(publication):
    args, github, operations, _ = publication
    args.apply = True
    result = release.publish(args, github)
    assert result["publication_verified"] and result["remote_state"]["phase"] == "verified"
    pushes = [operation for operation in operations if "push" in operation]
    assert pushes == [("-c", "push.followTags=false", "push", "--atomic", "origin",
                       P + ":refs/heads/main", P + ":refs/tags/v1.2.4")]
    names = [event[0] for event in github.events]
    assert names.index("POST") < names.index("UPLOAD") < names.index("DOWNLOAD") < names.index("PATCH")
    assert names.count("DOWNLOAD") == 28
    assert len(result["readback"]["asset_sha256"]) == 14
    assert not any(event[0] in {"DELETE"} for event in github.events)


@pytest.mark.parametrize("kind", ["tag", "release", "divergent"])
def test_existing_remote_state_fails_before_any_mutation(publication, kind):
    args, github, operations, remote = publication
    args.apply = True
    if kind == "tag":
        remote["tag"] = P
    elif kind == "release":
        github.existing_release = True
    else:
        remote["diverged"] = True
    with pytest.raises(release.PublicationError):
        release.publish(args, github)
    assert not any("push" in operation for operation in operations)
    assert all(event[0] in {"GET", "PAGES"} for event in github.events)


@pytest.mark.parametrize("kind,phase", [
    ("push", "push_requested"), ("create", "draft_creation_requested"),
    ("upload", "asset_upload_requested"), ("download", "assets_uploaded"),
    ("publish", "publication_requested"),
])
def test_failure_preserves_and_identifies_partial_remote_state(publication, kind, phase):
    args, github, _, remote = publication
    args.apply = True
    if kind == "push":
        remote["fail_push"] = True
    else:
        github.fail = kind
    with pytest.raises(release.PublicationError) as caught:
        release.publish(args, github)
    assert caught.value.remote_state["phase"] == phase
    assert caught.value.remote_state["tag"] == "v1.2.4"
    assert not any(event[0] == "DELETE" for event in github.events)
    if kind in {"upload", "download", "publish"}:
        assert github.draft["draft"] is True


@pytest.mark.parametrize("kind", ["extra_asset", "corrupt_asset"])
def test_wrong_remote_asset_set_or_bytes_never_publish_draft(publication, kind):
    args, github, _, _ = publication
    args.apply = True
    setattr(github, kind, True)
    with pytest.raises(release.PublicationError, match="asset"):
        release.publish(args, github)
    assert not any(event[0] == "PATCH" for event in github.events)
    assert github.draft["draft"] is True


def test_changed_local_inputs_stop_before_push(publication, monkeypatch):
    args, github, operations, _ = publication
    args.apply = True
    initial = release.inspect_local(args.target, P, "1.2.4", args.assets_dir)
    changed = copy.deepcopy(initial)
    changed["release_notes"] += "unreviewed change"
    values = iter([initial, changed])
    monkeypatch.setattr(release, "inspect_local", lambda *a: next(values))
    with pytest.raises(release.PublicationError, match="inputs changed"):
        release.publish(args, github)
    assert not any("push" in operation for operation in operations)


def test_remote_ref_malformed_response_is_not_missing_tag(monkeypatch, tmp_path):
    monkeypatch.setattr(release, "git", lambda *a: "not-a-sha\trefs/heads/main")
    with pytest.raises(release.PublicationError, match="malformed"):
        release.read_remote_refs(tmp_path, "v1.2.4")


@pytest.fixture
def local_source(tmp_path, monkeypatch):
    (tmp_path / "app/docs/publication").mkdir(parents=True)
    (tmp_path / "app/VERSION_APP").write_text("1.2.4\n")
    (tmp_path / "app/docs/publication/RELEASE_NOTES.md").write_text("Reviewed notes\n")
    values = {"branch": "main", "url": "https://github.com/kanilmari/filterest.git", "tag": "", "mirror": "false"}
    def git(root, *args):
        if args[0] == "rev-parse":
            return str(tmp_path)
        if args[0] == "branch":
            return values["branch"]
        if args[0] == "remote":
            return values["url"]
        if args[0] == "for-each-ref":
            return values["tag"]
        if args[0] == "config":
            return values["mirror"]
        raise AssertionError(args)
    monkeypatch.setattr(release, "git", git)
    monkeypatch.setitem(sys.modules, "server_tools.release.promote_release",
                        SimpleNamespace(validate_published_source=lambda *a: {"published_commit": P}))
    monkeypatch.setitem(sys.modules, "server_tools.release.asset_verifier",
                        SimpleNamespace(verify_assets=lambda *a: {"app_version": "1.2.4", "source_commit": P, "assets": {}}))
    return tmp_path, values


@pytest.mark.parametrize("field,value", [
    ("branch", "other"), ("branch", ""), ("url", "https://github.com/other/filterest.git"),
    ("url", "https://github.com/kanilmari/filterest.git\nhttps://example.invalid/extra"),
    ("tag", "refs/tags/v1.2.4"), ("mirror", "true"),
])
def test_local_publication_identity_rejects_wrong_branch_urls_or_existing_tag(local_source, field, value):
    root, values = local_source
    values[field] = value
    with pytest.raises(release.PublicationError):
        release.inspect_local(root, P, "1.2.4", root / "assets")


def test_local_version_mismatch_cannot_relabel_assets(local_source):
    root, _ = local_source
    with pytest.raises(release.PublicationError, match="expect-version"):
        release.inspect_local(root, P, "1.2.5", root / "assets")


def test_cli_defaults_to_plan_and_forbids_abbreviated_target():
    args = ["--expect-version", "1.2.4", "--published-commit", P, "--assets-dir", "/tmp/assets"]
    assert not release.parse_args(args).apply
    with pytest.raises(SystemExit):
        release.parse_args(args + ["--tar", "/tmp/other"])


def test_main_reports_partial_state_without_claiming_success(monkeypatch, capsys):
    def fail(*args):
        raise release.PublicationError("upload lost", {"phase": "asset_upload_requested", "release_id": 7})
    monkeypatch.setattr(release, "publish", fail)
    result = release.main(["--expect-version", "1.2.4", "--published-commit", P, "--assets-dir", "/tmp/assets", "--apply"])
    report = json.loads(capsys.readouterr().err)
    assert result == 1 and not report["publication_verified"]
    assert report["remote_state"]["release_id"] == 7


def test_subprocess_boundary_disables_prompts_and_has_a_deadline(monkeypatch):
    captured = []
    def run(arguments, **kwargs):
        captured.append((arguments, kwargs))
        return subprocess.CompletedProcess(arguments, 0, "{}", "")
    monkeypatch.setattr(release.subprocess, "run", run)
    release.command(["gh", "api", "user"])
    kwargs = captured[0][1]
    assert kwargs["timeout"] == 300
    assert kwargs["env"]["GIT_TERMINAL_PROMPT"] == "0"
    assert kwargs["env"]["GH_PROMPT_DISABLED"] == "1"
    assert kwargs["env"]["GH_HOST"] == "github.com"


def test_upload_boundary_names_repository_and_never_clobbers(monkeypatch, tmp_path):
    calls = []
    def run(arguments, **kwargs):
        calls.append((arguments, kwargs))
        return subprocess.CompletedProcess(arguments, 0, "{}", "")
    monkeypatch.setattr(release, "command", run)
    release.GitHub().upload("v1.2.4", [tmp_path / "binary"])
    assert calls[0][0] == ["gh", "release", "upload", "v1.2.4", str(tmp_path / "binary"),
                            "--repo", "github.com/kanilmari/filterest"]
    assert "--clobber" not in calls[0][0]


def test_timeout_during_upload_reports_uncertain_partial_state(publication):
    args, github, _, _ = publication
    args.apply = True
    def timeout(*arguments):
        raise subprocess.TimeoutExpired(["gh", "release", "upload"], 300)
    github.upload = timeout
    with pytest.raises(release.PublicationError) as caught:
        release.publish(args, github)
    assert caught.value.remote_state["phase"] == "asset_upload_requested"
    assert caught.value.remote_state["release_id"] == 7
    assert github.draft["draft"] is True


def test_preflight_policy_failure_happens_before_git_push(publication):
    args, github, operations, _ = publication
    args.apply = True
    github.enabled[release.OWNER + "/private-archive"] = True
    with pytest.raises(policy.ActionsPolicyError):
        release.publish(args, github)
    assert not any("push" in operation for operation in operations)


@pytest.mark.parametrize("field,value", [("full_name", "someone/filterest"), ("private", True),
                                         ("archived", True), ("disabled", True), ("permissions", {"push": False})])
def test_repository_redirect_or_nonpublic_unwritable_target_blocks_mutation(publication, field, value):
    args, github, operations, _ = publication
    args.apply = True
    github.repository[field] = value
    with pytest.raises(release.PublicationError, match="approved public active"):
        release.publish(args, github)
    assert not any("push" in operation for operation in operations)
