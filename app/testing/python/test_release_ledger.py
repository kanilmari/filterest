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


def test_repository_ledger_has_exact_append_only_candidate_history() -> None:
    entries = validate_ledger_bytes(LEDGER.read_bytes())

    expected_records = [
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
        {
            "app_version": "8.37.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.37.0-stable-runtime-5d67ee1c71dd",
            "channel": "stable",
            "created_at": "2026-08-20T13:51:43Z",
            "database": {"min_version": "9.2.4", "target_version": "9.2.4"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "b942599cebc49bd02b771721ba9c9b4ebc5a0fcd44e5bb07078d4efb73e27fa2"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.37.0-stable-runtime-5d67ee1c71dd",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "5d67ee1c71dd15c4d808fafdec04c0ecdf522904",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.37.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.37.0-stable-runtime-cc4a1d139653",
            "channel": "stable",
            "created_at": "2026-08-20T13:56:40Z",
            "database": {"min_version": "9.2.4", "target_version": "9.2.4"},
            "maturity": "published",
            "previous_record_sha256": (
                "5f7024c857784caa0fa2c215b4208851545d253f0d526361e1fcec5b9659ac9e"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.37.0-stable-runtime-cc4a1d139653",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "cc4a1d139653a55944c22268435a480ee9a94cbb",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.37.1",
            "artifact_type": "runtime",
            "build_id": "filterest-8.37.1-stable-runtime-07fbefe64a32",
            "channel": "stable",
            "created_at": "2026-08-20T20:39:37Z",
            "database": {"min_version": "9.2.5", "target_version": "9.2.5"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "e9647f9515c47c668ee3724a3e1dd2aceb2824a34b29228d2ecc5de0e0e62b78"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.37.1-stable-runtime-07fbefe64a32",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "07fbefe64a32abc26e1a5db5e35174d46066a154",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.37.1",
            "artifact_type": "runtime",
            "build_id": "filterest-8.37.1-stable-runtime-65a19ecc2d39",
            "channel": "stable",
            "created_at": "2026-08-20T20:45:08Z",
            "database": {"min_version": "9.2.5", "target_version": "9.2.5"},
            "maturity": "published",
            "previous_record_sha256": (
                "dcc6e8cd020cdfbaf81e70ff05f4f9d3bd274309d55c71cc23bd6af83674da10"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.37.1-stable-runtime-65a19ecc2d39",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "65a19ecc2d39353858548b4557c97f1346db7731",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.38.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.38.0-stable-runtime-cacda14ca24a",
            "channel": "stable",
            "created_at": "2026-08-22T12:27:13Z",
            "database": {"min_version": "9.3.0", "target_version": "9.3.0"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "a2107af665936605f832a79884178f2d3737986fec8032bae7ef2c5697ae52bc"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.38.0-stable-runtime-cacda14ca24a",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "cacda14ca24a2122f2591406dc7b4268b84e1a99",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.38.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.38.0-stable-runtime-c4befddd6fc7",
            "channel": "stable",
            "created_at": "2026-08-22T12:42:59Z",
            "database": {"min_version": "9.3.0", "target_version": "9.3.0"},
            "maturity": "published",
            "previous_record_sha256": (
                "276abc7e55a5d243a650d0ed06aec1a1ab5932d4f2057ad7fd0c3b6ef5adba52"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.38.0-stable-runtime-c4befddd6fc7",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "c4befddd6fc7cc8f7561e55b386f54a2375373c7",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.0-stable-runtime-503c409b1b8b",
            "channel": "stable",
            "created_at": "2026-08-22T23:49:33Z",
            "database": {"min_version": "9.6.0", "target_version": "9.6.0"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "c9deed1e4ac5d8a213a3e331568f9a0f14d89124a439ac2d961f3a69cc8df670"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.0-stable-runtime-503c409b1b8b",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "503c409b1b8bc8f7731c3ef9b3f9828b8e7f8e3e",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.0-stable-runtime-2a36d319e5f9",
            "channel": "stable",
            "created_at": "2026-08-22T23:51:48Z",
            "database": {"min_version": "9.6.0", "target_version": "9.6.0"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "0502c52ed957564b29a12ee97ed8f805017909a869e67ea891f3cc7e142c4a6e"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.0-stable-runtime-2a36d319e5f9",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "2a36d319e5f9c427145b327e87b91e17cd154ac1",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.0",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.0-stable-runtime-f13d2d4a20b5",
            "channel": "stable",
            "created_at": "2026-08-22T23:56:55Z",
            "database": {"min_version": "9.6.0", "target_version": "9.6.0"},
            "maturity": "published",
            "previous_record_sha256": (
                "44e3dc50ecaaa2a1c725c6ea1eae193ab5bffb30f4a1f959d00940e86c2ad71f"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.0-stable-runtime-f13d2d4a20b5",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "f13d2d4a20b5b3f06a9531cfffedbc56cbdc521e",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.2",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.2-stable-runtime-b694f2c83b28",
            "channel": "stable",
            "created_at": "2026-08-23T19:34:07Z",
            "database": {"min_version": "9.6.1", "target_version": "9.6.1"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "889c8857781bcd534d0cbecd503925a33b93d6c87a3b8004a496b28dd7582360"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.2-stable-runtime-b694f2c83b28",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "b694f2c83b28087e7c2ab05bffe648a4ce7b19d2",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.2",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.2-stable-runtime-0cb4325481be",
            "channel": "stable",
            "created_at": "2026-08-23T19:39:23Z",
            "database": {"min_version": "9.6.1", "target_version": "9.6.1"},
            "maturity": "published",
            "previous_record_sha256": (
                "d86879379fd0e6918f91103dfb8e7c722ac8b4cab904e682d30e018ffbb08970"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.2-stable-runtime-0cb4325481be",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "0cb4325481bed79b2ed9d1586541b4c8fa258fde",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.3",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.3-stable-runtime-8494d104dbb6",
            "channel": "stable",
            "created_at": "2026-08-23T20:44:58Z",
            "database": {"min_version": "9.6.1", "target_version": "9.6.1"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "b2311b08d15cdb6e7d78f7967178f7c6405f1e54a34370d46b2ba5335cb1f566"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.3-stable-runtime-8494d104dbb6",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "8494d104dbb6f37236d597d21d6a8d6839a0aa87",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.3",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.3-stable-runtime-5c8871d073eb",
            "channel": "stable",
            "created_at": "2026-08-23T20:49:25Z",
            "database": {"min_version": "9.6.1", "target_version": "9.6.1"},
            "maturity": "published",
            "previous_record_sha256": (
                "d4de41b2db0d94cb857fe85e597766c0230e41c6aec8d5e754dd7f9796f220b0"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.3-stable-runtime-5c8871d073eb",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "5c8871d073eb4dac598455b74fec180c3ac0bc87",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.4",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.4-stable-runtime-c93a8fee2ce5",
            "channel": "stable",
            "created_at": "2026-08-23T22:38:15Z",
            "database": {"min_version": "9.6.2", "target_version": "9.6.2"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "d54867d58165eea2da5d23f8c456414927d37704f919f9313175d3a6c6be6951"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.4-stable-runtime-c93a8fee2ce5",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "c93a8fee2ce5c0567d7e9950bdc450e6845ac9b0",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.4",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.4-stable-runtime-7654f105891f",
            "channel": "stable",
            "created_at": "2026-08-23T22:46:20Z",
            "database": {"min_version": "9.6.2", "target_version": "9.6.2"},
            "maturity": "published",
            "previous_record_sha256": (
                "c3ef54e1429eac9911af03d226fc9b62186460601eb9937b5a75e92826848af6"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.4-stable-runtime-7654f105891f",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "7654f105891f3b345154a5e0af5d916c150451dc",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.5",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.5-stable-runtime-894f60e2af69",
            "channel": "stable",
            "created_at": "2026-08-23T23:02:18Z",
            "database": {"min_version": "9.6.2", "target_version": "9.6.2"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "ff0a7a175298b5d393575b9f61a83938534cb3b16ced8d0b38fe2bac517c19f1"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.5-stable-runtime-894f60e2af69",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "894f60e2af69a60ca048fb986ab56fe87bfc81dd",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.5",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.5-stable-runtime-1154d27895d8",
            "channel": "stable",
            "created_at": "2026-08-23T23:06:34Z",
            "database": {"min_version": "9.6.2", "target_version": "9.6.2"},
            "maturity": "published",
            "previous_record_sha256": (
                "a667eb453e3d2e879ea97082c076715282211752ac2fc0a86dccf3023195669e"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.5-stable-runtime-1154d27895d8",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "1154d27895d871fc302cf88398409a478a6c082e",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.6",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.6-stable-runtime-5b5f9834e8ca",
            "channel": "stable",
            "created_at": "2026-08-23T23:30:30Z",
            "database": {"min_version": "9.6.2", "target_version": "9.6.2"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "53e852e21bc31a358c36817b847958d7a956e242ad1391b1e760cc2232fe8edc"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.6-stable-runtime-5b5f9834e8ca",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "5b5f9834e8ca2fa8877f7a06f68be0443f2be43e",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.6",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.6-stable-runtime-e93cb6b5c9d1",
            "channel": "stable",
            "created_at": "2026-08-23T23:36:07Z",
            "database": {"min_version": "9.6.2", "target_version": "9.6.2"},
            "maturity": "published",
            "previous_record_sha256": (
                "2c0dfa63ab10300ed10e48853c90368c9aad26e98fa1fc10981012dd5f7c30f9"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.6-stable-runtime-e93cb6b5c9d1",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "e93cb6b5c9d1b7020894202c803c59db4775e440",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.7",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.7-stable-runtime-ce1b2f3baf66",
            "channel": "stable",
            "created_at": "2026-08-24T00:25:30Z",
            "database": {"min_version": "9.6.2", "target_version": "9.6.2"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "76c149a1b3153f14508399a5e533ec204e271115c98c7949fcbcf03174430ef6"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.7-stable-runtime-ce1b2f3baf66",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "ce1b2f3baf661ec77918f72a85dc080ea1fd377d",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.7",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.7-stable-runtime-3256b36f3e9d",
            "channel": "stable",
            "created_at": "2026-08-24T00:32:19Z",
            "database": {"min_version": "9.6.2", "target_version": "9.6.2"},
            "maturity": "published",
            "previous_record_sha256": (
                "20a5e847605ef830419fcf8b6f2929999cbb102d3a683b55c5af224e10920fd2"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.7-stable-runtime-3256b36f3e9d",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "3256b36f3e9d638af1f2e35f78e1b0deda4df520",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.8",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.8-stable-runtime-5df788a25d15",
            "channel": "stable",
            "created_at": "2026-08-24T10:06:39Z",
            "database": {"min_version": "9.6.2", "target_version": "9.6.2"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "0dcffa7d882b2182beb554938e293fd574a9067e0dacf64d8fffb6b1ea49e31b"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.8-stable-runtime-5df788a25d15",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "5df788a25d154e464de194e2ba8ecab7b1f03830",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.8",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.8-stable-runtime-8a0bb9d872e0",
            "channel": "stable",
            "created_at": "2026-08-24T12:42:04Z",
            "database": {"min_version": "9.6.2", "target_version": "9.6.2"},
            "maturity": "published",
            "previous_record_sha256": (
                "e2e05b743fdc7b2475763991cb96963b34ef1939bedf8d41b2044be966dc80d3"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.8-stable-runtime-8a0bb9d872e0",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "8a0bb9d872e08b7b90c39ebab26ac278afe916ad",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.8",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.8-stable-runtime-6a62e9bdcd46",
            "channel": "stable",
            "created_at": "2026-08-24T13:10:00Z",
            "database": {"min_version": "9.6.2", "target_version": "9.6.2"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "7a2de69067450bf2ef1473c649132abe04a958a944acded73340d35ff4a48f6c"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.8-stable-runtime-6a62e9bdcd46",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "6a62e9bdcd46ee63b6518b946ecc863a6a3ba583",
                "model": "legacy_maintainer_export",
            },
        },
        {
            "app_version": "8.40.8",
            "artifact_type": "runtime",
            "build_id": "filterest-8.40.8-stable-runtime-27ff90a339eb",
            "channel": "stable",
            "created_at": "2026-08-24T16:55:00Z",
            "database": {"min_version": "9.6.2", "target_version": "9.6.2"},
            "maturity": "candidate",
            "previous_record_sha256": (
                "793d6169966df076bc7b0e7952dfb2d19ff6844b770adcd5fbd892c49294147f"
            ),
            "product": "filterest",
            "record_id": "build:filterest-8.40.8-stable-runtime-27ff90a339eb",
            "record_type": "build",
            "schema_version": 1,
            "source": {
                "commit": "27ff90a339eb503f8c258e60e104cb4728ec1f0c",
                "model": "legacy_maintainer_export",
            },
        },
    ]
    assert [entry.record for entry in entries[: len(expected_records)]] == expected_records
    tail = entries[len(expected_records) :]
    assert tail
    expected_databases = {
        "8.40.8": {"min_version": "9.6.2", "target_version": "9.6.2"},
        "8.41.0": {"min_version": "9.6.4", "target_version": "9.6.4"},
        "9.0.0": {"min_version": "9.6.7", "target_version": "9.6.7"},
        "9.0.1": {"min_version": "9.6.7", "target_version": "9.6.7"},
        "9.0.2": {"min_version": "9.6.7", "target_version": "9.6.7"},
        "9.0.3": {"min_version": "9.6.7", "target_version": "9.6.7"},
        "9.0.4": {"min_version": "9.6.7", "target_version": "9.6.7"},
        "9.0.5": {"min_version": "9.6.7", "target_version": "9.6.7"},
        "9.0.6": {"min_version": "9.6.7", "target_version": "9.6.7"},
        "9.0.7": {"min_version": "9.6.8", "target_version": "9.6.8"},
        "9.1.0": {"min_version": "9.7.0", "target_version": "9.7.0"},
        "9.1.1": {"min_version": "9.7.0", "target_version": "9.7.0"},
        "9.2.0": {"min_version": "9.7.0", "target_version": "9.7.0"},
        "9.2.1": {"min_version": "9.7.0", "target_version": "9.7.0"},
        "9.2.2": {"min_version": "9.7.0", "target_version": "9.7.0"},
        "9.2.3": {"min_version": "9.7.2", "target_version": "9.7.2"},
        "9.2.4": {"min_version": "9.7.2", "target_version": "9.7.2"},
        "9.3.0": {"min_version": "9.7.3", "target_version": "9.7.3"},
    }
    version_order = {
        "8.40.8": 0,
        "8.41.0": 1,
        "9.0.0": 2,
        "9.0.1": 3,
        "9.0.2": 4,
        "9.0.3": 5,
        "9.0.4": 6,
        "9.0.5": 7,
        "9.0.6": 8,
        "9.0.7": 9,
        "9.1.0": 10,
        "9.1.1": 11,
        "9.2.0": 12,
        "9.2.1": 13,
        "9.2.2": 14,
        "9.2.3": 15,
        "9.2.4": 16,
        "9.3.0": 17,
    }
    assert all(
        entry.record["app_version"] in expected_databases
        and entry.record["artifact_type"] == "runtime"
        and entry.record["channel"] == "stable"
        and entry.record["maturity"] in {"candidate", "published"}
        and entry.record["database"]
        == expected_databases[entry.record["app_version"]]
        and entry.record["source"]["model"]
        == (
            "public_first"
            if entry.record["app_version"]
            in {
                "9.0.0",
                "9.0.1",
                "9.0.2",
                "9.0.3",
                "9.0.4",
                "9.0.5",
                "9.0.6",
                "9.0.7",
                "9.1.0",
                "9.1.1",
                "9.2.0",
                "9.2.1",
                "9.2.2",
                "9.2.3",
                "9.2.4",
                "9.3.0",
            }
            else "legacy_maintainer_export"
        )
        for entry in tail
    )
    assert [version_order[entry.record["app_version"]] for entry in tail] == sorted(
        version_order[entry.record["app_version"]] for entry in tail
    )

    for version in expected_databases:
        version_maturities = [
            entry.record["maturity"]
            for entry in tail
            if entry.record["app_version"] == version
        ]
        assert version_maturities
        assert version_maturities[0] == "candidate"
        assert all(
            maturity != "published"
            or index > 0 and version_maturities[index - 1] == "candidate"
            for index, maturity in enumerate(version_maturities)
        )

    current_version_records = [
        entry.record for entry in tail if entry.record["app_version"] == "9.0.0"
    ]
    assert [record["record_id"] for record in current_version_records] == [
        "build:filterest-9.0.0-stable-runtime-d332ef51d593",
        "build:filterest-9.0.0-stable-runtime-b0283cb3d35d",
        "build:filterest-9.0.0-stable-runtime-e09aec3ed745",
        "build:filterest-9.0.0-stable-runtime-b3203ee51872",
        "build:filterest-9.0.0-stable-runtime-8ad23fd7f8af",
        "build:filterest-9.0.0-stable-runtime-94860a0157c0",
        "build:filterest-9.0.0-stable-runtime-0e56bfa665e1",
        "build:filterest-9.0.0-stable-runtime-ff0410676144",
        "build:filterest-9.0.0-stable-runtime-04aabc163596",
        "build:filterest-9.0.0-stable-runtime-fd3615a31156",
        "build:filterest-9.0.0-stable-runtime-24e4c45131f4",
        "build:filterest-9.0.0-stable-runtime-55cbb2c37f2d",
        "build:filterest-9.0.0-stable-runtime-0f6f8c9f1893",
    ]
    assert [record["source"]["commit"] for record in current_version_records] == [
        "d332ef51d5933f0aa0424f9dabc21de939440c4f",
        "b0283cb3d35dfc213b89e0cba00de683c950008d",
        "e09aec3ed7453a3dbab1112f0be41f79eb20766b",
        "b3203ee518728a2066b131a7c9af0b9ec16d9582",
        "8ad23fd7f8afd465d3fe4c609add6f9d4f0a09da",
        "94860a0157c08142c98127bbdb8aa329dd223ac1",
        "0e56bfa665e1321a3c29001da44c2f4de0557be3",
        "ff041067614473f9a7ebfc71518cf0687e298c14",
        "04aabc1635969368fc412cb3e624de0f57f72f53",
        "fd3615a311567efbda06b5a5a222d3a3971bb1c2",
        "24e4c45131f4aa800c66c1ad04945c1ad259fae5",
        "55cbb2c37f2d6e83b68fbc1fc3ad402367e80d17",
        "0f6f8c9f189376164ca9ce25b43cc52cc32840a5",
    ]
    assert [record["maturity"] for record in current_version_records] == [
        *(["candidate"] * 12),
        "published",
    ]
    assert all(
        record["source"]["model"] == "public_first"
        for record in current_version_records
    )
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
