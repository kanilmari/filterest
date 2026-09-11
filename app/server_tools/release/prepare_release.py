#!/usr/bin/env python3
"""Prepare one candidate's product metadata from reviewed standalone source.

Reuse the public ledger and dependency inventory contracts, stage all generated
bytes first, then apply a recoverable group of replacements. Database generation,
release promotion, Git commits and publication remain separate operations.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager, redirect_stdout
import datetime as dt
import fcntl
import hashlib
import json
import io
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))
from server_tools.scripts.validate_app_db_compatibility import validate_manifest
from server_tools.public_slice_export import generate_third_party_notices as notices
from server_tools.public_slice_export.third_party_notice_renderer import render_notice_from_manifest
from server_tools.versioning.release_contract_v1 import (
    ReleaseContractError, build_identity_from_entry, canonical_json_line,
    validate_append_only, validate_build_identity, validate_ledger_bytes,
)

LEDGER = "app/server_tools/versioning/release_ledger.v1.jsonl"
COMPATIBILITY = "app/server_tools/versioning/app_db_compatibility.jsonl"
BOOTSTRAP = "app/server_tools/public_bootstrap/manifest.json"
IDENTITY = "app/BUILD_IDENTITY.json"
RELEASE_NOTES = "app/docs/publication/RELEASE_NOTES.md"
BUNDLE = "THIRD_PARTY_LICENSES"
SEMVER = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")


class PreparationError(ValueError):
    """A source or output boundary prevents reliable preparation."""


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def regular_path(root, relative):
    """Never follow release input/output symlinks into operator-owned state."""
    relative = Path(relative)
    if relative.is_absolute() or ".." in relative.parts:
        raise PreparationError(f"path escapes the release source: {relative}")
    current = root
    for part in relative.parts:
        current /= part
        if current.is_symlink():
            raise PreparationError(f"release path must not be a symlink: {relative}")
    return current


def git(root, *arguments):
    result = subprocess.run(["git", "-C", str(root), *arguments], check=True,
                            capture_output=True, text=True)
    return result.stdout.strip()


def inspect_source(root, source_commit):
    if not re.fullmatch(r"[0-9a-f]{40}", source_commit):
        raise PreparationError("--source-commit requires the full lowercase Git commit")
    if Path(git(root, "rev-parse", "--show-toplevel")).resolve() != root:
        raise PreparationError("--target must be the standalone Git root")
    if git(root, "rev-parse", "HEAD") != source_commit:
        raise PreparationError("reviewed --source-commit does not match HEAD")
    return git(root, "status", "--porcelain=v1", "--untracked-files=all")


def next_version(current, explicit, bump):
    if not SEMVER.fullmatch(current):
        raise PreparationError(f"invalid current application version: {current}")
    major, minor, patch = map(int, current.split("."))
    allowed = {"patch": f"{major}.{minor}.{patch + 1}",
               "minor": f"{major}.{minor + 1}.0", "major": f"{major + 1}.0.0"}
    version = explicit or allowed[bump or "patch"]
    if version not in allowed.values():
        raise PreparationError("version must be the next patch, minor reset, or major reset")
    return version


def validate_bootstrap(root, current, database):
    """A metadata-only release reuses exactly the reviewed schema and seed."""
    manifest = json.loads(regular_path(root, BOOTSTRAP).read_bytes())
    if not isinstance(manifest, dict):
        raise PreparationError("bootstrap manifest must be a JSON object")
    if manifest.get("artifact") != "filterest-public-bootstrap" or manifest.get("format_version") != 2:
        raise PreparationError("bootstrap artifact/format must be filterest-public-bootstrap version 2")
    if manifest.get("app_version") != current or manifest.get("db_version") != database:
        raise PreparationError("bootstrap versions disagree with application/database markers")
    required = {"server_tools/public_bootstrap/schema.sql", "server_tools/public_bootstrap/seed_data.sql"}
    if not isinstance(manifest.get("generated_files"), dict) or set(manifest["generated_files"]) != required:
        raise PreparationError("bootstrap must identify the reviewed schema and seed")
    if not isinstance(manifest.get("source_files"), dict) or not manifest["source_files"]:
        raise PreparationError("bootstrap source-file provenance is missing")
    for field in ("generated_files", "source_files"):
        for relative, record in manifest[field].items():
            if relative.startswith("filterest/"):
                relative = relative[len("filterest/"):]
            if relative.startswith("server_tools/"):
                relative = "app/" + relative
            if not relative.startswith("app/"):
                raise PreparationError(f"bootstrap provenance is outside app/: {relative}")
            actual = hashlib.sha256(regular_path(root, relative).read_bytes()).hexdigest()
            if not isinstance(record, dict) or record.get("sha256") != actual:
                raise PreparationError(f"bootstrap source/generated hash mismatch: {relative}")
    return manifest


def prepare_metadata(root, args):
    """Return the bounded new metadata bytes while preserving immutable history."""
    current = regular_path(root, "app/VERSION_APP").read_text().strip()
    database = regular_path(root, "app/VERSION_DB").read_text().strip()
    if current != args.expect_current_version:
        raise PreparationError("--expect-current-version does not match app/VERSION_APP")
    if not SEMVER.fullmatch(database):
        raise PreparationError("invalid database version marker")
    version = next_version(current, args.version, args.bump)
    bootstrap = validate_bootstrap(root, current, database)
    old_ledger = regular_path(root, LEDGER).read_bytes()
    entries = validate_ledger_bytes(old_ledger)
    identity = validate_build_identity(json.loads(regular_path(root, IDENTITY).read_bytes()))
    matching = [entry for entry in entries if entry.record["record_id"] == identity["ledger_record_id"]]
    if len(matching) != 1 or build_identity_from_entry(matching[0]) != identity:
        raise PreparationError("current build identity does not match its immutable ledger record")
    if identity["app_version"] != current or identity["database"]["target_version"] != database:
        raise PreparationError("current build identity versions disagree with source markers")
    compatibility_text = regular_path(root, COMPATIBILITY).read_text()
    diagnostics = io.StringIO()
    with redirect_stdout(diagnostics):
        valid = validate_manifest(root / "app", Path("server_tools/versioning/app_db_compatibility.jsonl"))
    if valid:
        raise PreparationError(diagnostics.getvalue().strip())
    rows = [json.loads(line) for line in compatibility_text.splitlines() if line.strip() and not line.lstrip().startswith("#")]
    active = [row for row in rows if row.get("status") == "active"]
    if len(active) != 1 or active[0].get("app_version") != current or active[0].get("target_db_version") != database:
        raise PreparationError("compatibility requires one active row matching current source")
    if any(row.get("app_version") == version for row in rows):
        raise PreparationError("compatibility already contains the requested version")
    minimum = active[0].get("min_db_version")
    if minimum != identity["database"]["min_version"]:
        raise PreparationError("compatibility minimum database version disagrees with current build identity")
    snapshot = active[0].get("schema_snapshot_path", "")
    if not snapshot.startswith("server_tools/versioning/schema_snapshots/"):
        raise PreparationError("active compatibility row lacks a public schema snapshot")
    if regular_path(root, "app/" + snapshot).read_bytes() != regular_path(root, "app/server_tools/public_bootstrap/schema.sql").read_bytes():
        raise PreparationError("compatibility schema snapshot disagrees with reviewed bootstrap")
    build_id = f"filterest-{version}-stable-runtime-{args.source_commit[:12]}"
    record = {"schema_version": 1, "record_type": "build", "record_id": "build:" + build_id,
              "previous_record_sha256": entries[-1].sha256 if entries else None,
              "product": "filterest", "build_id": build_id, "app_version": version,
              "artifact_type": "runtime", "channel": "stable", "maturity": "candidate",
              "source": {"model": "public_first", "commit": args.source_commit},
              "database": {"min_version": minimum, "target_version": database},
              "created_at": args.created_at}
    ledger = old_ledger + canonical_json_line(record)
    updated_entries = validate_append_only(ledger, old_ledger)
    for row in rows:
        if row.get("status") == "active":
            row["status"] = "historical"
    rows.append({"app_version": version, "min_db_version": minimum, "target_db_version": database,
                 "schema_snapshot_path": snapshot, "git_commit_sha": args.source_commit,
                 "status": "active", "notes": args.manifest_notes.strip(), "recorded_at": args.created_at})
    note_bytes = args.release_notes.read_bytes()
    if not note_bytes.decode("utf-8").strip():
        raise PreparationError("release notes must be nonempty UTF-8 text")
    bootstrap["app_version"] = version
    return current, version, database, {
        "app/VERSION_APP": (version + "\n").encode(), LEDGER: ledger,
        IDENTITY: canonical_json_line(build_identity_from_entry(updated_entries[-1])),
        COMPATIBILITY: b"".join(canonical_json_line(row) for row in rows),
        BOOTSTRAP: json_bytes(bootstrap), RELEASE_NOTES: note_bytes,
    }


def prepare_notices(root, version, staging):
    """Collect from actual standalone source; retain documents only in staging."""
    go, go_source = notices.collect_go_modules(root / "app", readonly=True)
    npm, npm_source = notices.collect_npm_packages(root / "app")
    browser, browser_source = notices.collect_browser_bundle_dependencies(root)
    assets = notices.collect_assets(root)
    bundle = staging / BUNDLE
    manifest = notices.build_manifest(root, go, go_source, npm, npm_source,
                                     browser, browser_source, assets, bundle_dir=bundle)
    if manifest["unresolved"]:
        raise PreparationError("dependency notices contain unresolved components: " + ", ".join(manifest["unresolved"]))
    manifest["filterest_app_version"] = version
    manifest_bytes = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
    (bundle / "manifest.json").write_bytes(manifest_bytes)
    digest = hashlib.sha256(manifest_bytes).hexdigest()
    result = {"THIRD_PARTY_NOTICES.md": render_notice_from_manifest(manifest, digest).encode()}
    for path in bundle.rglob("*"):
        if path.is_file():
            result[path.relative_to(staging).as_posix()] = path.read_bytes()
    return result


def snapshot_outputs(root, planned):
    """Capture existing bytes, including license documents removed by regeneration."""
    paths = set(planned)
    bundle = regular_path(root, BUNDLE)
    if bundle.exists():
        for path in bundle.rglob("*"):
            relative = path.relative_to(root).as_posix()
            regular_path(root, relative)
            if path.is_file():
                paths.add(relative)
    original = {}
    for relative in sorted(paths):
        path = regular_path(root, relative)
        if path.exists() and not path.is_file():
            raise PreparationError(f"release output is not a regular file: {relative}")
        original[relative] = path.read_bytes() if path.exists() else None
    return original


def replace_bytes(path, content):
    """Replace one file through its own filesystem's atomic rename operation."""
    if content is None:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o644
    descriptor, name = tempfile.mkstemp(prefix=".release-prepare-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        temporary.chmod(mode)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def apply_prepared(root, planned, original):
    """Rollback replaced files if a write fails; never write outside the known set."""
    touched = []
    created_dirs = set()
    try:
        for relative, old in original.items():
            path = regular_path(root, relative)
            actual = path.read_bytes() if path.exists() else None
            if actual != old:
                raise PreparationError(f"release output changed during preparation: {relative}")
            new = planned.get(relative)
            if old == new:
                continue
            parent = path.parent
            while parent != root and not parent.exists():
                created_dirs.add(parent)
                parent = parent.parent
            touched.append(relative)
            replace_bytes(path, new)
    except BaseException:
        for relative in reversed(touched):
            replace_bytes(regular_path(root, relative), original[relative])
        for directory in sorted(created_dirs, key=lambda path: len(path.parts), reverse=True):
            if directory.exists():
                directory.rmdir()
        raise


@contextmanager
def preparation_lock(root):
    """Serialize preparation without changing Git metadata or operator settings."""
    digest = hashlib.sha256(str(root).encode()).hexdigest()
    directory = Path(tempfile.gettempdir()) / f"filterest-release-{os.getuid()}"
    directory.mkdir(mode=0o700, exist_ok=True)
    if directory.is_symlink() or directory.stat().st_uid != os.getuid():
        raise PreparationError("release lock directory is not owned by this user")
    descriptor = os.open(directory / (digest + ".lock"), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise PreparationError("another release preparation is already running") from exc
        yield


def prepare(args):
    root = args.target.resolve()
    with preparation_lock(root):
        status = inspect_source(root, args.source_commit)
        if args.apply and status:
            raise PreparationError("--apply requires a clean reviewed standalone source tree")
        current, version, database, planned = prepare_metadata(root, args)
        with tempfile.TemporaryDirectory(prefix="filterest-release-preparation-") as directory:
            planned.update(prepare_notices(root, version, Path(directory)))
        original = snapshot_outputs(root, planned)
        current_status = inspect_source(root, args.source_commit)
        if args.apply and current_status:
            raise PreparationError("source changed while preparing release metadata")
        changed = [relative for relative, old in original.items() if old != planned.get(relative)]
        if args.apply:
            apply_prepared(root, planned, original)
        return {"mode": "applied" if args.apply else "plan", "maturity": "candidate",
                "current_version": current, "version": version, "database_version": database,
                "source_commit": args.source_commit, "source_clean": not bool(current_status),
                "ready_to_apply": not bool(current_status), "publication_ready": False,
                "changed_paths": changed, "sha256": {relative: hashlib.sha256(planned[relative]).hexdigest()
                    for relative in changed if relative in planned}}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--target", type=Path, default=APP_ROOT.parent)
    version = parser.add_mutually_exclusive_group()
    version.add_argument("--version")
    version.add_argument("--bump", choices=("patch", "minor", "major"))
    parser.add_argument("--expect-current-version", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--release-notes", type=Path, required=True)
    parser.add_argument("--manifest-notes", required=True)
    parser.add_argument("--created-at", default=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    parser.add_argument("--apply", action="store_true", help="Apply prepared candidate metadata to clean reviewed source")
    parser.add_argument("--dry-run", action="store_true", help="Plan only (the default); incompatible with --apply")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if args.apply and args.dry_run:
        parser.error("--apply and --dry-run are mutually exclusive")
    if not args.manifest_notes.strip():
        parser.error("--manifest-notes must not be empty")
    return args


def main(argv=None):
    args = parse_args(argv)
    try:
        result = prepare(args)
    except (OSError, ValueError, notices.InventoryCollectionError, subprocess.SubprocessError) as error:
        print(f"release preparation failed: {error}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Candidate {result['version']}: {result['mode']} ({len(result['changed_paths'])} changed files)")
        print("Source clean: " + str(result["source_clean"]).lower())
        print("Candidate preparation does not establish publication readiness.")
        for path in result["changed_paths"]:
            print("- " + path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
