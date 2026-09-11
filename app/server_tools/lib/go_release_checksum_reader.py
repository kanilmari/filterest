#!/usr/bin/env python3
# go_release_checksum_reader.py
# Selects one official Go archive checksum from release metadata.
# Bridges the source module's toolchain version with the Go download JSON feed.
# Rejects absent or ambiguous metadata before installation can modify a toolchain.

import json
from pathlib import Path
import re
import sys


def read_archive_checksum(metadata_path, version, architecture):
    """Return the exact stable Linux archive checksum or reject unsafe metadata."""
    if not re.fullmatch(r"[0-9]+\.[0-9]+(?:\.[0-9]+)?", version):
        raise ValueError("invalid Go version in go.mod")
    if architecture not in {"amd64", "arm64"}:
        raise ValueError("unsupported Go archive architecture")
    releases = json.loads(Path(metadata_path).read_text(encoding="utf-8"))
    if not isinstance(releases, list):
        raise ValueError("Go release metadata must be a list")
    release_version = "go" + version
    matches = [item for item in releases if isinstance(item, dict) and item.get("version") == release_version]
    if len(matches) != 1 or matches[0].get("stable") is not True:
        raise ValueError("expected exactly one stable Go release matching go.mod")
    files = matches[0].get("files")
    if not isinstance(files, list):
        raise ValueError("Go release has no archive list")
    filename = f"{release_version}.linux-{architecture}.tar.gz"
    archives = [item for item in files if isinstance(item, dict) and item.get("filename") == filename]
    if len(archives) != 1:
        raise ValueError("expected exactly one Go archive matching the version and architecture")
    archive = archives[0]
    expected = {"version": release_version, "os": "linux", "arch": architecture, "kind": "archive"}
    if any(archive.get(key) != value for key, value in expected.items()):
        raise ValueError("Go archive metadata does not match the requested toolchain")
    checksum = archive.get("sha256")
    if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise ValueError("Go archive metadata has no valid SHA-256 checksum")
    return checksum


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("usage: go_release_checksum_reader.py METADATA VERSION ARCHITECTURE")
    try:
        print(read_archive_checksum(*sys.argv[1:]))
    except (OSError, ValueError) as error:
        raise SystemExit(f"error: cannot verify Go download: {error}") from None
