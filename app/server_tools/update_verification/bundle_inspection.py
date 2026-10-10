# bundle_inspection.py
# Inspects authenticated source and OCI payloads without a publisher Git checkout.
# Connects the S1.3 archive contracts to an installation's approved migration roots.
# Pins safe source bytes and image descriptors without extraction or bundle execution.
"""Signatures bind source archives to publisher-reviewed commits; no Git/network is needed here."""
from __future__ import annotations

import base64
import json
from pathlib import PurePosixPath
import re
import stat

from server_tools.release import bundle_contract
from server_tools.release.archive_inventory import archive_members, member_bytes, member_digest, open_archive, safe_member_name
from server_tools.release.asset_verifier import asset_names, sha256
from server_tools.release.audit_source_boundary import OPERATOR_HOMES
from server_tools.release.bundle_contract import BundleError, MANIFEST_NAME, SIGNATURES_NAME
from server_tools.release.bundle_verifier import native_platform, portable_platform, source_archive_name
from server_tools.release.oci_archive import identity_labels, inspect_oci_archive
from server_tools.update_verification.installation_evidence import (
    MIGRATION, no_symlinks, protected_authentication_bridge, unique_json,
)
from server_tools.versioning.release_contract_v1 import build_identity_from_entry, validate_ledger_bytes


def inventory_hashes(directory, expected, expected_sizes=None):
    """Require exact regular inventory and hash bytes without following aliases or blocking on FIFOs."""
    if {path.name for path in directory.iterdir()} != set(expected):
        raise BundleError("bundle must equal its signed artifact inventory plus detached metadata")
    hashes, sizes = {}, {}
    for name in sorted(expected):
        path = no_symlinks(directory / name)
        if not stat.S_ISREG(path.lstat().st_mode):
            raise BundleError("bundle inventory includes a non-regular member")
        size = path.stat().st_size
        required_size = (expected_sizes or {}).get(name, size)
        if size != required_size:
            raise BundleError("bundle artifact size differs from the declared inventory")
        hashes[name], sizes[name] = sha256(path, expected_size=required_size), size
    return hashes, sizes


def inspect_source(path, row, pin, prefix, manifest):
    """Read signed Git-archive provenance and complete SQL membership at an independent prefix."""
    prefix = safe_member_name(prefix)
    if prefix.endswith("/") or prefix.split("/")[0] in {*OPERATOR_HOMES, ".git"}:
        raise BundleError("component migration prefix is not a source path")
    with open_archive(path) as archive:
        files = archive_members(archive, maximum_bytes=row["expanded_size_bytes"])
        if any(member.mode not in {0o644, 0o755} for member in files.values()):
            raise BundleError("source archive executable modes differ from regular Git files")
        if archive.pax_headers.get("comment") != pin["commit"]:
            raise BundleError("source archive commit identity differs from the signed component pin")
        if any(name.split("/")[0] in {*OPERATOR_HOMES, ".git"} for name in files):
            raise BundleError("source archive includes an operator-owned or Git metadata path")
        expanded = max(path.stat().st_size, sum(member.size for member in files.values()))
        if expanded != row["expanded_size_bytes"]:
            raise BundleError("source archive expanded size differs from the signed inventory")
        if pin["id"] == "filterest":
            required = {"app/BUILD_IDENTITY.json", "app/VERSION_APP", "app/VERSION_DB", "app/server_tools/versioning/release_ledger.v1.jsonl"}
            if not required <= files.keys():
                raise BundleError("Filterest source lacks its build/version/ledger identity")
            identity = json.loads(member_bytes(archive, files["app/BUILD_IDENTITY.json"]), object_pairs_hook=unique_json)
            ledger = validate_ledger_bytes(member_bytes(archive, files["app/server_tools/versioning/release_ledger.v1.jsonl"]))
            if identity != manifest["build_identity"] or identity != build_identity_from_entry(ledger[-1]):
                raise BundleError("archived source build identity or release ledger differs from the manifest")
            if (member_bytes(archive, files["app/VERSION_APP"]) != (manifest["version"] + "\n").encode()
                    or member_bytes(archive, files["app/VERSION_DB"]) != (manifest["database"]["target_version"] + "\n").encode()):
                raise BundleError("archived source version markers differ from the signed target")
        migrations = {}
        # Match the runner's nonrecursive *.sql discovery; helpers elsewhere are
        # not eligible migrations, while every direct SQL file must be accounted for.
        for name, member in files.items():
            if str(PurePosixPath(name).parent) != prefix or not name.endswith(".sql"):
                continue
            identifier = PurePosixPath(name).name
            if not MIGRATION.fullmatch(identifier):
                raise BundleError("source has an unsupported migration filename")
            migrations[identifier] = {"component": pin["id"], "content_sha256": member_digest(archive, member)}
            if any(item["id"] == identifier and item["component"] == pin["id"] for item in manifest["database"]["migrations"]):
                migrations[identifier]["data"] = member_bytes(archive, member)
        parents = {str(parent) for name in files for parent in PurePosixPath(name).parents if str(parent) != "."}
        return migrations, len(files) + len(parents)


def inspect_migration_inventory(manifest, sources, bridge):
    """Delegate transaction/error directives to the real runner, then bind version marker claims."""
    bridge = protected_authentication_bridge(bridge, (bundle_contract.APP_ROOT.parent,))
    declared = manifest["database"]["migrations"]
    encoded = {}
    for row in declared:
        actual = sources.get(row["id"])
        if actual is None or actual["component"] != row["component"] or actual["content_sha256"] != row["content_sha256"]:
            raise BundleError("migration inventory differs from archived source bytes or component")
        data = actual["data"]
        versions = re.findall(rb"(?m)^-- VERSION_DB: ([0-9]+\.[0-9]+\.[0-9]+)\s*$", data)
        if versions != [row["database_version"].encode()]:
            raise BundleError("migration database version differs from its archived marker")
        if row["publishes_database_version"] and re.search(rb"(?m)^-- VERSION_DB_OWNER: \S+\s*$", data):
            raise BundleError("database version publisher cannot delegate ownership")
        encoded[row["id"]] = base64.b64encode(data).decode("ascii")
    data = json.dumps(encoded).encode()
    if len(data) > 64 << 20:
        raise BundleError("migration policy inspection exceeds bridge input limit")
    policies = bundle_contract.contract_command(["inspect-migrations"], data, bridge=bridge)
    for row in declared:
        if policies.get(row["id"]) != {key: row[key] for key in ("content_sha256", "error_policy", "transaction_policy")}:
            raise BundleError("migration execution policies differ from the real runner's classification")


def inspect_bundle(directory, manifest, baseline, facts, *, bridge):
    """Check all delivered bytes; select exactly one signed image matching this host."""
    bridge = protected_authentication_bridge(bridge, (bundle_contract.APP_ROOT.parent, directory))
    artifacts = {row["name"]: row for row in manifest["artifacts"]}
    expected = set(artifacts) | {MANIFEST_NAME, SIGNATURES_NAME}
    hashes, sizes = inventory_hashes(directory, expected, {name: row["size_bytes"] for name, row in artifacts.items()})
    for name, row in artifacts.items():
        if hashes[name] != row["sha256"] or sizes[name] != row["size_bytes"]:
            raise BundleError("bundle artifact hash or size differs: " + name)
    _, native_names = asset_names(manifest["version"])
    if not set(native_names) <= artifacts.keys():
        raise BundleError("bundle is missing a native or notice deliverable")
    allowed = set(native_names)
    for name in native_names:
        row = artifacts[name]
        kind = "checksum" if name.endswith(".sha256") else "binary" if name.startswith("filterest-linux-") else "notice"
        required_platform = native_platform(name.rsplit("-", 1)[-1]) if kind == "binary" else portable_platform()
        if row["kind"] != kind or row["platform"] != required_platform:
            raise BundleError("native/notice deliverable kind or platform differs")
    components = manifest["composition"]["components"]
    if set(baseline["migration_prefixes"]) != {pin["id"] for pin in components}:
        raise BundleError("every component needs an independent migration prefix")
    if baseline["migration_prefixes"].get("filterest") != "app/server_tools/migrations":
        raise BundleError("Filterest must use its canonical migration source")
    sources, source_inodes, source_report = {}, 0, []
    for pin in components:
        name = source_archive_name(pin)
        row = artifacts.get(name)
        if row is None or row["kind"] != "source_archive" or row["platform"] != portable_platform():
            raise BundleError("component source archive is missing or has a wrong platform")
        migrations, inodes = inspect_source(directory / name, row, pin, baseline["migration_prefixes"][pin["id"]], manifest)
        if set(sources) & migrations.keys():
            raise BundleError("component sources collide on a migration filename")
        sources.update(migrations)
        source_inodes += inodes
        source_report.append({**pin, "archive": name, "archive_sha256": hashes[name]})
        allowed.update((name, name + ".sha256"))
    inspect_migration_inventory(manifest, sources, bridge)
    selected, image_platforms = [], set()
    for name, row in artifacts.items():
        if row["kind"] == "oci_archive":
            target = row["platform"]
            architecture = target["architecture"]
            if architecture in image_platforms or name != f"{manifest['composition']['id']}-{manifest['version']}-oci-linux-{architecture}.tar":
                raise BundleError("OCI inventory has duplicate platforms or unexpected filenames")
            image_platforms.add(architecture)
            descriptors, expanded, image_inodes = inspect_oci_archive(directory / name, target,
                identity_labels(manifest), maximum_expanded=row["expanded_size_bytes"])
            if descriptors != row["oci"] or expanded != row["expanded_size_bytes"]:
                raise BundleError("OCI identity or expanded size differs from its signed descriptors")
            allowed.update((name, name + ".sha256"))
            if target["os"] == facts["os"] and architecture == facts["architecture"] and set(target["cpu_features"]) <= set(facts["cpu_features"]):
                selected.append({**descriptors, "archive": name, "archive_sha256": hashes[name],
                                 "expanded_bytes": expanded, "inodes": image_inodes})
        elif row["kind"] == "notice" and name.endswith(".tar.gz"):
            with open_archive(directory / name) as archive:
                members = archive_members(archive, maximum_bytes=row["expanded_size_bytes"])
                expanded = max(sizes[name], sum(member.size for member in members.values()))
            if expanded != row["expanded_size_bytes"]:
                raise BundleError("notice archive expanded size differs")
        elif row["kind"] in {"binary", "checksum", "notice"} and row["expanded_size_bytes"] != sizes[name]:
            raise BundleError("nonarchive expanded size differs")
    if set(artifacts) != allowed or len(selected) != 1:
        raise BundleError("bundle has unknown/missing deliverables or no exact host OCI platform")
    for name in allowed:
        if name.endswith(".sha256"):
            row, base = artifacts[name], name[:-7]
            if (row["kind"] != "checksum" or row["platform"] != portable_platform()
                    or (directory / name).read_bytes() != f"{hashes[base]}  {base}\n".encode()):
                raise BundleError("checksum sidecar differs from the authenticated inventory")
    return {"hashes": hashes, "sizes": sizes, "migrations": sources, "sources": source_report,
            "image": selected[0], "source_inodes": source_inodes,
            "expanded_bytes": sum(row["expanded_size_bytes"] for row in artifacts.values()),
            "image_expanded_bytes": selected[0]["expanded_bytes"], "image_inodes": selected[0]["inodes"]}
