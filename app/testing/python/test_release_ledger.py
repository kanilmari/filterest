"""Offline proofs for the immutable Filterest release-ledger v1 contract."""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
FILTEREST_ROOT = (
    REPO_ROOT / "filterest"
    if (REPO_ROOT / "filterest/go.mod").is_file()
    else REPO_ROOT
)
sys.path.insert(0, str(FILTEREST_ROOT))
LEDGER = FILTEREST_ROOT / "server_tools/versioning/release_ledger.v1.jsonl"
LEDGER_SCHEMA = (
    FILTEREST_ROOT / "server_tools/versioning/release_ledger_record.v1.schema.json"
)
VALIDATOR = FILTEREST_ROOT / "server_tools/scripts/validate_release_ledger.py"
APPENDER = FILTEREST_ROOT / "server_tools/scripts/append_release_ledger_record.py"

from server_tools.scripts.append_release_ledger_record import (  # noqa: E402
    append_build_record,
)
from server_tools.versioning.release_contract_v1 import (  # noqa: E402
    ReleaseContractError,
    canonical_json_line,
    validate_append_only,
    validate_ledger_bytes,
)


def make_record(
    *,
    version: str = "8.30.0",
    commit: str = "1" * 40,
    channel: str = "stable",
    artifact_type: str = "runtime",
    maturity: str = "candidate",
    previous_line: bytes | None = None,
    created_at: str = "2026-08-16T12:00:00Z",
) -> dict[str, object]:
    build_id = f"filterest-{version}-{channel}-{artifact_type}-{commit[:12]}"
    return {
        "schema_version": 1,
        "record_type": "build",
        "record_id": f"build:{build_id}",
        "previous_record_sha256": (
            None if previous_line is None else hashlib.sha256(previous_line).hexdigest()
        ),
        "product": "filterest",
        "build_id": build_id,
        "app_version": version,
        "artifact_type": artifact_type,
        "channel": channel,
        "maturity": maturity,
        "source": {"model": "public_first", "commit": commit},
        "database": {"min_version": "8.0.59", "target_version": "8.0.59"},
        "created_at": created_at,
    }


# Public release ae831fe7c01ca50636fdefadefb2d61048915ba8 (v9.3.2).
# This immutable prefix pins every historical byte without listing future versions.
PUBLISHED_HISTORY_RECORDS = 133
PUBLISHED_HISTORY_SHA256 = "4f9104492a421480cdcac593762912655405df9627d7727b7593d51ccfe6b6d8"


def validate_repository_history(data: bytes):
    lines = data.splitlines(keepends=True)
    assert len(lines) >= PUBLISHED_HISTORY_RECORDS, "Published ledger history was truncated"
    published_prefix = b"".join(lines[:PUBLISHED_HISTORY_RECORDS])
    assert hashlib.sha256(published_prefix).hexdigest() == PUBLISHED_HISTORY_SHA256, (
        "Published ledger prefix changed"
    )
    # New records follow the maintained schema, hash chain and release-state
    # rules, rather than another version/database allowlist maintained by tests.
    return validate_append_only(data, published_prefix)


def test_repository_ledger_has_exact_append_only_candidate_history() -> None:
    entries = validate_repository_history(LEDGER.read_bytes())
    assert len(entries) >= PUBLISHED_HISTORY_RECORDS


def test_repository_history_accepts_future_version_without_allowlist() -> None:
    previous = LEDGER.read_bytes()
    historical_entries = validate_repository_history(previous)
    future = make_record(
        version="123.45.67",
        commit="f" * 40,
        previous_line=previous.splitlines(keepends=True)[-1],
        created_at="2099-01-01T00:00:00Z",
    )
    future["database"] = deepcopy(historical_entries[-1].record["database"])
    entries = validate_repository_history(previous + canonical_json_line(future))
    assert len(entries) == len(historical_entries) + 1
    assert entries[-1].record == future


def test_repository_history_rejects_a_rehashed_historical_change() -> None:
    records = [json.loads(line) for line in LEDGER.read_bytes().splitlines()]
    records[0]["created_at"] = "2026-08-16T13:29:00Z"
    rewritten_lines = []
    for record in records:
        record["previous_record_sha256"] = (
            hashlib.sha256(rewritten_lines[-1]).hexdigest() if rewritten_lines else None
        )
        rewritten_lines.append(canonical_json_line(record))
    rewritten = b"".join(rewritten_lines)
    validate_ledger_bytes(rewritten)  # A self-consistent new chain is not old history.
    with pytest.raises(AssertionError, match="Published ledger prefix changed"):
        validate_repository_history(rewritten)


def test_valid_hash_chain_and_exact_append_pass() -> None:
    first_line = canonical_json_line(make_record())
    second_line = canonical_json_line(
        make_record(
            version="8.30.1",
            commit="2" * 40,
            previous_line=first_line,
            created_at="2026-08-17T12:00:00Z",
        )
    )
    previous = first_line
    current = first_line + second_line

    entries = validate_append_only(current, previous)

    assert [entry.record["app_version"] for entry in entries] == ["8.30.0", "8.30.1"]
    assert entries[0].sha256 == hashlib.sha256(first_line).hexdigest()


def test_same_version_and_source_can_have_distinct_channels_and_artifact_types() -> None:
    development_line = canonical_json_line(
        make_record(channel="development", maturity="snapshot")
    )
    stable_line = canonical_json_line(
        make_record(previous_line=development_line)
    )
    backup_line = canonical_json_line(
        make_record(
            artifact_type="backup",
            maturity="snapshot",
            previous_line=stable_line,
        )
    )

    entries = validate_ledger_bytes(development_line + stable_line + backup_line)

    assert len({entry.record["build_id"] for entry in entries}) == 3
    assert entries[0].record["build_id"].endswith("development-runtime-111111111111")
    assert entries[2].record["build_id"].endswith("stable-backup-111111111111")


def test_prior_record_mutation_fails_byte_prefix_check() -> None:
    previous = canonical_json_line(make_record())
    mutated = canonical_json_line(make_record(created_at="2026-08-16T12:00:01Z"))

    with pytest.raises(ReleaseContractError, match="byte-for-byte"):
        validate_append_only(mutated, previous)


def test_prior_record_deletion_fails_byte_prefix_check() -> None:
    first_line = canonical_json_line(make_record())
    second_line = canonical_json_line(
        make_record(
            version="8.30.1",
            commit="2" * 40,
            previous_line=first_line,
            created_at="2026-08-17T12:00:00Z",
        )
    )

    with pytest.raises(ReleaseContractError, match="byte-for-byte"):
        validate_append_only(first_line, first_line + second_line)


def test_prior_record_reordering_fails_byte_prefix_check() -> None:
    first_record = make_record()
    first_line = canonical_json_line(first_record)
    second_record = make_record(
        version="8.30.1",
        commit="2" * 40,
        previous_line=first_line,
        created_at="2026-08-17T12:00:00Z",
    )
    second_line = canonical_json_line(second_record)
    reordered_first = deepcopy(second_record)
    reordered_first["previous_record_sha256"] = None
    reordered_first_line = canonical_json_line(reordered_first)
    reordered_second = deepcopy(first_record)
    reordered_second["previous_record_sha256"] = hashlib.sha256(
        reordered_first_line
    ).hexdigest()
    reordered = reordered_first_line + canonical_json_line(reordered_second)

    with pytest.raises(ReleaseContractError, match="byte-for-byte"):
        validate_append_only(reordered, first_line + second_line)


def test_incorrect_hash_chain_is_rejected() -> None:
    first_line = canonical_json_line(make_record())
    second = make_record(version="8.30.1", commit="2" * 40, previous_line=first_line)
    second["previous_record_sha256"] = "0" * 64

    with pytest.raises(ReleaseContractError, match="exact previous line"):
        validate_ledger_bytes(first_line + canonical_json_line(second))


def test_duplicate_record_and_build_identity_is_rejected() -> None:
    first = make_record()
    first_line = canonical_json_line(first)
    duplicate = deepcopy(first)
    duplicate["previous_record_sha256"] = hashlib.sha256(first_line).hexdigest()

    with pytest.raises(ReleaseContractError, match="duplicates record_id"):
        validate_ledger_bytes(first_line + canonical_json_line(duplicate))


def test_second_published_stable_version_is_rejected() -> None:
    first_line = canonical_json_line(make_record(maturity="published"))
    second_line = canonical_json_line(
        make_record(
            commit="2" * 40,
            maturity="published",
            previous_line=first_line,
            created_at="2026-08-17T12:00:00Z",
        )
    )

    with pytest.raises(ReleaseContractError, match="published stable app_version"):
        validate_ledger_bytes(first_line + second_line)


def test_published_stable_version_can_be_republished_after_new_candidate() -> None:
    first = make_record(maturity="published")
    first_line = canonical_json_line(first)
    candidate = make_record(
        commit="2" * 40,
        maturity="candidate",
        previous_line=first_line,
        created_at="2026-08-24T12:00:00Z",
    )
    candidate_line = canonical_json_line(candidate)
    published = make_record(
        commit="3" * 40,
        maturity="published",
        previous_line=candidate_line,
        created_at="2026-08-24T13:00:00Z",
    )

    validate_ledger_bytes(first_line + candidate_line + canonical_json_line(published))


@pytest.mark.parametrize("channel", ["nightly", "preview"])
def test_v1_rejects_non_development_or_stable_channel(channel: str) -> None:
    with pytest.raises(ReleaseContractError, match="channel must be one of"):
        validate_ledger_bytes(canonical_json_line(make_record(channel=channel)))


def test_development_and_backup_are_snapshot_only() -> None:
    with pytest.raises(ReleaseContractError, match="development artifacts"):
        validate_ledger_bytes(
            canonical_json_line(
                make_record(channel="development", maturity="candidate")
            )
        )


def test_database_target_cannot_be_older_than_minimum() -> None:
    record = make_record()
    record["database"] = {"min_version": "8.0.59", "target_version": "8.0.58"}

    with pytest.raises(ReleaseContractError, match="must not be older"):
        validate_ledger_bytes(canonical_json_line(record))
    with pytest.raises(ReleaseContractError, match="backup artifacts"):
        validate_ledger_bytes(
            canonical_json_line(make_record(artifact_type="backup", maturity="candidate"))
        )


def test_unknown_fields_and_noncanonical_json_are_rejected() -> None:
    record = make_record()
    record["mutable_status"] = "active"
    with pytest.raises(ReleaseContractError, match="unexpected mutable_status"):
        validate_ledger_bytes(canonical_json_line(record))

    valid_record = make_record()
    pretty_line = (json.dumps(valid_record, separators=(", ", ": ")) + "\n").encode(
        "utf-8"
    )
    with pytest.raises(ReleaseContractError, match="not canonical JSON"):
        validate_ledger_bytes(pretty_line)


def test_json_schema_exposes_only_v1_channels_and_dimensions() -> None:
    schema = json.loads(LEDGER_SCHEMA.read_text(encoding="utf-8"))

    assert schema["properties"]["channel"]["enum"] == ["development", "stable"]
    assert schema["properties"]["artifact_type"]["enum"] == ["runtime", "backup"]
    assert schema["properties"]["maturity"]["enum"] == [
        "snapshot",
        "candidate",
        "published",
    ]
    assert "nightly" not in LEDGER_SCHEMA.read_text(encoding="utf-8")


def test_validator_cli_is_offline_and_accepts_empty_ledger(tmp_path: Path) -> None:
    previous = tmp_path / "previous.jsonl"
    candidate = tmp_path / "candidate.jsonl"
    previous.write_bytes(b"")
    candidate.write_bytes(b"")

    result = subprocess.run(
        [
            sys.executable,
            str(VALIDATOR),
            str(candidate),
            "--previous",
            str(previous),
        ],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "release ledger valid: 0 record(s) with append-only history"


def append_explicit_record(ledger: Path, previous: Path, **overrides: str):
    arguments = {
        "ledger_path": ledger,
        "previous_path": previous,
        "app_version": "8.30.0",
        "artifact_type": "runtime",
        "channel": "stable",
        "maturity": "candidate",
        "source_model": "public_first",
        "source_commit": "a" * 40,
        "db_min_version": "8.0.59",
        "db_target_version": "8.0.59",
        "created_at": "2026-08-16T12:00:00Z",
    }
    arguments.update(overrides)
    return append_build_record(**arguments)


def test_append_cli_core_is_atomic_canonical_and_idempotent(tmp_path: Path) -> None:
    previous = tmp_path / "previous.jsonl"
    ledger = tmp_path / "release_ledger.v1.jsonl"
    previous.write_bytes(b"")
    ledger.write_bytes(b"")

    first_record, first_appended = append_explicit_record(ledger, previous)
    first_bytes = ledger.read_bytes()
    second_record, second_appended = append_explicit_record(ledger, previous)

    assert first_appended is True
    assert second_appended is False
    assert second_record == first_record
    assert ledger.read_bytes() == first_bytes == canonical_json_line(first_record)
    assert validate_append_only(first_bytes, b"")[0].record == first_record


def test_append_refuses_a_ledger_that_changed_before_the_baseline(tmp_path: Path) -> None:
    previous = tmp_path / "previous.jsonl"
    ledger = tmp_path / "release_ledger.v1.jsonl"
    baseline_line = canonical_json_line(make_record())
    previous.write_bytes(baseline_line)
    ledger.write_bytes(canonical_json_line(make_record(created_at="2026-08-16T12:00:01Z")))

    with pytest.raises(ReleaseContractError, match="byte-for-byte"):
        append_explicit_record(ledger, previous, app_version="8.30.1")


def test_append_rejects_an_existing_build_with_changed_immutable_data(
    tmp_path: Path,
) -> None:
    previous = tmp_path / "previous.jsonl"
    ledger = tmp_path / "release_ledger.v1.jsonl"
    previous.write_bytes(b"")
    ledger.write_bytes(b"")
    append_explicit_record(ledger, previous)

    with pytest.raises(ReleaseContractError, match="different immutable fields"):
        append_explicit_record(
            ledger,
            previous,
            created_at="2026-08-16T12:00:01Z",
        )


def test_append_cli_requires_every_release_dimension(tmp_path: Path) -> None:
    previous = tmp_path / "previous.jsonl"
    ledger = tmp_path / "release_ledger.v1.jsonl"
    previous.write_bytes(b"")
    ledger.write_bytes(b"")

    result = subprocess.run(
        [
            sys.executable,
            str(APPENDER),
            "--ledger",
            str(ledger),
            "--previous",
            str(previous),
        ],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "--app-version" in result.stderr
    assert ledger.read_bytes() == b""
