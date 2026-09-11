"""Verify promotion and complete asset boundaries using miniature Git histories.

Fixture binaries expose deterministic tool output; no real product is cloned,
built, published, deployed, or promoted while testing chronology and failures.
"""
import io
import json
from pathlib import Path
import tarfile
from types import SimpleNamespace

import pytest

from test_release_preparation import candidate, commit_fixture, snapshot, write
from server_tools.release import asset_verifier as assets
from server_tools.release import prepare_release as preparation
from server_tools.release import promote_release as promotion
from server_tools.release.verify_binary_manifest import BinaryManifestError


def create_assets(root, output):
    output.mkdir(exist_ok=True)
    version = (root / "app/VERSION_APP").read_text().strip()
    for architecture in ("amd64", "arm64"):
        write(output, "filterest-linux-" + architecture, "fixture binary " + architecture)
    for name, relative in {"LICENSE": "LICENSE", "NOTICE": "NOTICE", "THIRD_PARTY_NOTICES.md": "THIRD_PARTY_NOTICES.md", "LICENSE-GPL-3.0": "app/server_tools/licenses/GPL-3.0.txt"}.items():
        write(output, f"filterest-{version}-{name}", (root / relative).read_bytes())
    with tarfile.open(output / f"filterest-{version}-THIRD_PARTY_LICENSES.tar.gz", "w:gz") as bundle:
        bundle.add(root / "THIRD_PARTY_LICENSES", arcname="THIRD_PARTY_LICENSES")
    originals, _ = assets.asset_names(version)
    for name in originals:
        refresh_checksum(output, name)


def refresh_checksum(output, name):
    write(output, name + ".sha256", assets.sha256(output / name) + "  " + name + "\n")


@pytest.fixture
def release_candidate(candidate, tmp_path, monkeypatch):
    root, prepare_args = candidate
    for relative in ("LICENSE", "NOTICE", "app/server_tools/licenses/GPL-3.0.txt"):
        write(root, relative, "Fixture source legal document " + relative + "\n")
    dependency_license = tmp_path / "dependency-LICENSE"
    dependency_license.write_text("Fixture dependency attribution\n")
    dependencies = [preparation.notices.Dependency(ecosystem, name, version, "MIT", None,
        (dependency_license,), "fixture compiled dependency", ("filterest",)) for ecosystem, name, version in [
        ("go", "example.invalid/module", "v1.0.0"), ("go-toolchain", "Go", "go1.26.5")]]
    monkeypatch.setattr(preparation.notices, "collect_go_modules", lambda target, **kwargs: (dependencies, "fixture Go inventory"))
    source_commit = commit_fixture(root)
    prepare_args.source_commit = source_commit
    prepare_args.apply = True
    preparation.prepare(prepare_args)
    candidate_commit = commit_fixture(root)
    output = tmp_path / "candidate-assets"
    create_assets(root, output)
    state = {"vcs": candidate_commit, "modified": "false", "glibc": "2.34", "library": "libc.so.6", "module": "v1.0.0", "amd64_isa": "v1", "arm64_isa": "v8.0"}
    def tool_output(*arguments):
        binary = Path(arguments[-1]).name
        architecture = "arm64" if binary.endswith("arm64") else "amd64"
        if arguments[:3] == ("go", "version", "-m"):
            settings = {"CGO_ENABLED": "1", "GOARCH": architecture, "GOOS": "linux", "-tags": "netgo,osusergo",
                        "vcs": "git", "vcs.revision": state["vcs"], "vcs.modified": state["modified"]}
            settings["GOAMD64" if architecture == "amd64" else "GOARM64"] = state[architecture + "_isa"]
            return f"{binary}: go1.26.5\n\tdep\texample.invalid/module\t{state['module']}\th1:fixture\n" + "".join(f"\tbuild\t{key}={value}\n" for key, value in settings.items())
        if arguments[:2] == ("readelf", "-h"):
            machine = "AArch64" if architecture == "arm64" else "Advanced Micro Devices X86-64"
            return f"  Class:                             ELF64\n  Machine:                           {machine}\n"
        if arguments[:2] == ("readelf", "-d"):
            return f"  Shared library: [{state['library']}]\n"
        if arguments[:2] == ("readelf", "--version-info"):
            return "Name: GLIBC_" + state["glibc"] + "\n"
        pytest.fail(f"unexpected tool call: {arguments}")
    monkeypatch.setattr(assets, "command", tool_output)
    args = SimpleNamespace(target=root, expect_version="1.2.4", candidate_commit=candidate_commit,
        reviewed_source_commit=source_commit, assets_dir=output, created_at="2026-09-11T01:00:00Z", apply=False)
    return root, args, state


def test_candidate_plan_verifies_assets_without_changing_any_source(release_candidate):
    root, args, _ = release_candidate
    before = snapshot(root)
    result = promotion.promote(args)
    assert snapshot(root) == before
    assert result["mode"] == "plan" and result["maturity"] == "published"
    assert not result["remote_published"] and not result["publication_ready"]
    assert result["final_rebuild_required"]
    assert len(result["candidate_assets"]["assets"]) == 14
    assert set(result["changed_paths"]) == promotion.PROMOTION_PATHS


def test_apply_preserves_candidate_history_and_requires_final_rebuild(release_candidate):
    root, args, state = release_candidate
    before = snapshot(root)
    args.apply = True
    promotion.promote(args)
    after = snapshot(root)
    assert {path for path in after if before.get(path) != after[path]} == promotion.PROMOTION_PATHS
    entries = preparation.validate_append_only(after[preparation.LEDGER], before[preparation.LEDGER])
    assert len(entries) == 3
    identity = json.loads(after[preparation.IDENTITY])
    assert identity["maturity"] == "published" and identity["source"]["commit"] == args.candidate_commit
    final_commit = commit_fixture(root)
    history = promotion.validate_published_source(root, final_commit)
    assert history["candidate_commit"] == args.candidate_commit
    assert history["reviewed_source_commit"] == args.reviewed_source_commit
    with pytest.raises(assets.AssetVerificationError, match="VCS identity"):
        assets.verify_assets(root, args.assets_dir, final_commit)
    state["vcs"] = final_commit
    assert assets.verify_assets(root, args.assets_dir, final_commit)["source_commit"] == final_commit
    args.candidate_commit = final_commit
    with pytest.raises(promotion.PromotionError, match="current candidate"):
        promotion.promote(args)


def test_promotion_write_failure_rolls_back_two_files(release_candidate, monkeypatch):
    root, args, _ = release_candidate
    before = snapshot(root)
    args.apply = True
    original = preparation.replace_bytes
    calls = 0
    def fail_once(path, content):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("injected promotion failure")
        original(path, content)
    monkeypatch.setattr(preparation, "replace_bytes", fail_once)
    with pytest.raises(OSError, match="promotion failure"):
        promotion.promote(args)
    assert snapshot(root) == before
    assert preparation.git(root, "status", "--porcelain") == ""


def test_plan_rejects_uncommitted_candidate_source(release_candidate):
    root, args, _ = release_candidate
    write(root, "app/main.go", "unfinished source\n")
    with pytest.raises(promotion.PromotionError, match="clean reviewed"):
        promotion.promote(args)


def test_candidate_cannot_smuggle_frontend_or_backend_changes(release_candidate):
    root, args, _ = release_candidate
    write(root, "app/frontend/dist/unreviewed.js", "unreviewed generated source")
    args.candidate_commit = commit_fixture(root)
    with pytest.raises(promotion.PromotionError, match="outside preparation outputs"):
        promotion.promote(args)


def test_wrong_source_commit_and_old_timestamp_fail_closed(release_candidate):
    root, args, _ = release_candidate
    args.reviewed_source_commit = args.candidate_commit
    with pytest.raises(promotion.PromotionError, match="after reviewed source"):
        promotion.promote(args)
    candidate = promotion.read_identity(root, args.candidate_commit)[0]
    args.reviewed_source_commit = candidate["source"]["commit"]
    args.created_at = "2025-01-01T00:00:00Z"
    with pytest.raises(promotion.PromotionError, match="precedes candidate"):
        promotion.promote(args)


@pytest.mark.parametrize("key,value,message", [
    ("vcs", "a" * 40, "VCS identity"), ("modified", "true", "VCS identity"),
    ("glibc", "2.35", "GLIBC_2.34"), ("library", "libcrypto.so.3", "dynamic libraries"),
    ("module", "v9.9.9", "module set"),
    ("amd64_isa", "v3", "GOAMD64"), ("arm64_isa", "v9.0", "GOARM64"),
])
def test_binary_identity_dependency_and_abi_boundaries(release_candidate, key, value, message):
    root, args, state = release_candidate
    state[key] = value
    with pytest.raises((assets.AssetVerificationError, BinaryManifestError), match=message):
        assets.verify_assets(root, args.assets_dir, args.candidate_commit)


@pytest.mark.parametrize("change", ["extra", "missing", "symlink"])
def test_assets_require_exact_regular_fourteen_file_set(release_candidate, tmp_path, change):
    root, args, _ = release_candidate
    binary = args.assets_dir / "filterest-linux-amd64"
    if change == "extra":
        write(args.assets_dir, "unexpected-secret.txt", "fixture")
    elif change == "missing":
        binary.unlink()
    else:
        outside = tmp_path / "outside-binary"
        binary.rename(outside)
        binary.symlink_to(outside)
    with pytest.raises(assets.AssetVerificationError, match="exactly fourteen"):
        assets.verify_assets(root, args.assets_dir, args.candidate_commit)


def test_checksums_and_distributed_notice_bytes_are_bound(release_candidate):
    root, args, _ = release_candidate
    name = "filterest-1.2.4-NOTICE"
    write(args.assets_dir, name, "wrong notice\n")
    with pytest.raises(assets.AssetVerificationError, match="checksum sidecar"):
        assets.verify_assets(root, args.assets_dir, args.candidate_commit)
    refresh_checksum(args.assets_dir, name)
    with pytest.raises(assets.AssetVerificationError, match="notice differs"):
        assets.verify_assets(root, args.assets_dir, args.candidate_commit)


@pytest.mark.parametrize("member_name,kind", [("../escape", "file"), ("THIRD_PARTY_LICENSES/extra", "file"), ("THIRD_PARTY_LICENSES/link", "symlink")])
def test_archive_never_extracts_unexpected_members(release_candidate, member_name, kind):
    root, args, _ = release_candidate
    archive_name = "filterest-1.2.4-THIRD_PARTY_LICENSES.tar.gz"
    with tarfile.open(args.assets_dir / archive_name, "w:gz") as bundle:
        bundle.add(root / "THIRD_PARTY_LICENSES", arcname="THIRD_PARTY_LICENSES")
        member = tarfile.TarInfo(member_name)
        if kind == "symlink":
            member.type = tarfile.SYMTYPE
            member.linkname = "/operator/state"
            bundle.addfile(member)
        else:
            member.size = 7
            bundle.addfile(member, io.BytesIO(b"fixture"))
    refresh_checksum(args.assets_dir, archive_name)
    with pytest.raises(assets.AssetVerificationError, match="archive"):
        assets.verify_assets(root, args.assets_dir, args.candidate_commit)


def test_final_source_rejects_nonpromotion_changes(release_candidate):
    root, args, _ = release_candidate
    args.apply = True
    promotion.promote(args)
    write(root, "app/main.go", "changed after candidate verification\n")
    final_commit = commit_fixture(root)
    with pytest.raises(promotion.PromotionError, match="only the promotion"):
        promotion.validate_published_source(root, final_commit)


def test_legacy_published_source_is_not_candidate_promotion(release_candidate):
    root, args, _ = release_candidate
    args.expect_version = "1.2.3"
    with pytest.raises(promotion.PromotionError, match="current candidate"):
        promotion.inspect_candidate(root, args.candidate_commit, args.reviewed_source_commit, args.expect_version)


def test_promote_options_require_full_names(release_candidate):
    _, args, _ = release_candidate
    with pytest.raises(SystemExit):
        promotion.parse_args(["--expect-version", "1.2.4", "--candidate-commit", args.candidate_commit,
            "--reviewed-source-commit", args.reviewed_source_commit, "--assets-dir", str(args.assets_dir), "--tar=/other"])


@pytest.mark.parametrize("row_index,field,value,message", [
    (0, "git_commit_sha", "f" * 40, "previous compatibility history"),
    (0, "notes", "rewritten historical explanation", "previous compatibility history"),
    (1, "git_commit_sha", "f" * 40, "does not match its reviewed source"),
    (1, "recorded_at", "2026-09-11T00:30:00Z", "does not match its reviewed source"),
    (1, "min_db_version", "1.0.0", "does not match its reviewed source"),
])
def test_candidate_cannot_rewrite_compatibility_history(release_candidate, row_index, field, value, message):
    root, args, state = release_candidate
    path = root / preparation.COMPATIBILITY
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    rows[row_index][field] = value
    path.write_bytes(b"".join(preparation.canonical_json_line(row) for row in rows))
    args.candidate_commit = commit_fixture(root)
    state["vcs"] = args.candidate_commit
    with pytest.raises(promotion.PromotionError, match=message):
        promotion.promote(args)
