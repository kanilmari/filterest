#!/usr/bin/env python3
"""Append one explicit, idempotent Filterest release-ledger build record."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys
import tempfile
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from server_tools.versioning.release_contract_v1 import (  # noqa: E402
    ReleaseContractError,
    canonical_json_line,
    validate_append_only,
    validate_release_record,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Append exactly one canonical build record after proving that the "
            "current ledger preserves an explicit previous ledger byte-for-byte."
        )
    )
    parser.add_argument("--ledger", required=True, type=Path)
    parser.add_argument("--previous", required=True, type=Path)
    parser.add_argument("--app-version", required=True)
    parser.add_argument("--artifact-type", required=True, choices=("runtime", "backup"))
    parser.add_argument("--channel", required=True, choices=("development", "stable"))
    parser.add_argument(
        "--maturity",
        required=True,
        choices=("snapshot", "candidate", "published"),
    )
    parser.add_argument(
        "--source-model",
        required=True,
        choices=("legacy_maintainer_export", "public_first"),
    )
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--db-min-version", required=True)
    parser.add_argument("--db-target-version", required=True)
    parser.add_argument("--created-at", required=True)
    return parser.parse_args()


def _without_chain_pointer(record: dict[str, Any]) -> dict[str, Any]:
    comparable = dict(record)
    comparable.pop("previous_record_sha256", None)
    return comparable


def append_build_record(
    *,
    ledger_path: Path,
    previous_path: Path,
    app_version: str,
    artifact_type: str,
    channel: str,
    maturity: str,
    source_model: str,
    source_commit: str,
    db_min_version: str,
    db_target_version: str,
    created_at: str,
) -> tuple[dict[str, Any], bool]:
    """Append a record atomically, or return the already-identical record."""

    current = ledger_path.read_bytes()
    previous = previous_path.read_bytes()
    entries = validate_append_only(current, previous)

    build_id = (
        f"filterest-{app_version}-{channel}-{artifact_type}-{source_commit[:12]}"
    )
    candidate: dict[str, Any] = {
        "schema_version": 1,
        "record_type": "build",
        "record_id": f"build:{build_id}",
        "previous_record_sha256": entries[-1].sha256 if entries else None,
        "product": "filterest",
        "build_id": build_id,
        "app_version": app_version,
        "artifact_type": artifact_type,
        "channel": channel,
        "maturity": maturity,
        "source": {"model": source_model, "commit": source_commit},
        "database": {
            "min_version": db_min_version,
            "target_version": db_target_version,
        },
        "created_at": created_at,
    }
    validate_release_record(candidate)

    for entry in entries:
        if entry.record["build_id"] != build_id:
            continue
        if _without_chain_pointer(entry.record) != _without_chain_pointer(candidate):
            raise ReleaseContractError(
                f"build_id {build_id!r} already exists with different immutable fields"
            )
        return entry.record, False

    candidate_bytes = current + canonical_json_line(candidate)
    validate_append_only(candidate_bytes, previous)

    with tempfile.NamedTemporaryFile(dir=ledger_path.parent, delete=False) as temp_file:
        temporary_path = Path(temp_file.name)
        temp_file.write(candidate_bytes)
        temp_file.flush()
        os.fsync(temp_file.fileno())
    try:
        os.replace(temporary_path, ledger_path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise
    return candidate, True


def main() -> int:
    args = parse_args()
    try:
        record, appended = append_build_record(
            ledger_path=args.ledger,
            previous_path=args.previous,
            app_version=args.app_version,
            artifact_type=args.artifact_type,
            channel=args.channel,
            maturity=args.maturity,
            source_model=args.source_model,
            source_commit=args.source_commit,
            db_min_version=args.db_min_version,
            db_target_version=args.db_target_version,
            created_at=args.created_at,
        )
    except (OSError, ReleaseContractError) as exc:
        print(f"release ledger append failed: {exc}", file=sys.stderr)
        return 1

    action = "appended" if appended else "already present"
    print(f"release ledger record {action}: {record['record_id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
