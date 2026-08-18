#!/usr/bin/env python3
"""Generate deterministic BUILD_IDENTITY.json from one immutable ledger record."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys
import tempfile


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from server_tools.versioning.release_contract_v1 import (  # noqa: E402
    ReleaseContractError,
    build_identity_from_entry,
    canonical_json_line,
    read_and_validate_ledger,
)


DEFAULT_LEDGER = REPO_ROOT / "server_tools/versioning/release_ledger.v1.jsonl"
DEFAULT_OUTPUT = REPO_ROOT / "BUILD_IDENTITY.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate Filterest BUILD_IDENTITY.json from a validated ledger record."
    )
    parser.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    parser.add_argument("--record-id", required=True)
    parser.add_argument("--expected-app-version", required=True)
    parser.add_argument("--expected-db-version", required=True)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def generate(
    ledger: Path,
    record_id: str,
    output: Path,
    *,
    expected_app_version: str,
    expected_db_version: str,
) -> bytes:
    entries = read_and_validate_ledger(ledger)
    matches = [entry for entry in entries if entry.record["record_id"] == record_id]
    if len(matches) != 1:
        raise ReleaseContractError(
            f"ledger must contain exactly one record_id {record_id!r}; found {len(matches)}"
        )

    record = matches[0].record
    if record["app_version"] != expected_app_version:
        raise ReleaseContractError(
            "ledger app_version does not match the generated VERSION_APP marker"
        )
    if record["database"]["target_version"] != expected_db_version:
        raise ReleaseContractError(
            "ledger database.target_version does not match the generated VERSION_DB marker"
        )

    identity_bytes = canonical_json_line(build_identity_from_entry(matches[0]))
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output.parent, delete=False) as temp_file:
        temporary_path = Path(temp_file.name)
        temp_file.write(identity_bytes)
        temp_file.flush()
        os.fsync(temp_file.fileno())
    try:
        os.replace(temporary_path, output)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise
    return identity_bytes


def main() -> int:
    args = parse_args()
    try:
        identity_bytes = generate(
            args.ledger,
            args.record_id,
            args.output,
            expected_app_version=args.expected_app_version,
            expected_db_version=args.expected_db_version,
        )
    except (OSError, ReleaseContractError) as exc:
        print(f"build identity generation failed: {exc}", file=sys.stderr)
        return 1
    print(f"build identity written: {args.output} ({len(identity_bytes)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
