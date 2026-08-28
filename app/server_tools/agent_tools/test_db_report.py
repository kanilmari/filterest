#!/usr/bin/env python3
# test_db_report.py
# Verifies CLI request shaping for DB-backed workline reports.
# Bridges parsed shell arguments with the shared authenticated API client contract.
# Exists so command-line maintenance cannot drift into direct SQL or malformed report payloads.

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from . import db_report


_DB_REPORT_MODULE = f"{__package__}.db_report"


class CapturingClient:
    instances = []

    def __init__(self, *, base_url=None, username=None, password=None, verification_code_provider=None):
        self.base_url = base_url
        self.username = username
        self.password = password
        self.verification_code_provider = verification_code_provider
        self.calls = []
        self.logged_in = False
        self.__class__.instances.append(self)

    def login(self):
        self.logged_in = True
        return {"authenticated": True}

    def request(self, method, path, *, data=None, query=None, csrf=False):
        self.calls.append(
            {
                "method": method,
                "path": path,
                "data": data,
                "query": query,
                "csrf": csrf,
            }
        )
        if path == db_report.WORKLINES_PATH and method == "GET":
            return []
        if path == db_report.OBSERVATORY_BOARD_PATH and method == "GET":
            return {
                "worklines": [{
                    "id": 12,
                    "title": "Canonical synchronization",
                    "status": "active",
                    "current_phase": 4,
                    "task_ids": [869],
                    "latest_report": {"id": 31},
                }],
            }
        if path == db_report.HANDOVERS_PATH and method == "GET":
            return {
                "id": 1,
                "state": "final",
                "title": "Latest handover",
                "source_kind": "codex",
                "items": [],
                "markdown": "# Latest handover\n",
            }
        return {"ok": True}


class DBReportCLITest(unittest.TestCase):
    def setUp(self):
        CapturingClient.instances.clear()

    def test_workline_list_uses_shared_authenticated_api(self):
        with patch("builtins.print"):
            exit_code = db_report.main(
                ["--base-url", "https://localhost:8082", "workline", "list", "--status", "active"],
                client_factory=CapturingClient,
            )

        self.assertEqual(exit_code, 0)
        client = CapturingClient.instances[0]
        self.assertTrue(client.logged_in)
        self.assertEqual(
            client.calls,
            [{
                "method": "GET",
                "path": db_report.WORKLINES_PATH,
                "data": None,
                "query": {"limit": 50, "status": "active"},
                "csrf": False,
            }],
        )

    def test_report_add_payload_uses_structured_snapshot_and_preserves_correction_link(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            metadata_path = Path(temp_dir) / "metadata.json"
            snapshot_path = Path(temp_dir) / "snapshot.json"
            metadata_path.write_text(json.dumps({"phase": 4}), encoding="utf-8")
            snapshot_path.write_text(json.dumps({"tests": "pending"}), encoding="utf-8")

            args = db_report.build_parser().parse_args([
                "report",
                "add",
                "12",
                "--title",
                "Canonical report tool",
                "--phase",
                "3-4",
                "--current-phase",
                "4",
                "--workline-status",
                "active",
                "--sync-workline-status",
                "--context",
                "Reports preserve development context.",
                "--plain-language",
                "The work can be continued later.",
                "--technical",
                "The API stores a structured snapshot.",
                "--next-step",
                "Verify the native route.",
                "--changed-this-turn",
                "--git-path",
                "backend/report.go",
                "--snapshot-file",
                str(snapshot_path),
                "--metadata-file",
                str(metadata_path),
                "--tag",
                "reports",
                "--supersedes",
                "8",
            ])
            with patch(f"{_DB_REPORT_MODULE}.collect_git_snapshot", return_value={
                "git_head_commit": "a" * 40,
                "git_worktree_state": "dirty",
                "git_has_other_changes": True,
                "git_workline_changed_paths": ["backend/report.go"],
            }):
                payload = db_report.report_add_payload(args)

        self.assertEqual(payload["workline_id"], 12)
        self.assertEqual(payload["phase_gate"], "3-4")
        self.assertEqual(payload["current_phase"], 4)
        self.assertTrue(payload["sync_workline_status"])
        self.assertEqual(payload["context"], "Reports preserve development context.")
        self.assertEqual(payload["snapshot"], {"tests": "pending"})
        self.assertEqual(payload["metadata"], {"phase": 4})
        self.assertEqual(payload["tags"], ["reports"])
        self.assertEqual(payload["supersedes_report_id"], 8)

    def test_workline_board_reads_exact_observatory_truth_in_one_request(self):
        with patch("builtins.print") as output:
            exit_code = db_report.main(
                ["workline", "board"],
                client_factory=CapturingClient,
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            CapturingClient.instances[0].calls,
            [{
                "method": "GET",
                "path": db_report.OBSERVATORY_BOARD_PATH,
                "data": None,
                "query": None,
                "csrf": False,
            }],
        )
        rendered = "\n".join(str(call.args[0]) for call in output.call_args_list)
        self.assertIn("#12 [active] phase 4 Canonical synchronization", rendered)
        self.assertIn("latest report: 31 | tasks: 869", rendered)

    def test_collect_git_snapshot_limits_other_worktree_detail_to_boolean(self):
        results = [
            subprocess.CompletedProcess([], 0, stdout="a" * 40 + "\n", stderr=""),
            subprocess.CompletedProcess(
                [],
                0,
                stdout=b" M backend/report.go\0?? unrelated.txt\0",
                stderr=b"",
            ),
        ]
        with patch(f"{_DB_REPORT_MODULE}.subprocess.run", side_effect=results):
            snapshot = db_report.collect_git_snapshot(["backend/report.go"])

        self.assertEqual(snapshot["git_workline_changed_paths"], ["backend/report.go"])
        self.assertTrue(snapshot["git_has_other_changes"])
        self.assertNotIn("git_other_changed_paths", snapshot)

    def test_collect_git_snapshot_compacts_owned_move_subtrees(self):
        results = [
            subprocess.CompletedProcess([], 0, stdout="b" * 40 + "\n", stderr=""),
            subprocess.CompletedProcess(
                [],
                0,
                stdout=(
                    b"R  filterest/app/backend/a.go\0backend/a.go\0"
                    b"R  filterest/app/backend/b.go\0backend/b.go\0"
                    b" M README.md\0"
                ),
                stderr=b"",
            ),
        ]
        with patch(f"{_DB_REPORT_MODULE}.subprocess.run", side_effect=results):
            snapshot = db_report.collect_git_snapshot(
                ["README.md"],
                ["backend", "filterest/app/backend"],
            )

        self.assertEqual(
            snapshot["git_workline_changed_paths"],
            ["README.md", "backend/**", "filterest/app/backend/**"],
        )
        self.assertFalse(snapshot["git_has_other_changes"])

    def test_collect_git_snapshot_rejects_prefix_without_dirty_paths(self):
        results = [
            subprocess.CompletedProcess([], 0, stdout="c" * 40 + "\n", stderr=""),
            subprocess.CompletedProcess([], 0, stdout=b" M README.md\0", stderr=b""),
        ]
        with patch(f"{_DB_REPORT_MODULE}.subprocess.run", side_effect=results):
            with self.assertRaisesRegex(ValueError, "cover no dirty paths"):
                db_report.collect_git_snapshot([], ["filterest/app/backend"])

    def test_handover_latest_requests_full_latest_manifest(self):
        with patch("builtins.print"):
            exit_code = db_report.main(
                ["handover", "latest"],
                client_factory=CapturingClient,
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            CapturingClient.instances[0].calls[0],
            {
                "method": "GET",
                "path": db_report.HANDOVERS_PATH,
                "data": None,
                "query": {"latest": "true"},
                "csrf": False,
            },
        )

    def test_parse_handover_items_preserves_order(self):
        self.assertEqual(
            db_report.parse_handover_items(["4:10", "7:22"]),
            [
                {"workline_id": 4, "workline_report_id": 10},
                {"workline_id": 7, "workline_report_id": 22},
            ],
        )

    def test_write_requests_enable_csrf(self):
        client = CapturingClient()
        db_report.request(client, "PATCH", db_report.REPORTS_PATH, data={"id": 2, "state": "archived"})

        self.assertTrue(client.calls[0]["csrf"])

    def test_prompt_credentials_names_exact_account_and_uses_hidden_password(self):
        args = db_report.build_parser().parse_args([
            "--prompt-credentials",
            "--credential-username",
            "operator@example.test",
            "workline",
            "list",
        ])
        with patch(f"{_DB_REPORT_MODULE}.getpass.getpass", return_value="entered-password") as prompt:
            with patch("builtins.print"):
                client = db_report.make_client(args, CapturingClient)

        self.assertEqual(client.username, "operator@example.test")
        self.assertEqual(client.password, "entered-password")
        prompt.assert_called_once_with("Password for existing account 'operator@example.test': ")

    def test_metadata_file_must_contain_object(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            metadata_path = Path(temp_dir) / "metadata.json"
            metadata_path.write_text("[]", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "JSON object"):
                db_report.read_metadata_file(str(metadata_path))


if __name__ == "__main__":
    unittest.main()
