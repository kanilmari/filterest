#!/usr/bin/env python3
"""Run the release source checks on one Filterest checkout.

This is `./filterest release verify`, and `./filterest release build` runs it
before building. It checks, in order: the source boundary, the reviewed
repository-root files, the release ledger, the app/database compatibility
record, the public bootstrap package and the demo media. Each check runs from
the checked tree itself, so a checkout is judged by its own rules, and the
first failure stops the run.

A workspace that embeds Filterest passes the private names that must not reach
this repository with --forbidden-name (source) and --forbidden-marker (demo
media); Filterest itself ships none.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys


DEFAULT_TARGET = Path(__file__).resolve().parents[3]


def source_checks(
    target: Path,
    forbidden_names: list[str],
    forbidden_markers: list[str],
) -> list[tuple[str, list[str]]]:
    """List each check as a label and the command that runs it."""

    tools = target / "app/server_tools"
    python = sys.executable
    return [
        ("source boundary", [
            python, str(tools / "release/audit_source_boundary.py"), "--target", str(target),
            *(f"--forbidden-name={name}" for name in forbidden_names),
        ]),
        ("repository-root files", [
            python, str(tools / "release/audit_public_root_files.py"), "--target", str(target),
        ]),
        ("release ledger", [python, str(tools / "scripts/validate_release_ledger.py")]),
        ("app/database compatibility", [
            python, str(tools / "scripts/validate_app_db_compatibility.py"),
            "--repository-root", str(target / "app"),
        ]),
        ("public bootstrap", [
            python, str(tools / "public_slice_export/audit_public_bootstrap.py"), "--target", str(target),
        ]),
        # The boundary check has already proved the operator homes are
        # untracked and ignored, so their local presence is allowed here.
        ("demo media", [
            python, str(tools / "release/audit_public_demo_assets.py"), "--target", str(target),
            "--allow-local-mutable-homes",
            *(f"--forbidden-marker={marker}" for marker in forbidden_markers),
        ]),
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET,
                        help="Filterest checkout to check (default: the one this tool belongs to)")
    parser.add_argument("--forbidden-name", action="append", default=[],
                        help="A private owner name tracked source must not address; repeatable")
    parser.add_argument("--forbidden-marker", action="append", default=[],
                        help="Text no demo media file may contain; repeatable")
    args = parser.parse_args(argv)

    target = args.target.resolve()
    if not (target / "app/server_tools").is_dir():
        parser.error(f"not a Filterest checkout: {target}")
    checks = source_checks(target, args.forbidden_name, args.forbidden_marker)
    for label, command in checks:
        if subprocess.run(command, check=False).returncode != 0:
            print(f"Release source check failed: {label}.", file=sys.stderr)
            return 1
    print(
        f"Release source checks passed ({len(checks)} checks). "
        "This is not a publication receipt or a new release approval."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
