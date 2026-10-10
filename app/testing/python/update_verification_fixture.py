# update_verification_fixture.py
# Builds signed fixture updates with real source archives and an audited historical ledger.
# Connects throwaway release signing to host observations without installation access.
# Keeps keys, mount paths, SQL and all fixture history inside temporary test directories.
"""The historical null row is explicitly reviewed; it never gains an execution hash."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

import pytest

from release_bundle_fixture import bundle_go_tools, local_contract_bridge, unsigned_bundle
from test_release_preparation import candidate as original_candidate, commit_fixture
from test_release_promotion import release_candidate
from server_tools.release import bundle_contract
from server_tools.release.source_archive import bind_migrations
from server_tools.update_verification.verify_update import verify_update
from server_tools.versioning.release_contract_v1 import canonical_json_line

HISTORICAL = "20260307_create_history.sql"
PREPARE = "20261009000001_prepare_fixture.sql"
OWNER = "20261009000099_record_fixture.sql"


@pytest.fixture
def candidate(original_candidate):
    root, args = original_candidate
    directory = root / "app/server_tools/migrations"
    directory.mkdir()
    for name, source in {
        HISTORICAL: b"SELECT 'historical fixture';\n",
        PREPARE: b"-- VERSION_DB: 2.0.0\n/* header */ START TRANSACTION; SELECT 'fixture only'; COMMIT;\n",
        OWNER: b"-- VERSION_DB: 2.0.0\nSELECT 'fixture version owner';\n",
    }.items():
        (directory / name).write_bytes(source)
    args.source_commit = commit_fixture(root)
    return root, args


def sign_fixture(directory, policy, key_directory, bundle_go_tools, *, unchecked=False):
    """Only the compiled test fixture signer accepts this test-only passphrase injection."""
    key_directory.mkdir()
    _, signer = bundle_go_tools
    arguments = [str(signer), str(directory / bundle_contract.MANIFEST_NAME), str(policy),
        str(directory / bundle_contract.SIGNATURES_NAME), str(key_directory / "throwaway.container")]
    if unchecked:
        arguments.append("invalid-contract-fixture")
    result = subprocess.run(arguments,
        capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr.decode()
    assert result.stdout == b""


@pytest.fixture
def installation_bundle(unsigned_bundle, bundle_go_tools, tmp_path):
    root, directory, commit, _, _, _ = unsigned_bundle
    manifest = json.loads((directory / bundle_contract.MANIFEST_NAME).read_bytes())
    rows = [{"id": name, "component": "filterest", "database_version": "2.0.0", "publishes_database_version": name == OWNER,
             "transaction_policy": "self_managed" if name == PREPARE else "runner", "error_policy": "required"}
            for name in (PREPARE, OWNER)]
    manifest["database"]["migrations"] = bind_migrations(root, commit, rows)
    manifest["database"]["supported_starts"][0]["migration_ids"] = [PREPARE, OWNER]
    (directory / bundle_contract.MANIFEST_NAME).write_bytes(canonical_json_line(manifest))
    policy = tmp_path / "operator-trust.json"
    sign_fixture(directory, policy, tmp_path / "initial-keys", bundle_go_tools)
    ledger = [{"id": HISTORICAL, "applied_at": "2026-09-01T00:00:00Z", "content_sha256": None, "outcome": None, "provenance": None}]
    baseline_record = {"schema_version": 1, "baseline_type": "filterest_update_baseline",
        "installation_id": "throwaway-installation", "composition_id": "filterest",
        "installed": {"app_version": "1.2.3", "database_version": "2.0.0", "composition_revision": 1},
        "ledger": ledger, "ledger_sha256": hashlib.sha256(canonical_json_line(ledger)).hexdigest(),
        "legacy_exceptions": {HISTORICAL: "Fixture audit accepts unverified legacy history; no execution claim."},
        "approval_reference": "fixture-audit-1", "migration_prefixes": {"filterest": "app/server_tools/migrations"}}
    baseline = tmp_path / "operator-baseline.json"
    baseline.write_bytes(canonical_json_line(baseline_record))
    baseline.chmod(0o600)
    mount = tmp_path / "installation-mount"
    mount.mkdir()
    purposes = {row["purpose"] for row in manifest["capacity"]["allocations"]}
    observation = {"schema_version": 1, "observation_type": "filterest_update_observation",
        "installation_id": baseline_record["installation_id"], "composition_id": "filterest",
        "installed": baseline_record["installed"].copy(), "ledger": ledger.copy(),
        "observed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platform": {"os": "linux", "architecture": "amd64", "cpu_features": [], "postgresql_major": 16,
            "extensions": {"postgis": "3.0.0", "vector": "0.5.0"}, "docker_engine_version": "20.10.0", "docker_compose_version": "2.20.0"},
        "capabilities": manifest["protocol"]["required_capabilities"],
        "capacity_paths": {purpose: str(mount) for purpose in purposes},
        "capacity_minimums": {purpose: {"bytes": 1, "inodes": 1} for purpose in purposes}}
    inputs = {"bundle": directory, "trust_policy": policy, "minimum_trust_policy_revision": 1, "composition": "filterest",
        "baseline": baseline, "expected_manifest_sha256": hashlib.sha256((directory / bundle_contract.MANIFEST_NAME).read_bytes()).hexdigest(),
        "authentication_bridge": bundle_go_tools[0]}
    return inputs, observation, manifest


def change_manifest(installation_bundle, tmp_path, bundle_go_tools, modify, *, unchecked=False):
    inputs, observation, manifest = installation_bundle
    modify(manifest)
    path = inputs["bundle"] / bundle_contract.MANIFEST_NAME
    path.write_bytes(canonical_json_line(manifest))
    inputs["expected_manifest_sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    key_directory = tmp_path / ("resign-" + str(len(list(tmp_path.glob("resign-*")))))
    sign_fixture(inputs["bundle"], inputs["trust_policy"], key_directory, bundle_go_tools, unchecked=unchecked)
    return verify_update(observation=observation, **inputs)
