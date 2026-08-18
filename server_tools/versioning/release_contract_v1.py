"""Offline helpers for the immutable Filterest release-contract v1.

The module deliberately uses only the Python standard library.  Release
assembly must remain reproducible and testable without network access or a
package installation step.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
from typing import Any


SCHEMA_VERSION = 1
PRODUCT = "filterest"
RECORD_TYPE = "build"
CHANNELS = frozenset({"development", "stable"})
ARTIFACT_TYPES = frozenset({"runtime", "backup"})
MATURITIES = frozenset({"snapshot", "candidate", "published"})
SOURCE_MODELS = frozenset({"legacy_maintainer_export", "public_first"})

SEMVER_PATTERN = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
FULL_GIT_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
UTC_TIMESTAMP_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

RECORD_KEYS = frozenset(
    {
        "schema_version",
        "record_type",
        "record_id",
        "previous_record_sha256",
        "product",
        "build_id",
        "app_version",
        "artifact_type",
        "channel",
        "maturity",
        "source",
        "database",
        "created_at",
    }
)
SOURCE_KEYS = frozenset({"model", "commit"})
DATABASE_KEYS = frozenset({"min_version", "target_version"})
IDENTITY_KEYS = frozenset(
    {
        "schema_version",
        "product",
        "build_id",
        "ledger_record_id",
        "ledger_record_sha256",
        "app_version",
        "artifact_type",
        "channel",
        "maturity",
        "source",
        "database",
        "created_at",
    }
)


class ReleaseContractError(ValueError):
    """Raised when release-contract data is malformed or internally inconsistent."""


@dataclass(frozen=True)
class LedgerEntry:
    """A validated ledger object together with its exact persisted bytes."""

    record: dict[str, Any]
    line_bytes: bytes
    sha256: str


def canonical_json_line(value: dict[str, Any]) -> bytes:
    """Return the only accepted on-disk representation for a v1 JSON object."""

    return (
        json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        + b"\n"
    )


def _require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ReleaseContractError(f"{label} must be a JSON object")
    return value


def _require_exact_keys(
    value: dict[str, Any], expected: frozenset[str], label: str
) -> None:
    actual = frozenset(value)
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    if missing or extra:
        details: list[str] = []
        if missing:
            details.append(f"missing {', '.join(missing)}")
        if extra:
            details.append(f"unexpected {', '.join(extra)}")
        raise ReleaseContractError(f"{label} has invalid fields: {'; '.join(details)}")


def _require_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ReleaseContractError(f"{label} must be a non-empty string")
    return value


def _require_semver(value: Any, label: str) -> str:
    text = _require_string(value, label)
    if not SEMVER_PATTERN.fullmatch(text):
        raise ReleaseContractError(f"{label} must use strict x.y.z version syntax")
    return text


def _semver_tuple(value: str) -> tuple[int, int, int]:
    major, minor, patch = value.split(".")
    return int(major), int(minor), int(patch)


def _validate_timestamp(value: Any, label: str) -> str:
    text = _require_string(value, label)
    if not UTC_TIMESTAMP_PATTERN.fullmatch(text):
        raise ReleaseContractError(f"{label} must be UTC in YYYY-MM-DDTHH:MM:SSZ form")
    try:
        datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as exc:
        raise ReleaseContractError(f"{label} is not a real UTC timestamp") from exc
    return text


def _validate_source(value: Any, label: str) -> dict[str, str]:
    source = _require_object(value, label)
    _require_exact_keys(source, SOURCE_KEYS, label)
    model = _require_string(source["model"], f"{label}.model")
    if model not in SOURCE_MODELS:
        raise ReleaseContractError(
            f"{label}.model must be one of {', '.join(sorted(SOURCE_MODELS))}"
        )
    commit = _require_string(source["commit"], f"{label}.commit")
    if not FULL_GIT_SHA_PATTERN.fullmatch(commit):
        raise ReleaseContractError(f"{label}.commit must be a full lowercase Git SHA")
    return {"model": model, "commit": commit}


def _validate_database(value: Any, label: str) -> dict[str, str]:
    database = _require_object(value, label)
    _require_exact_keys(database, DATABASE_KEYS, label)
    minimum = _require_semver(database["min_version"], f"{label}.min_version")
    target = _require_semver(database["target_version"], f"{label}.target_version")
    if _semver_tuple(target) < _semver_tuple(minimum):
        raise ReleaseContractError(
            f"{label}.target_version must not be older than min_version"
        )
    return {"min_version": minimum, "target_version": target}


def _validate_identity_dimensions(
    value: dict[str, Any], label: str
) -> tuple[str, str, str, str, dict[str, str], dict[str, str]]:
    app_version = _require_semver(value["app_version"], f"{label}.app_version")
    artifact_type = _require_string(value["artifact_type"], f"{label}.artifact_type")
    channel = _require_string(value["channel"], f"{label}.channel")
    maturity = _require_string(value["maturity"], f"{label}.maturity")

    if artifact_type not in ARTIFACT_TYPES:
        raise ReleaseContractError(
            f"{label}.artifact_type must be one of {', '.join(sorted(ARTIFACT_TYPES))}"
        )
    if channel not in CHANNELS:
        raise ReleaseContractError(
            f"{label}.channel must be one of {', '.join(sorted(CHANNELS))}"
        )
    if maturity not in MATURITIES:
        raise ReleaseContractError(
            f"{label}.maturity must be one of {', '.join(sorted(MATURITIES))}"
        )

    # In v1 a development build and every backup are private snapshots.  A
    # candidate or published artifact can only be a stable runtime artifact.
    if channel == "development" and maturity != "snapshot":
        raise ReleaseContractError(
            f"{label}: development artifacts must have snapshot maturity"
        )
    if artifact_type == "backup" and maturity != "snapshot":
        raise ReleaseContractError(f"{label}: backup artifacts must have snapshot maturity")
    if maturity in {"candidate", "published"} and (
        channel != "stable" or artifact_type != "runtime"
    ):
        raise ReleaseContractError(
            f"{label}: candidate and published artifacts must be stable runtime artifacts"
        )

    source = _validate_source(value["source"], f"{label}.source")
    database = _validate_database(value["database"], f"{label}.database")
    return app_version, artifact_type, channel, maturity, source, database


def validate_release_record(record_value: Any, *, label: str = "record") -> dict[str, Any]:
    """Validate one ledger record, including all cross-field invariants."""

    record = _require_object(record_value, label)
    _require_exact_keys(record, RECORD_KEYS, label)

    if type(record["schema_version"]) is not int or record["schema_version"] != SCHEMA_VERSION:
        raise ReleaseContractError(f"{label}.schema_version must be integer 1")
    if record["record_type"] != RECORD_TYPE:
        raise ReleaseContractError(f"{label}.record_type must be {RECORD_TYPE!r}")
    if record["product"] != PRODUCT:
        raise ReleaseContractError(f"{label}.product must be {PRODUCT!r}")

    app_version, artifact_type, channel, _, source, _ = _validate_identity_dimensions(
        record, label
    )
    _validate_timestamp(record["created_at"], f"{label}.created_at")

    previous_hash = record["previous_record_sha256"]
    if previous_hash is not None and (
        not isinstance(previous_hash, str)
        or not SHA256_PATTERN.fullmatch(previous_hash)
    ):
        raise ReleaseContractError(
            f"{label}.previous_record_sha256 must be null or a lowercase SHA-256"
        )

    build_id = _require_string(record["build_id"], f"{label}.build_id")
    expected_build_id = (
        f"filterest-{app_version}-{channel}-{artifact_type}-{source['commit'][:12]}"
    )
    if build_id != expected_build_id:
        raise ReleaseContractError(
            f"{label}.build_id must be {expected_build_id!r} for this record"
        )
    record_id = _require_string(record["record_id"], f"{label}.record_id")
    expected_record_id = f"build:{build_id}"
    if record_id != expected_record_id:
        raise ReleaseContractError(
            f"{label}.record_id must be {expected_record_id!r} for this record"
        )
    return record


def validate_build_identity(
    identity_value: Any, *, label: str = "build identity"
) -> dict[str, Any]:
    """Validate a generated BUILD_IDENTITY v1 object."""

    identity = _require_object(identity_value, label)
    _require_exact_keys(identity, IDENTITY_KEYS, label)
    if type(identity["schema_version"]) is not int or identity["schema_version"] != 1:
        raise ReleaseContractError(f"{label}.schema_version must be integer 1")
    if identity["product"] != PRODUCT:
        raise ReleaseContractError(f"{label}.product must be {PRODUCT!r}")

    app_version, artifact_type, channel, _, source, _ = _validate_identity_dimensions(
        identity, label
    )
    _validate_timestamp(identity["created_at"], f"{label}.created_at")
    ledger_sha = _require_string(
        identity["ledger_record_sha256"], f"{label}.ledger_record_sha256"
    )
    if not SHA256_PATTERN.fullmatch(ledger_sha):
        raise ReleaseContractError(
            f"{label}.ledger_record_sha256 must be a lowercase SHA-256"
        )

    expected_build_id = (
        f"filterest-{app_version}-{channel}-{artifact_type}-{source['commit'][:12]}"
    )
    if identity["build_id"] != expected_build_id:
        raise ReleaseContractError(
            f"{label}.build_id must be {expected_build_id!r} for this identity"
        )
    expected_record_id = f"build:{expected_build_id}"
    if identity["ledger_record_id"] != expected_record_id:
        raise ReleaseContractError(
            f"{label}.ledger_record_id must be {expected_record_id!r} for this identity"
        )
    return identity


def validate_ledger_bytes(data: bytes, *, label: str = "release ledger") -> list[LedgerEntry]:
    """Validate canonical JSONL, its hash chain, and all uniqueness rules."""

    if data.startswith(b"\xef\xbb\xbf"):
        raise ReleaseContractError(f"{label} must not contain a UTF-8 byte-order mark")
    if data and not data.endswith(b"\n"):
        raise ReleaseContractError(f"{label} must end every record with LF")

    entries: list[LedgerEntry] = []
    record_ids: set[str] = set()
    build_ids: set[str] = set()
    published_stable_versions: set[str] = set()
    previous_line: bytes | None = None

    for index, line_bytes in enumerate(data.splitlines(keepends=True), start=1):
        line_label = f"{label} line {index}"
        if line_bytes in {b"\n", b"\r\n"}:
            raise ReleaseContractError(f"{line_label} must not be blank")
        if not line_bytes.endswith(b"\n") or line_bytes.endswith(b"\r\n"):
            raise ReleaseContractError(f"{line_label} must use LF line endings")
        try:
            decoded = line_bytes[:-1].decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ReleaseContractError(f"{line_label} is not valid UTF-8") from exc
        try:
            parsed = json.loads(decoded)
        except json.JSONDecodeError as exc:
            raise ReleaseContractError(f"{line_label} is not valid JSON: {exc.msg}") from exc

        record = validate_release_record(parsed, label=line_label)
        canonical = canonical_json_line(record)
        if line_bytes != canonical:
            raise ReleaseContractError(f"{line_label} is not canonical JSON")

        expected_previous_hash = (
            None if previous_line is None else hashlib.sha256(previous_line).hexdigest()
        )
        if record["previous_record_sha256"] != expected_previous_hash:
            raise ReleaseContractError(
                f"{line_label}.previous_record_sha256 does not match the exact previous line"
            )
        if record["record_id"] in record_ids:
            raise ReleaseContractError(f"{line_label} duplicates record_id {record['record_id']!r}")
        if record["build_id"] in build_ids:
            raise ReleaseContractError(f"{line_label} duplicates build_id {record['build_id']!r}")

        if record["channel"] == "stable" and record["maturity"] == "published":
            version = record["app_version"]
            if version in published_stable_versions:
                raise ReleaseContractError(
                    f"{line_label} duplicates published stable app_version {version!r}"
                )
            published_stable_versions.add(version)

        record_ids.add(record["record_id"])
        build_ids.add(record["build_id"])
        digest = hashlib.sha256(line_bytes).hexdigest()
        entries.append(LedgerEntry(record=record, line_bytes=line_bytes, sha256=digest))
        previous_line = line_bytes

    return entries


def validate_append_only(current: bytes, previous: bytes) -> list[LedgerEntry]:
    """Validate two ledgers and prove that current only appends to previous."""

    validate_ledger_bytes(previous, label="previous release ledger")
    current_entries = validate_ledger_bytes(current, label="current release ledger")
    if not current.startswith(previous):
        raise ReleaseContractError(
            "current release ledger does not preserve the previous ledger byte-for-byte"
        )
    return current_entries


def read_and_validate_ledger(
    ledger_path: Path, *, previous_path: Path | None = None
) -> list[LedgerEntry]:
    """Read a ledger and optionally compare it with a committed/baseline copy."""

    current = ledger_path.read_bytes()
    if previous_path is None:
        return validate_ledger_bytes(current)
    return validate_append_only(current, previous_path.read_bytes())


def build_identity_from_entry(entry: LedgerEntry) -> dict[str, Any]:
    """Derive BUILD_IDENTITY solely from one validated immutable ledger entry."""

    record = entry.record
    identity = {
        "schema_version": SCHEMA_VERSION,
        "product": record["product"],
        "build_id": record["build_id"],
        "ledger_record_id": record["record_id"],
        "ledger_record_sha256": entry.sha256,
        "app_version": record["app_version"],
        "artifact_type": record["artifact_type"],
        "channel": record["channel"],
        "maturity": record["maturity"],
        "source": record["source"],
        "database": record["database"],
        "created_at": record["created_at"],
    }
    return validate_build_identity(identity)
