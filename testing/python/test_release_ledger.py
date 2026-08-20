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
        {
            "app_version": "8.34.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.34.0-stable-runtime-a14261820c55",
            "channel": "stable",
            "created_at": "2026-08-19T08:21:16Z",
            "database": {"min_version": "9.2.0", "target_version": "9.2.0"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "a57474f200d8e0369ed0c791ed7159d10f0d3b2e8c19f6395101f6e6b88f5d07"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.34.0-stable-runtime-a14261820c55",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "a14261820c555086fb38189b48c7f2ccbc5b9643",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.34.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.34.0-stable-runtime-6b290718643c",
            "channel": "stable",
            "created_at": "2026-08-19T08:28:01Z",
            "database": {"min_version": "9.2.0", "target_version": "9.2.0"},
            "maturity": "published",
            "previous_record_sha256": (
                "d0d631d8c10186697a517a7325491794c773b7c896224385824c213615da6674"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.34.0-stable-runtime-6b290718643c",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "6b290718643c40818f8397e186a777b73e2ec301",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.34.1",
            "artifact_type": "runtime",
            "build_id": "filterest-8.34.1-stable-runtime-326dc36fea50",
            "channel": "stable",
            "created_at": "2026-08-19T14:17:50Z",
            "database": {"min_version": "9.2.0", "target_version": "9.2.0"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "9b0b57d52194aa10a9224f28a6e2e702aab67375c93d475628d9f8c7f6757ace"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.34.1-stable-runtime-326dc36fea50",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "326dc36fea50f049e7023d2415b59d7cc7358b1e",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.34.1",
            "artifact_type": "runtime",
            "build_id": "filterest-8.34.1-stable-runtime-3ffab82cad53",
            "channel": "stable",
            "created_at": "2026-08-19T14:25:06Z",
            "database": {"min_version": "9.2.0", "target_version": "9.2.0"},
            "maturity": "published",
            "previous_record_sha256": (
                "d307825371e64d5a2383f993de146915b8a864e3e4d66ebfe68a29e011e15430"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.34.1-stable-runtime-3ffab82cad53",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "3ffab82cad532071ca884518e2c24f5c76a29f34",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.35.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.35.0-stable-runtime-53f8267e42a1",
            "channel": "stable",
            "created_at": "2026-08-19T19:48:10Z",
            "database": {"min_version": "9.2.1", "target_version": "9.2.1"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "34649f702771aee7a4f0c286487028a3483459d785da42d266b1262b321d6d5c"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.35.0-stable-runtime-53f8267e42a1",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "53f8267e42a1e0b797d94eaf7af50c0dedc4bc01",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.35.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.35.0-stable-runtime-d7ab9a2105c7",
            "channel": "stable",
            "created_at": "2026-08-19T19:53:37Z",
            "database": {"min_version": "9.2.1", "target_version": "9.2.1"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "939462d69e89e308b5c4d721417a78ec042aae260b6e1ce42092659a2b44cb82"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.35.0-stable-runtime-d7ab9a2105c7",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "d7ab9a2105c7e068800ce7c38e02f9c7c7a49a01",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.35.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.35.0-stable-runtime-eb8b3057ab8f",
            "channel": "stable",
            "created_at": "2026-08-19T20:00:06Z",
            "database": {"min_version": "9.2.1", "target_version": "9.2.1"},
            "maturity": "published",
            "previous_record_sha256": (
                "7e2d9e93fce07bf7d1b7d7ff4636db3aee7b5f28eb33a9062410ae1c70011a14"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.35.0-stable-runtime-eb8b3057ab8f",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "eb8b3057ab8fbb9d27c5c6ed6038c48b03952bc5",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.35.1",
            "artifact_type": "runtime",
            "build_id": "filterest-8.35.1-stable-runtime-5f21f2fb4809",
            "channel": "stable",
            "created_at": "2026-08-19T20:22:20Z",
            "database": {"min_version": "9.2.1", "target_version": "9.2.1"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "19924a4d82dcf2306e90136fd392a1284c613b5e8dba339f895484605cc1a2ed"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.35.1-stable-runtime-5f21f2fb4809",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "5f21f2fb4809de8d06de6c803311b3338987bc0c",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.35.1",
            "artifact_type": "runtime",
            "build_id": "filterest-8.35.1-stable-runtime-37f117a81a18",
            "channel": "stable",
            "created_at": "2026-08-19T20:28:52Z",
            "database": {"min_version": "9.2.1", "target_version": "9.2.1"},
            "maturity": "published",
            "previous_record_sha256": (
                "2d755817744a1d611c81c7df6c6c3d9fc5a56726c6838aae02d384d525dda1b5"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.35.1-stable-runtime-37f117a81a18",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "37f117a81a185b8d20b9bf8d29b003949a1162b8",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.35.2",
            "artifact_type": "runtime",
            "build_id": "filterest-8.35.2-stable-runtime-c786647015d5",
            "channel": "stable",
            "created_at": "2026-08-19T21:21:36Z",
            "database": {"min_version": "9.2.1", "target_version": "9.2.1"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "fe38fd20830468be39cb70650242fc944afbe11a7e6bb7b98eb050e828cfd6a1"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.35.2-stable-runtime-c786647015d5",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "c786647015d557c4618e1726185c4af8df2201dc",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.35.2",
            "artifact_type": "runtime",
            "build_id": "filterest-8.35.2-stable-runtime-1fb013eca1ed",
            "channel": "stable",
            "created_at": "2026-08-19T21:29:29Z",
            "database": {"min_version": "9.2.1", "target_version": "9.2.1"},
            "maturity": "published",
            "previous_record_sha256": (
                "f55ce7e3f54e9232d626972df53f129909e76bf0163f8a3b64273d854ef3e1b2"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.35.2-stable-runtime-1fb013eca1ed",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "1fb013eca1edf980b7eb40df510820636b283b66",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.36.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.36.0-stable-runtime-4fedce4c4390",
            "channel": "stable",
            "created_at": "2026-08-20T07:25:20Z",
            "database": {"min_version": "9.2.2", "target_version": "9.2.2"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "47e47afdf4f61a8a482b5405fcbe78ec6bdc566d69da6f1b64f30f6bb7388d57"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.36.0-stable-runtime-4fedce4c4390",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "4fedce4c4390fe775e916c238f28a6e1bb1222d4",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.36.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.36.0-stable-runtime-67c0fc8d409e",
            "channel": "stable",
            "created_at": "2026-08-20T07:32:39Z",
            "database": {"min_version": "9.2.2", "target_version": "9.2.2"},
            "maturity": "published",
            "previous_record_sha256": (
                "fc148b3ef7f0700d6420e64d73215d4879b91c37c08dad7787527e01e738c819"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.36.0-stable-runtime-67c0fc8d409e",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "67c0fc8d409e0efb2037dc54ca007a8e1dcd748e",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.36.1",
            "artifact_type": "runtime",
            "build_id": "filterest-8.36.1-stable-runtime-b119f075fd6c",
            "channel": "stable",
            "created_at": "2026-08-20T08:40:01Z",
            "database": {"min_version": "9.2.2", "target_version": "9.2.2"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "7bbe146dc41419afc3dc79f61e64cfcf570a53b309ffb1511a13e16344c96e88"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.36.1-stable-runtime-b119f075fd6c",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "b119f075fd6ce37d435798b6da914c4a134311cd",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.36.1",
            "artifact_type": "runtime",
            "build_id": "filterest-8.36.1-stable-runtime-a527a5f1a8e9",
            "channel": "stable",
            "created_at": "2026-08-20T08:44:54Z",
            "database": {"min_version": "9.2.2", "target_version": "9.2.2"},
            "maturity": "published",
            "previous_record_sha256": (
                "030055519373f73196015f3f06a4274626df506c1e2124f5d319a367022f9c98"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.36.1-stable-runtime-a527a5f1a8e9",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "a527a5f1a8e9190462c8bf7f3b539dd3947486cf",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.36.2",
            "artifact_type": "runtime",
            "build_id": "filterest-8.36.2-stable-runtime-5a320b28f3a7",
            "channel": "stable",
            "created_at": "2026-08-20T09:12:26Z",
            "database": {"min_version": "9.2.2", "target_version": "9.2.2"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "19afae167ffce0d12f5d290f0c7ece4d40598ee7420df6fa8ee6223ad1699738"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.36.2-stable-runtime-5a320b28f3a7",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "5a320b28f3a7caafb482364873e75174a90b470d",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.36.2",
            "artifact_type": "runtime",
            "build_id": "filterest-8.36.2-stable-runtime-002dbd653495",
            "channel": "stable",
            "created_at": "2026-08-20T09:16:59Z",
            "database": {"min_version": "9.2.2", "target_version": "9.2.2"},
            "maturity": "published",
            "previous_record_sha256": (
                "495a4bcba1184b2324f68f22c49501d3f65cbf9a8653c0e01665873df19fde21"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.36.2-stable-runtime-002dbd653495",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "002dbd653495d1e772a722be0f983ffdaa3bad69",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.36.3",
            "artifact_type": "runtime",
            "build_id": "filterest-8.36.3-stable-runtime-fdb3bca96295",
            "channel": "stable",
            "created_at": "2026-08-20T10:29:42Z",
            "database": {"min_version": "9.2.3", "target_version": "9.2.3"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "83215ab990973e7e098dfb87aa2337d7c56ab0a70ef48c6a599d80ead5e65e59"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.36.3-stable-runtime-fdb3bca96295",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "fdb3bca96295b29745a01f302e2bc93bf9eaf8fa",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.36.3",
            "artifact_type": "runtime",
            "build_id": "filterest-8.36.3-stable-runtime-20e9bb8e7e9d",
            "channel": "stable",
            "created_at": "2026-08-20T10:33:24Z",
            "database": {"min_version": "9.2.3", "target_version": "9.2.3"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "a3eef0568349dc89ad161ae615bae25266ab5b4adad9f5efb1339bb9974e9674"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.36.3-stable-runtime-20e9bb8e7e9d",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "20e9bb8e7e9d38282f959d4439285390b01b4520",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.36.3",
            "artifact_type": "runtime",
            "build_id": "filterest-8.36.3-stable-runtime-1786735091a3",
            "channel": "stable",
            "created_at": "2026-08-20T10:38:19Z",
            "database": {"min_version": "9.2.3", "target_version": "9.2.3"},
            "maturity": "published",
            "previous_record_sha256": (
                "9b55b4b6c199dd86b4ba0a0d20c85071759ca2cf3a4d64f4b67181b493fbbb67"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.36.3-stable-runtime-1786735091a3",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "1786735091a31add379ce0de2c91d7cea2c9fc5d",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.36.4",
            "artifact_type": "runtime",
            "build_id": "filterest-8.36.4-stable-runtime-c62b702e8801",
            "channel": "stable",
            "created_at": "2026-08-20T11:30:47Z",
            "database": {"min_version": "9.2.3", "target_version": "9.2.3"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "41d1ee3223bb6341fd04c3e2155419c2c4fec74ae9af84d30814389c66f13914"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.36.4-stable-runtime-c62b702e8801",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "c62b702e88014e2a77c3fcd4b9d22638e4a36c18",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.36.4",
            "artifact_type": "runtime",
            "build_id": "filterest-8.36.4-stable-runtime-7487bea1ec09",
            "channel": "stable",
            "created_at": "2026-08-20T11:35:45Z",
            "database": {"min_version": "9.2.3", "target_version": "9.2.3"},
            "maturity": "published",
            "previous_record_sha256": (
                "40b40b73a3ad7c70f0ccd304f98540738991a490f9ea8219bbd709d60eca6afb"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.36.4-stable-runtime-7487bea1ec09",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "7487bea1ec09a54a005ac20f12d36e0fe181b161",
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
