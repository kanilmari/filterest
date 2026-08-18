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
LEDGER = REPO_ROOT / "server_tools/versioning/release_ledger.v1.jsonl"
LEDGER_SCHEMA = REPO_ROOT / "server_tools/versioning/release_ledger_record.v1.schema.json"
VALIDATOR = REPO_ROOT / "server_tools/scripts/validate_release_ledger.py"
APPENDER = REPO_ROOT / "server_tools/scripts/append_release_ledger_record.py"

from server_tools.scripts.append_release_ledger_record import append_build_record  # noqa: E402
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


def test_repository_ledger_has_exact_append_only_candidate_history() -> None:
    entries = validate_ledger_bytes(LEDGER.read_bytes())

    assert [entry.record for entry in entries] == [
        {
            "app_version": "8.31.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.31.0-stable-runtime-127ebde13a05",
            "channel": "stable",
            "created_at": "2026-08-16T13:28:59Z",
            "database": {"min_version": "8.0.60", "target_version": "8.0.60"},
            "maturity": "candidate",
            "previous_record_sha256": None,
            "product": "filterest",
            "record_id": "build:filterest-8.31.0-stable-runtime-127ebde13a05",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "127ebde13a05bf8d903fb9195daa62d5ef14e853",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.32.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.32.0-stable-runtime-700c9e9bd1d8",
            "channel": "stable",
            "created_at": "2026-08-18T11:47:33Z",
            "database": {"min_version": "9.0.0", "target_version": "9.0.0"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "84a36201c47b334f500e84abcd77cdffc4dfebba57e3589020bd06c1c61e7e33"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.32.0-stable-runtime-700c9e9bd1d8",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "700c9e9bd1d8b31a263df8aa3d0cba31e9fbc84f",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.32.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.32.0-stable-runtime-3df4022927ce",
            "channel": "stable",
            "created_at": "2026-08-18T11:51:10Z",
            "database": {"min_version": "9.0.0", "target_version": "9.0.0"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "ccb08e71a002747b7e3ef72a89091016a007a6b5e90d8db01ad6fbcbec95d074"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.32.0-stable-runtime-3df4022927ce",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "3df4022927cee0d89a941ec4bbce01cf8765827b",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.32.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.32.0-stable-runtime-4f3b27753d64",
            "channel": "stable",
            "created_at": "2026-08-18T11:55:51Z",
            "database": {"min_version": "9.0.0", "target_version": "9.0.0"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "ed8f2bbd28a274bf01d063fb72491659334a06ab5e47a87cd46e5d2cf681df26"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.32.0-stable-runtime-4f3b27753d64",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "4f3b27753d6458e0ddffbc174c51712f817342d3",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.32.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.32.0-stable-runtime-1194727e59f0",
            "channel": "stable",
            "created_at": "2026-08-18T12:54:30Z",
            "database": {"min_version": "9.0.0", "target_version": "9.0.0"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "03ffccc053adb69f9cc6caa05d61a01d24f2a76a596ea796e4dd273083d51839"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.32.0-stable-runtime-1194727e59f0",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "1194727e59f0453784a98891080e8c2c93415d81",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.32.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.32.0-stable-runtime-b1c9f919673b",
            "channel": "stable",
            "created_at": "2026-08-18T13:26:33Z",
            "database": {"min_version": "9.0.0", "target_version": "9.0.0"},
            "maturity": "published",
            "previous_record_sha256": (
                "57175ee0392009428ec1c58dc24188350b402e00e36125f1beea426cf8c42a84"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.32.0-stable-runtime-b1c9f919673b",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "b1c9f919673b6956127025c58ff7085f807562d8",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.32.1",
            "artifact_type": "runtime",
            "build_id": "filterest-8.32.1-stable-runtime-4045145312c9",
            "channel": "stable",
            "created_at": "2026-08-18T14:00:53Z",
            "database": {"min_version": "9.0.0", "target_version": "9.0.0"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "ee869bc357c21e9b33dba7f40e4860d9cbcf637af2e4383a563072bcd4975ed8"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.32.1-stable-runtime-4045145312c9",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "4045145312c9df1ac6d99186af690b5db01f55e5",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.32.1",
            "artifact_type": "runtime",
            "build_id": "filterest-8.32.1-stable-runtime-9953bcb4b1f4",
            "channel": "stable",
            "created_at": "2026-08-18T14:06:25Z",
            "database": {"min_version": "9.0.0", "target_version": "9.0.0"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "143cacbbde53f7c6a8b91c10a46318f7636645aef3f0b7a179206156469feb87"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.32.1-stable-runtime-9953bcb4b1f4",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "9953bcb4b1f4ef77aa4882f2fc3d80f52fb05113",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.32.1",
            "artifact_type": "runtime",
            "build_id": "filterest-8.32.1-stable-runtime-f7aa853c27a6",
            "channel": "stable",
            "created_at": "2026-08-18T14:14:00Z",
            "database": {"min_version": "9.0.0", "target_version": "9.0.0"},
            "maturity": "published",
            "previous_record_sha256": (
                "93dc46c694d759ad414fa4b95eb77c2ea835e833640262fdf58b6870bb704ab1"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.32.1-stable-runtime-f7aa853c27a6",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "f7aa853c27a6e49e045b7f8097fe8816d204a423",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.32.2",
            "artifact_type": "runtime",
            "build_id": "filterest-8.32.2-stable-runtime-72c1cd5dbd56",
            "channel": "stable",
            "created_at": "2026-08-18T14:31:30Z",
            "database": {"min_version": "9.0.0", "target_version": "9.0.0"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "4f8c4241f2d3f5d1676c93b304b1cd800f3bb90228a579322499ba096b9c4885"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.32.2-stable-runtime-72c1cd5dbd56",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "72c1cd5dbd56f6ed9bc20d639d30488123d8fb4f",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.32.2",
            "artifact_type": "runtime",
            "build_id": "filterest-8.32.2-stable-runtime-c19b15aba153",
            "channel": "stable",
            "created_at": "2026-08-18T14:42:25Z",
            "database": {"min_version": "9.0.0", "target_version": "9.0.0"},
            "maturity": "published",
            "previous_record_sha256": (
                "80ace6d73c3152eb014f1fa1e66c67dac3d9094848ab6933c2aea115f53c7a47"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.32.2-stable-runtime-c19b15aba153",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "c19b15aba153527b7f8b3f18e1667889b9c6b556",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.33.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.33.0-stable-runtime-b32863d2f841",
            "channel": "stable",
            "created_at": "2026-08-18T19:00:31Z",
            "database": {"min_version": "9.1.0", "target_version": "9.1.0"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "7ac9d521bd2fee4735769ab1da4606ac76618266be20bdeeef20e5dae6cb4b4f"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.33.0-stable-runtime-b32863d2f841",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "b32863d2f8411b37bc894396a1e0d3b1c4621de5",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.33.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.33.0-stable-runtime-23344d6d5e33",
            "channel": "stable",
            "created_at": "2026-08-18T19:14:11Z",
            "database": {"min_version": "9.1.0", "target_version": "9.1.0"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "c8c392564f9b27385ef59da47bd9c5bb13030c1482815057ea5e6b0c671e6a03"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.33.0-stable-runtime-23344d6d5e33",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "23344d6d5e33ada682038b026f76a0838df3f93e",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.33.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.33.0-stable-runtime-2b1fcacbeebc",
            "channel": "stable",
            "created_at": "2026-08-18T19:24:37Z",
            "database": {"min_version": "9.1.0", "target_version": "9.1.0"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "8df99b2cb93ae138465e7a351233abe13eb8590fbd3c975f9c6196dd98aee02d"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.33.0-stable-runtime-2b1fcacbeebc",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "2b1fcacbeebc417af5a2792ed0455c18862661e2",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.33.1",
            "artifact_type": "runtime",
            "build_id": "filterest-8.33.1-stable-runtime-147baabd550b",
            "channel": "stable",
            "created_at": "2026-08-18T21:34:39Z",
            "database": {"min_version": "9.1.0", "target_version": "9.1.0"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "ee9cf3848ebfe8f5bba9b631ee6bd72f2ffa7669a8a4550c2e797c31cca391cf"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.33.1-stable-runtime-147baabd550b",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "147baabd550b54aa6fe345c320cc01df17c5395c",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.33.1",
            "artifact_type": "runtime",
            "build_id": "filterest-8.33.1-stable-runtime-cd259b10a1b4",
            "channel": "stable",
            "created_at": "2026-08-18T21:39:09Z",
            "database": {"min_version": "9.1.0", "target_version": "9.1.0"},
            "maturity": "published",
            "previous_record_sha256": (
                "49043d9f68c50e97ad9c723057b847347b0aab1c084c2d5b706942bd1336ce38"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.33.1-stable-runtime-cd259b10a1b4",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "cd259b10a1b4f3b5cb800389e0edb23ae1cb995a",
                "model": "legacy_maintainer_export",
            },
        },
    ]
    assert all(entry.record["app_version"] != "8.29.4" for entry in entries)


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
