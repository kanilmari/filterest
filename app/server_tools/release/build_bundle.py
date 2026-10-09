#!/usr/bin/env python3
# build_bundle.py
# Assembles unsigned source/native/OCI bundles from a reviewed published Git commit.
# Connects explicit update requirements and prebuilt images to canonical manifest v1.
# Stops before owner signing and refuses operator data or outputs inside source.
"""Native binaries must already be built; OCI inputs are local single-image layout tars."""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import shutil
import sys

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from server_tools.release.asset_verifier import asset_names, sha256, verify_assets
from server_tools.release.bundle_contract import BundleError, MANIFEST_NAME, validate_manifest
from server_tools.release.bundle_verifier import native_platform, notice_expanded_size, portable_platform, source_archive_name, verify_unsigned_bundle
from server_tools.release.oci_archive import identity_labels, verify_oci_archive
from server_tools.release.prepare_release import inspect_source, regular_path
from server_tools.release.promote_release import validate_published_source
from server_tools.release.source_archive import bind_migrations, package_source
from server_tools.versioning.release_contract_v1 import canonical_json_line

SPEC_KEYS = {"publisher", "release_id", "created_at", "product", "minimum_trust_policy_revision",
             "composition", "database", "protocol", "platform", "health", "recovery", "capacity"}


def checksum(path):
    with path.with_name(path.name + ".sha256").open("xb") as output:
        output.write(f"{sha256(path)}  {path.name}\n".encode())


def artifact(path, kind, platform, expanded=None, oci=None):
    size = path.stat().st_size
    row = {"name": path.name, "kind": kind, "size_bytes": size,
           "expanded_size_bytes": size if expanded is None else expanded, "sha256": sha256(path), "platform": platform}
    if oci is not None:
        row["oci"] = oci
    return row


def build_unsigned_bundle(root, directory, commit, specification, oci_inputs):
    """Bind generated fields to final P; reviewed compatibility/recovery claims are explicit inputs."""
    root, directory = root.resolve(), directory.resolve()
    if directory == root or root in directory.parents:
        raise BundleError("bundle output must be outside the source tree")
    history = validate_published_source(root, commit)
    identity = history["published_identity"]
    if set(specification) != SPEC_KEYS:
        raise BundleError("bundle specification must contain exactly the reviewed requirement fields")
    manifest = deepcopy(specification)
    version = identity["app_version"]
    core = {"id": "filterest", "version": version, "commit": commit}
    if (manifest["product"] != "filterest" or manifest["composition"]["id"] != "filterest"
            or manifest["composition"]["components"] != [core]):
        raise BundleError("public builder requires the exact Filterest-only composition pin")
    if {key: manifest["database"][key] for key in ("min_version", "target_version")} != identity["database"]:
        raise BundleError("bundle database range differs from the published build identity")
    manifest.update(schema_version=1, manifest_type="filterest_release", version=version,
                    release_tag="v" + version, published_commit=commit, build_identity=identity)
    manifest["database"]["migrations"] = bind_migrations(root, commit, manifest["database"]["migrations"])
    verify_assets(root, directory, commit)
    originals, _ = asset_names(version)
    rows = []
    for name in originals:
        path = regular_path(directory, name)
        kind = "binary" if name.startswith("filterest-linux-") else "notice"
        platform = native_platform(name.rsplit("-", 1)[-1]) if kind == "binary" else portable_platform()
        rows.append(artifact(path, kind, platform, notice_expanded_size(path) if kind == "notice" else None))
    # Validate the requirement contract before creating new payload files. The
    # source placeholder supplies a nonempty inventory, not a signing document.
    placeholder = artifact(directory / originals[0], "binary", native_platform("amd64"))
    validate_manifest(canonical_json_line({**manifest, "artifacts": [placeholder]}))
    images = []
    for architecture, input_path in sorted(oci_inputs.items()):
        if architecture not in {"amd64", "arm64"}:
            raise BundleError("OCI input architecture must be amd64 or arm64")
        regular_path(input_path.parent, input_path.name)
        platform = {"os": "linux", "architecture": architecture, "cpu_features": []}
        descriptors, expanded = verify_oci_archive(input_path, platform, identity_labels(manifest))
        images.append((input_path, platform, descriptors, expanded, sha256(input_path)))
    if manifest["platform"].get("docker") and not images:
        raise BundleError("managed Docker bundle requires a prebuilt OCI archive")
    source_path = directory / source_archive_name(core)
    expanded = package_source(root, commit, source_path)
    checksum(source_path)
    rows.append(artifact(source_path, "source_archive", portable_platform(), expanded))
    for input_path, platform, descriptors, expanded, digest in images:
        destination = directory / f"filterest-{version}-oci-linux-{platform['architecture']}.tar"
        with input_path.open("rb") as source, destination.open("xb") as output:
            shutil.copyfileobj(source, output)
        if sha256(destination) != digest:
            raise BundleError("OCI input changed while copying")
        checksum(destination)
        rows.append(artifact(destination, "oci_archive", platform, expanded, descriptors))
    rows += [artifact(directory / (row["name"] + ".sha256"), "checksum", portable_platform()) for row in rows.copy()]
    manifest["artifacts"] = sorted(rows, key=lambda row: row["name"])
    data = canonical_json_line(manifest)
    validate_manifest(data)
    with (directory / MANIFEST_NAME).open("xb") as output:
        output.write(data)
    report = verify_unsigned_bundle(root, directory, commit)
    if inspect_source(root, commit):
        raise BundleError("source changed during bundle assembly")
    return {**report, "signed": False, "publication_ready": False}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--target", type=Path, default=APP_ROOT.parent)
    parser.add_argument("--published-commit", required=True)
    parser.add_argument("--assets-dir", type=Path, required=True)
    parser.add_argument("--bundle-spec", type=Path, required=True)
    parser.add_argument("--oci-archive", action="append", default=[], metavar="ARCH=PATH")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    step = "read reviewed inputs"
    succeeded = 0
    try:
        print("1/2: Read reviewed bundle requirements and local OCI inputs", file=sys.stderr)
        specification = json.loads(regular_path(args.bundle_spec.parent, args.bundle_spec.name).read_bytes())
        inputs = {}
        for value in args.oci_archive:
            architecture, separator, path = value.partition("=")
            if not separator or not path or architecture in inputs:
                raise BundleError("--oci-archive requires unique ARCH=PATH inputs")
            inputs[architecture] = Path(path).absolute()
        succeeded = 1
        step = "assemble and verify unsigned bundle"
        print("2/2: Assemble and verify unsigned bundle", file=sys.stderr)
        report = build_unsigned_bundle(args.target, args.assets_dir, args.published_commit, specification, inputs)
    except Exception as error:
        print(f"NOT completed: {succeeded}/2 steps; failed step ({step}): {error}", file=sys.stderr)
        return 1
    print("Completed: 2/2 steps; unsigned bundle verified. Owner terminal signing is still required.", file=sys.stderr)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
