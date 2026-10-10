#!/usr/bin/env python3
"""check_installation.py
Report bounded offline conformance to the shipped public Compose layout.
Connect saved redacted observations, explicit parameters and the standard renderer.
Keep matching shape separate from update authorization and recovery readiness.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
CHECKS = (
    ("C01", "app_mounts"), ("C02", "db_mounts"), ("C03", "app_ports"), ("C04", "db_ports"),
    ("C05", "network_authority"), ("C06", "network_addressing"),
    ("C07", "app_authority"), ("C08", "db_authority"), ("C09", "application_hardening"),
    ("C10", "app_environment_keys"), ("C11", "db_environment_keys"),
    ("C12", "application_identity"), ("C13", "effective_configuration"),
)
EXCLUSIONS = [
    "Live collection, installation database access and Docker engine operations",
    "Environment values and secret/key comparison; operator-typed values are outside the key-disclosure promise",
    "Directory ownership, image verification, repairs and provisioning",
    "Evidence freshness, update authorization and recovery or reconstruction proof",
    "nginx forwarding, certificates/renewal, functional secure cookies and backup consistency",
]


class VerdictParser(argparse.ArgumentParser):
    def error(self, message):
        raise EvidenceError("Use conform --snapshot saved-site.json --parameters deployment.json")


def read_document(path: Path) -> tuple[bytes, str]:
    """Read only caller-selected saved evidence, rejecting installation key paths."""
    if "keys" in path.resolve().parts:
        raise EvidenceError("Evidence inputs must be saved outside installation keys directories")
    with path.open("rb") as stream:
        raw = stream.read(16 * 1024 * 1024 + 1)
    if len(raw) > 16 * 1024 * 1024:
        raise EvidenceError("Evidence input exceeds the 16 MiB bound")
    checksum = hashlib.sha256(raw).hexdigest()
    return raw, checksum


def new_verdict() -> dict:
    return {"schema_version": 1, "verdict_type": "filterest_installation_conformance",
            "verdict": "unknown", "execution_ready": False, "observed_at": None,
            "source": None, "snapshot_sha256": None, "parameters_sha256": None,
            "observation_source_sha256": None,
            "checks": [{"number": number, "id": identifier, "name": name,
                        "result": "unknown", "expected": None, "observed": None}
                       for number, (identifier, name) in enumerate(CHECKS, 1)],
            "unknowns": [{"check_id": identifier, "reason": "Inputs unavailable"}
                         for identifier, name in CHECKS],
            "counts": {"matched": 0, "differs": 0, "unknown": len(CHECKS)},
            "exclusions": EXCLUSIONS, "errors": []}


try:
    from server_tools.installation_conformance.compose_standard import (
        EvidenceError, digest, render_standard, source_identity, standard_facts, validate_parameters,
    )
    from server_tools.installation_conformance.snapshot_facts import SnapshotFacts, parse_json
except Exception:
    unavailable = new_verdict()
    unavailable["errors"].append("Conformance libraries unavailable; raw diagnostics withheld")
    print(json.dumps(unavailable, sort_keys=True, separators=(",", ":"), ensure_ascii=True))
    raise SystemExit(2)


def compare_facts(name: str, expected: object, observed: object) -> bool:
    if name in ("app_environment_keys", "db_environment_keys"):
        # A null Compose environment value is an optional pass-through, absent
        # from the container when the scrubbed caller does not supply it.
        return (expected["declared"] == observed["declared"]
                and set(expected["required_runtime"]).issubset(observed["runtime_keys"]))
    if name == "network_addressing":
        if expected["allocation"] == "automatic":
            return (observed["allocation"] == "automatic" and observed["usable_gateway"]
                    and observed["container_addresses_usable"])
        return (observed["allocation"] == "pinned" and observed["usable_gateway"] and observed["container_addresses_usable"]
                and expected["config"] == observed["config"])
    return expected == observed


def check_installation(snapshot_path: Path, parameters_path: Path) -> tuple[dict, int]:
    """Keep independent results; incomplete evidence takes precedence over differences."""
    verdict = new_verdict()
    verdict["checks"] = []
    verdict["unknowns"] = []
    snapshot = {}
    expected = {}
    settings = None
    try:
        raw, verdict["snapshot_sha256"] = read_document(snapshot_path)
        snapshot = parse_json(raw.decode("utf-8"))
    except EvidenceError as error:
        verdict["errors"].append(str(error))
    except (OSError, UnicodeError, ValueError, RecursionError):
        verdict["errors"].append("Snapshot is unreadable or invalid JSON; raw diagnostics withheld")
    facts = SnapshotFacts(snapshot)
    verdict["errors"].extend(facts.problems)
    verdict["observed_at"] = facts.observed_at
    verdict["observation_source_sha256"] = facts.source_sha256
    try:
        raw, verdict["parameters_sha256"] = read_document(parameters_path)
        parameters = parse_json(raw.decode("utf-8"))
        settings = validate_parameters(parameters)
        verdict["source"] = source_identity(settings)
        expected = standard_facts(render_standard(settings), settings)
        expected["effective_configuration"] = {
            "algorithm": "filterest-conformance-facts-v1", "sha256": digest(expected)}
    except EvidenceError as error:
        verdict["errors"].append(str(error))
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, RecursionError):
        verdict["errors"].append("Parameters or standard rendering are invalid; raw diagnostics withheld")

    observed = {}
    for role in ("app", "db"):
        for field in ("mounts", "ports", "authority"):
            observed[f"{role}_{field}"] = facts.container_fact(role, field)
        observed[f"{role}_environment_keys"] = facts.environment_keys(role)
    observed["network_authority"], observed["network_addressing"] = facts.network_facts()
    observed["application_hardening"] = facts.hardening()
    observed["application_identity"] = facts.application_identity()
    observed["effective_configuration"] = facts.effective_configuration()
    for number, (identifier, name) in enumerate(CHECKS, 1):
        wanted = expected.get(name)
        actual = observed.get(name)
        result = "unknown"
        partial = (name == "application_hardening" and isinstance(actual, dict)
                   and any(value is None for value in actual.values()))
        if wanted is not None and partial:
            missing = sorted(key for key, value in actual.items() if value is None)
            verdict["unknowns"].append({"check_id": identifier, "fields": missing,
                                       "reason": "Hardening evidence missing or invalid"})
            result = "differs" if any(value is not None and value != wanted[key]
                                      for key, value in actual.items()) else "unknown"
        elif wanted is not None and actual is not None:
            result = "matched" if compare_facts(name, wanted, actual) else "differs"
        else:
            verdict["unknowns"].append({"check_id": identifier,
                "reason": "Standard unavailable" if wanted is None else "Evidence missing, failed or invalid"})
        verdict["checks"].append({"number": number, "id": identifier, "name": name,
                                  "result": result, "expected": wanted, "observed": actual})
    counts = {result: sum(check["result"] == result for check in verdict["checks"])
              for result in ("matched", "differs", "unknown")}
    verdict["counts"] = counts
    if verdict["errors"] or verdict["unknowns"]:
        return verdict, 2
    if counts["differs"]:
        verdict["verdict"] = "differs"
        return verdict, 1
    verdict["verdict"] = "matched"
    return verdict, 0


def main(argv: list[str] | None = None) -> int:
    try:
        parser = VerdictParser(prog="filterest conform", description=__doc__)
        parser.add_argument("--snapshot", type=Path, required=True)
        parser.add_argument("--parameters", type=Path, required=True)
        args = parser.parse_args(argv)
        verdict, status = check_installation(args.snapshot, args.parameters)
    except EvidenceError as error:
        verdict = new_verdict()
        verdict["errors"].append(str(error))
        status = 2
    except Exception:
        # Neither filenames, parser text, subprocess streams nor tracebacks
        # cross this boundary, even for an unexpected malformed evidence shape.
        verdict = new_verdict()
        verdict["errors"].append("Conformance could not complete; raw diagnostics withheld")
        status = 2
    print(json.dumps(verdict, sort_keys=True, separators=(",", ":"), ensure_ascii=True))
    return status


if __name__ == "__main__":
    raise SystemExit(main())
