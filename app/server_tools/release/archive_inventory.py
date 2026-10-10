# archive_inventory.py
# Inspects release tar members without extraction or execution.
# Connects source and OCI packaging to one conservative archive path contract.
# Refuses aliases, links, devices, duplicate members and unbounded metadata reads.
"""Release layout archives contain regular files and their parent directories only."""
from __future__ import annotations

import hashlib
from contextlib import contextmanager
import os
from pathlib import PurePosixPath
import tarfile
import stat

from server_tools.release.bundle_contract import BundleError


def safe_member_name(name):
    """Require a canonical relative POSIX path before any archive member is read."""
    relative = PurePosixPath(name)
    if (not name or relative.is_absolute() or ".." in relative.parts or "\\" in name
            or any(ord(character) < 32 or ord(character) == 127 for character in name)
            or str(relative) != name.rstrip("/")):
        raise BundleError("archive contains an unsafe or noncanonical member path")
    return str(relative)


def archive_members(archive, *, maximum_bytes=None, maximum_members=200000):
    """Index safe regular members and exact parents, retaining the open tar descriptor."""
    files, directories, seen = {}, set(), set()
    total_bytes = 0
    for member in archive:
        total_bytes += member.size
        if len(seen) >= maximum_members or (maximum_bytes is not None and total_bytes > maximum_bytes):
            raise BundleError("archive inventory exceeds its declared expansion or member limit")
        name = safe_member_name(member.name)
        if name in seen:
            raise BundleError("archive duplicates a member: " + name)
        seen.add(name)
        if member.mode & ~0o777 or member.pax_headers.keys() - {"path", "size", "mtime", "comment"}:
            raise BundleError("archive contains privileged modes or unsupported metadata")
        if member.isdir():
            directories.add(name)
        elif member.isfile() and not member.sparse and member.size >= 0:
            files[name] = member
        else:
            raise BundleError("archive contains a link, device or unsupported member: " + name)
    parents = {str(parent) for name in files for parent in PurePosixPath(name).parents if str(parent) != "."}
    if directories - parents or set(files) & parents:
        raise BundleError("archive has unexpected directories or a file used as a parent")
    return files


def member_bytes(archive, member, maximum=4 << 20):
    """Read bounded JSON/SQL metadata; large payloads use streaming digests instead."""
    if member.size > maximum:
        raise BundleError("archive metadata exceeds its size limit")
    with archive.extractfile(member) as stream:
        data = stream.read(maximum + 1)
    if len(data) != member.size:
        raise BundleError("archive member is truncated")
    return data


def member_digest(archive, member, algorithm="sha256", prefix=b""):
    digest = hashlib.new(algorithm)
    digest.update(prefix)
    with archive.extractfile(member) as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@contextmanager
def open_archive(path, mode="r:*"):
    """Normalize malformed/truncated tar failures to the release refusal boundary."""
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
        with os.fdopen(descriptor, "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise BundleError("release archive must be a regular file")
            with tarfile.open(fileobj=stream, mode=mode) as archive:
                yield archive
    except (tarfile.TarError, EOFError, OSError) as error:
        raise BundleError("cannot read release archive") from error
