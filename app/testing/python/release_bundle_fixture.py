# release_bundle_fixture.py
# Builds isolated source/native/OCI bundles and random encrypted test signing keys.
# Connects production packaging/verifier code to fixture-only compiler and owner inputs.
# Never uses installation state, real keys, Docker or remote publication.
"""Shared evidence fixtures for asset, publication and cross-language contract tests."""
from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile

import pytest

from server_tools.release import build_bundle, bundle_contract, bundle_verifier
from server_tools.release.oci_archive import identity_labels
from server_tools.versioning.release_contract_v1 import canonical_json_line
from test_release_preparation import candidate, commit_fixture
from test_release_promotion import release_candidate, create_assets
from server_tools.release import promote_release as promotion

APP = Path(__file__).resolve().parents[2]
SIGNER = r'''
package main
import (
    "encoding/base64"
    "encoding/json"
    "os"
    "time"
    release "easelect/backend/core_components/release_updates"
)
func must(err error) { if err != nil { panic(err) } }
func main() {
    // This injection exists only in this compiled temporary fixture program.
    // No production command accepts a passphrase from an argument or pipe.
    passphrase := []byte("throwaway FIXTURE ONLY passphrase")
    defer clear(passphrase)
    public, err := release.GenerateSigningKeyFile(os.Args[4], os.Args[4]+".public", passphrase); must(err)
    key, err := release.ReadSigningKeyFile(os.Args[4], passphrase); must(err); defer clear(key)
    data, err := os.ReadFile(os.Args[1]); must(err)
    manifest, err := release.ParseManifest(data); must(err)
    proofs, err := release.SignManifest(data, key); must(err)
    encoded, err := json.Marshal(proofs); must(err)
    must(os.WriteFile(os.Args[3], append(encoded, '\n'), 0600))
    created, err := time.Parse("2006-01-02T15:04:05Z", manifest.CreatedAt); must(err)
    before := created.Add(-24*time.Hour).Format("2006-01-02T15:04:05Z")
    after := time.Now().UTC().Add(48*time.Hour).Format("2006-01-02T15:04:05Z")
    policy := release.TrustPolicyV1{SchemaVersion:1, PolicyType:"filterest_release_trust",
      PolicyRevision:1, IssuedAt:before, ExpiresAt:after, Compositions:[]release.CompositionTrustV1{
        {ID:manifest.Composition.ID, Publisher:manifest.Publisher, Keys:[]release.TrustedKeyV1{
          {Fingerprint:release.KeyFingerprint(public), PublicKey:base64.StdEncoding.EncodeToString(public),
           NotBefore:before, NotAfter:after, Revoked:false}}}}}
    encoded, err = json.Marshal(policy); must(err)
    must(os.WriteFile(os.Args[2], append(encoded, '\n'), 0600))
}
'''


@pytest.fixture(scope="session")
def bundle_go_tools(tmp_path_factory):
    """Compile the real verifier plus a test-only encrypted-container signer offline."""
    directory = tmp_path_factory.mktemp("bundle-go-tools")
    environment = {**os.environ, "GOTOOLCHAIN": "local", "GOWORK": "off", "GOPROXY": "off",
                   "GOSUMDB": "off", "GOFLAGS": "-mod=readonly"}
    verifier = directory / "verify"
    source = directory / "fixture_signer.go"
    source.write_text(SIGNER)
    signer = directory / "fixture-sign"
    for output, target in ((verifier, "./server_tools/release/manifest_verification"), (signer, str(source))):
        result = subprocess.run(["go", "build", "-o", str(output), target], cwd=APP,
                                env=environment, capture_output=True, timeout=300)
        assert result.returncode == 0, result.stderr.decode()
    return verifier, signer


@pytest.fixture
def local_contract_bridge(bundle_go_tools, monkeypatch):
    verifier, _ = bundle_go_tools
    def command(arguments, data=None):
        result = subprocess.run([str(verifier), *arguments], input=data, capture_output=True, timeout=20)
        if result.returncode:
            raise bundle_contract.BundleError(result.stderr.decode().strip())
        return json.loads(result.stdout)
    monkeypatch.setattr(bundle_contract, "contract_command", command)
    return command


def write_tar(path, content):
    """Use deterministic regular members; mutations below intentionally violate this contract."""
    with tarfile.open(path, "w") as archive:
        for name, data in sorted(content.items()):
            item = tarfile.TarInfo(name)
            item.size = len(data)
            item.mode = 0o644
            archive.addfile(item, io.BytesIO(data))


def write_oci(path, manifest, *, architecture="amd64", label_updates=None):
    labels = {**identity_labels(manifest), **(label_updates or {})}
    layer = io.BytesIO()
    with tarfile.open(fileobj=layer, mode="w") as archive:
        data = b"synthetic application image bytes\n"
        item = tarfile.TarInfo("filterest/app/fixture")
        item.size = len(data)
        archive.addfile(item, io.BytesIO(data))
    layer = layer.getvalue()
    config = canonical_json_line({"os": "linux", "architecture": architecture,
        "config": {"Labels": labels}, "rootfs": {"type": "layers", "diff_ids": ["sha256:" + hashlib.sha256(layer).hexdigest()]}})
    files = {"oci-layout": b'{"imageLayoutVersion":"1.0.0"}\n'}
    def descriptor(data, media_type):
        digest = hashlib.sha256(data).hexdigest()
        files["blobs/sha256/" + digest] = data
        return {"mediaType": media_type, "digest": "sha256:" + digest, "size": len(data)}
    image = canonical_json_line({"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "config": descriptor(config, "application/vnd.oci.image.config.v1+json"),
        "layers": [descriptor(layer, "application/vnd.oci.image.layer.v1.tar")]})
    image_descriptor = descriptor(image, "application/vnd.oci.image.manifest.v1+json")
    image_descriptor["platform"] = {"os": "linux", "architecture": architecture}
    files["index.json"] = canonical_json_line({"schemaVersion": 2, "manifests": [image_descriptor]})
    write_tar(path, files)
    return files


@pytest.fixture
def unsigned_bundle(release_candidate, tmp_path, local_contract_bridge):
    root, args, state = release_candidate
    args.apply = True
    promotion.promote(args)
    commit = commit_fixture(root)
    state["vcs"] = commit
    directory = tmp_path / "final-bundle"
    create_assets(root, directory)
    identity = json.loads((root / "app/BUILD_IDENTITY.json").read_bytes())
    fixture = APP / "backend/core_components/release_updates/testdata/test_only/public_manifest.json"
    specification = {key: value for key, value in json.loads(fixture.read_bytes()).items() if key in build_bundle.SPEC_KEYS}
    specification.update(release_id="filterest-1.2.4", created_at="2026-09-11T01:01:00Z")
    specification["composition"] = {"id": "filterest", "revision": 2,
        "components": [{"id": "filterest", "version": "1.2.4", "commit": commit}]}
    specification["database"] = {**identity["database"], "migrations": [], "supported_starts": [
        {"app_version": "1.2.3", "database_version": identity["database"]["target_version"],
         "composition_revision": 1, "migration_ids": []}]}
    specification["platform"]["targets"] = [bundle_verifier.native_platform(arch) for arch in ("amd64", "arm64")]
    specification["platform"]["targets"].append({"os": "linux", "architecture": "amd64", "cpu_features": []})
    specification["platform"]["docker"] = {"min_engine_version": "20.10.0", "min_compose_version": "2.20.0"}
    specification["capacity"]["allocations"].append({"purpose": "docker_storage", "bytes": 1048576, "inodes": 100})
    preview = {**specification, "published_commit": commit, "version": identity["app_version"], "build_identity": identity}
    oci = tmp_path / "prebuilt-image.tar"
    write_oci(oci, preview)
    report = build_bundle.build_unsigned_bundle(root, directory, commit, specification, {"amd64": oci})
    return root, directory, commit, specification, oci, report


@pytest.fixture
def signed_bundle(unsigned_bundle, bundle_go_tools, tmp_path):
    root, directory, commit, specification, oci, report = unsigned_bundle
    policy = tmp_path / "independent-policy.json"
    _, signer = bundle_go_tools
    result = subprocess.run([str(signer), str(directory / bundle_contract.MANIFEST_NAME), str(policy),
        str(directory / bundle_contract.SIGNATURES_NAME), str(tmp_path / "throwaway.container")], capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr.decode()
    assert b"passphrase" not in result.stdout and b"PRIVATE KEY" not in result.stdout
    return root, directory, commit, policy, report


def resign_document(directory, policy, tmp_path, bundle_go_tools):
    """Sign a deliberately modified contract with a newly generated fixture key."""
    _, signer = bundle_go_tools
    output = directory / bundle_contract.SIGNATURES_NAME
    result = subprocess.run([str(signer), str(directory / bundle_contract.MANIFEST_NAME), str(policy),
        str(output), str(tmp_path / "replacement.container")], capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr.decode()
