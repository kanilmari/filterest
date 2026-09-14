"""Bind a reviewed source DB transition without rewriting published history.

The opt-in preparation path raises the minimum to the new target. Promotion
reconstructs the same contract from immutable S bytes; C and P stay strict.
"""
from __future__ import annotations

from contextlib import redirect_stdout
import io
from pathlib import Path

from server_tools.scripts.validate_app_db_compatibility import (
    canonical_schema_snapshot_path, parse_semver, validate_manifest, validate_repo_artifact_path,
)


def source_database_contract(identity, current, database, rows, read_bytes, *, transition_from=None):
    """Validate old published pairing and the exact schema proposed in source S."""
    if identity["app_version"] != current:
        raise ValueError("current build identity versions disagree with source markers")
    active = [row for row in rows if row.get("status") == "active"]
    if len(active) != 1 or active[0].get("app_version") != current:
        raise ValueError("compatibility requires one active row matching current source")
    baseline = active[0]
    previous = identity["database"]
    if baseline.get("min_db_version") != previous["min_version"]:
        raise ValueError("compatibility minimum database version disagrees with current build identity")
    if baseline.get("target_db_version") != previous["target_version"]:
        raise ValueError("reviewed source compatibility disagrees with current build identity")
    old_target = previous["target_version"]
    changed = database != old_target
    if changed:
        if transition_from is None:
            raise ValueError("database change requires explicit --db-transition-from")
        if transition_from != old_target:
            raise ValueError("--db-transition-from does not match published database target")
        if parse_semver(database) <= parse_semver(old_target):
            raise ValueError("database transition requires a newer target version")
        if (identity["maturity"], identity["channel"], identity["artifact_type"],
                identity["source"]["model"]) != ("published", "stable", "runtime", "public_first"):
            raise ValueError("database transition requires a published public-first source identity")
        minimum = database
        snapshot = canonical_schema_snapshot_path(database)
    else:
        if transition_from is not None:
            raise ValueError("--db-transition-from requires a newer target version")
        minimum = previous["min_version"]
        snapshot = baseline.get("schema_snapshot_path")
    if baseline.get("schema_snapshot_path") != canonical_schema_snapshot_path(old_target):
        raise ValueError("reviewed source schema_snapshot_path must match target_db_version")
    if snapshot != canonical_schema_snapshot_path(database):
        raise ValueError("compatibility schema snapshot is not canonical")
    if read_bytes("app/" + snapshot) != read_bytes("app/server_tools/public_bootstrap/schema.sql"):
        raise ValueError("compatibility schema snapshot disagrees with reviewed bootstrap")
    return {"min_version": minimum, "target_version": database,
            "schema_snapshot_path": snapshot, "transition": changed,
            "previous_target": old_target}


def validate_source_manifest(root, contract):
    """Validate old history against its identity only after the strict source check."""
    if contract["transition"]:
        errors = validate_repo_artifact_path(
            repo_root=root / "app", artifact_root=root / "app",
            manifest_path=Path("reviewed DB transition"), line_no=1,
            field_name="schema_snapshot_path", raw_path=contract["schema_snapshot_path"],
            required_suffix=".sql",
        )
        if errors:
            raise ValueError("\n".join(errors))
    diagnostics = io.StringIO()
    with redirect_stdout(diagnostics):
        invalid = validate_manifest(
            root / "app", Path("server_tools/versioning/app_db_compatibility.jsonl"),
            current_db_version_override=contract["previous_target"] if contract["transition"] else None,
        )
    if invalid:
        raise ValueError(diagnostics.getvalue().strip())
