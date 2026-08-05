#!/usr/bin/env python3
"""
Validate the app↔DB compatibility manifest used by #808 slice 1.

This validator is intentionally git-artifact-first:
- the manifest is the canonical source for app-version compatibility rows
- schema snapshots are committed only for DB-version bumps
- no database access is required to validate the current repository state
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path


SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
REQUIRED_FIELDS = (
    "app_version",
    "min_db_version",
    "target_db_version",
    "schema_snapshot_path",
    "git_commit_sha",
    "status",
    "notes",
    "recorded_at",
)
OPTIONAL_ZIP_ARTIFACT_FIELDS = ("bootstrap_seed_artifact_path",)
ALLOWED_STATUSES = {"active", "historical"}


def parse_semver(version: str) -> tuple[int, int, int]:
    if not SEMVER_RE.fullmatch(version):
        raise ValueError(f"invalid semantic version: {version!r}")
    major, minor, patch = version.split(".")
    return int(major), int(minor), int(patch)


def load_required_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def read_current_app_version(repo_root: Path) -> tuple[str, str]:
    for file_name in ("VERSION_EASELECT", "VERSION_APP"):
        path = repo_root / file_name
        if not path.exists():
            continue
        version = load_required_text(path)
        if not version:
            raise RuntimeError(f"{path} is empty")
        return version, file_name
    raise RuntimeError("missing VERSION_EASELECT or VERSION_APP")


def validate_repo_artifact_path(
    *,
    repo_root: Path,
    manifest_path: Path,
    line_no: int,
    field_name: str,
    raw_path: str,
    required_suffix: str | None = None,
) -> list[str]:
    errors: list[str] = []
    artifact_path = Path(raw_path)

    if artifact_path.is_absolute():
        errors.append(
            f"{manifest_path}:{line_no}: field {field_name!r} must be a repo-relative path, got {raw_path!r}"
        )
        return errors

    if required_suffix is not None and artifact_path.suffix.lower() != required_suffix:
        errors.append(
            f"{manifest_path}:{line_no}: field {field_name!r} must point to a {required_suffix} artifact, "
            f"got {raw_path!r}"
        )

    repo_root_resolved = repo_root.resolve()
    resolved_artifact_path = (repo_root / artifact_path).resolve()

    try:
        resolved_artifact_path.relative_to(repo_root_resolved)
    except ValueError:
        errors.append(
            f"{manifest_path}:{line_no}: field {field_name!r} escapes the repository root: {raw_path!r}"
        )
        return errors

    if not resolved_artifact_path.exists():
        errors.append(f"{manifest_path}:{line_no}: {field_name} not found: {raw_path}")
        return errors

    tracked_result = subprocess.run(
        ["git", "-C", str(repo_root), "ls-files", "--error-unmatch", "--", raw_path],
        check=False,
        capture_output=True,
        text=True,
    )
    if tracked_result.returncode != 0:
        errors.append(
            f"{manifest_path}:{line_no}: field {field_name!r} must reference a git-tracked artifact, "
            f"got {raw_path!r}"
        )

    return errors


def canonical_schema_snapshot_path(db_version: str) -> str:
    """Return the canonical committed schema snapshot path for one DB version."""
    return f"server_tools/versioning/schema_snapshots/db-{db_version}.sql"


def canonical_bootstrap_seed_artifact_path(db_version: str) -> str:
    """Return the canonical committed bootstrap zip path for one DB version."""
    return (
        "server_tools/versioning/bootstrap_seeds/"
        f"db-{db_version}/easelect_bootstrap_db-{db_version}.zip"
    )


def validate_status_contract(rows: list[dict[str, str]], current_app_version: str) -> list[str]:
    """Require one current active pairing while retaining older rows as history."""
    errors: list[str] = []
    active_versions = [row["app_version"] for row in rows if row["status"] == "active"]

    if active_versions != [current_app_version]:
        errors.append(
            "compatibility manifest must contain exactly one active row for "
            f"current app {current_app_version}; found active rows {active_versions}"
        )

    non_historical_versions = [
        row["app_version"]
        for row in rows
        if row["app_version"] != current_app_version and row["status"] != "historical"
    ]
    if non_historical_versions:
        errors.append(
            "all non-current compatibility rows must be historical; "
            f"found {non_historical_versions}"
        )

    return errors


def validate_manifest() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    manifest_path = repo_root / "server_tools/versioning/app_db_compatibility.jsonl"
    current_app_version, current_app_version_file = read_current_app_version(repo_root)
    current_db_version = load_required_text(repo_root / "VERSION_DB")

    errors: list[str] = []
    rows: list[dict[str, str]] = []

    if not manifest_path.exists():
        print(f"❌ Missing compatibility manifest: {manifest_path}")
        return 1

    seen_app_versions: dict[str, int] = {}

    for line_no, raw_line in enumerate(manifest_path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        row_errors: list[str] = []

        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"{manifest_path}:{line_no}: invalid JSON: {exc}")
            continue

        if not isinstance(row, dict):
            errors.append(f"{manifest_path}:{line_no}: row must be a JSON object")
            continue

        missing_fields = [field for field in REQUIRED_FIELDS if field not in row]
        if missing_fields:
            row_errors.append(f"{manifest_path}:{line_no}: missing fields: {', '.join(missing_fields)}")
            errors.extend(row_errors)
            continue

        for field in REQUIRED_FIELDS:
            value = row[field]
            if not isinstance(value, str) or not value.strip():
                row_errors.append(f"{manifest_path}:{line_no}: field {field!r} must be a non-empty string")

        for field in OPTIONAL_ZIP_ARTIFACT_FIELDS:
            if field not in row:
                continue
            value = row[field]
            if not isinstance(value, str) or not value.strip():
                row_errors.append(f"{manifest_path}:{line_no}: field {field!r} must be a non-empty string")

        if row_errors:
            errors.extend(row_errors)
            continue

        try:
            min_db_tuple = parse_semver(row["min_db_version"])
            target_db_tuple = parse_semver(row["target_db_version"])
            parse_semver(row["app_version"])
        except ValueError as exc:
            row_errors.append(f"{manifest_path}:{line_no}: {exc}")
            errors.extend(row_errors)
            continue

        if min_db_tuple > target_db_tuple:
            row_errors.append(
                f"{manifest_path}:{line_no}: min_db_version {row['min_db_version']} exceeds "
                f"target_db_version {row['target_db_version']}"
            )

        try:
            datetime.fromisoformat(row["recorded_at"].replace("Z", "+00:00"))
        except ValueError:
            row_errors.append(
                f"{manifest_path}:{line_no}: recorded_at must be ISO-8601, got {row['recorded_at']!r}"
            )

        if not GIT_SHA_RE.fullmatch(row["git_commit_sha"]):
            row_errors.append(
                f"{manifest_path}:{line_no}: git_commit_sha must be a full 40-character lowercase hex SHA, "
                f"got {row['git_commit_sha']!r}"
            )

        if row["status"] not in ALLOWED_STATUSES:
            row_errors.append(
                f"{manifest_path}:{line_no}: status must be one of "
                f"{sorted(ALLOWED_STATUSES)}, got {row['status']!r}"
            )

        row_errors.extend(
            validate_repo_artifact_path(
                repo_root=repo_root,
                manifest_path=manifest_path,
                line_no=line_no,
                field_name="schema_snapshot_path",
                raw_path=row["schema_snapshot_path"],
            )
        )
        expected_snapshot_path = canonical_schema_snapshot_path(row["target_db_version"])
        if row["schema_snapshot_path"] != expected_snapshot_path:
            row_errors.append(
                f"{manifest_path}:{line_no}: schema_snapshot_path must match target_db_version "
                f"{row['target_db_version']}: expected {expected_snapshot_path!r}, "
                f"got {row['schema_snapshot_path']!r}"
            )

        for field in OPTIONAL_ZIP_ARTIFACT_FIELDS:
            raw_path = row.get(field)
            if raw_path is None:
                continue
            row_errors.extend(
                validate_repo_artifact_path(
                    repo_root=repo_root,
                    manifest_path=manifest_path,
                    line_no=line_no,
                    field_name=field,
                    raw_path=raw_path,
                    required_suffix=".zip",
                )
            )
            expected_bootstrap_path = canonical_bootstrap_seed_artifact_path(row["target_db_version"])
            if raw_path != expected_bootstrap_path:
                row_errors.append(
                    f"{manifest_path}:{line_no}: {field} must match target_db_version "
                    f"{row['target_db_version']}: expected {expected_bootstrap_path!r}, got {raw_path!r}"
                )

        previous_line = seen_app_versions.get(row["app_version"])
        if previous_line is not None:
            row_errors.append(
                f"{manifest_path}:{line_no}: duplicate app_version {row['app_version']!r} "
                f"(already defined on line {previous_line})"
            )
        else:
            seen_app_versions[row["app_version"]] = line_no

        if row_errors:
            errors.extend(row_errors)
            continue

        rows.append(row)

    if not rows:
        errors.append(f"{manifest_path}: no compatibility rows found")
    else:
        errors.extend(validate_status_contract(rows, current_app_version))

    current_row = next((row for row in rows if row["app_version"] == current_app_version), None)
    if current_row is None:
        errors.append(
            f"{manifest_path}: current {current_app_version_file} {current_app_version} has no manifest row"
        )
    else:
        if current_row["target_db_version"] != current_db_version:
            errors.append(
                f"{manifest_path}: current app row targets DB {current_row['target_db_version']}, "
                f"but VERSION_DB is {current_db_version}"
            )
        if parse_semver(current_row["min_db_version"]) > parse_semver(current_db_version):
            errors.append(
                f"{manifest_path}: current app row requires min DB {current_row['min_db_version']}, "
                f"but VERSION_DB is {current_db_version}"
            )

    if errors:
        print("❌ App/DB compatibility validation failed:")
        for error in errors:
            print(f" - {error}")
        return 1

    print(
        "✅ App/DB compatibility manifest OK: "
        f"app {current_app_version} -> DB {current_db_version} "
        f"({current_row['schema_snapshot_path']})"
        + (
            f" [bootstrap: {current_row['bootstrap_seed_artifact_path']}]"
            if "bootstrap_seed_artifact_path" in current_row
            else ""
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(validate_manifest())
