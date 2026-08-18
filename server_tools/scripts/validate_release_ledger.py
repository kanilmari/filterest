#!/usr/bin/env python3
"""Validate Filterest release ledger v1 without network or database access."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from server_tools.versioning.release_contract_v1 import (  # noqa: E402
    ReleaseContractError,
    read_and_validate_ledger,
)


DEFAULT_LEDGER = REPO_ROOT / "server_tools/versioning/release_ledger.v1.jsonl"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate canonical JSONL, record semantics, hash chain, uniqueness, "
            "and optional byte-for-byte append-only history."
        )
    )
    parser.add_argument(
        "ledger",
        nargs="?",
        type=Path,
        default=DEFAULT_LEDGER,
        help=f"ledger to validate (default: {DEFAULT_LEDGER})",
    )
    parser.add_argument(
        "--previous",
        type=Path,
        help="previous committed ledger whose exact bytes must be a prefix",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        entries = read_and_validate_ledger(args.ledger, previous_path=args.previous)
    except (OSError, ReleaseContractError) as exc:
        print(f"release ledger validation failed: {exc}", file=sys.stderr)
        return 1
    suffix = " with append-only history" if args.previous else ""
    print(f"release ledger valid: {len(entries)} record(s){suffix}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
