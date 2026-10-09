# source_archive.py
# Packages and compares only the reviewed Git tree, including executable modes.
# Connects published/component commits and migration byte evidence to source payloads.
# Excludes operator homes and refuses incomplete archives, links and submodules.
"""Worktree files, untracked files and ignored installation state are never source inputs."""
from __future__ import annotations

import gzip
import hashlib
from pathlib import Path
import re
import shutil
import subprocess

from server_tools.release.archive_inventory import archive_members, member_digest, open_archive, safe_member_name
from server_tools.release.audit_source_boundary import OPERATOR_HOMES
from server_tools.release.bundle_contract import BundleError

COMMIT = re.compile(r"[0-9a-f]{40}\Z")


def git_bytes(root, *arguments):
    return subprocess.run(["git", "-C", str(root), *arguments], check=True,
                          capture_output=True, timeout=300).stdout


def reviewed_tree(root, commit):
    """Inspect immutable tree modes/blobs; do not apply worktree export/filter settings."""
    if not COMMIT.fullmatch(commit) or git_bytes(root, "rev-parse", commit + "^{commit}").decode().strip() != commit:
        raise BundleError("source packaging requires an exact full Git commit")
    files = {}
    for entry in git_bytes(root, "ls-tree", "-r", "-z", "--full-tree", commit).split(b"\0"):
        if not entry:
            continue
        metadata, path = entry.split(b"\t", 1)
        mode, kind, object_id = metadata.decode().split()
        name = safe_member_name(path.decode("utf-8"))
        if name.split("/")[0] in {*OPERATOR_HOMES, ".git"}:
            raise BundleError("reviewed source tracks an operator-owned or Git metadata path")
        if kind != "blob" or mode not in {"100644", "100755"}:
            raise BundleError("source bundles require regular Git files; links/submodules are unsupported")
        files[name] = (mode, object_id)
    if not files:
        raise BundleError("reviewed source tree is empty")
    return files


def verify_source_archive(root, commit, path, migrations=(), component="filterest", migration_prefix="app/server_tools/migrations"):
    """Prove complete Git blob membership, modes and declared migration byte hashes."""
    expected = reviewed_tree(root, commit)
    with open_archive(path) as archive:
        actual = archive_members(archive)
        if set(actual) != set(expected):
            raise BundleError("source archive is missing or adds reviewed Git members")
        for name, member in actual.items():
            mode, object_id = expected[name]
            prefix = f"blob {member.size}\0".encode()
            if member.mode != int(mode[-3:], 8) or member_digest(archive, member, "sha1", prefix) != object_id:
                raise BundleError("source archive bytes or executable mode differ from reviewed Git tree: " + name)
        for migration in migrations:
            if migration["component"] != component:
                continue
            name = migration_prefix + "/" + migration["id"]
            if name not in actual or member_digest(archive, actual[name]) != migration["content_sha256"]:
                raise BundleError("migration inventory differs from archived source: " + migration["id"])
        expanded = max(path.stat().st_size, sum(member.size for member in actual.values()))
    return expanded


def package_source(root, commit, path):
    """Create a deterministic Git archive outside source, then prove its exact tree."""
    if root.resolve() == path.resolve() or root.resolve() in path.resolve().parents:
        raise BundleError("source archive output must be outside the source tree")
    reviewed_tree(root, commit)
    # git archive reads the commit's attributes, never --worktree-attributes. Its
    # export-ignore/export-subst effects are refused by the exact blob check.
    with path.open("xb") as destination:
        with gzip.GzipFile(filename="", fileobj=destination, mode="wb", mtime=0) as compressed:
            process = subprocess.Popen(["git", "-C", str(root), "-c", "tar.umask=022", "archive", "--format=tar", commit],
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                shutil.copyfileobj(process.stdout, compressed)
                process.stdout.close()
                error = process.stderr.read()
                if process.wait(timeout=300):
                    raise BundleError("Git source archive failed: " + error.decode(errors="replace"))
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                process.stderr.close()
    return verify_source_archive(root, commit, path)


def bind_migrations(root, commit, rows, component="filterest", migration_prefix="app/server_tools/migrations"):
    """Hash selected reviewed route files; eligibility/policies remain explicit reviewed claims."""
    files = reviewed_tree(root, commit)
    bound = []
    for row in rows:
        row = dict(row)
        if row["component"] == component:
            name = migration_prefix + "/" + row["id"]
            if name not in files:
                raise BundleError("migration inventory references a missing Git member")
            data = git_bytes(root, "show", commit + ":" + name)
            digest = hashlib.sha256(data).hexdigest()
            if row.get("content_sha256", digest) != digest:
                raise BundleError("supplied migration hash differs from reviewed source")
            row["content_sha256"] = digest
            declared = re.findall(rb"(?m)^-- VERSION_DB: ([0-9]+\.[0-9]+\.[0-9]+)\s*$", data)
            if declared != [row["database_version"].encode()]:
                raise BundleError("migration database version must match its reviewed VERSION_DB marker")
            optional = data.startswith(b"-- skip-on-error")
            if row["error_policy"] != ("optional" if optional else "required"):
                raise BundleError("migration error policy differs from its runner directive")
            owner = re.findall(rb"(?m)^-- VERSION_DB_OWNER: (\S+)\s*$", data)
            if row["publishes_database_version"] and owner:
                raise BundleError("database version publisher cannot delegate ownership")
        bound.append(row)
    return bound
