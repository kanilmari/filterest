# test_update_verification.py
# Exercises standalone update verdicts with signed fixture bundles and host evidence.
# Connects authentication, safe archives, ordered routes and exact-image lock rechecks.
# Proves refusals happen offline without touching an installation or executing payloads.
"""All source history, signing keys, ledger rows and capacity mounts are throwaway fixtures."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone, timedelta
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
from types import SimpleNamespace

import pytest

from update_verification_fixture import (
    HISTORICAL, OWNER, PREPARE, bundle_go_tools, candidate, original_candidate, release_candidate,
    local_contract_bridge, unsigned_bundle, installation_bundle, change_manifest,
)
from release_bundle_fixture import write_oci
from server_tools.release import bundle_contract
from server_tools.release.asset_verifier import sha256
from server_tools.release.oci_archive import identity_labels, inspect_oci_archive
from server_tools.update_verification import host_requirements
from server_tools.update_verification import verify_update as update_verifier
from server_tools.update_verification.bundle_inspection import inspect_bundle, inspect_migration_inventory
from server_tools.update_verification.verify_update import verify_update, recheck_under_execution_lock, require_verified_image
from server_tools.update_verification.source_extraction import extract_verified_sources
from server_tools.versioning.release_contract_v1 import canonical_json_line

APP = Path(__file__).resolve().parents[2]


def assert_refused(result, stage, message):
    assert result["verdict"] == "refused", result
    assert result["execution_ready"] is False
    assert result["reasons"][0]["code"] == stage, result
    assert message in result["reasons"][0]["message"], result


def image_identity(result):
    return {key: result["image"][key] for key in ("manifest_digest", "config_digest", "archive_sha256")}


def update_artifact(manifest, directory, name, expanded=None):
    """Rebind signed outer hashes so archive tests reach the intended inner safety check."""
    for current in (name, name + ".sha256"):
        path = directory / current
        if current.endswith(".sha256"):
            path.write_text(f"{sha256(directory / name)}  {name}\n")
        row = next(row for row in manifest["artifacts"] if row["name"] == current)
        row.update(sha256=sha256(path), size_bytes=path.stat().st_size,
                   expanded_size_bytes=max(path.stat().st_size, expanded or 0) if current == name else path.stat().st_size)


def test_valid_fixture_end_to_end_pins_source_route_and_oci_without_execution(installation_bundle):
    inputs, observation, manifest = installation_bundle
    before = {path.name: path.read_bytes() for path in inputs["bundle"].iterdir()}
    result = verify_update(observation=observation, **inputs)
    assert result["verdict"] == "accepted", result
    assert result["execution_ready"] is False and result["execution_lock_recheck_required"] is True
    assert all(step["result"] == "passed" for step in result["steps"])
    assert result["sources"][0]["commit"] == manifest["published_commit"]
    assert result["build_identity"] == manifest["build_identity"]
    assert result["database_route"]["migration_ids"] == [PREPARE, OWNER]
    assert result["database_route"]["legacy_exceptions"][HISTORICAL]
    assert observation["ledger"][0]["content_sha256"] is None
    row = next(row for row in manifest["artifacts"] if row["kind"] == "oci_archive")
    assert result["image"]["manifest_digest"] == row["oci"]["manifest_digest"]
    assert result["image"]["config_digest"] == row["oci"]["config_digest"]
    assert len(result["capacity"]) == 1
    assert {path.name: path.read_bytes() for path in inputs["bundle"].iterdir()} == before


@pytest.mark.parametrize("change,message", [
    ("tampered", "not authenticated"), ("unsigned", "regular file"), ("wrong_composition", "composition"),
    ("revoked", "not authenticated"), ("revision", "revision"), ("wrong_offer", "offer digest"),
])
def test_authentication_refuses_untrusted_updates(installation_bundle, change, message):
    inputs, observation, _ = installation_bundle
    if change == "tampered":
        path = inputs["bundle"] / bundle_contract.MANIFEST_NAME
        path.write_bytes(path.read_bytes().replace(b'"publisher":"filterest"', b'"publisher":"attacker"'))
    elif change == "unsigned":
        (inputs["bundle"] / bundle_contract.SIGNATURES_NAME).unlink()
    elif change == "wrong_composition":
        inputs["composition"] = "easelect"
    elif change == "revoked":
        policy = json.loads(inputs["trust_policy"].read_bytes())
        policy["compositions"][0]["keys"][0]["revoked"] = True
        inputs["trust_policy"].write_bytes(canonical_json_line(policy))
    elif change == "revision":
        inputs["minimum_trust_policy_revision"] = 2
    elif change == "wrong_offer":
        inputs["expected_manifest_sha256"] = "0" * 64
    assert_refused(verify_update(observation=observation, **inputs), "authenticate_release", message)


@pytest.mark.parametrize("change", ["payload", "unexpected", "symlink", "fifo"])
def test_exact_inventory_refuses_changed_or_nonregular_payloads(installation_bundle, change, tmp_path):
    inputs, observation, manifest = installation_bundle
    path = inputs["bundle"] / "filterest-linux-amd64"
    if change == "payload":
        path.write_bytes(path.read_bytes() + b"substitution")
    elif change == "unexpected":
        (inputs["bundle"] / "unlisted").write_bytes(b"fixture")
    elif change == "symlink":
        outside = tmp_path / "outside-binary"
        path.rename(outside)
        path.symlink_to(outside)
    elif change == "fifo":
        path.unlink()
        os.mkfifo(path)
    result = verify_update(observation=observation, **inputs)
    assert result["verdict"] == "refused" and result["reasons"][0]["code"] == "inspect_payloads", result


@pytest.mark.parametrize("change,message", [
    ("traversal", "unsafe"), ("absolute", "unsafe"), ("symlink", "link"), ("hardlink", "link"),
    ("device", "device"), ("duplicate", "duplicates"), ("privileged", "privileged"),
    ("file_parent", "parent"), ("commit", "commit identity"), ("expanded", "expansion"),
])
def test_safe_source_inspection_refuses_signed_unsafe_archives(installation_bundle, tmp_path, bundle_go_tools, change, message):
    inputs, _, manifest = installation_bundle
    row = next(row for row in manifest["artifacts"] if row["kind"] == "source_archive")
    path = inputs["bundle"] / row["name"]
    with tarfile.open(path) as archive:
        contents = [(item, archive.extractfile(item).read()) for item in archive.getmembers() if item.isfile()]
        headers = dict(archive.pax_headers)
    member = tarfile.TarInfo("unsafe-fixture")
    member.size, data = 1, b"x"
    if change == "traversal":
        member.name = "../escape"
    elif change == "absolute":
        member.name = "/absolute"
    elif change in {"symlink", "hardlink"}:
        member.type = tarfile.SYMTYPE if change == "symlink" else tarfile.LNKTYPE
        member.linkname, member.size = "../escape", 0
    elif change == "device":
        member.type, member.size = tarfile.CHRTYPE, 0
    elif change == "duplicate":
        member.name = contents[0][0].name
    elif change == "privileged":
        member.mode = 0o4755
    elif change == "file_parent":
        member.name = contents[0][0].name + "/child"
    elif change == "commit":
        headers["comment"] = "0" * 40
    with tarfile.open(path, "w:gz", format=tarfile.PAX_FORMAT, pax_headers=headers) as archive:
        for item, content in contents:
            archive.addfile(item, io.BytesIO(content))
        if change not in {"commit", "expanded"}:
            archive.addfile(member, io.BytesIO(data))
    expanded = sum(item.size for item, _ in contents) + member.size
    def modify(document):
        update_artifact(document, inputs["bundle"], path.name, expanded)
        if change == "expanded":
            next(row for row in document["artifacts"] if row["name"] == path.name)["expanded_size_bytes"] = path.stat().st_size
    result = change_manifest(installation_bundle, tmp_path, bundle_go_tools, modify)
    assert_refused(result, "inspect_payloads", message)


def test_signed_oci_substitution_cannot_replace_original_descriptors(installation_bundle, tmp_path, bundle_go_tools):
    inputs, _, manifest = installation_bundle
    row = next(row for row in manifest["artifacts"] if row["kind"] == "oci_archive")
    path = inputs["bundle"] / row["name"]
    files = write_oci(path, manifest, label_updates={"fixture.extra": "substitute image"})
    result = change_manifest(installation_bundle, tmp_path, bundle_go_tools,
        lambda document: update_artifact(document, inputs["bundle"], path.name, sum(map(len, files.values())) + 10240))
    assert_refused(result, "inspect_payloads", "signed descriptors")


@pytest.mark.parametrize("change,stage,message", [
    ("skip", "check_database_route", "skips"), ("reorder", "authenticate_release", "globally ordered"),
    ("wrong_transaction", "inspect_payloads", "real runner"), ("wrong_error", "inspect_payloads", "real runner"),
    ("wrong_hash", "inspect_payloads", "source bytes"),
])
def test_signed_route_cannot_skip_reorder_or_misdescribe_migrations(installation_bundle, tmp_path, bundle_go_tools, change, stage, message):
    def modify(manifest):
        rows = manifest["database"]["migrations"]
        route = manifest["database"]["supported_starts"][0]
        if change == "skip":
            rows.pop(0)
            route["migration_ids"] = [OWNER]
        elif change == "reorder":
            route["migration_ids"].reverse()
        elif change == "wrong_transaction":
            rows[0]["transaction_policy"] = "runner"
        elif change == "wrong_error":
            rows[0]["error_policy"] = "optional"
        elif change == "wrong_hash":
            rows[0]["content_sha256"] = "0" * 64
    assert_refused(change_manifest(installation_bundle, tmp_path, bundle_go_tools, modify, unchecked=change == "reorder"), stage, message)


@pytest.mark.parametrize("change,message", [
    ("ledger", "ledger differs"), ("version", "version differs"), ("site", "identity"),
    ("unresolved", "unresolved"), ("null_exception", "explicit baseline exception"),
    ("partial_evidence", "incomplete"), ("bootstrap_as_execution", "unsupported outcome"),
])
def test_ledger_and_installed_identity_require_exact_reviewed_baseline(installation_bundle, change, message):
    inputs, observation, _ = installation_bundle
    baseline = json.loads(inputs["baseline"].read_bytes())
    if change == "ledger":
        observation["ledger"] = []
    elif change == "version":
        observation["installed"]["app_version"] = "1.2.2"
    elif change == "site":
        observation["installation_id"] = "other-installation"
    elif change == "null_exception":
        baseline["legacy_exceptions"] = {}
    else:
        baseline["ledger"][0].update(content_sha256="0" * 64, outcome="interrupted_self_managed", provenance="runner")
        if change == "partial_evidence":
            baseline["ledger"][0]["content_sha256"] = None
        elif change == "bootstrap_as_execution":
            baseline["ledger"][0].update(outcome="applied", provenance="bootstrap")
    inputs["baseline"].write_bytes(canonical_json_line(baseline))
    assert_refused(verify_update(observation=observation, **inputs), "validate_installation_evidence", message)


def test_recorded_execution_hash_must_match_target_source(installation_bundle):
    inputs, observation, _ = installation_bundle
    baseline = json.loads(inputs["baseline"].read_bytes())
    baseline["ledger"][0].update(content_sha256="0" * 64, outcome="applied", provenance="runner")
    baseline["legacy_exceptions"] = {}
    baseline["ledger_sha256"] = hashlib.sha256(canonical_json_line(baseline["ledger"])).hexdigest()
    inputs["baseline"].write_bytes(canonical_json_line(baseline))
    observation["ledger"] = baseline["ledger"]
    assert_refused(verify_update(observation=observation, **inputs), "check_database_route", "recorded ledger evidence")


@pytest.mark.parametrize("change,message", [
    ("architecture", "platform"), ("postgresql", "PostgreSQL"), ("extensions", "extension"),
    ("docker", "Docker"), ("capabilities", "capabilities"), ("stale", "stale"),
])
def test_platform_versions_and_freshness_are_required(installation_bundle, change, message):
    inputs, observation, _ = installation_bundle
    if change == "architecture":
        observation["platform"]["architecture"] = "arm64"
    elif change == "postgresql":
        observation["platform"]["postgresql_major"] = 15
    elif change == "extensions":
        observation["platform"]["extensions"].pop("vector")
    elif change == "docker":
        observation["platform"]["docker_engine_version"] = "19.3.0"
    elif change == "capabilities":
        observation["capabilities"] = []
    elif change == "stale":
        observation["observed_at"] = (datetime.now(timezone.utc) - timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert_refused(verify_update(observation=observation, **inputs), "check_platform", message)


@pytest.mark.parametrize("change", ["bytes", "inodes", "aggregate", "observed_backup", "missing_mount"])
def test_capacity_requires_current_space_and_inodes_for_shared_mounts(installation_bundle, monkeypatch, change):
    inputs, observation, manifest = installation_bundle
    total = 128 << 20
    free_bytes, free_inodes = total, 100000
    if change == "bytes":
        free_bytes = 1
    elif change == "inodes":
        free_inodes = 1
    elif change == "aggregate":
        # Each individual allocation fits, but their combined requirement does not.
        free_bytes = (15 << 20) + 100
    elif change == "observed_backup":
        observation["capacity_minimums"]["database_backup"]["bytes"] = total
    elif change == "missing_mount":
        observation["capacity_paths"].pop("database_backup")
    sample = SimpleNamespace(f_bavail=free_bytes, f_blocks=total, f_frsize=1, f_favail=free_inodes, f_flag=0)
    monkeypatch.setattr(host_requirements.os, "statvfs", lambda path: sample)
    result = verify_update(observation=observation, **inputs)
    assert result["verdict"] == "refused" and result["reasons"][0]["code"] == "check_capacity", result


def test_execution_lock_recheck_refreshes_observations_and_rejects_rebuilds(installation_bundle):
    inputs, observation, _ = installation_bundle
    previous = verify_update(observation=observation, **inputs)
    calls = []
    def observe():
        calls.append("fresh read under caller lock")
        return deepcopy(observation)
    identity = image_identity(previous)
    result = recheck_under_execution_lock(previous, observe=observe, image_identity=identity, **inputs)
    assert result["verdict"] == "accepted" and not result["execution_lock_recheck_required"], result
    assert result["execution_ready"] is False and calls == ["fresh read under caller lock"]
    require_verified_image(result, identity)
    for identity_change in ({**identity, "config_digest": "sha256:" + "0" * 64}, {"tag": "filterest:latest"}):
        with pytest.raises(bundle_contract.BundleError, match="substitution"):
            require_verified_image(result, identity_change)
    with pytest.raises(bundle_contract.BundleError, match="rebuild"):
        require_verified_image(result, identity, rebuilt=True)
    assert_refused(recheck_under_execution_lock(previous, observe=observe, image_identity=identity,
        rebuilt=True, **inputs), "execution_lock_recheck", "rebuild")


@pytest.mark.parametrize("change", ["ledger", "version", "capacity", "payload", "trust", "baseline", "image"])
def test_execution_recheck_refuses_drift_after_preflight(installation_bundle, monkeypatch, change):
    inputs, observation, _ = installation_bundle
    previous = verify_update(observation=observation, **inputs)
    identity = image_identity(previous)
    if change == "ledger":
        observation["ledger"] = []
    elif change == "version":
        observation["installed"]["app_version"] = "1.2.2"
    elif change == "capacity":
        sample = SimpleNamespace(f_bavail=1, f_blocks=100, f_frsize=1, f_favail=1, f_flag=0)
        monkeypatch.setattr(host_requirements.os, "statvfs", lambda path: sample)
    elif change == "payload":
        (inputs["bundle"] / previous["image"]["archive"]).write_bytes(b"changed image")
    elif change == "trust":
        policy = json.loads(inputs["trust_policy"].read_bytes())
        policy["compositions"][0]["keys"][0]["revoked"] = True
        inputs["trust_policy"].write_bytes(canonical_json_line(policy))
    elif change == "baseline":
        baseline = json.loads(inputs["baseline"].read_bytes())
        baseline["approval_reference"] = "replacement audit"
        inputs["baseline"].write_bytes(canonical_json_line(baseline))
    elif change == "image":
        identity["manifest_digest"] = "sha256:" + "0" * 64
    result = recheck_under_execution_lock(previous, observe=lambda: observation, image_identity=identity, **inputs)
    assert result["verdict"] == "refused", result


def test_public_launcher_and_lock_recheck_emit_single_json_without_writes(installation_bundle, tmp_path):
    inputs, observation, _ = installation_bundle
    observation_file = tmp_path / "fresh-observation.json"
    observation_file.write_bytes(canonical_json_line(observation))
    observation_file.chmod(0o600)
    arguments = [str(APP / "filterest"), "verify-update", "--observation", str(observation_file)]
    for key, value in inputs.items():
        arguments.extend(["--" + key.replace("_", "-"), str(value)])
    environment = {**os.environ, "FILTEREST_PROJECT_VENV_DIR": "/home/user/GitHub/filterest/data/runtime/python/venv"}
    before = {path: path.stat().st_mtime_ns for path in tmp_path.rglob("*") if path.is_file()}
    result = subprocess.run(arguments, capture_output=True, text=True, env=environment, timeout=30)
    assert result.returncode == 0 and result.stderr == "", result.stderr + result.stdout
    assert len(result.stdout.splitlines()) == 1
    verdict = json.loads(result.stdout)
    assert verdict["verdict"] == "accepted"
    assert {path: path.stat().st_mtime_ns for path in before} == before
    prior, identity = tmp_path / "prior-verdict.json", tmp_path / "loaded-image.json"
    for path, record in ((prior, verdict), (identity, image_identity(verdict))):
        path.write_bytes(canonical_json_line(record))
        path.chmod(0o600)
    result = subprocess.run([*arguments, "--recheck-verdict", str(prior), "--image-identity", str(identity)],
        capture_output=True, text=True, env=environment, timeout=30)
    assert result.returncode == 0 and json.loads(result.stdout)["execution_lock_recheck_required"] is False
    result = subprocess.run(arguments + ["--unknown"], capture_output=True, text=True, env=environment, timeout=30)
    assert result.returncode == 1 and result.stderr == "" and json.loads(result.stdout)["verdict"] == "refused"
    bridge_index = arguments.index("--authentication-bridge")
    missing_bridge = arguments[:bridge_index] + arguments[bridge_index + 2:]
    for extra in ([], ["--recheck-verdict", str(prior), "--image-identity", str(identity)]):
        result = subprocess.run(missing_bridge + extra, capture_output=True, text=True, env=environment, timeout=30)
        assert result.returncode == 1 and result.stderr == ""
        assert_refused(json.loads(result.stdout), "invalid_inputs", "--authentication-bridge")


def test_explicit_source_staging_is_safe_and_pinned(installation_bundle, tmp_path):
    inputs, observation, _ = installation_bundle
    result = verify_update(observation=observation, **inputs)
    destination = tmp_path / "caller-staging"
    extract_verified_sources(result, inputs["bundle"], destination)
    assert destination.stat().st_mode & 0o777 == 0o700
    assert (destination / "filterest/app/server_tools/migrations" / PREPARE).is_file()
    assert json.loads((destination / "filterest/app/BUILD_IDENTITY.json").read_bytes()) == result["build_identity"]
    with pytest.raises(FileExistsError):
        extract_verified_sources(result, inputs["bundle"], destination)
    assert (destination / "filterest/app/BUILD_IDENTITY.json").is_file()


def test_source_staging_refuses_replaced_archive_and_preserves_existing_state(installation_bundle, tmp_path):
    inputs, observation, _ = installation_bundle
    result = verify_update(observation=observation, **inputs)
    (inputs["bundle"] / result["sources"][0]["archive"]).write_bytes(b"substitution")
    destination = tmp_path / "failed-staging"
    sentinel = tmp_path / "untouched-state"
    sentinel.write_bytes(b"untouched fixture")
    with pytest.raises(bundle_contract.BundleError, match="changed before extraction"):
        extract_verified_sources(result, inputs["bundle"], destination)
    assert not destination.exists() and sentinel.read_bytes() == b"untouched fixture"


@pytest.mark.parametrize("evidence", ["trust_policy", "baseline", "authentication_bridge"])
def test_bundle_cannot_provide_independent_trust_baseline_or_bridge(installation_bundle, evidence):
    inputs, observation, _ = installation_bundle
    replacement = inputs["bundle"] / inputs[evidence].name
    replacement.write_bytes(inputs[evidence].read_bytes())
    replacement.chmod(0o700)
    inputs[evidence] = replacement
    result = verify_update(observation=observation, **inputs)
    assert result["verdict"] == "refused"
    assert "outside source and bundle" in result["reasons"][0]["message"]


@pytest.mark.parametrize("evidence", ["baseline", "authentication_bridge"])
def test_operator_evidence_cannot_be_group_writable(installation_bundle, evidence):
    inputs, observation, _ = installation_bundle
    original_mode = inputs[evidence].stat().st_mode & 0o777
    try:
        inputs[evidence].chmod(0o770)
        result = verify_update(observation=observation, **inputs)
    finally:
        inputs[evidence].chmod(original_mode)
    assert result["verdict"] == "refused" and "other writers" in result["reasons"][0]["message"]


def test_bootstrap_evidence_keeps_its_origin_and_matches_source(installation_bundle):
    inputs, observation, _ = installation_bundle
    baseline = json.loads(inputs["baseline"].read_bytes())
    baseline["ledger"][0].update(content_sha256=hashlib.sha256(b"SELECT 'historical fixture';\n").hexdigest(),
        outcome="bootstrap_baseline", provenance="bootstrap")
    baseline["legacy_exceptions"] = {}
    baseline["ledger_sha256"] = hashlib.sha256(canonical_json_line(baseline["ledger"])).hexdigest()
    inputs["baseline"].write_bytes(canonical_json_line(baseline))
    observation["ledger"] = baseline["ledger"]
    result = verify_update(observation=observation, **inputs)
    assert result["verdict"] == "accepted", result["reasons"]
    assert observation["ledger"][0]["outcome"] == "bootstrap_baseline"


def fixture_layer(entries):
    """Keep repeated paths, directories, links and whiteouts as distinct tar entries."""
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w") as archive:
        for name, kind in entries:
            member = tarfile.TarInfo(name)
            member.type = kind
            if kind in {tarfile.SYMTYPE, tarfile.LNKTYPE}:
                member.linkname = "app/files/file-0"
            archive.addfile(member)
    return stream.getvalue()


@pytest.mark.parametrize("compressed", [False, True])
def test_many_file_oci_layer_sets_docker_inode_floor(installation_bundle, tmp_path, bundle_go_tools, monkeypatch, compressed):
    inputs, observation, manifest = installation_bundle
    row = next(row for row in manifest["artifacts"] if row["kind"] == "oci_archive")
    path = inputs["bundle"] / row["name"]
    layer = fixture_layer([(f"app/files/file-{index}", tarfile.REGTYPE) for index in range(5000)])
    files = write_oci(path, manifest, layers=[layer], compressed=compressed)
    row["oci"], expanded, inodes = inspect_oci_archive(path, row["platform"], identity_labels(manifest))
    assert len(files) == 5 and inodes >= 5000 + 2
    # Give Docker its own device; every signed/observed inode minimum fits 200,
    # while the actual layer does not. Other purposes have ample capacity.
    docker_mount = tmp_path / "docker-storage"
    docker_mount.mkdir()
    observation["capacity_paths"]["docker_storage"] = str(docker_mount)
    original_stat = Path.stat
    def stat(target, *args, **kwargs):
        metadata = original_stat(target, *args, **kwargs)
        if target == docker_mount:
            values = list(metadata)
            values[2] = -1
            return os.stat_result(values)
        return metadata
    monkeypatch.setattr(Path, "stat", stat)
    def capacity(target):
        return SimpleNamespace(f_bavail=1 << 40, f_blocks=1 << 40, f_frsize=1,
            f_favail=200 if target == docker_mount else 1000000, f_flag=0)
    monkeypatch.setattr(host_requirements.os, "statvfs", capacity)
    result = change_manifest(installation_bundle, tmp_path, bundle_go_tools,
        lambda document: update_artifact(document, inputs["bundle"], path.name, expanded))
    assert_refused(result, "check_capacity", "insufficient free bytes or inodes")
    assert result["image"]["inodes"] == inodes
    monkeypatch.setattr(host_requirements.os, "statvfs", lambda target: SimpleNamespace(
        f_bavail=1 << 40, f_blocks=1 << 40, f_frsize=1, f_favail=1000000, f_flag=0))
    assert verify_update(observation=observation, **inputs)["verdict"] == "accepted"


@pytest.mark.parametrize("compressed", [False, True])
def test_oci_inode_floor_counts_each_layer_entry_and_required_directory(tmp_path, compressed):
    manifest = json.loads((APP / "backend/core_components/release_updates/testdata/test_only/public_manifest.json").read_bytes())
    entries = [("app/files/file-0", tarfile.REGTYPE), ("app/files/file-0", tarfile.REGTYPE),
        ("app/files/.wh.removed", tarfile.REGTYPE), ("app/files/.wh..wh..opq", tarfile.REGTYPE),
        ("app/empty", tarfile.DIRTYPE), ("app/files/hardlink", tarfile.LNKTYPE),
        ("app/files/symlink", tarfile.SYMTYPE), ("app/files/.wh.device", tarfile.CHRTYPE)]
    layer = fixture_layer(entries)
    path = tmp_path / "layer-count.tar"
    files = write_oci(path, manifest, layers=[layer, layer], compressed=compressed)
    _, _, inodes = inspect_oci_archive(path, {"os": "linux", "architecture": "amd64", "cpu_features": []}, identity_labels(manifest))
    # Five wrapper files and two parents, plus both identical layers in full:
    # root + seven entries with two parents + one empty dir with its parent.
    assert len(files) == 5
    assert inodes == 7 + 2 * (1 + 7 * 3 + 2)


@pytest.mark.parametrize("entrypoint", ["verify", "recheck", "payload", "migration"])
@pytest.mark.parametrize("missing", ["omitted", "none"])
def test_all_update_library_paths_require_prebuilt_bridge(installation_bundle, monkeypatch, entrypoint, missing):
    inputs, observation, manifest = installation_bundle
    previous = verify_update(observation=observation, **inputs)
    assert previous["verdict"] == "accepted"
    def forbidden_command(*args, **kwargs):
        pytest.fail("missing bridge reached the build-capable release command")
    monkeypatch.setattr(bundle_contract, "contract_command", forbidden_command)
    bridge = {} if missing == "omitted" else {"authentication_bridge": None}
    inputs = {key: value for key, value in inputs.items() if key != "authentication_bridge"}
    def invoke():
        if entrypoint == "verify":
            return verify_update(observation=observation, **inputs, **bridge)
        if entrypoint == "recheck":
            return recheck_under_execution_lock(previous, observe=lambda: observation,
                image_identity=image_identity(previous), **inputs, **bridge)
        if entrypoint == "payload":
            return inspect_bundle(inputs["bundle"], manifest, {}, observation["platform"],
                **({"bridge": None} if bridge else {}))
        return inspect_migration_inventory(manifest, {}, **({"bridge": None} if bridge else {}))
    if missing == "omitted":
        with pytest.raises(TypeError, match="bridge"):
            invoke()
    elif entrypoint in {"payload", "migration"}:
        with pytest.raises(bundle_contract.BundleError, match="prebuilt authentication bridge"):
            invoke()
    else:
        assert_refused(invoke(), "authenticate_release", "prebuilt authentication bridge")


@pytest.mark.parametrize("protection", ["writable", "nonexecutable", "symlink", "bundled"])
def test_lock_recheck_requires_protected_independent_bridge(installation_bundle, tmp_path, protection):
    inputs, observation, _ = installation_bundle
    previous = verify_update(observation=observation, **inputs)
    bridge = (inputs["bundle"] if protection == "bundled" else tmp_path) / "replacement-bridge"
    if protection == "symlink":
        bridge.symlink_to(inputs["authentication_bridge"])
    else:
        bridge.write_bytes(inputs["authentication_bridge"].read_bytes())
        bridge.chmod(0o770 if protection == "writable" else 0o600 if protection == "nonexecutable" else 0o700)
    inputs["authentication_bridge"] = bridge
    result = recheck_under_execution_lock(previous, observe=lambda: observation,
        image_identity=image_identity(previous), **inputs)
    assert result["verdict"] == "refused" and result["reasons"][0]["code"] == "authenticate_release", result


@pytest.mark.parametrize("policy_revision,caller_floor,accepted", [(2, 1, True), (1, 1, False), (2, 3, False)])
def test_lock_recheck_retains_highest_trust_floor(installation_bundle, policy_revision, caller_floor, accepted):
    inputs, observation, _ = installation_bundle
    policy = json.loads(inputs["trust_policy"].read_bytes())
    policy["policy_revision"] = 2
    inputs["trust_policy"].write_bytes(canonical_json_line(policy))
    previous = verify_update(observation=observation, **inputs)
    assert previous["verdict"] == "accepted" and previous["signature_verification"]["trust_policy_revision"] == 2
    policy["policy_revision"] = policy_revision
    inputs["trust_policy"].write_bytes(canonical_json_line(policy))
    inputs["minimum_trust_policy_revision"] = caller_floor
    result = recheck_under_execution_lock(previous, observe=lambda: observation,
        image_identity=image_identity(previous), **inputs)
    if accepted:
        assert result["verdict"] == "accepted" and result["execution_lock_recheck_required"] is False, result
    else:
        assert_refused(result, "authenticate_release", "revision")


@pytest.mark.parametrize("evidence", ["trust_policy_revision", "key_fingerprints", "signatures_sha256"])
def test_lock_recheck_compares_authentication_evidence(installation_bundle, monkeypatch, evidence):
    inputs, observation, _ = installation_bundle
    previous = verify_update(observation=observation, **inputs)
    previous["signature_verification"]["trust_policy_revision"] = 2
    current = deepcopy(previous)
    current["signature_verification"][evidence] = {
        "trust_policy_revision": 1, "key_fingerprints": ["0" * 64], "signatures_sha256": "0" * 64}[evidence]
    captured = []
    def verify(**arguments):
        captured.append(arguments["minimum_trust_policy_revision"])
        return current
    monkeypatch.setattr(update_verifier, "verify_update", verify)
    result = recheck_under_execution_lock(previous, observe=lambda: observation,
        image_identity=image_identity(previous), **inputs)
    assert captured == [2]
    assert_refused(result, "execution_lock_recheck", "signature_verification")
