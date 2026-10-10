# source_extraction.py
# Stages only authenticated source archives into a new private directory when a caller requests it.
# Connects the read-only verifier's source pins to the later executor's staging boundary.
# Copies regular files safely without executing source or trusting tar ownership and links.
"""The public verification command never calls this writing helper."""
from __future__ import annotations

import hashlib
import os
from pathlib import PurePosixPath
import shutil
import stat
import tarfile

from server_tools.release.archive_inventory import archive_members
from server_tools.release.bundle_contract import BundleError
from server_tools.update_verification.installation_evidence import no_symlinks


def descriptor_digest(stream):
    digest = hashlib.sha256()
    stream.seek(0)
    metadata = os.fstat(stream.fileno())
    remaining = metadata.st_size
    while chunk := stream.read(min(1024 * 1024, remaining + 1)):
        remaining -= len(chunk)
        if remaining < 0:
            raise BundleError("source archive grew during extraction")
        digest.update(chunk)
    if remaining != 0 or os.fstat(stream.fileno()).st_mtime_ns != metadata.st_mtime_ns:
        raise BundleError("source archive changed during extraction")
    return digest.hexdigest()


def extract_verified_sources(verdict, bundle, destination):
    """Extract pinned regular sources into an exclusive 0700 staging directory.

    The caller supplies its protected accepted verdict and owns staging throughout
    this call. Archives are hashed on the same open descriptor before and after
    copying; failures delete only the new staging directory. Source staging cannot
    rebuild or replace the separately pinned OCI image. No extractall is used.
    """
    if verdict.get("verdict") != "accepted":
        raise BundleError("only an accepted protected verdict can stage source")
    bundle, destination = no_symlinks(bundle), no_symlinks(destination)
    if bundle == destination or bundle in destination.parents or destination in bundle.parents:
        raise BundleError("source staging must be outside the bundle")
    destination.mkdir(mode=0o700)
    try:
        for pin in verdict["sources"]:
            component = pin["id"]
            if not isinstance(component, str) or "\\" in component or PurePosixPath(component).name != component or component in {".", ".."}:
                raise BundleError("invalid protected component identity")
            archive_path = no_symlinks(bundle / pin["archive"])
            if archive_path.parent != bundle:
                raise BundleError("protected source archive escapes bundle")
            descriptor = os.open(archive_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
            with os.fdopen(descriptor, "rb") as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode) or descriptor_digest(stream) != pin["archive_sha256"]:
                    raise BundleError("source archive changed before extraction")
                stream.seek(0)
                with tarfile.open(fileobj=stream, mode="r:*") as archive:
                    members = archive_members(archive)
                    if archive.pax_headers.get("comment") != pin["commit"]:
                        raise BundleError("source commit changed before extraction")
                    component_root = destination / component
                    component_root.mkdir(mode=0o700)
                    for name, member in members.items():
                        output = component_root / name
                        output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                        with archive.extractfile(member) as source, output.open("xb") as target:
                            shutil.copyfileobj(source, target)
                        output.chmod(0o755 if member.mode & 0o111 else 0o644)
                if descriptor_digest(stream) != pin["archive_sha256"]:
                    raise BundleError("source archive changed during extraction")
        return destination
    except Exception:
        shutil.rmtree(destination)
        raise
