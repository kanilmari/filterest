# test_release_publication.py
# Exercises publication ordering, owner authorization and exact remote bundle readback.
# Connects real signed/unsigned payload checks to fake GitHub mutation boundaries.
# Proves missing approval, failed trust or inventory cannot mutate remote state.
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
from server_tools.release import bundle_contract, bundle_verifier
from release_bundle_fixture import (bundle_go_tools, local_contract_bridge, candidate, release_candidate,
    unsigned_bundle, signed_bundle)

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
            assets = [{"name": name, "id": index, "state": "uploaded", "size": len(self.content[name]),
                       "digest": "sha256:" + hashlib.sha256(self.content[name]).hexdigest()}
                      for index, name in enumerate(sorted(self.content), 1)]
            if self.extra_asset:
                assets.append({"name": "unexpected-secret", "id": 99, "state": "uploaded", "size": 7})
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
                                 "sizes": {name: len(data) for name, data in content.items()},
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
    monkeypatch.setattr(bundle_verifier, "verify_signed_bundle",
                       lambda *a, **kw: {"app_version": "1.2.4", "source_commit": P, "assets": {}})
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
    args = ["--expect-version", "1.2.4", "--published-commit", P, "--assets-dir", "/tmp/assets",
            "--trust-policy", "/tmp/operator-policy", "--minimum-trust-policy-revision", "1"]
    assert not release.parse_args(args).apply
    with pytest.raises(SystemExit):
        release.parse_args(args + ["--tar", "/tmp/other"])


def test_main_reports_partial_state_without_claiming_success(monkeypatch, capsys):
    def fail(*args):
        raise release.PublicationError("upload lost", {"phase": "asset_upload_requested", "release_id": 7})
    monkeypatch.setattr(release, "publish", fail)
    result = release.main(["--expect-version", "1.2.4", "--published-commit", P, "--assets-dir", "/tmp/assets", "--apply",
                           "--trust-policy", "/tmp/operator-policy", "--minimum-trust-policy-revision", "1"])
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


def fake_publication_transport(root, directory, commit, monkeypatch):
    """Keep real local history/payload checks; fake only remote transport."""
    github = FakeGitHub({path.name: path.read_bytes() for path in directory.iterdir()})
    remote = {"main": json.loads((root / "app/BUILD_IDENTITY.json").read_bytes())["source"]["commit"], "tag": None}
    operations = []
    def git(target, *arguments):
        operations.append(arguments)
        if arguments[0] == "rev-parse":
            return str(root)
        if arguments[0] == "branch":
            return "main"
        if arguments[0] == "remote":
            return "https://github.com/kanilmari/filterest.git"
        if arguments[0] == "config":
            return "false"
        if arguments[0] in {"for-each-ref", "merge-base"}:
            return ""
        if arguments[0] == "ls-remote":
            refs = remote["main"] + "\trefs/heads/main\n"
            return refs + (remote["tag"] + "\trefs/tags/v1.2.4\n" if remote["tag"] else "")
        if "push" in arguments:
            remote.update(main=commit, tag=commit)
            return ""
        raise AssertionError(arguments)
    monkeypatch.setattr(release, "git", git)
    args = SimpleNamespace(target=root, assets_dir=directory, published_commit=commit,
                           expect_version="1.2.4", apply=True)
    return args, github, operations


@pytest.fixture
def signed_publication(signed_bundle, monkeypatch):
    root, directory, commit, trust, _ = signed_bundle
    args, github, operations = fake_publication_transport(root, directory, commit, monkeypatch)
    args.trust_policy, args.minimum_trust_policy_revision = trust, 1
    return args, github, operations


@pytest.fixture
def unsigned_publication(unsigned_bundle, tmp_path, monkeypatch):
    root, directory, commit, _, _, _ = unsigned_bundle
    args, github, operations = fake_publication_transport(root, directory, commit, monkeypatch)
    approval = {"schema_version": 1, "approval_type": "owner_chat_approval", "owner": release.OWNER,
                "approved_at": "2026-09-11T02:00:00Z", "wording": "ok, publish this reviewed release",
                "published_commit": commit,
                "manifest_sha256": hashlib.sha256((directory / bundle_contract.MANIFEST_NAME).read_bytes()).hexdigest()}
    args.owner_approval = tmp_path / "owner-approval.json"
    args.owner_approval.write_text(json.dumps(approval))
    return args, github, operations


def test_unsigned_publication_records_chat_approval_and_reads_back_nineteen_files(unsigned_publication):
    args, github, operations = unsigned_publication
    approval = json.loads(args.owner_approval.read_bytes())
    ledger = (args.target / "app/server_tools/versioning/release_ledger.v1.jsonl").read_bytes()
    result = release.publish(args, github)
    assert result["publication_verified"] and result["signing_status"] == "unsigned"
    assert result["owner_approval"] == approval
    assert "signature_verification" not in result["verified_assets"]
    assert len(result["readback"]["asset_sha256"]) == 19
    assert bundle_contract.SIGNATURES_NAME not in result["readback"]["asset_sha256"]
    assert len([event for event in github.events if event[0] == "DOWNLOAD"]) == 38
    assert any("push" in operation for operation in operations)
    assert (args.target / "app/server_tools/versioning/release_ledger.v1.jsonl").read_bytes() == ledger


@pytest.mark.parametrize("failure", ["absent", "missing_file", "blank", "wrong_owner", "wrong_commit", "wrong_manifest",
                                    "bad_time", "early", "future", "duplicate", "inside_bundle", "symlink"])
def test_unsigned_approval_refusals_precede_remote_reads(unsigned_publication, failure, tmp_path):
    args, github, operations = unsigned_publication
    path = args.owner_approval
    approval = json.loads(path.read_bytes())
    changes = {"blank": ("wording", "  "), "wrong_owner": ("owner", "other"),
               "wrong_commit": ("published_commit", "f" * 40), "wrong_manifest": ("manifest_sha256", "0" * 64),
               "bad_time": ("approved_at", "today"), "early": ("approved_at", "2000-01-01T00:00:00Z"),
               "future": ("approved_at", "2999-01-01T00:00:00Z")}
    if failure in changes:
        key, value = changes[failure]
        approval[key] = value
        path.write_text(json.dumps(approval))
    elif failure == "absent":
        args.owner_approval = None
    elif failure == "missing_file":
        path.unlink()
    elif failure == "duplicate":
        path.write_text(json.dumps(approval)[:-1] + ', "wording": "different"}')
    elif failure == "inside_bundle":
        args.owner_approval = args.assets_dir / path.name
        args.owner_approval.write_bytes(path.read_bytes())
    else:
        args.owner_approval = tmp_path / "linked-approval.json"
        args.owner_approval.symlink_to(path)
    with pytest.raises((ValueError, OSError)):
        release.publish(args, github)
    assert not any("push" in operation for operation in operations)
    assert github.events == []


@pytest.mark.parametrize("failure", ["extra", "source", "image", "checksum", "manifest", "dirty", "wrong_head"])
def test_unsigned_publication_retains_payload_and_clean_source_guards(unsigned_publication, failure):
    args, github, operations = unsigned_publication
    if failure == "extra":
        (args.assets_dir / "unexpected").write_bytes(b"extra")
    elif failure in {"source", "image", "checksum", "manifest"}:
        names = {"source": "filterest-1.2.4-source.tar.gz", "image": "filterest-1.2.4-oci-linux-amd64.tar",
                 "checksum": "filterest-linux-amd64.sha256", "manifest": bundle_contract.MANIFEST_NAME}
        (args.assets_dir / names[failure]).write_bytes(b"changed")
    elif failure == "dirty":
        (args.target / "app/VERSION_APP").write_text("1.2.5\n")
    else:
        args.published_commit = "f" * 40
    with pytest.raises((ValueError, OSError, subprocess.CalledProcessError)):
        release.publish(args, github)
    assert not any("push" in operation for operation in operations)
    assert github.events == []


def test_unsigned_changed_approval_during_upload_keeps_draft_private(unsigned_publication):
    args, github, _ = unsigned_publication
    upload = github.upload
    def change_approval(*arguments):
        upload(*arguments)
        approval = json.loads(args.owner_approval.read_bytes())
        approval["wording"] += " changed"
        args.owner_approval.write_text(json.dumps(approval))
    github.upload = change_approval
    with pytest.raises(release.PublicationError, match="inputs changed during upload"):
        release.publish(args, github)
    assert github.draft["draft"] is True
    assert not any(event[0] == "PATCH" for event in github.events)


def test_unsigned_cli_accepts_approval_without_trust():
    args = release.parse_args(["--expect-version", "1.2.4", "--published-commit", P,
                               "--assets-dir", "/tmp/assets", "--owner-approval", "/tmp/approval.json"])
    assert args.owner_approval == Path("/tmp/approval.json")
    assert args.trust_policy is None and args.minimum_trust_policy_revision is None


def test_unsigned_plan_records_approval_without_mutation(unsigned_publication):
    args, github, operations = unsigned_publication
    args.apply = False
    result = release.publish(args, github)
    assert not result["publication_verified"] and result["signing_status"] == "unsigned"
    assert result["owner_approval"] == json.loads(args.owner_approval.read_bytes())
    assert not any("push" in operation for operation in operations)
    assert all(event[0] in {"GET", "PAGES"} for event in github.events)


@pytest.mark.parametrize("failure", ["signature_entry", "explicit_trust"])
def test_chat_approval_cannot_bypass_selected_signed_verification(unsigned_publication, failure):
    args, github, operations = unsigned_publication
    if failure == "signature_entry":
        (args.assets_dir / bundle_contract.SIGNATURES_NAME).write_bytes(b"invalid signature")
    else:
        args.minimum_trust_policy_revision = 1
    with pytest.raises(ValueError, match="trust-policy"):
        release.publish(args, github)
    assert not any("push" in operation for operation in operations)
    assert github.events == []


@pytest.mark.parametrize("failure", ["extra_asset", "corrupt_asset"])
def test_unsigned_remote_inventory_and_bytes_keep_bad_draft_private(unsigned_publication, failure):
    args, github, _ = unsigned_publication
    setattr(github, failure, True)
    with pytest.raises(release.PublicationError, match="asset"):
        release.publish(args, github)
    assert github.draft["draft"] is True
    assert not any(event[0] == "PATCH" for event in github.events)


def test_signed_bundle_publication_end_to_end_reads_back_all_twenty_files(signed_publication):
    args, github, operations = signed_publication
    result = release.publish(args, github)
    assert result["publication_verified"]
    assert len(result["readback"]["asset_sha256"]) == 20
    assert len([event for event in github.events if event[0] == "DOWNLOAD"]) == 40
    assert result["verified_assets"]["signature_verification"]["trust_policy_revision"] == 1
    assert any("push" in operation for operation in operations)
    assert "passphrase" not in json.dumps(result)


@pytest.mark.parametrize("failure", ["absent_trust", "revoked", "floor", "missing_signature", "bad_signature",
                                      "tampered_manifest", "extra_payload", "missing_source", "wrong_image"])
def test_signed_preflight_fails_before_remote_reads_or_mutation(signed_publication, failure):
    args, github, operations = signed_publication
    if failure == "absent_trust":
        args.trust_policy = None
    elif failure == "revoked":
        document = json.loads(args.trust_policy.read_bytes())
        document["compositions"][0]["keys"][0]["revoked"] = True
        args.trust_policy.write_text(json.dumps(document))
    elif failure == "floor":
        args.minimum_trust_policy_revision = 2
    elif failure == "missing_signature":
        (args.assets_dir / bundle_contract.SIGNATURES_NAME).unlink()
    elif failure == "bad_signature":
        document = json.loads((args.assets_dir / bundle_contract.SIGNATURES_NAME).read_bytes())
        document["signatures"][0]["signature"] = "A" * 86 + "=="
        (args.assets_dir / bundle_contract.SIGNATURES_NAME).write_text(json.dumps(document))
    elif failure == "tampered_manifest":
        path = args.assets_dir / bundle_contract.MANIFEST_NAME
        path.write_bytes(path.read_bytes().replace(b'"publisher":"filterest"', b'"publisher":"substitute"'))
    elif failure == "extra_payload":
        (args.assets_dir / "unexpected-extra").write_bytes(b"fixture")
    elif failure == "missing_source":
        (args.assets_dir / "filterest-1.2.4-source.tar.gz").unlink()
    else:
        (args.assets_dir / "filterest-1.2.4-oci-linux-amd64.tar").write_bytes(b"substitute image")
    with pytest.raises((ValueError, OSError)):
        release.publish(args, github)
    assert not any("push" in operation for operation in operations)
    assert github.events == []


@pytest.mark.parametrize("location", ["bundle", "source", "symlink", "permissions"])
def test_bundle_cannot_provision_its_own_trust_or_use_unprotected_policy(signed_publication, tmp_path, location):
    args, github, operations = signed_publication
    data = args.trust_policy.read_bytes()
    if location in {"bundle", "source"}:
        path = (args.assets_dir if location == "bundle" else args.target) / "trust-policy.json"
        path.write_bytes(data)
        args.trust_policy = path
    elif location == "symlink":
        path = tmp_path / "linked-policy"
        path.symlink_to(args.trust_policy)
        args.trust_policy = path
    else:
        args.trust_policy.chmod(0o666)
    with pytest.raises(ValueError):
        release.publish(args, github)
    assert not any("push" in operation for operation in operations)
    assert github.events == []


@pytest.mark.parametrize("change", ["uploaded_size", "uploaded_digest", "downloaded_size"])
def test_remote_size_and_digest_failures_keep_verified_release_private(publication, change):
    args, github, _, _ = publication
    args.apply = True
    original = github.pages
    def pages(endpoint):
        rows = original(endpoint)
        if endpoint.endswith("/assets?per_page=100"):
            if change == "uploaded_size":
                rows[0]["size"] += 1
            elif change == "uploaded_digest":
                rows[0]["digest"] = "sha256:" + "f" * 64
        return rows
    github.pages = pages
    if change == "downloaded_size":
        github.download = lambda asset_id: b"truncated"
    with pytest.raises(release.PublicationError, match="asset"):
        release.publish(args, github)
    assert github.draft["draft"] is True
    assert not any(event[0] == "PATCH" for event in github.events)
