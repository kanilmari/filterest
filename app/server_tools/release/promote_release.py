#!/usr/bin/env python3
"""Promote one verified candidate's metadata without publishing or deploying.

Reviewed source S becomes candidate metadata commit C. After its exact assets
pass, promotion appends a published record whose source is C. Final commit P
must be rebuilt before publication; the candidate binaries remain evidence only.
"""
from __future__ import annotations

import argparse
from contextlib import redirect_stdout
import datetime as dt
import hashlib
import io
import json
import re
from pathlib import Path
import subprocess
import sys

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))
from server_tools.release import prepare_release as preparation
from server_tools.release.asset_verifier import verify_assets
from server_tools.release.verify_binary_manifest import BinaryManifestError
from server_tools.scripts.validate_app_db_compatibility import validate_manifest
from server_tools.versioning.release_contract_v1 import (
    build_identity_from_entry, canonical_json_line, validate_append_only,
    validate_build_identity, validate_ledger_bytes,
)

PROMOTION_PATHS = {preparation.LEDGER, preparation.IDENTITY}
PREPARATION_PATHS = PROMOTION_PATHS | {
    "app/VERSION_APP", preparation.COMPATIBILITY, preparation.BOOTSTRAP,
    preparation.RELEASE_NOTES, "THIRD_PARTY_NOTICES.md",
}


class PromotionError(ValueError):
    """Candidate history or evidence is not eligible for promotion."""


def show(root, commit, relative):
    return subprocess.run(["git", "-C", str(root), "show", f"{commit}:{relative}"],
                          check=True, capture_output=True).stdout


def changed_paths(root, before, after):
    result = subprocess.run(["git", "-C", str(root), "diff", "--name-only", "-z", before, after, "--"],
                            check=True, capture_output=True)
    return {path.decode() for path in result.stdout.split(b"\0") if path}


def require_commit(root, commit):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise PromotionError("release history requires full lowercase Git commits")
    if preparation.git(root, "rev-parse", commit + "^{commit}") != commit:
        raise PromotionError("release commit does not identify an exact Git commit")


def read_identity(root, commit):
    ledger = show(root, commit, preparation.LEDGER)
    entries = validate_ledger_bytes(ledger)
    identity = validate_build_identity(json.loads(show(root, commit, preparation.IDENTITY)))
    if not entries or identity != build_identity_from_entry(entries[-1]):
        raise PromotionError("build identity must describe the latest immutable ledger record")
    version = show(root, commit, "app/VERSION_APP").decode().strip()
    database = show(root, commit, "app/VERSION_DB").decode().strip()
    if identity["app_version"] != version or identity["database"]["target_version"] != database:
        raise PromotionError("build identity versions disagree with source markers")
    if identity["artifact_type"] != "runtime" or identity["channel"] != "stable" or identity["source"]["model"] != "public_first":
        raise PromotionError("promotion supports public-first stable/runtime identities only")
    return identity, ledger


def validate_candidate_compatibility(root, source_commit, candidate_commit, source_identity, candidate):
    """Preserve previous compatibility records while appending the candidate pair."""
    def rows_at(commit):
        text = show(root, commit, preparation.COMPATIBILITY).decode()
        rows = [json.loads(line) for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")]
        if not all(isinstance(row, dict) for row in rows):
            raise PromotionError("compatibility history must contain JSON objects")
        return rows
    previous = rows_at(source_commit)
    current = rows_at(candidate_commit)
    active = [row for row in previous if row.get("status") == "active"]
    if len(active) != 1 or active[0].get("app_version") != source_identity["app_version"]:
        raise PromotionError("reviewed source compatibility lacks its current active row")
    baseline = active[0]
    if (baseline.get("min_db_version"), baseline.get("target_db_version")) != (
            source_identity["database"]["min_version"], source_identity["database"]["target_version"]):
        raise PromotionError("reviewed source compatibility disagrees with its identity")
    preserved = [dict(row, status="historical") if row.get("status") == "active" else row for row in previous]
    if len(current) != len(previous) + 1 or current[:-1] != preserved:
        raise PromotionError("candidate rewrote previous compatibility history")
    appended = current[-1]
    expected = {"app_version": candidate["app_version"], "min_db_version": candidate["database"]["min_version"],
                "target_db_version": candidate["database"]["target_version"],
                "schema_snapshot_path": baseline.get("schema_snapshot_path"),
                "git_commit_sha": source_commit, "status": "active", "notes": appended.get("notes"),
                "recorded_at": candidate["created_at"]}
    if appended != expected or not isinstance(appended.get("notes"), str) or not appended["notes"].strip():
        raise PromotionError("candidate compatibility row does not match its reviewed source and identity")


def inspect_candidate(root, candidate_commit, reviewed_source_commit, expected_version):
    """Validate S→C from immutable Git data without checking out another tree."""
    for commit in (candidate_commit, reviewed_source_commit):
        require_commit(root, commit)
    if candidate_commit == reviewed_source_commit:
        raise PromotionError("candidate metadata must be committed after reviewed source")
    subprocess.run(["git", "-C", str(root), "merge-base", "--is-ancestor", reviewed_source_commit, candidate_commit],
                   check=True, capture_output=True)
    candidate, ledger = read_identity(root, candidate_commit)
    if candidate["maturity"] != "candidate" or candidate["app_version"] != expected_version:
        raise PromotionError("expected version must identify a current candidate")
    if candidate["source"]["commit"] != reviewed_source_commit:
        raise PromotionError("candidate does not bind the requested reviewed source commit")
    paths = changed_paths(root, reviewed_source_commit, candidate_commit)
    forbidden = sorted(path for path in paths if path not in PREPARATION_PATHS and not path.startswith("THIRD_PARTY_LICENSES/"))
    if forbidden:
        raise PromotionError("candidate includes changes outside preparation outputs: " + ", ".join(forbidden))
    previous_ledger = show(root, reviewed_source_commit, preparation.LEDGER)
    old_entries = validate_ledger_bytes(previous_ledger)
    entries = validate_append_only(ledger, previous_ledger)
    if len(entries) != len(old_entries) + 1:
        raise PromotionError("candidate must append exactly one immutable record")
    source_identity, _ = read_identity(root, reviewed_source_commit)
    if candidate["database"] != source_identity["database"]:
        raise PromotionError("candidate changed reviewed database compatibility")
    validate_candidate_compatibility(root, reviewed_source_commit, candidate_commit, source_identity, candidate)
    previous_version = show(root, reviewed_source_commit, "app/VERSION_APP").decode().strip()
    preparation.next_version(previous_version, expected_version, None)
    before_bootstrap = json.loads(show(root, reviewed_source_commit, preparation.BOOTSTRAP))
    after_bootstrap = json.loads(show(root, candidate_commit, preparation.BOOTSTRAP))
    before_bootstrap["app_version"] = expected_version
    if before_bootstrap != after_bootstrap:
        raise PromotionError("candidate changed bootstrap data beyond its application version")
    return {"reviewed_source_commit": reviewed_source_commit, "candidate_commit": candidate_commit,
            "candidate_identity": candidate, "candidate_ledger": ledger}


def published_record(candidate, candidate_commit, previous_hash, created_at):
    """Retain version and database semantics while assigning a new immutable ID."""
    if created_at < candidate["created_at"]:
        raise PromotionError("promotion timestamp precedes candidate creation")
    build_id = f"filterest-{candidate['app_version']}-stable-runtime-{candidate_commit[:12]}"
    return {"schema_version": 1, "record_type": "build", "record_id": "build:" + build_id,
            "previous_record_sha256": previous_hash, "product": "filterest", "build_id": build_id,
            "app_version": candidate["app_version"], "artifact_type": "runtime", "channel": "stable",
            "maturity": "published", "source": {"model": "public_first", "commit": candidate_commit},
            "database": candidate["database"], "created_at": created_at}


def promotion_writes(history, created_at):
    old_ledger = history["candidate_ledger"]
    candidate_entries = validate_ledger_bytes(old_ledger)
    record = published_record(history["candidate_identity"], history["candidate_commit"], candidate_entries[-1].sha256, created_at)
    ledger = old_ledger + canonical_json_line(record)
    entries = validate_append_only(ledger, old_ledger)
    return {preparation.LEDGER: ledger, preparation.IDENTITY: canonical_json_line(build_identity_from_entry(entries[-1]))}


def validate_current_metadata(root, identity):
    """Reuse product compatibility checks for candidate and final source alike."""
    preparation.validate_bootstrap(root, identity["app_version"], identity["database"]["target_version"])
    diagnostics = io.StringIO()
    with redirect_stdout(diagnostics):
        invalid = validate_manifest(root / "app", Path("server_tools/versioning/app_db_compatibility.jsonl"))
    if invalid:
        raise PromotionError(diagnostics.getvalue().strip())
    rows = [json.loads(line) for line in preparation.regular_path(root, preparation.COMPATIBILITY).read_text().splitlines()
            if line.strip() and not line.lstrip().startswith("#")]
    active = next(row for row in rows if row["status"] == "active")
    if active["min_db_version"] != identity["database"]["min_version"]:
        raise PromotionError("compatibility minimum differs from build identity")
    schema = preparation.regular_path(root, "app/" + active["schema_snapshot_path"])
    bootstrap = preparation.regular_path(root, "app/server_tools/public_bootstrap/schema.sql")
    if schema.read_bytes() != bootstrap.read_bytes():
        raise PromotionError("compatibility snapshot differs from reviewed bootstrap")


def validate_published_source(root: Path, expected_commit: str) -> dict:
    """Validate clean final P, exact C→P promotion, and C's reviewed source S."""
    root = root.resolve()
    if preparation.inspect_source(root, expected_commit):
        raise PromotionError("published source must be clean at the requested final commit")
    published, ledger = read_identity(root, expected_commit)
    if published["maturity"] != "published":
        raise PromotionError("final identity must have published maturity")
    validate_current_metadata(root, published)
    candidate_commit = published["source"]["commit"]
    candidate, _ = read_identity(root, candidate_commit)
    history = inspect_candidate(root, candidate_commit, candidate["source"]["commit"], published["app_version"])
    subprocess.run(["git", "-C", str(root), "merge-base", "--is-ancestor", candidate_commit, expected_commit],
                   check=True, capture_output=True)
    if changed_paths(root, candidate_commit, expected_commit) != PROMOTION_PATHS:
        raise PromotionError("final commit must change only the promotion ledger and identity")
    expected = promotion_writes(history, published["created_at"])
    if ledger != expected[preparation.LEDGER] or show(root, expected_commit, preparation.IDENTITY) != expected[preparation.IDENTITY]:
        raise PromotionError("final metadata is not the exact candidate promotion")
    return {key: value for key, value in history.items() if key != "candidate_ledger"} | {
        "published_commit": expected_commit, "published_identity": published}


def promote(args):
    root = args.target.resolve()
    with preparation.preparation_lock(root):
        if preparation.inspect_source(root, args.candidate_commit):
            raise PromotionError("promotion requires clean reviewed candidate source, including plan mode")
        history = inspect_candidate(root, args.candidate_commit, args.reviewed_source_commit, args.expect_version)
        candidate = history["candidate_identity"]
        validate_current_metadata(root, candidate)
        evidence = verify_assets(root, args.assets_dir, args.candidate_commit)
        planned = promotion_writes(history, args.created_at)
        # Only these two paths participate; candidate license outputs remain intact.
        original = {path: preparation.regular_path(root, path).read_bytes() for path in planned}
        if preparation.inspect_source(root, args.candidate_commit):
            raise PromotionError("candidate source changed before promotion")
        if args.apply:
            preparation.apply_prepared(root, planned, original)
        return {"mode": "applied" if args.apply else "plan", "version": args.expect_version,
                "candidate_commit": args.candidate_commit, "reviewed_source_commit": args.reviewed_source_commit,
                "maturity": "published", "remote_published": False, "publication_ready": False,
                "final_rebuild_required": True, "changed_paths": sorted(planned),
                "sha256": {path: hashlib.sha256(content).hexdigest() for path, content in planned.items()},
                "candidate_assets": evidence}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--target", type=Path, default=APP_ROOT.parent)
    parser.add_argument("--expect-version", required=True)
    parser.add_argument("--candidate-commit", required=True)
    parser.add_argument("--reviewed-source-commit", required=True)
    parser.add_argument("--assets-dir", type=Path, required=True)
    parser.add_argument("--created-at", default=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--dry-run", action="store_true", help="Verify and plan only (the default)")
    parser.add_argument("--json", action="store_true")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    try:
        result = promote(args)
    except (OSError, ValueError, BinaryManifestError, subprocess.SubprocessError) as error:
        print(f"release promotion failed: {error}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Candidate {result['version']} promotion: {result['mode']}")
        print("Commit the two metadata files, then rebuild final assets before publication.")
        for path in result["changed_paths"]:
            print("- " + path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
