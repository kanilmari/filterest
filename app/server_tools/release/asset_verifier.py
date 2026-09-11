#!/usr/bin/env python3
"""Verify every local Linux release asset against one clean source commit.

Shared by candidate promotion and publication: hashes, retained legal bytes,
archive membership, binary dependencies, compiler ABI and VCS identity must all
agree. This verifier reads archives without extracting or executing their data.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile

from server_tools.public_slice_export.third_party_notice_renderer import render_notice_from_manifest
from server_tools.release.prepare_release import inspect_source, regular_path
from server_tools.release.verify_binary_manifest import parse_binary_metadata, verify_metadata


class AssetVerificationError(ValueError):
    """A distributed file does not match its reviewed source and build contract."""


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def asset_names(version):
    """The builder's seven deliverables and their seven checksum sidecars."""
    originals = ["filterest-linux-amd64", "filterest-linux-arm64"]
    originals += [f"filterest-{version}-{name}" for name in (
        "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md", "LICENSE-GPL-3.0", "THIRD_PARTY_LICENSES.tar.gz")]
    return originals, sorted(originals + [name + ".sha256" for name in originals])


def command(*arguments):
    result = subprocess.run(list(arguments), check=True, capture_output=True, text=True)
    return result.stdout


def verify_archive(root, archive):
    """Compare a license tar's exact regular-file membership and bytes to source."""
    source_dir = regular_path(root, "THIRD_PARTY_LICENSES")
    expected = {}
    directories = {"THIRD_PARTY_LICENSES"}
    for path in source_dir.rglob("*"):
        relative = path.relative_to(root).as_posix()
        regular_path(root, relative)
        if path.is_file():
            expected[relative] = path
        elif path.is_dir():
            directories.add(relative)
        else:
            raise AssetVerificationError(f"license source is not regular: {relative}")
    seen = set()
    with tarfile.open(archive, "r:gz") as bundle:
        for item in bundle:
            relative = PurePosixPath(item.name)
            if relative.is_absolute() or ".." in relative.parts or str(relative) != item.name.rstrip("/"):
                raise AssetVerificationError("license archive contains a noncanonical path")
            name = str(relative)
            if name in seen:
                raise AssetVerificationError(f"license archive duplicates a member: {name}")
            seen.add(name)
            if item.isdir() and name in directories:
                continue
            if not item.isfile() or name not in expected:
                raise AssetVerificationError(f"license archive has unexpected member: {name}")
            path = expected[name]
            if item.size != path.stat().st_size:
                raise AssetVerificationError(f"license archive size differs: {name}")
            extracted = bundle.extractfile(item)
            if extracted is None or extracted.read() != path.read_bytes():
                raise AssetVerificationError(f"license archive bytes differ: {name}")
    if seen - directories != set(expected):
        raise AssetVerificationError("license archive is missing retained source documents")


def verify_source_notices(root, version, database):
    """Require the notice text and retained documents to match their manifest."""
    manifest_path = regular_path(root, "THIRD_PARTY_LICENSES/manifest.json")
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 3:
        raise AssetVerificationError("third-party manifest must use schema version 3")
    if manifest.get("filterest_app_version") != version or manifest.get("database_version") != database:
        raise AssetVerificationError("third-party manifest versions disagree with source")
    if manifest.get("unresolved") != []:
        raise AssetVerificationError("third-party manifest contains unresolved inventory")
    rendered = render_notice_from_manifest(manifest, hashlib.sha256(manifest_bytes).hexdigest()).encode()
    if regular_path(root, "THIRD_PARTY_NOTICES.md").read_bytes() != rendered:
        raise AssetVerificationError("third-party notice text does not match its manifest")
    expected_documents = {"THIRD_PARTY_LICENSES/manifest.json"}
    for group in ("dependencies", "asset_components", "first_party_components"):
        rows = manifest.get(group)
        if not isinstance(rows, list):
            raise AssetVerificationError(f"third-party manifest lacks {group}")
        for row in rows:
            for document in row.get("documents", []):
                relative = document.get("path", "")
                if not relative.startswith("THIRD_PARTY_LICENSES/"):
                    raise AssetVerificationError("retained document escapes the license bundle")
                path = regular_path(root, relative)
                if sha256(path) != document.get("sha256"):
                    raise AssetVerificationError(f"retained document hash differs: {relative}")
                expected_documents.add(relative)
    actual_documents = {path.relative_to(root).as_posix()
        for path in regular_path(root, "THIRD_PARTY_LICENSES").rglob("*") if path.is_file()}
    if expected_documents != actual_documents:
        raise AssetVerificationError("license source documents do not match manifest membership")
    return manifest


def verify_binary(path, architecture, manifest, expected_commit):
    metadata = command("go", "version", "-m", str(path))
    verify_metadata(manifest, metadata, architecture, "filterest")
    go_version, _, settings = parse_binary_metadata(metadata)
    if settings.get("vcs") != "git" or settings.get("vcs.revision") != expected_commit or settings.get("vcs.modified") != "false":
        raise AssetVerificationError(f"{path.name}: binary VCS identity differs from clean reviewed commit")
    header = command("readelf", "-h", str(path))
    expected_machine = "Advanced Micro Devices X86-64" if architecture == "amd64" else "AArch64"
    if not re.search(r"Class:\s+ELF64\b", header) or not re.search(r"Machine:\s+" + re.escape(expected_machine) + r"\s*$", header, re.MULTILINE):
        raise AssetVerificationError(f"{path.name}: ELF architecture differs")
    dynamic = command("readelf", "-d", str(path))
    libraries = re.findall(r"Shared library: \[([^\]]+)\]", dynamic)
    allowed = {"libc.so.6", "libm.so.6"}
    if architecture == "arm64":
        allowed.add("ld-linux-aarch64.so.1")
    if "libc.so.6" not in libraries or set(libraries) - allowed:
        raise AssetVerificationError(f"{path.name}: unreviewed dynamic libraries")
    versions = command("readelf", "--version-info", str(path))
    glibc = [tuple(map(int, value.split("."))) for value in re.findall(r"GLIBC_([0-9]+\.[0-9]+)", versions)]
    if not glibc or max(glibc) > (2, 34):
        raise AssetVerificationError(f"{path.name}: supported GLIBC_2.34 boundary exceeded or absent")
    return {"go_version": go_version, "build_settings": settings, "glibc_max": ".".join(map(str, max(glibc)))}


def verify_assets(root: Path, assets_dir: Path, expected_commit: str) -> dict:
    """Verify exactly fourteen unchanged assets built from expected_commit."""
    root = root.resolve()
    if inspect_source(root, expected_commit):
        raise AssetVerificationError("asset verification requires clean reviewed source")
    assets_dir = assets_dir.resolve()
    if not assets_dir.is_dir():
        raise AssetVerificationError("asset directory does not exist")
    if assets_dir == root or root in assets_dir.parents:
        raise AssetVerificationError("asset verification directory must be outside the source checkout")
    version = regular_path(root, "app/VERSION_APP").read_text().strip()
    database = regular_path(root, "app/VERSION_DB").read_text().strip()
    originals, expected = asset_names(version)
    actual = list(assets_dir.iterdir())
    if {path.name for path in actual} != set(expected) or any(path.is_symlink() or not path.is_file() for path in actual):
        raise AssetVerificationError("asset directory must contain exactly fourteen regular release files")
    hashes = {name: sha256(assets_dir / name) for name in expected}
    for name in originals:
        checksum = (assets_dir / (name + ".sha256")).read_text()
        if checksum != hashes[name] + "  " + name + "\n":
            raise AssetVerificationError(f"invalid checksum sidecar: {name}")
    manifest = verify_source_notices(root, version, database)
    for filename, relative in {"LICENSE": "LICENSE", "NOTICE": "NOTICE", "THIRD_PARTY_NOTICES.md": "THIRD_PARTY_NOTICES.md", "LICENSE-GPL-3.0": "app/server_tools/licenses/GPL-3.0.txt"}.items():
        if (assets_dir / f"filterest-{version}-{filename}").read_bytes() != regular_path(root, relative).read_bytes():
            raise AssetVerificationError(f"distributed notice differs from source: {filename}")
    verify_archive(root, assets_dir / f"filterest-{version}-THIRD_PARTY_LICENSES.tar.gz")
    binaries = {architecture: verify_binary(assets_dir / ("filterest-linux-" + architecture), architecture, manifest, expected_commit)
                for architecture in ("amd64", "arm64")}
    if inspect_source(root, expected_commit):
        raise AssetVerificationError("source changed during asset verification")
    if hashes != {name: sha256(assets_dir / name) for name in expected}:
        raise AssetVerificationError("asset bytes changed during verification")
    return {"source_commit": expected_commit, "app_version": version,
            "database_version": database, "assets": hashes, "binaries": binaries}
