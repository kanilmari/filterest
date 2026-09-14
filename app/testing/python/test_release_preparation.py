"""Candidate preparation preserves source and release contracts in miniature Git fixtures.

Real public ledger, identity, notice rendering and grouped file replacement run
without copying a product checkout, touching databases, or publishing anything.
"""
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
from server_tools.release import prepare_release as release


def write(root, relative, content):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content if isinstance(content, bytes) else content.encode())


def commit_fixture(root):
    release.git(root, "add", ".")
    release.git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Fixture source")
    return release.git(root, "rev-parse", "HEAD")


def snapshot(root):
    return {path.relative_to(root).as_posix(): path.read_bytes() for path in root.rglob("*")
            if path.is_file() and ".git" not in path.relative_to(root).parts}


@pytest.fixture
def candidate(tmp_path, monkeypatch):
    root = tmp_path / "miniature-source"
    root.mkdir()
    release.git(root, "init", "-q")
    record = {"schema_version": 1, "record_type": "build", "record_id": "build:filterest-1.2.3-stable-runtime-" + "a" * 12,
              "previous_record_sha256": None, "product": "filterest", "build_id": "filterest-1.2.3-stable-runtime-" + "a" * 12,
              "app_version": "1.2.3", "artifact_type": "runtime", "channel": "stable", "maturity": "published",
              "source": {"model": "public_first", "commit": "a" * 40},
              "database": {"min_version": "2.0.0", "target_version": "2.0.0"}, "created_at": "2026-09-01T00:00:00Z"}
    ledger = release.canonical_json_line(record)
    entry = release.validate_ledger_bytes(ledger)[0]
    source_relative = "app/server_tools/public_bootstrap/source/base.sql"
    schema_relative = "server_tools/public_bootstrap/schema.sql"
    seed_relative = "server_tools/public_bootstrap/seed_data.sql"
    schema_snapshot = "server_tools/versioning/schema_snapshots/db-2.0.0.sql"
    provenance = {"schema_version": 2, "reviewed_on": "2026-09-01", "components": {
        "Fixture asset": {"party": "third-party", "license": "MIT", "source": "https://example.invalid/fixture", "documents": ["fixture-LICENSE"]}}, "files": []}
    files = {"app/VERSION_APP": "1.2.3\n", "app/VERSION_DB": "2.0.0\n",
             release.LEDGER: ledger, release.IDENTITY: release.canonical_json_line(release.build_identity_from_entry(entry)),
             source_relative: "source bytes", "app/" + schema_relative: "schema bytes", "app/" + seed_relative: "seed bytes",
             "app/" + schema_snapshot: "schema bytes", "app/main.go": "fixture implementation\n",
             release.COMPATIBILITY: release.canonical_json_line({"app_version": "1.2.3", "min_db_version": "2.0.0", "target_db_version": "2.0.0",
                "status": "active", "schema_snapshot_path": schema_snapshot, "git_commit_sha": "a" * 40, "notes": "Fixture", "recorded_at": "2026-09-01T00:00:00Z"}),
             release.BOOTSTRAP: release.json_bytes({"artifact": "filterest-public-bootstrap", "format_version": 2, "app_version": "1.2.3", "db_version": "2.0.0", "generated_files": {
                 schema_relative: {"sha256": hashlib.sha256(b"schema bytes").hexdigest()}, seed_relative: {"sha256": hashlib.sha256(b"seed bytes").hexdigest()}},
                 "source_files": {"filterest/" + source_relative: {"sha256": hashlib.sha256(b"source bytes").hexdigest()}}}),
             "app/server_tools/licenses/asset_provenance.json": release.json_bytes(provenance),
             "app/server_tools/licenses/browser_bundle_provenance.json": "{}\n",
             "THIRD_PARTY_NOTICES.md": "Previous reviewed notices\n",
             "THIRD_PARTY_LICENSES/obsolete-license": "Previous retained document\n",
             release.RELEASE_NOTES: "Previous release notes\n"}
    for relative, content in files.items():
        write(root, relative, content)
    commit = commit_fixture(root)
    notes = tmp_path / "reviewed-notes.md"
    notes.write_text("# Fixture 1.2.4\n\nNo database changes.\n")
    args = SimpleNamespace(target=root, expect_current_version="1.2.3", version="1.2.4", bump=None,
        source_commit=commit, release_notes=notes, manifest_notes="Fixture candidate", created_at="2026-09-11T00:00:00Z", apply=False)
    monkeypatch.setattr(release.notices, "collect_go_modules", lambda target, **kwargs: ([], "fixture Go inventory"))
    monkeypatch.setattr(release.notices, "collect_npm_packages", lambda target: ([], "fixture npm inventory"))
    monkeypatch.setattr(release.notices, "collect_browser_bundle_dependencies", lambda target: ([], "fixture browser inventory"))
    monkeypatch.setattr(release.notices, "collect_assets", lambda target: [])
    return root, args


def test_plan_preserves_every_source_byte_and_renders_current_candidate(candidate):
    root, args = candidate
    before = snapshot(root)
    result = release.prepare(args)
    assert snapshot(root) == before
    assert result["mode"] == "plan" and result["source_clean"]
    assert result["maturity"] == "candidate" and not result["publication_ready"]
    assert "THIRD_PARTY_LICENSES/obsolete-license" in result["changed_paths"]
    assert "THIRD_PARTY_LICENSES/manifest.json" in result["sha256"]
    assert release.git(root, "status", "--porcelain") == ""


def test_apply_appends_ledger_demotes_compatibility_and_keeps_schema(candidate):
    root, args = candidate
    before = snapshot(root)
    args.apply = True
    result = release.prepare(args)
    after = snapshot(root)
    assert result["mode"] == "applied"
    entries = release.validate_append_only(after[release.LEDGER], before[release.LEDGER])
    assert len(entries) == 2
    identity = json.loads(after[release.IDENTITY])
    assert identity == release.build_identity_from_entry(entries[-1])
    assert identity["maturity"] == "candidate" and identity["source"]["commit"] == args.source_commit
    rows = [json.loads(line) for line in after[release.COMPATIBILITY].splitlines()]
    assert [(row["app_version"], row["status"]) for row in rows] == [("1.2.3", "historical"), ("1.2.4", "active")]
    for relative in ["app/VERSION_DB", "app/server_tools/public_bootstrap/schema.sql", "app/server_tools/public_bootstrap/seed_data.sql", "app/main.go"]:
        assert after[relative] == before[relative]
    assert "THIRD_PARTY_LICENSES/obsolete-license" not in after
    manifest = json.loads(after["THIRD_PARTY_LICENSES/manifest.json"])
    assert manifest["filterest_app_version"] == "1.2.4"
    assert hashlib.sha256(after["THIRD_PARTY_LICENSES/manifest.json"]).hexdigest() in after["THIRD_PARTY_NOTICES.md"].decode()


def test_dirty_plan_disclaims_readiness_but_apply_refuses(candidate):
    root, args = candidate
    write(root, "app/main.go", "unfinished work\n")
    before = snapshot(root)
    result = release.prepare(args)
    assert not result["source_clean"] and not result["ready_to_apply"]
    args.apply = True
    with pytest.raises(release.PreparationError, match="clean reviewed"):
        release.prepare(args)
    assert snapshot(root) == before


@pytest.mark.parametrize("attribute,value,message", [
    ("source_commit", "b" * 40, "does not match HEAD"),
    ("source_commit", "abcdef", "full lowercase"),
    ("expect_current_version", "1.2.2", "expect-current-version"),
    ("version", "1.2.6", "next patch"),
    ("created_at", "yesterday", "created_at"),
])
def test_invalid_release_identity_never_changes_source(candidate, attribute, value, message):
    root, args = candidate
    setattr(args, attribute, value)
    before = snapshot(root)
    with pytest.raises((release.PreparationError, release.ReleaseContractError), match=message):
        release.prepare(args)
    assert snapshot(root) == before


@pytest.mark.parametrize("relative,content,message", [
    (release.COMPATIBILITY, "not-json\n", "invalid JSON"),
    (release.LEDGER, "{}\n", "missing"),
    ("app/server_tools/public_bootstrap/source/base.sql", "changed", "hash mismatch"),
    ("app/server_tools/public_bootstrap/schema.sql", "changed", "hash mismatch"),
    ("app/server_tools/versioning/schema_snapshots/db-2.0.0.sql", "wrong snapshot", "snapshot disagrees"),
])
def test_corrupt_history_or_stale_bootstrap_fails_closed(candidate, relative, content, message):
    root, args = candidate
    write(root, relative, content)
    before = snapshot(root)
    with pytest.raises(ValueError, match=message):
        release.prepare(args)
    assert snapshot(root) == before


def test_duplicate_requested_version_is_rejected(candidate):
    root, args = candidate
    with (root / release.COMPATIBILITY).open("ab") as out:
        row = json.loads((root / release.COMPATIBILITY).read_text().splitlines()[0])
        row.update(app_version="1.2.4", status="historical")
        out.write(release.canonical_json_line(row))
    with pytest.raises(release.PreparationError, match="already contains"):
        release.prepare(args)


def test_symlink_output_preserves_external_file(candidate, tmp_path):
    root, args = candidate
    external = tmp_path / "operator-state"
    external.write_text("do not change")
    (root / release.RELEASE_NOTES).unlink()
    (root / release.RELEASE_NOTES).symlink_to(external)
    with pytest.raises(release.PreparationError, match="symlink"):
        release.prepare(args)
    assert external.read_text() == "do not change"


def test_inventory_failure_preserves_previous_license_bundle(candidate, monkeypatch):
    root, args = candidate
    before = snapshot(root)
    def fail(target, **kwargs):
        raise release.notices.InventoryCollectionError("missing reviewed dependency")
    monkeypatch.setattr(release.notices, "collect_go_modules", fail)
    with pytest.raises(release.notices.InventoryCollectionError):
        release.prepare(args)
    assert snapshot(root) == before


def test_partial_write_failure_rolls_back_all_replaced_bytes(candidate, monkeypatch):
    root, args = candidate
    before = snapshot(root)
    args.apply = True
    original = release.replace_bytes
    calls = 0
    def fail_once(path, content):
        nonlocal calls
        calls += 1
        if calls == 5:
            raise OSError("injected disk failure")
        original(path, content)
    monkeypatch.setattr(release, "replace_bytes", fail_once)
    with pytest.raises(OSError, match="disk failure"):
        release.prepare(args)
    assert calls > 5
    assert snapshot(root) == before
    assert release.git(root, "status", "--porcelain") == ""


def test_source_change_during_inventory_refuses_apply(candidate, monkeypatch):
    root, args = candidate
    args.apply = True
    before = snapshot(root)
    def change_source(target, **kwargs):
        write(root, "app/main.go", "another editor changed source\n")
        return [], "fixture inventory"
    monkeypatch.setattr(release.notices, "collect_go_modules", change_source)
    with pytest.raises(release.PreparationError, match="source changed"):
        release.prepare(args)
    assert (root / release.LEDGER).read_bytes() == before[release.LEDGER]
    assert (root / "THIRD_PARTY_NOTICES.md").read_bytes() == before["THIRD_PARTY_NOTICES.md"]


def test_git_inspection_failure_does_not_reach_inventory(candidate, monkeypatch):
    root, args = candidate
    def fail(*arguments):
        raise subprocess.CalledProcessError(128, "git")
    monkeypatch.setattr(release, "git", fail)
    with pytest.raises(subprocess.CalledProcessError):
        release.prepare(args)


def test_same_target_preparation_lock_refuses_concurrent_run(candidate):
    root, args = candidate
    with release.preparation_lock(root):
        with pytest.raises(release.PreparationError, match="already running"):
            release.prepare(args)


def test_apply_and_dry_run_are_mutually_exclusive(candidate):
    _, args = candidate
    with pytest.raises(SystemExit):
        release.parse_args(["--expect-current-version", "1.2.3", "--source-commit", args.source_commit,
            "--release-notes", str(args.release_notes), "--manifest-notes", "test", "--apply", "--dry-run"])


def test_readonly_go_collection_never_warms_or_rewrites_manifests(tmp_path, monkeypatch):
    source = tmp_path / "app"
    source.mkdir()
    (source / "go.mod").write_text("module fixture.invalid/example\n")
    events = []
    def warm_forbidden(target):
        pytest.fail("readonly inventory warmed the source module cache")
    def capture(command, **kwargs):
        events.append((command, kwargs))
        return SimpleNamespace(returncode=1, stdout="", stderr="missing fixture module")
    monkeypatch.setattr(release.notices, "warm_go_module_cache", warm_forbidden)
    monkeypatch.setattr(release.notices.subprocess, "run", capture)
    before = snapshot(source)
    with pytest.raises(release.notices.InventoryCollectionError, match="missing fixture module"):
        release.notices.collect_go_modules(source, readonly=True)
    assert snapshot(source) == before
    assert events[0][0][0:2] == ["go", "list"]
    assert events[0][1]["env"]["GOFLAGS"] == "-mod=readonly"
    assert events[0][1]["env"]["GOWORK"] == "off"


def test_option_abbreviations_cannot_override_adapter_source(candidate):
    _, args = candidate
    with pytest.raises(SystemExit):
        release.parse_args(["--expect-current-version", "1.2.3", "--source-commit", args.source_commit,
            "--release-notes", str(args.release_notes), "--manifest-notes", "test", "--tar=/other/source"])


@pytest.mark.parametrize("field,value,message", [
    ("min_db_version", "1.0.0", "minimum database"),
    ("notes", "", "non-empty string"),
    ("schema_snapshot_path", "server_tools/versioning/schema_snapshots/db-1.0.0.sql", "must match target_db_version"),
])
def test_current_compatibility_cannot_weaken_existing_contract(candidate, field, value, message):
    root, args = candidate
    path = root / release.COMPATIBILITY
    row = json.loads(path.read_text())
    row[field] = value
    path.write_bytes(release.canonical_json_line(row))
    with pytest.raises(release.PreparationError, match=message):
        release.prepare(args)


def test_duplicate_historical_versions_are_not_carried_forward(candidate):
    root, args = candidate
    path = root / release.COMPATIBILITY
    row = json.loads(path.read_text())
    row.update(app_version="1.2.2", status="historical")
    path.write_bytes(path.read_bytes() + release.canonical_json_line(row) * 2)
    with pytest.raises(release.PreparationError, match="duplicate app_version"):
        release.prepare(args)


@pytest.mark.parametrize("field,value", [("artifact", "other"), ("format_version", 1)])
def test_bootstrap_artifact_format_must_match(candidate, field, value):
    root, args = candidate
    path = root / release.BOOTSTRAP
    manifest = json.loads(path.read_bytes())
    manifest[field] = value
    path.write_bytes(release.json_bytes(manifest))
    with pytest.raises(release.PreparationError, match="artifact/format"):
        release.prepare(args)


def test_bootstrap_malformed_structure_has_clear_failure(candidate):
    root, args = candidate
    (root / release.BOOTSTRAP).write_text("[]\n")
    with pytest.raises(release.PreparationError, match="JSON object"):
        release.prepare(args)


def reviewed_db_transition(root, args, target="2.0.1"):
    """Commit new reviewed DB artifacts, keeping the published history unchanged."""
    args.db_transition_from = "2.0.0"
    write(root, "app/VERSION_DB", target + "\n")
    manifest = json.loads((root / release.BOOTSTRAP).read_bytes())
    manifest["db_version"] = target
    for name in ("schema.sql", "seed_data.sql"):
        relative = "server_tools/public_bootstrap/" + name
        content = ("reviewed " + target + " " + name).encode()
        write(root, "app/" + relative, content)
        manifest["generated_files"][relative]["sha256"] = hashlib.sha256(content).hexdigest()
    write(root, "app/server_tools/versioning/schema_snapshots/db-" + target + ".sql",
          (root / "app/server_tools/public_bootstrap/schema.sql").read_bytes())
    write(root, release.BOOTSTRAP, release.json_bytes(manifest))
    args.source_commit = commit_fixture(root)


def test_explicit_database_transition_preserves_published_history(candidate):
    from server_tools.scripts.validate_app_db_compatibility import validate_manifest
    root, args = candidate
    published_identity = (root / release.IDENTITY).read_bytes()
    published_ledger = (root / release.LEDGER).read_bytes()
    published_snapshot = (root / "app/server_tools/versioning/schema_snapshots/db-2.0.0.sql").read_bytes()
    reviewed_db_transition(root, args)
    before = snapshot(root)
    assert validate_manifest(root / "app") == 1  # S is deliberately not a candidate.
    result = release.prepare(args)
    assert result["source_clean"] and snapshot(root) == before
    assert (root / release.IDENTITY).read_bytes() == published_identity
    args.apply = True
    release.prepare(args)
    assert validate_manifest(root / "app") == 0
    assert (root / release.LEDGER).read_bytes().startswith(published_ledger)
    assert (root / "app/server_tools/versioning/schema_snapshots/db-2.0.0.sql").read_bytes() == published_snapshot
    identity = json.loads((root / release.IDENTITY).read_bytes())
    assert identity["database"] == {"min_version": "2.0.1", "target_version": "2.0.1"}
    rows = [json.loads(line) for line in (root / release.COMPATIBILITY).read_bytes().splitlines()]
    old = json.loads(before[release.COMPATIBILITY])
    assert rows[0] == dict(old, status="historical")
    assert rows[-1]["schema_snapshot_path"].endswith("/db-2.0.1.sql")
    for name in ("app/VERSION_DB", "app/server_tools/public_bootstrap/schema.sql",
                 "app/server_tools/public_bootstrap/seed_data.sql",
                 "app/server_tools/versioning/schema_snapshots/db-2.0.1.sql"):
        assert (root / name).read_bytes() == before[name]


@pytest.mark.parametrize("change,message", [
    ("no_flag", "requires explicit --db-transition-from"),
    ("wrong_from", "does not match published"),
    ("downgrade", "requires a newer target"),
    ("snapshot", "snapshot disagrees"),
    ("untracked_snapshot", "git-tracked artifact"),
    ("stale_bootstrap", "hash mismatch"),
    ("history_min", "minimum database"),
])
def test_database_transition_rejects_unreviewed_or_inconsistent_inputs(candidate, change, message):
    root, args = candidate
    reviewed_db_transition(root, args, "1.9.9" if change == "downgrade" else "2.0.1")
    if change == "no_flag":
        args.db_transition_from = None
    elif change == "wrong_from":
        args.db_transition_from = "1.0.0"
    elif change == "snapshot":
        write(root, "app/server_tools/versioning/schema_snapshots/db-2.0.1.sql", "wrong")
    elif change == "untracked_snapshot":
        release.git(root, "rm", "--cached", "app/server_tools/versioning/schema_snapshots/db-2.0.1.sql")
    elif change == "stale_bootstrap":
        write(root, "app/server_tools/public_bootstrap/schema.sql", "stale")
    elif change == "history_min":
        row = json.loads((root / release.COMPATIBILITY).read_bytes())
        row["min_db_version"] = "1.0.0"
        write(root, release.COMPATIBILITY, release.canonical_json_line(row))
    before = snapshot(root)
    with pytest.raises((ValueError, OSError), match=message):
        release.prepare(args)
    assert snapshot(root) == before


def test_same_database_cannot_claim_a_transition(candidate):
    root, args = candidate
    args.db_transition_from = "2.0.0"
    before = snapshot(root)
    with pytest.raises(release.PreparationError, match="requires a newer target"):
        release.prepare(args)
    assert snapshot(root) == before


def test_database_transition_cli_uses_explicit_full_option(candidate):
    _, args = candidate
    parsed = release.parse_args(["--expect-current-version", "1.2.3", "--source-commit", args.source_commit,
        "--release-notes", str(args.release_notes), "--manifest-notes", "reviewed", "--db-transition-from", "2.0.0"])
    assert parsed.db_transition_from == "2.0.0"
