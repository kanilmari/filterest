# oci_archive.py
# Validates a single-image OCI layout, content descriptors and exact release identity.
# Connects prebuilt offline image archives to signed manifest/config and platform pins.
# Refuses image substitution, foreign blobs and ambiguous indexes without Docker access.
"""This tool reads image data; it never builds, pulls, loads or executes an image."""
from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import PurePosixPath
import re
import tarfile

from server_tools.release.archive_inventory import archive_members, member_bytes, member_digest, open_archive
from server_tools.release.bundle_contract import BundleError

MANIFEST_TYPE = "application/vnd.oci.image.manifest.v1+json"
CONFIG_TYPE = "application/vnd.oci.image.config.v1+json"
LAYER_TYPES = {"application/vnd.oci.image.layer.v1.tar", "application/vnd.oci.image.layer.v1.tar+gzip"}
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise BundleError("OCI metadata duplicates a JSON key")
        result[key] = value
    return result


def json_member(archive, member):
    try:
        return json.loads(member_bytes(archive, member), object_pairs_hook=unique_object)
    except (ValueError, UnicodeError) as error:
        raise BundleError("OCI metadata is not unambiguous JSON") from error


def verify_oci_archive(path, platform, labels, *, maximum_expanded=None):
    """Verify every referenced blob and layer diff ID, plus caller-selected identity labels."""
    descriptors, expanded, _ = inspect_oci_archive(path, platform, labels,
        maximum_expanded=maximum_expanded, count_inodes=False)
    return descriptors, expanded


class LayerReader:
    """Hash and bound decoded reads used by both tar inspection and trailing-byte checks."""
    def __init__(self, stream, maximum_bytes):
        self.stream, self.maximum_bytes = stream, maximum_bytes
        self.bytes_read, self.digest = 0, hashlib.sha256()

    def read(self, size=1024 * 1024):
        data = self.stream.read(min(size, 1024 * 1024) if size >= 0 else 1024 * 1024)
        self.bytes_read += len(data)
        if self.maximum_bytes is not None and self.bytes_read > self.maximum_bytes:
            raise BundleError("OCI layers exceed the declared expansion limit")
        self.digest.update(data)
        return data


def layer_inode_floor(stream):
    """Count every entry (including whiteouts/links) and all of its parent directories.

    Repeat the directory allowance for every entry and the root for every layer:
    neither overlay merging nor hardlink/path deduplication may reduce this floor.
    No layer member is extracted or executed.
    """
    inodes = 1
    try:
        with tarfile.open(fileobj=stream, mode="r|") as archive:
            while (member := archive.next()) is not None:
                inodes += max(1, len(PurePosixPath(member.name).parts))
                # Streaming inspection needs no retained member index.
                archive.members.clear()
    except tarfile.TarError as error:
        raise BundleError("OCI layer tar is malformed") from error
    return inodes


def inspect_oci_archive(path, platform, labels, *, maximum_expanded=None, count_inodes=True):
    """Reuse OCI authentication with optional layer inode accounting for host preflight.

    The release build/verification wrapper retains its digest-only behavior and
    two-value result. Installation verification also inspects each layer's tar.
    """
    with open_archive(path, "r:") as archive:
        files = archive_members(archive, maximum_bytes=maximum_expanded)
        if not {"oci-layout", "index.json"} <= files.keys():
            raise BundleError("OCI archive is missing layout/index members")
        if json_member(archive, files["oci-layout"]) != {"imageLayoutVersion": "1.0.0"}:
            raise BundleError("unsupported OCI layout version")
        index = json_member(archive, files["index.json"])
        if (not isinstance(index, dict) or index.get("schemaVersion") != 2
                or index.get("mediaType", "application/vnd.oci.image.index.v1+json") != "application/vnd.oci.image.index.v1+json"
                or not isinstance(index.get("manifests"), list) or len(index["manifests"]) != 1):
            raise BundleError("OCI archive must contain exactly one image manifest")
        referenced = {"oci-layout", "index.json"}

        def descriptor(row, media_types):
            if (not isinstance(row, dict) or row.get("mediaType") not in media_types
                    or not isinstance(row.get("digest"), str) or not DIGEST.fullmatch(row["digest"])
                    or type(row.get("size")) is not int or row["size"] <= 0 or "urls" in row):
                raise BundleError("OCI descriptor has an unsupported type, digest, size or remote reference")
            name = "blobs/sha256/" + row["digest"][7:]
            if name not in files or files[name].size != row["size"] or member_digest(archive, files[name]) != row["digest"][7:]:
                raise BundleError("OCI descriptor bytes or size differ; missing/substituted image blob")
            referenced.add(name)
            return files[name]

        image = index["manifests"][0]
        manifest_member = descriptor(image, {MANIFEST_TYPE})
        selected = image.get("platform")
        if (not isinstance(selected, dict) or selected.get("os") != platform["os"]
                or selected.get("architecture") != platform["architecture"]
                or selected.get("variant", "v8" if platform["architecture"] == "arm64" else "") != ("v8" if platform["architecture"] == "arm64" else "")
                or set(selected) - {"os", "architecture", "variant"}):
            raise BundleError("OCI descriptor platform differs from the requested baseline platform")
        if platform.get("cpu_features") or "libc" in platform:
            raise BundleError("OCI targets must use baseline CPU features and no host libc claim")
        manifest = json_member(archive, manifest_member)
        if (not isinstance(manifest, dict) or manifest.get("schemaVersion") != 2
                or manifest.get("mediaType") != MANIFEST_TYPE or "subject" in manifest or "artifactType" in manifest
                or not isinstance(manifest.get("layers"), list) or not manifest["layers"]):
            raise BundleError("unsupported OCI image manifest")
        config_member = descriptor(manifest.get("config"), {CONFIG_TYPE})
        config = json_member(archive, config_member)
        if (not isinstance(config, dict) or config.get("os") != platform["os"]
                or config.get("architecture") != platform["architecture"]
                or config.get("variant", selected.get("variant")) != selected.get("variant")):
            raise BundleError("OCI config platform differs from its descriptor")
        actual_labels = config.get("config", {}).get("Labels", {})
        if not isinstance(actual_labels, dict) or any(actual_labels.get(key) != value for key, value in labels.items()):
            raise BundleError("OCI image release/composition/build identity labels differ")
        rootfs = config.get("rootfs", {})
        if (not isinstance(rootfs, dict) or rootfs.get("type") != "layers"
                or not isinstance(rootfs.get("diff_ids"), list) or len(rootfs["diff_ids"]) != len(manifest["layers"])):
            raise BundleError("OCI config must bind every uncompressed layer")
        expanded_layers = 0
        stored_bytes = sum(member.size for member in files.values())
        parents = {str(parent) for name in files for parent in PurePosixPath(name).parents if str(parent) != "."}
        inodes = len(files) + len(parents) if count_inodes else 0
        for layer, diff_id in zip(manifest["layers"], rootfs["diff_ids"]):
            member = descriptor(layer, LAYER_TYPES)
            with archive.extractfile(member) as stream:
                decoded = gzip.GzipFile(fileobj=stream) if layer["mediaType"].endswith("+gzip") else stream
                remaining = None if maximum_expanded is None else maximum_expanded - stored_bytes - expanded_layers
                reader = LayerReader(decoded, remaining)
                try:
                    if count_inodes:
                        inodes += layer_inode_floor(reader)
                    # Tar stops at its end marker; digest/limit checks include
                    # all remaining padding and the gzip trailer too.
                    for _ in iter(lambda: reader.read(1024 * 1024), b""):
                        pass
                    expanded_layers += reader.bytes_read
                except (OSError, EOFError) as error:
                    raise BundleError("OCI compressed layer is malformed") from error
                finally:
                    if decoded is not stream:
                        decoded.close()
            if diff_id != "sha256:" + reader.digest.hexdigest():
                raise BundleError("OCI layer differs from the config diff ID")
        if set(files) != referenced:
            raise BundleError("OCI archive has unreferenced or unexpected members")
        return {"manifest_digest": image["digest"], "config_digest": manifest["config"]["digest"]}, max(
            path.stat().st_size, stored_bytes + expanded_layers), inodes


def identity_labels(manifest):
    """Labels bind the actual composition, independent of hosting/domain ownership."""
    from server_tools.versioning.release_contract_v1 import canonical_json_line
    labels = {
        "org.opencontainers.image.revision": manifest["published_commit"],
        "org.opencontainers.image.version": manifest["version"],
        "com.filterest.build-identity-sha256": hashlib.sha256(canonical_json_line(manifest["build_identity"])).hexdigest(),
        "com.filterest.composition": manifest["composition"]["id"],
        "com.filterest.composition-revision": str(manifest["composition"]["revision"]),
    }
    for component in manifest["composition"]["components"]:
        labels[f"com.filterest.component.{component['id']}.commit"] = component["commit"]
        labels[f"com.filterest.component.{component['id']}.version"] = component["version"]
    return labels
