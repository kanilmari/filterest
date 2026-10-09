# bundle_verifier.py
# Verifies complete source/native/OCI payloads against one canonical release manifest.
# Connects independent signature trust, reviewed Git history and exact file inventory.
# Rejects altered archives/images before publication can mutate remote state.
"""Payload inspection is read-only and never extracts or loads release archives."""
from __future__ import annotations

from pathlib import Path

from server_tools.release.archive_inventory import archive_members, open_archive
from server_tools.release.asset_verifier import asset_names, sha256, verify_assets
from server_tools.release.bundle_contract import BundleError, MANIFEST_NAME, SIGNATURES_NAME, authenticate_manifest, validate_manifest
from server_tools.release.oci_archive import identity_labels, verify_oci_archive
from server_tools.release.prepare_release import regular_path
from server_tools.release.promote_release import read_identity
from server_tools.release.source_archive import bind_migrations, verify_source_archive


def source_archive_name(component):
    return f"{component['id']}-{component['version']}-source.tar.gz"


def native_platform(architecture):
    return {"os": "linux", "architecture": architecture, "cpu_features": [],
            "libc": {"family": "glibc", "min_version": "2.34.0"}}


def portable_platform():
    return {"os": "any", "architecture": "any", "cpu_features": []}


def notice_expanded_size(path):
    if path.name.endswith(".tar.gz"):
        with open_archive(path) as archive:
            return max(path.stat().st_size, sum(item.size for item in archive_members(archive).values()))
    return path.stat().st_size


def verify_bundle_payload(root, directory, commit, manifest, *, signed, component_sources=None):
    """Bind source origins supplied by the caller; archive/manifest paths cannot select trust."""
    directory = Path(directory).resolve()
    root = Path(root).resolve()
    components = {pin["id"]: pin for pin in manifest["composition"]["components"]}
    composition = manifest["composition"]["id"]
    if manifest["published_commit"] != commit or components[composition]["commit"] != commit:
        raise BundleError("manifest published commit differs from the reviewed release")
    component_sources = component_sources or {"filterest": (root, "app/server_tools/migrations")}
    if set(component_sources) != set(components):
        raise BundleError("every composition component needs an independent reviewed source root")
    core_root = Path(component_sources["filterest"][0]).resolve()
    identity, _ = read_identity(core_root, components["filterest"]["commit"])
    if manifest["build_identity"] != identity or identity["maturity"] != "published":
        raise BundleError("manifest build identity differs from the published Git ledger")
    artifacts = {item["name"]: item for item in manifest["artifacts"]}
    metadata = {MANIFEST_NAME, SIGNATURES_NAME} if signed else {MANIFEST_NAME}
    expected = set(artifacts) | metadata
    actual = list(directory.iterdir())
    if {path.name for path in actual} != expected or any(path.is_symlink() or not path.is_file() for path in actual):
        raise BundleError("bundle must contain exactly its manifest inventory and detached metadata")
    hashes = {name: sha256(regular_path(directory, name)) for name in expected}
    for name, artifact in artifacts.items():
        if (hashes[name] != artifact["sha256"]
                or (directory / name).stat().st_size != artifact["size_bytes"]):
            raise BundleError("bundle artifact hash or size differs: " + name)
    _, native_names = asset_names(manifest["version"])
    if not set(native_names) <= set(artifacts):
        raise BundleError("bundle must retain every native binary and notice deliverable")
    for name in native_names:
        row = artifacts[name]
        kind = "checksum" if name.endswith(".sha256") else "binary" if name.startswith("filterest-linux-") else "notice"
        platform = native_platform(name.rsplit("-", 1)[-1]) if kind == "binary" else portable_platform()
        if row["kind"] != kind or row["platform"] != platform:
            raise BundleError("native deliverable kind or platform differs: " + name)
    native = verify_assets(core_root, directory, components["filterest"]["commit"], extra_names=expected - set(native_names))
    allowed = set(native_names)
    for component, pin in components.items():
        name = source_archive_name(pin)
        if name not in artifacts or artifacts[name]["kind"] != "source_archive":
            raise BundleError("bundle is missing a component source archive")
        component_root, prefix = component_sources[component]
        expanded = verify_source_archive(Path(component_root), pin["commit"], directory / name,
            manifest["database"]["migrations"], component, prefix)
        # Recheck source version/directive claims too, not only supplied hashes.
        bind_migrations(Path(component_root), pin["commit"], manifest["database"]["migrations"], component, prefix)
        if artifacts[name]["expanded_size_bytes"] != expanded:
            raise BundleError("source archive expanded size differs")
        allowed.update((name, name + ".sha256"))
    images = set()
    for name, row in artifacts.items():
        if row["kind"] == "oci_archive":
            architecture = row["platform"]["architecture"]
            if architecture in images or name != f"{composition}-{manifest['version']}-oci-linux-{architecture}.tar":
                raise BundleError("OCI image inventory has a duplicate platform or unexpected filename")
            images.add(architecture)
            descriptors, expanded = verify_oci_archive(directory / name, row["platform"], identity_labels(manifest))
            if descriptors != row["oci"] or expanded != row["expanded_size_bytes"]:
                raise BundleError("OCI image descriptors or expanded size differ from manifest")
            allowed.update((name, name + ".sha256"))
        elif row["kind"] in {"notice", "checksum", "binary"}:
            expanded = notice_expanded_size(directory / name) if row["kind"] == "notice" else row["size_bytes"]
            if row["expanded_size_bytes"] != expanded:
                raise BundleError("artifact expanded size differs: " + name)
    if manifest["platform"].get("docker") and not images:
        raise BundleError("managed Docker bundle is missing its exact OCI image")
    if set(artifacts) != allowed:
        raise BundleError("bundle includes unknown or missing deliverables")
    for name in allowed:
        if name.endswith(".sha256"):
            base = name[:-7]
            row = artifacts[name]
            if (row["kind"] != "checksum" or row["platform"] != portable_platform()
                    or (directory / name).read_bytes() != f"{hashes[base]}  {base}\n".encode()):
                raise BundleError("bundle checksum sidecar differs: " + name)
    routes = {item for start in manifest["database"]["supported_starts"] for item in start["migration_ids"]}
    if routes != {row["id"] for row in manifest["database"]["migrations"]}:
        raise BundleError("migration inventory must equal the union of the reviewed routes")
    if hashes != {name: sha256(regular_path(directory, name)) for name in expected}:
        raise BundleError("bundle bytes changed during verification")
    return {**native, "assets": hashes, "sizes": {name: (directory / name).stat().st_size for name in expected},
            "manifest_sha256": hashes[MANIFEST_NAME], "composition": manifest["composition"],
            "published_commit": commit, "build_source_commit": identity["source"]["commit"]}


def verify_signed_bundle(root, directory, commit, policy, revision, composition="filterest", *, component_sources=None):
    """Require independent authentication before inspecting the manifest's payload instructions."""
    manifest, trust = authenticate_manifest(root, directory, policy, revision, composition)
    report = verify_bundle_payload(root, directory, commit, manifest, signed=True, component_sources=component_sources)
    if report["manifest_sha256"] != trust["manifest_sha256"]:
        raise BundleError("authenticated manifest changed during payload verification")
    return {**report, "signature_verification": trust}


def verify_unsigned_bundle(root, directory, commit):
    data = regular_path(directory, MANIFEST_NAME).read_bytes()
    manifest = validate_manifest(data)
    return verify_bundle_payload(root, directory, commit, manifest, signed=False)
