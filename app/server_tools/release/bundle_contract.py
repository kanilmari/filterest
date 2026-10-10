# bundle_contract.py
# Shares canonical manifest validation and independent public trust with release tools.
# Bridges Python packaging/publication to the existing authoritative Go verifier.
# Keeps private signing material and bundle-supplied trust out of automated builds.
"""The release manifest v1 is owned by release_updates, not a second Python parser."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import stat

from server_tools.release.prepare_release import regular_path

APP_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_NAME = "release_manifest.v1.json"
SIGNATURES_NAME = "release_signatures.v1.json"


class BundleError(ValueError):
    """A payload or its authenticated contract cannot be used as a release."""


def contract_command(arguments, data=None, *, bridge=None):
    """Use a prebuilt bridge or the release tooling's local build-capable Go fallback.

    Installation update verification independently requires a protected prebuilt
    bridge before calling this shared release helper; it never selects go run.
    """
    command = [str(bridge)] if bridge is not None else ["go", "run", "./server_tools/release/manifest_verification"]
    result = subprocess.run(
        [*command, *arguments],
        cwd=APP_ROOT, input=data, capture_output=True, timeout=300,
        env={**os.environ, "GOWORK": "off", "GOTOOLCHAIN": "local", "GOPROXY": "off",
             "GOSUMDB": "off", "GOFLAGS": "-mod=readonly"},
    )
    if result.returncode:
        raise BundleError(result.stderr.decode("utf-8", errors="replace").strip())
    return json.loads(result.stdout)


def validate_manifest(data):
    """Validate canonical bytes without representing them as authenticated output."""
    contract_command(["validate"], data)
    return json.loads(data)


def independent_policy_path(path, roots):
    """Refuse source/bundle policies and symlink ancestors before the Go ownership check."""
    if path is None:
        raise BundleError("independently provisioned --trust-policy is required")
    path = Path(path).absolute()
    for parent in (path, *path.parents):
        if parent.is_symlink():
            raise BundleError("trust policy path must not contain a symlink")
    path = path.resolve()
    if any(path == root.resolve() or root.resolve() in path.parents for root in roots):
        raise BundleError("trust policy must be outside source and bundle directories")
    if not path.is_file():
        raise BundleError("independent trust policy is missing or not a regular file")
    return path


def bounded_input_bytes(path, maximum):
    """Reread the same bounded regular-input contract as Go without following a replaced symlink/FIFO."""
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    with os.fdopen(descriptor, "rb") as stream:
        metadata = os.fstat(stream.fileno())
        if not stat.S_ISREG(metadata.st_mode) or not 0 < metadata.st_size <= maximum:
            raise BundleError("release input is not a regular bounded file")
        data = stream.read(maximum + 1)
        if len(data) != metadata.st_size:
            raise BundleError("release input changed during rereading")
        return data


def authenticate_manifest(root, directory, policy, revision, composition="filterest", *, bridge=None):
    """Authenticate before interpreting instructions; trust and floor are caller inputs."""
    policy = independent_policy_path(policy, (root, directory))
    if type(revision) is not int or revision <= 0:
        raise BundleError("positive independent trust-policy revision floor is required")
    manifest = regular_path(directory, MANIFEST_NAME)
    signatures = regular_path(directory, SIGNATURES_NAME)
    arguments = [
        "verify", "--manifest", str(manifest), "--signatures", str(signatures),
        "--trust-policy", str(policy), "--composition", composition,
        "--minimum-trust-policy-revision", str(revision),
    ]
    report = contract_command(arguments) if bridge is None else contract_command(arguments, bridge=bridge)
    data = bounded_input_bytes(manifest, 4 << 20)
    # Bind the Python interpretation to exactly the bytes authenticated by Go.
    if hashlib.sha256(data).hexdigest() != report["manifest_sha256"]:
        raise BundleError("manifest changed during signature verification")
    if "signatures_sha256" in report and hashlib.sha256(bounded_input_bytes(signatures, 64 << 10)).hexdigest() != report["signatures_sha256"]:
        raise BundleError("signature envelope changed during authentication")
    return json.loads(data), report
