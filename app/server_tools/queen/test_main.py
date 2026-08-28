# test_main.py
# Unit tests for Queen multi-ticket dispatch rules in main.py.
# Bridges CLI batch selection logic with ticket status filtering and claim behavior.
# Exists to stop multi-ticket regressions from silently reintroducing a new-only gate.

from __future__ import annotations

import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from .main import _list_multi_ticket_candidates, _run_autopilot_multi_ticket_batch


_QUEEN_PACKAGE = __package__ or "server_tools.queen"


class MultiTicketCandidateTests(unittest.TestCase):
    def test_list_multi_ticket_candidates_accepts_non_terminal_non_new_statuses(self) -> None:
        tasks = [
            {"id": 1, "status": "new"},
            {"id": 2, "status": "in_progress"},
            {"id": 3, "status": "awaiting_human_decision"},
            {"id": 4, "status": "backlog_later"},
            {"id": 5, "status": "done"},
            {"id": 6, "status": "rejected"},
            {"id": 7, "status": "archived"},
            {"id": 8, "status": "to_be_deleted"},
            {"id": 9, "status": "aborted"},
        ]

        with patch(f"{_QUEEN_PACKAGE}.main._read_db_task_record", return_value=tasks):
            candidates = _list_multi_ticket_candidates(
                SimpleNamespace(),
                explicit_task_id=None,
                ticket_queue="Security",
                ticket_groups="backend,security",
                seen_task_ids={3},
            )

        self.assertEqual([task["id"] for task in candidates], [1, 2, 4])


class MultiTicketDispatchTests(unittest.TestCase):
    def test_run_autopilot_multi_ticket_batch_dispatches_in_progress_without_reclaim(self) -> None:
        task = {"id": 802, "status": "in_progress", "title": "Unified OTP / verification pipeline for Easelect"}
        loop = SimpleNamespace(
            task_id=None,
            runtime_state_path=None,
            prompts=[],
            run=lambda prompt: [{"role": "worker", "agent": "heisenberg", "text": "[DONE]", "turn": 1}],
            _write_runtime_state=lambda *args, **kwargs: None,
        )

        def capture_prompt(prompt: str):
            loop.prompts.append(prompt)
            return [{"role": "worker", "agent": "heisenberg", "text": "[DONE]", "turn": 1}]

        loop.run = capture_prompt

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch(f"{_QUEEN_PACKAGE}.main._load_db_task_module", return_value=SimpleNamespace()):
                with patch(f"{_QUEEN_PACKAGE}.main._list_multi_ticket_candidates", return_value=[task]):
                    with patch(f"{_QUEEN_PACKAGE}.main._hold_direct_run_task_guard", return_value=nullcontext()):
                        with patch(f"{_QUEEN_PACKAGE}.main._read_db_task_record", side_effect=[task, task]):
                            with patch(
                                f"{_QUEEN_PACKAGE}.main._claim_db_task_for_autopilot",
                                side_effect=AssertionError("in_progress tickets should not be auto-claimed again"),
                            ):
                                transcript = _run_autopilot_multi_ticket_batch(
                                    loop,
                                    project_root=Path(temp_dir),
                                    transcript_path=Path(temp_dir) / "transcript.jsonl",
                                    base_prompt="Bundle prompt",
                                    initial_task_id=None,
                                    ticket_queue=None,
                                    ticket_groups=None,
                                )

        self.assertEqual(len(transcript), 1)
        self.assertEqual(loop.task_id, 802)
        self.assertEqual(len(loop.prompts), 1)
        self.assertIn("Status at dispatch: in_progress", loop.prompts[0])

    def test_run_autopilot_multi_ticket_batch_still_claims_new_ticket(self) -> None:
        new_task = {"id": 797, "status": "new", "title": "Forgot password"}
        claimed_task = {"id": 797, "status": "in_progress", "title": "Forgot password"}
        loop = SimpleNamespace(
            task_id=None,
            runtime_state_path=None,
            run=lambda prompt: [{"role": "worker", "agent": "heisenberg", "text": "[DONE]", "turn": 1}],
            _write_runtime_state=lambda *args, **kwargs: None,
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch(f"{_QUEEN_PACKAGE}.main._load_db_task_module", return_value=SimpleNamespace()):
                with patch(f"{_QUEEN_PACKAGE}.main._list_multi_ticket_candidates", return_value=[new_task]):
                    with patch(f"{_QUEEN_PACKAGE}.main._hold_direct_run_task_guard", return_value=nullcontext()):
                        with patch(f"{_QUEEN_PACKAGE}.main._read_db_task_record", side_effect=[new_task, claimed_task]):
                            with patch(f"{_QUEEN_PACKAGE}.main._claim_db_task_for_autopilot", return_value=claimed_task) as claim_mock:
                                _run_autopilot_multi_ticket_batch(
                                    loop,
                                    project_root=Path(temp_dir),
                                    transcript_path=Path(temp_dir) / "transcript.jsonl",
                                    base_prompt="Bundle prompt",
                                    initial_task_id=None,
                                    ticket_queue=None,
                                    ticket_groups=None,
                                )

        claim_mock.assert_called_once_with(unittest.mock.ANY, 797)


if __name__ == "__main__":
    unittest.main()
