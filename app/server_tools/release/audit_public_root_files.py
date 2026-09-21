#!/usr/bin/env python3
"""Audit the intentionally small tracked file surface of a Filterest root.

The audit compares a Filterest repository root with the reviewed manifest
beside this file. It exists so release reports, helper commands, and local
artifacts cannot silently turn the repository root back into an uncurated tool
drawer. `./filterest release build` runs it; with no --target it audits the
installation this tool belongs to.
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


DEFAULT_MANIFEST = Path(__file__).with_name("public_root_files.txt")
DEFAULT_TARGET = Path(__file__).resolve().parents[3]


def read_manifest(manifest_path: Path = DEFAULT_MANIFEST) -> set[str]:
    """Return reviewed root filenames from the canonical manifest."""

    entries: set[str] = set()
    for raw_line in manifest_path.read_text(encoding="utf-8").splitlines():
        entry = raw_line.strip()
        if not entry or entry.startswith("#"):
            continue
        if "/" in entry or entry in {".", ".."}:
            raise ValueError(f"root manifest entry must be one filename: {entry}")
        entries.add(entry)
    return entries


def tracked_root_files(target: Path) -> set[str]:
    """Read tracked root files, or physical files in a pre-Git staging tree."""

    git_dir_probe = subprocess.run(
        ["git", "-C", str(target), "rev-parse", "--show-toplevel"],
        check=False,
        capture_output=True,
        text=True,
    )
    if git_dir_probe.returncode == 0:
        repository_root = Path(git_dir_probe.stdout.strip()).resolve()
        if repository_root == target.resolve():
            tracked = subprocess.run(
                ["git", "-C", str(target), "ls-files"],
                check=True,
                capture_output=True,
                text=True,
            )
            return {
                path
                for path in tracked.stdout.splitlines()
                if path and "/" not in path
            }

    return {
        entry.name
        for entry in target.iterdir()
        if entry.is_file() or entry.is_symlink()
    }


def audit_root_files(target: Path, manifest_path: Path = DEFAULT_MANIFEST) -> tuple[list[str], list[str]]:
    """Return missing and unexpected filenames for one Filterest root."""

    expected = read_manifest(manifest_path)
    actual = tracked_root_files(target)
    return sorted(expected - actual), sorted(actual - expected)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    args = parser.parse_args()

    target = args.target.resolve()
    manifest = args.manifest.resolve()
    if not target.is_dir():
        parser.error(f"target directory does not exist: {target}")
    if not manifest.is_file():
        parser.error(f"root manifest does not exist: {manifest}")

    missing, unexpected = audit_root_files(target, manifest)
    if missing or unexpected:
        if missing:
            print("Missing reviewed root files:")
            for path in missing:
                print(f"- {path}")
        if unexpected:
            print("Unexpected root files:")
            for path in unexpected:
                print(f"- {path}")
        print(f"Reviewed root files are listed in {manifest}.")
        return 1

    expected_count = len(read_manifest(manifest))
    print(f"Public root contract OK: {expected_count} tracked root files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
