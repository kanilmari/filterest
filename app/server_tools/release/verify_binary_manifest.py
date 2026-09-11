#!/usr/bin/env python3
"""Verify one built Filterest binary against its retained Go manifest.

Bridges `go version -m` build metadata with the generated third-party bundle.
Exists so release binaries cannot silently contain a different dependency set.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys


class BinaryManifestError(RuntimeError):
    """Describe a release binary and third-party manifest mismatch."""


REQUIRED_BUILD_TAGS = {
    "filterest": {"netgo", "osusergo"},
    "filterest-admin-recovery": set(),
}


def parse_binary_metadata(metadata: str) -> tuple[str, set[tuple[str, str]], dict[str, str]]:
    """Extract the Go version, module identities, and build settings."""

    lines = metadata.splitlines()
    if not lines or ": " not in lines[0]:
        raise BinaryManifestError("go version -m did not report a Go toolchain version")
    go_version = lines[0].rsplit(": ", maxsplit=1)[1].strip()
    dependencies: set[tuple[str, str]] = set()
    build_settings: dict[str, str] = {}
    for raw_line in lines[1:]:
        fields = raw_line.strip().split("\t")
        if not fields:
            continue
        if fields[0] == "=>":
            raise BinaryManifestError(
                "replacement module metadata requires an explicit manifest policy"
            )
        if fields[0] == "dep" and len(fields) >= 3:
            identity = (fields[1], fields[2])
            if identity in dependencies:
                raise BinaryManifestError(f"duplicate binary module metadata: {identity!r}")
            dependencies.add(identity)
        elif fields[0] == "build" and len(fields) >= 2 and "=" in fields[1]:
            key, value = fields[1].split("=", maxsplit=1)
            build_settings[key] = value
    return go_version, dependencies, build_settings


def expected_manifest_metadata(
    manifest: dict,
    binary_target: str,
) -> tuple[str, set[tuple[str, str]]]:
    """Read one binary's toolchain and exact compiled-module set from the manifest."""

    dependencies = manifest.get("dependencies")
    if not isinstance(dependencies, list):
        raise BinaryManifestError("third-party manifest dependencies are missing")
    available_binary_targets: set[str] = set()
    for item in dependencies:
        if not isinstance(item, dict) or item.get("ecosystem") not in {
            "go",
            "go-toolchain",
            "go-vendored",
        }:
            continue
        binary_targets = item.get("binary_targets")
        if (
            not isinstance(binary_targets, list)
            or not binary_targets
            or binary_targets != sorted(set(binary_targets))
            or any(not isinstance(value, str) or not value for value in binary_targets)
        ):
            raise BinaryManifestError(
                "third-party manifest contains invalid Go binary target membership"
            )
        available_binary_targets.update(binary_targets)
    if binary_target not in available_binary_targets:
        raise BinaryManifestError(
            f"third-party manifest does not define binary target {binary_target!r}"
        )
    go_modules = {
        (str(item.get("name") or ""), str(item.get("version") or ""))
        for item in dependencies
        if (
            isinstance(item, dict)
            and item.get("ecosystem") == "go"
            and binary_target in (item.get("binary_targets") or [])
        )
    }
    if any(not name or not version for name, version in go_modules):
        raise BinaryManifestError("third-party manifest contains an incomplete Go module")
    toolchains = [
        item
        for item in dependencies
        if (
            isinstance(item, dict)
            and item.get("ecosystem") == "go-toolchain"
            and binary_target in (item.get("binary_targets") or [])
        )
    ]
    if len(toolchains) != 1:
        raise BinaryManifestError("third-party manifest must contain exactly one Go toolchain")
    go_version = str(toolchains[0].get("version") or "")
    if not go_version:
        raise BinaryManifestError("third-party manifest Go toolchain version is missing")
    if not go_modules:
        raise BinaryManifestError(
            f"third-party manifest has no Go modules for binary target {binary_target!r}"
        )
    return go_version, go_modules


def verify_metadata(
    manifest: dict,
    metadata: str,
    expected_architecture: str,
    binary_target: str,
) -> None:
    """Require exact module/toolchain identity and reviewed release build settings."""

    expected_go_version, expected_modules = expected_manifest_metadata(
        manifest,
        binary_target,
    )
    actual_go_version, actual_modules, build_settings = parse_binary_metadata(metadata)
    if actual_go_version != expected_go_version:
        raise BinaryManifestError(
            f"binary Go version {actual_go_version!r} does not match manifest {expected_go_version!r}"
        )
    missing = sorted(expected_modules - actual_modules)
    unexpected = sorted(actual_modules - expected_modules)
    if missing or unexpected:
        raise BinaryManifestError(
            f"binary module set does not match manifest; missing={missing!r}; unexpected={unexpected!r}"
        )
    required_settings = {
        "CGO_ENABLED": "1",
        "GOARCH": expected_architecture,
        "GOOS": "linux",
    }
    for key, expected_value in required_settings.items():
        if build_settings.get(key) != expected_value:
            raise BinaryManifestError(
                f"binary build setting {key}={build_settings.get(key)!r}; expected {expected_value!r}"
            )
    build_tags = set(filter(None, build_settings.get("-tags", "").split(",")))
    if binary_target not in REQUIRED_BUILD_TAGS:
        raise BinaryManifestError(
            f"binary target build-tag policy is undefined: {binary_target!r}"
        )
    required_tags = REQUIRED_BUILD_TAGS[binary_target]
    if not required_tags.issubset(build_tags):
        raise BinaryManifestError(
            f"binary build tags {sorted(build_tags)!r} omit {sorted(required_tags)!r}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=pathlib.Path)
    parser.add_argument("--binary", required=True, type=pathlib.Path)
    parser.add_argument("--architecture", required=True, choices=("amd64", "arm64"))
    parser.add_argument("--binary-target", required=True)
    arguments = parser.parse_args()
    manifest = json.loads(arguments.manifest.read_text(encoding="utf-8"))
    completed = subprocess.run(
        ["go", "version", "-m", str(arguments.binary)],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise BinaryManifestError(completed.stderr.strip() or "go version -m failed")
    verify_metadata(
        manifest,
        completed.stdout,
        arguments.architecture,
        arguments.binary_target,
    )
    print(
        f"PASS: {arguments.binary.name} Go metadata matches the third-party manifest"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (BinaryManifestError, OSError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
