"""Offline proofs for deterministic Filterest BUILD_IDENTITY generation."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
GENERATOR = (
    REPO_ROOT
    / "server_tools/public_slice_export/generate_filterest_build_identity.py"
)
IDENTITY_SCHEMA = REPO_ROOT / "server_tools/versioning/build_identity.v1.schema.json"

from server_tools.public_slice_export.generate_filterest_build_identity import (  # noqa: E402
    generate,
)
from server_tools.versioning.release_contract_v1 import (  # noqa: E402
    ReleaseContractError,
    canonical_json_line,
    validate_build_identity,
)


def make_record() -> dict[str, object]:
    commit = "a" * 40
    build_id = f"filterest-8.30.0-stable-runtime-{commit[:12]}"
    return {
        "schema_version": 1,
        "record_type": "build",
        "record_id": f"build:{build_id}",
        "previous_record_sha256": None,
        "product": "filterest",
        "build_id": build_id,
        "app_version": "8.30.0",
        "artifact_type": "runtime",
        "channel": "stable",
        "maturity": "candidate",
        "source": {"model": "legacy_maintainer_export", "commit": commit},
        "database": {"min_version": "8.0.59", "target_version": "8.0.59"},
        "created_at": "2026-08-16T12:00:00Z",
    }


def test_generator_derives_identity_and_exact_ledger_binding(tmp_path: Path) -> None:
    record = make_record()
    line = canonical_json_line(record)
    ledger = tmp_path / "release_ledger.v1.jsonl"
    output = tmp_path / "BUILD_IDENTITY.json"
    ledger.write_bytes(line)

    generated = generate(
        ledger,
        str(record["record_id"]),
        output,
        expected_app_version="8.30.0",
        expected_db_version="8.0.59",
    )
    identity = json.loads(generated)

    assert output.read_bytes() == generated
    assert identity["build_id"] == record["build_id"]
    assert identity["ledger_record_id"] == record["record_id"]
    assert identity["ledger_record_sha256"] == hashlib.sha256(line).hexdigest()
    assert identity["channel"] == "stable"
    assert identity["maturity"] == "candidate"
    assert "previous_record_sha256" not in identity
    assert validate_build_identity(identity) == identity


def test_generator_is_byte_deterministic_for_same_record(tmp_path: Path) -> None:
    record = make_record()
    ledger = tmp_path / "release_ledger.v1.jsonl"
    output = tmp_path / "BUILD_IDENTITY.json"
    ledger.write_bytes(canonical_json_line(record))

    first = generate(
        ledger,
        str(record["record_id"]),
        output,
        expected_app_version="8.30.0",
        expected_db_version="8.0.59",
    )
    second = generate(
        ledger,
        str(record["record_id"]),
        output,
        expected_app_version="8.30.0",
        expected_db_version="8.0.59",
    )

    assert first == second == output.read_bytes()
    assert first.endswith(b"\n")


def test_generator_rejects_unknown_record_without_writing(tmp_path: Path) -> None:
    ledger = tmp_path / "release_ledger.v1.jsonl"
    output = tmp_path / "BUILD_IDENTITY.json"
    ledger.write_bytes(canonical_json_line(make_record()))

    with pytest.raises(ReleaseContractError, match="found 0"):
        generate(
            ledger,
            "build:missing",
            output,
            expected_app_version="8.30.0",
            expected_db_version="8.0.59",
        )

    assert not output.exists()


def test_generator_rejects_invalid_ledger_before_writing(tmp_path: Path) -> None:
    ledger = tmp_path / "release_ledger.v1.jsonl"
    output = tmp_path / "BUILD_IDENTITY.json"
    ledger.write_text('{"channel":"nightly"}\n', encoding="utf-8")

    with pytest.raises(ReleaseContractError):
        generate(
            ledger,
            "build:missing",
            output,
            expected_app_version="8.30.0",
            expected_db_version="8.0.59",
        )

    assert not output.exists()


def test_identity_schema_has_the_exact_v1_classification_enums() -> None:
    schema_text = IDENTITY_SCHEMA.read_text(encoding="utf-8")
    schema = json.loads(schema_text)

    assert schema["properties"]["channel"]["enum"] == ["development", "stable"]
    assert schema["properties"]["artifact_type"]["enum"] == ["runtime", "backup"]
    assert schema["properties"]["maturity"]["enum"] == [
        "snapshot",
        "candidate",
        "published",
    ]
    assert "nightly" not in schema_text


@pytest.mark.parametrize(
    ("expected_app_version", "expected_db_version", "message"),
    [
        ("8.30.1", "8.0.59", "VERSION_APP"),
        ("8.30.0", "8.0.60", "VERSION_DB"),
    ],
)
def test_generator_rejects_marker_mismatch(
    tmp_path: Path,
    expected_app_version: str,
    expected_db_version: str,
    message: str,
) -> None:
    record = make_record()
    ledger = tmp_path / "release_ledger.v1.jsonl"
    output = tmp_path / "BUILD_IDENTITY.json"
    ledger.write_bytes(canonical_json_line(record))

    with pytest.raises(ReleaseContractError, match=message):
        generate(
            ledger,
            str(record["record_id"]),
            output,
            expected_app_version=expected_app_version,
            expected_db_version=expected_db_version,
        )

    assert not output.exists()


def test_generator_cli_writes_only_requested_output(tmp_path: Path) -> None:
    record = make_record()
    ledger = tmp_path / "release_ledger.v1.jsonl"
    output = tmp_path / "generated" / "BUILD_IDENTITY.json"
    default_output = REPO_ROOT / "BUILD_IDENTITY.json"
    default_before = default_output.read_bytes() if default_output.exists() else None
    ledger.write_bytes(canonical_json_line(record))

    result = subprocess.run(
        [
            sys.executable,
            str(GENERATOR),
            "--ledger",
            str(ledger),
            "--record-id",
            str(record["record_id"]),
            "--expected-app-version",
            "8.30.0",
            "--expected-db-version",
            "8.0.59",
            "--output",
            str(output),
        ],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert output.exists()
    default_after = default_output.read_bytes() if default_output.exists() else None
    assert default_after == default_before
