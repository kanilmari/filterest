# installation_evidence.py
# Validates independently recorded installation baselines and fresh host observations.
# Connects the migration ledger and capacity mounts to offline update verification.
# Refuses fabricated historical evidence, ambiguous inputs and unreviewed drift.
"""These records are host evidence, never instructions supplied by a release bundle."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat

from server_tools.release.bundle_contract import BundleError, independent_policy_path
from server_tools.versioning.release_contract_v1 import canonical_json_line

HASH = re.compile(r"[0-9a-f]{64}\Z")
VERSION = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")
MIGRATION = re.compile(r"(?:[0-9]{8}|[0-9]{14})_[a-z0-9_]+\.sql\Z")
BASELINE_KEYS = {"schema_version", "baseline_type", "installation_id", "composition_id", "installed",
                 "ledger", "ledger_sha256", "legacy_exceptions", "approval_reference", "migration_prefixes"}
OBSERVATION_KEYS = {"schema_version", "observation_type", "installation_id", "composition_id", "installed",
                    "ledger", "platform", "capabilities", "capacity_paths", "capacity_minimums", "observed_at"}


def exact_keys(value, keys, label):
    if not isinstance(value, dict) or set(value) != keys:
        raise BundleError(label + " must contain exactly its versioned fields")


def text_value(value, label):
    if not isinstance(value, str) or not value or len(value) > 1024 or any(ord(char) < 32 for char in value):
        raise BundleError(label + " must be nonempty plain text")


def positive_integer(value, label, *, zero=False):
    if type(value) is not int or value < (0 if zero else 1):
        raise BundleError(label + " must be a positive integer")


def semantic_version(value):
    if not isinstance(value, str) or not VERSION.fullmatch(value):
        raise BundleError("host versions must use canonical major.minor.patch")
    return tuple(int(part) for part in value.split("."))


def unique_json(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise BundleError("evidence contains duplicate JSON keys")
        result[key] = value
    return result


def no_symlinks(path):
    """Reject aliases at every existing ancestor before opening evidence or measuring mounts."""
    path = Path(path).absolute()
    if ".." in path.parts:
        raise BundleError("host paths cannot contain parent traversal")
    for parent in (path, *path.parents):
        if parent.is_symlink():
            raise BundleError("host paths must not contain symlinks")
    return path


def protected_input(path, roots, *, executable=False):
    """Read operator/root-owned regular evidence through a bounded no-follow descriptor."""
    path = independent_policy_path(path, roots)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    with os.fdopen(descriptor, "rb") as stream:
        metadata = os.fstat(stream.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid not in {0, os.geteuid()}
                or metadata.st_mode & 0o022):
            raise BundleError("independent evidence must be operator/root-owned and protected from other writers")
        if executable:
            if not os.access(path, os.X_OK):
                raise BundleError("trusted authentication bridge is not executable")
            return path
        if not 0 < metadata.st_size <= 16 << 20:
            raise BundleError("independent evidence size is empty or exceeds limit")
        data = stream.read((16 << 20) + 1)
        if len(data) != metadata.st_size:
            raise BundleError("independent evidence changed while reading")
    return json.loads(data, object_pairs_hook=unique_json), hashlib.sha256(data).hexdigest()


def protected_authentication_bridge(path, roots):
    """Require independent prebuilt code; update verification cannot compile a fallback."""
    if path is None:
        raise BundleError("protected prebuilt authentication bridge is required")
    return protected_input(path, roots, executable=True)


def validate_installed(value):
    exact_keys(value, {"app_version", "database_version", "composition_revision"}, "installed identity")
    semantic_version(value["app_version"])
    semantic_version(value["database_version"])
    positive_integer(value["composition_revision"], "installed composition revision")


def validate_ledger(rows):
    """Preserve null historical evidence and bootstrap provenance; unresolved attempts always refuse."""
    if not isinstance(rows, list):
        raise BundleError("ledger must be an ordered array")
    previous = ""
    for row in rows:
        exact_keys(row, {"id", "applied_at", "content_sha256", "outcome", "provenance"}, "ledger row")
        if row["applied_at"] is not None:
            text_value(row["applied_at"], "recorded ledger timestamp")
        name = row["id"]
        if not isinstance(name, str) or not MIGRATION.fullmatch(name) or name <= previous:
            raise BundleError("ledger filenames must be unique and globally ordered")
        previous = name
        evidence = (row["content_sha256"], row["outcome"], row["provenance"])
        if evidence == (None, None, None):
            continue
        if not isinstance(evidence[0], str) or not HASH.fullmatch(evidence[0]):
            raise BundleError("ledger has incomplete byte evidence")
        if evidence[1] in {"failed_self_managed", "interrupted_self_managed"}:
            raise BundleError("ledger contains an unresolved migration attempt: " + name)
        if (evidence[1], evidence[2]) not in {("applied", "runner"), ("optional_failure_skipped", "runner"),
                                           ("bootstrap_baseline", "bootstrap")}:
            raise BundleError("ledger has unsupported outcome or provenance")
    return hashlib.sha256(canonical_json_line(rows)).hexdigest()


def validate_baseline(baseline):
    """Require an independently approved digest and a reason for every bounded legacy exception."""
    exact_keys(baseline, BASELINE_KEYS, "baseline")
    if type(baseline["schema_version"]) is not int or baseline["schema_version"] != 1 or baseline["baseline_type"] != "filterest_update_baseline":
        raise BundleError("unsupported baseline version or type")
    for key in ("installation_id", "composition_id", "approval_reference"):
        text_value(baseline[key], key)
    validate_installed(baseline["installed"])
    if validate_ledger(baseline["ledger"]) != baseline["ledger_sha256"]:
        raise BundleError("recorded baseline ledger digest differs")
    exceptions = baseline["legacy_exceptions"]
    if not isinstance(exceptions, dict):
        raise BundleError("legacy exceptions must map filenames to reviewed reasons")
    needed = {row["id"] for row in baseline["ledger"] if row["outcome"] in {None, "optional_failure_skipped"}}
    if set(exceptions) != needed:
        raise BundleError("every unverified or optional-failure row needs an explicit baseline exception")
    for reason in exceptions.values():
        text_value(reason, "baseline exception reason")
    if not isinstance(baseline["migration_prefixes"], dict):
        raise BundleError("baseline needs independently approved component migration prefixes")


def validate_observation(observation, baseline):
    exact_keys(observation, OBSERVATION_KEYS, "observation")
    if type(observation["schema_version"]) is not int or observation["schema_version"] != 1 or observation["observation_type"] != "filterest_update_observation":
        raise BundleError("unsupported observation version or type")
    for key in ("installation_id", "composition_id", "installed"):
        if observation[key] != baseline[key]:
            raise BundleError("installation identity or version differs from the approved baseline: " + key)
    validate_installed(observation["installed"])
    if validate_ledger(observation["ledger"]) != baseline["ledger_sha256"] or observation["ledger"] != baseline["ledger"]:
        raise BundleError("installation ledger differs from the recorded baseline")
    if not isinstance(observation["capabilities"], list) or any(not isinstance(item, str) for item in observation["capabilities"]):
        raise BundleError("host capabilities must be an array of names")
    if len(set(observation["capabilities"])) != len(observation["capabilities"]):
        raise BundleError("host capabilities cannot repeat")
    for key in ("capacity_paths", "capacity_minimums"):
        if not isinstance(observation[key], dict):
            raise BundleError(key + " must be an object")
    text_value(observation["observed_at"], "observation time")
