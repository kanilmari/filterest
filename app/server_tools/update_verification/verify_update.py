#!/usr/bin/env python3
# verify_update.py
# Produces one offline verdict for a signed update and an independently approved installation.
# Connects release authentication, payload/route inspection and execution-lock rechecks.
# Never extracts archives, runs bundle programs or changes installation state.
"""The caller owns its execution lock, fresh observations and exact-image enforcement."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from server_tools.release.bundle_contract import BundleError, authenticate_manifest
from server_tools.update_verification.bundle_inspection import inspect_bundle, inventory_hashes
from server_tools.update_verification.host_requirements import check_capacity, check_platform
from server_tools.update_verification.installation_evidence import (
    HASH, no_symlinks, positive_integer, protected_authentication_bridge, protected_input,
    validate_baseline, validate_observation,
)
from server_tools.versioning.release_contract_v1 import canonical_json_line

STEPS = ("authenticate_release", "validate_installation_evidence", "check_platform",
         "inspect_payloads", "check_database_route", "check_capacity", "recheck_bundle_bytes")


def new_verdict():
    return {"schema_version": 1, "verdict_type": "filterest_update_verification", "verdict": "refused",
            "execution_ready": False, "execution_lock_recheck_required": True,
            "checked_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "reasons": [],
            "steps": [{"number": index + 1, "name": name, "result": "not_run"} for index, name in enumerate(STEPS)]}


def check_route(manifest, baseline, observation, sources):
    """Require exact ordered pending SQL, so allowlists cannot hide skipped work."""
    database = manifest["database"]
    starts = [start for start in database["supported_starts"] if all(
        start[key] == observation["installed"][key] for key in ("app_version", "database_version", "composition_revision"))]
    if len(starts) != 1:
        raise BundleError("no unique signed database route matches the installation's exact starting versions")
    ledger = {row["id"]: row for row in baseline["ledger"]}
    for identifier in sources.keys() & ledger.keys():
        recorded = ledger[identifier]["content_sha256"]
        if recorded is not None and recorded != sources[identifier]["content_sha256"]:
            raise BundleError("archived migration bytes differ from recorded ledger evidence: " + identifier)
    pending = sorted(sources.keys() - ledger.keys())
    if starts[0]["migration_ids"] != pending:
        raise BundleError("signed database route skips, reorders or repeats the installation's pending migrations")
    union = {identifier for start in database["supported_starts"] for identifier in start["migration_ids"]}
    if union != {row["id"] for row in database["migrations"]}:
        raise BundleError("signed migration inventory must equal the union of its approved routes")
    return {"starting_identity": observation["installed"], "target_database_version": database["target_version"],
            "migration_ids": pending, "ledger_sha256": baseline["ledger_sha256"],
            "approval_reference": baseline["approval_reference"], "legacy_exceptions": baseline["legacy_exceptions"]}


def verify_update(*, bundle, trust_policy, minimum_trust_policy_revision, composition,
                  baseline, expected_manifest_sha256, observation, authentication_bridge):
    """Return a verdict; accepted means verified/compatible, never execution or recovery readiness.

    Baseline/trust/bridge come from protected independent host provisioning.
    Observation is collected by the trusted caller, not read from the bundle.
    All mutable evidence must be collected again under that caller's execution lock.
    """
    result = new_verdict()
    step = result["steps"][0]
    try:
        directory = no_symlinks(bundle)
        if not directory.is_dir():
            raise BundleError("bundle must be an existing directory")
        roots = (APP_ROOT.parent, directory)
        bridge = protected_authentication_bridge(authentication_bridge, roots)
        manifest, authentication = authenticate_manifest(APP_ROOT.parent, directory, trust_policy,
            minimum_trust_policy_revision, composition, bridge=bridge)
        if (not isinstance(expected_manifest_sha256, str) or not HASH.fullmatch(expected_manifest_sha256)
                or authentication["manifest_sha256"] != expected_manifest_sha256):
            raise BundleError("authenticated manifest differs from the independently selected offer digest")
        result.update(manifest_sha256=authentication["manifest_sha256"], signature_verification=authentication)
        step["result"] = "passed"
        step = result["steps"][1]
        baseline_record, baseline_digest = protected_input(baseline, roots)
        validate_baseline(baseline_record)
        if baseline_record["composition_id"] != composition:
            raise BundleError("approved installation baseline has a different composition")
        validate_observation(observation, baseline_record)
        result.update(installation_id=baseline_record["installation_id"], baseline_sha256=baseline_digest,
                      observation_sha256=hashlib.sha256(canonical_json_line(observation)).hexdigest())
        step["result"] = "passed"
        step = result["steps"][2]
        facts = check_platform(manifest, observation)
        step["result"] = "passed"
        step = result["steps"][3]
        payload = inspect_bundle(directory, manifest, baseline_record, facts, bridge=bridge)
        if (payload["hashes"]["release_manifest.v1.json"] != authentication["manifest_sha256"]
                or payload["hashes"]["release_signatures.v1.json"] != authentication.get("signatures_sha256")):
            raise BundleError("manifest or signature envelope changed after authentication")
        result.update(composition=manifest["composition"], version=manifest["version"],
                      published_commit=manifest["published_commit"], build_identity=manifest["build_identity"],
                      sources=payload["sources"], image=payload["image"], artifacts=payload["hashes"])
        step["result"] = "passed"
        step = result["steps"][4]
        result["database_route"] = check_route(manifest, baseline_record, observation, payload["migrations"])
        step["result"] = "passed"
        step = result["steps"][5]
        result["capacity"] = check_capacity(manifest, observation, payload)
        step["result"] = "passed"
        step = result["steps"][6]
        if inventory_hashes(directory, payload["hashes"], payload["sizes"]) != (payload["hashes"], payload["sizes"]):
            raise BundleError("bundle bytes changed during inspection")
        step["result"] = "passed"
        result["verdict"] = "accepted"
        result["reasons"] = [{"code": "verified_and_compatible", "message": "Signed payload and approved installation route verified; execution-lock recheck and recovery evidence are still required."}]
    except Exception as error:
        step["result"] = "failed"
        result["reasons"] = [{"code": step["name"], "message": str(error) or type(error).__name__}]
    return result


def require_verified_image(verdict, identity, *, rebuilt=False):
    """Enforce immutable target-image identity at rehearsal, load and activation boundaries.

    The caller supplies independently inspected OCI manifest/config/archive digests.
    Tags, source commits and release labels alone cannot identify the bytes to run.
    """
    if verdict.get("verdict") != "accepted" or rebuilt is not False:
        raise BundleError("refused verdict or image rebuild cannot authorize rehearsal or activation")
    expected = {key: verdict["image"][key] for key in ("manifest_digest", "config_digest", "archive_sha256")}
    if identity != expected:
        raise BundleError("image substitution: rehearsal and activation must use the exact verified image")


def recheck_under_execution_lock(previous, *, observe, image_identity, authentication_bridge, rebuilt=False, **inputs):
    """Caller MUST hold its installation execution lock throughout this call and subsequent handoff.

    observe() MUST capture current installed identity/ledger/platform/capacity floors
    under that lock. This function reauthenticates trust and rereads every bundle byte,
    baseline and statvfs sample. The caller keeps the bundle immutable, uses digest
    references, and calls require_verified_image again before rehearsal and activation.
    A result does not prove backups, restoration, grants, administrator acceptance,
    writer quiescence, or that the caller really acquired its lock.
    """
    try:
        require_verified_image(previous, image_identity, rebuilt=rebuilt)
        if inputs["expected_manifest_sha256"] != previous["manifest_sha256"]:
            raise BundleError("execution recheck cannot select a different offer")
        prior_revision = previous["signature_verification"]["trust_policy_revision"]
        positive_integer(prior_revision, "prior accepted trust-policy revision")
        positive_integer(inputs["minimum_trust_policy_revision"], "supplied trust-policy revision floor")
        # A caller's older retained floor cannot undo a newer accepted policy.
        inputs["minimum_trust_policy_revision"] = max(inputs["minimum_trust_policy_revision"], prior_revision)
        current = verify_update(observation=observe(), authentication_bridge=authentication_bridge, **inputs)
        if current["verdict"] != "accepted":
            return current
        for key in ("installation_id", "baseline_sha256", "manifest_sha256", "signature_verification",
                    "artifacts", "image", "sources", "database_route"):
            if current[key] != previous[key]:
                raise BundleError("verified evidence changed before execution: " + key)
        require_verified_image(current, image_identity, rebuilt=rebuilt)
        current["execution_lock_recheck_required"] = False
        current["execution_lock_recheck"] = "passed_under_caller_lock_contract"
        current["reasons"] = [{"code": "lock_recheck_passed", "message": "Changing installation evidence and exact image rechecked; caller retains the execution lock and recovery gates."}]
        return current
    except Exception as error:
        current = new_verdict()
        current["reasons"] = [{"code": "execution_lock_recheck", "message": str(error) or type(error).__name__}]
        return current


class VerdictParser(argparse.ArgumentParser):
    def error(self, message):
        raise BundleError(message)


def parse_args(argv=None):
    parser = VerdictParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--trust-policy", type=Path, required=True)
    parser.add_argument("--minimum-trust-policy-revision", type=int, required=True)
    parser.add_argument("--composition", required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--observation", type=Path, required=True)
    parser.add_argument("--expected-manifest-sha256", required=True)
    parser.add_argument("--authentication-bridge", type=Path, required=True)
    parser.add_argument("--recheck-verdict", type=Path)
    parser.add_argument("--image-identity", type=Path)
    return parser.parse_args(argv)


def main(argv=None):
    try:
        args = parse_args(argv)
        roots = (APP_ROOT.parent, args.bundle)
        def observe():
            return protected_input(args.observation, roots)[0]
        inputs = {key: getattr(args, key) for key in ("bundle", "trust_policy", "minimum_trust_policy_revision",
                  "composition", "baseline", "expected_manifest_sha256", "authentication_bridge")}
        if bool(args.recheck_verdict) != bool(args.image_identity):
            raise BundleError("execution-lock recheck requires both prior verdict and independent image identity")
        if args.recheck_verdict:
            previous = protected_input(args.recheck_verdict, roots)[0]
            identity = protected_input(args.image_identity, roots)[0]
            result = recheck_under_execution_lock(previous, observe=observe, image_identity=identity, **inputs)
        else:
            result = verify_update(observation=observe(), **inputs)
    except Exception as error:
        result = new_verdict()
        result["reasons"] = [{"code": "invalid_inputs", "message": str(error) or type(error).__name__}]
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0 if result["verdict"] == "accepted" else 1


if __name__ == "__main__":
    raise SystemExit(main())
