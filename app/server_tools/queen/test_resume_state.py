# test_resume_state.py
# Unit tests for Queen restart-resume checkpoints and state persistence.
# Bridges the conversation loop with the shared managed-session runtime-state file.
# Exists to stop awaiting_human restart regressions from silently dropping session ids or inbox offsets.

from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from .conversation_loop import ConversationLoop, SingleWorkerAutopilotLoop
from .simple_qap import (
    QAP_CONTROLLER_DEBUG_TEXT_KEY,
    QAP_SUMMARY_CHIPS_KEY,
    QAP_SUMMARY_NOTE_KEY,
    build_qap_continue_message,
    build_qap_continue_transcript_summary,
    build_qap_continue_transcript_message,
    build_qap_handoff_transcript_summary,
    build_qap_initial_message,
    build_qap_initial_transcript_summary,
    build_qap_initial_transcript_message,
    parse_handoff,
)
from .session_store import (
    ManagedSessionPendingTurn,
    ManagedSessionResumeCheckpoint,
    ManagedSessionWorktreeEvidence,
    read_runtime_state,
    runtime_state_path_for_transcript,
    write_runtime_state,
)


_QUEEN_PACKAGE = __package__ or "server_tools.queen"


class _FakeAgent:
    """Minimal stand-in for PersistentAgent used by conversation-loop tests."""

    def __init__(
        self,
        *,
        agent_name: str,
        session_id: str,
        user_id: int,
        turn_count: int,
        responses: list[str],
    ) -> None:
        self.agent_name = agent_name
        self._session_id = session_id
        self.user_id = user_id
        self._turn_count = turn_count
        self._responses = list(responses)
        self.received_messages: list[str] = []
        self.project_root = Path(__file__).resolve().parents[2]

    @property
    def session_id(self) -> str:
        return self._session_id

    @property
    def turn_count(self) -> int:
        return self._turn_count

    def turn(self, incoming_message: str) -> str:
        self.received_messages.append(incoming_message)
        self._turn_count += 1
        if not self._responses:
            raise RuntimeError(f"{self.agent_name} has no queued response")
        return self._responses.pop(0)

    def stop(self) -> None:
        return


class _SlowFakeAgent(_FakeAgent):
    """Fake agent that simulates one long-running turn before replying."""

    def __init__(self, *, delay_seconds: float, **kwargs) -> None:
        super().__init__(**kwargs)
        self.delay_seconds = delay_seconds

    def turn(self, incoming_message: str) -> str:
        time.sleep(self.delay_seconds)
        return super().turn(incoming_message)


def _read_transcript_entries(path: Path) -> list[dict]:
    """Return parsed JSONL transcript entries from one test transcript file."""
    rows: list[dict] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if raw_line.strip() == "":
            continue
        rows.append(json.loads(raw_line))
    return rows


def _build_qap_reply(
    *,
    summary: str,
    next_step: str = "",
    done: bool = False,
    blocked: bool = False,
    block_reason: str = "",
    evidence: list[str] | None = None,
    phase_start: str = "Phase 1: Orient",
    phase_end: str | None = None,
) -> str:
    """Build one worker reply that ends with the structured QAP handoff block."""
    prefix_lines: list[str] = []
    if done:
        prefix_lines.append("[DONE]")
    if blocked:
        reason = block_reason or "Human decision needed."
        prefix_lines.append(f"[AWAITING_HUMAN] {reason}")
    if summary:
        prefix_lines.append(summary)

    if phase_end is None:
        phase_end = "Phase 6: Close the Loop" if done else phase_start

    handoff = {
        "tiketti_id": None,
        "tyovaihe_alku": phase_start,
        "tyovaihe_loppu": phase_end,
        "tavoite": "Autopilot structured handoff test",
        "mita_tehtiin": summary,
        "ehdotus_jatkoon": next_step,
        "koodin_tila_vastaa_tavoitetta": done,
        "evidence": evidence or [],
        "voidaanko_jatkaa": not blocked,
        "miksi_ei_voida_jatkaa": block_reason if blocked else None,
    }

    prefix = "\n".join(prefix_lines).strip()
    handoff_block = "```json\n" + json.dumps(handoff) + "\n```"
    if prefix:
        return prefix + "\n\n" + handoff_block
    return handoff_block


class ManagedSessionRuntimeStateTests(unittest.TestCase):
    def test_write_runtime_state_preserves_existing_checkpoint_and_pending_turn(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.json"
            checkpoint = ManagedSessionResumeCheckpoint(
                queen_session_id="queen-session-1",
                worker_session_id="worker-session-1",
                loop_turn_count=3,
                queen_turn_count=2,
                worker_turn_count=1,
                human_input_offset=128,
            )
            pending_turn = ManagedSessionPendingTurn(
                agent_name="heisenberg",
                loop_turn_count=4,
                started_at="2026-04-01T09:00:04+00:00",
                message_preview="Please investigate the failed guardian run.",
            )
            worktree_evidence = ManagedSessionWorktreeEvidence(
                captured_at="2026-04-01T09:00:04+00:00",
                changed_path_count=2,
                changed_paths=[
                    "filterest/app/server_tools/lib/sql_dump_policy.sh",
                    "server_tools/deploy_to_production.sh",
                ],
                summary="This turn has touched 2 repo files so far.",
            )

            now = datetime(2026, 4, 1, 9, 0, 0, tzinfo=timezone.utc)
            write_runtime_state(
                state_path,
                "awaiting_human",
                "Choose the safest rollout path.",
                now,
                progress_phase="awaiting_human",
                progress_tone="warning",
                progress_note="Queen is awaiting a human reply.",
                process_id=4242,
                resume_checkpoint=checkpoint,
                pending_turn=pending_turn,
                worktree_evidence=worktree_evidence,
            )
            write_runtime_state(
                state_path,
                "resuming",
                "Human reply received.",
                now + timedelta(seconds=5),
            )

            runtime_state = read_runtime_state(state_path)
            self.assertEqual(runtime_state.status, "resuming")
            self.assertEqual(runtime_state.progress_phase, "awaiting_human")
            self.assertEqual(runtime_state.progress_tone, "warning")
            self.assertEqual(runtime_state.progress_note, "Queen is awaiting a human reply.")
            self.assertEqual(runtime_state.process_id, 4242)
            self.assertIsNotNone(runtime_state.resume_checkpoint)
            self.assertEqual(runtime_state.resume_checkpoint, checkpoint)
            self.assertIsNotNone(runtime_state.pending_turn)
            self.assertEqual(runtime_state.pending_turn, pending_turn)
            self.assertTrue(runtime_state.pending_turn.is_worker_turn)
            self.assertTrue(runtime_state.has_recoverable_pending_worker_turn)
            self.assertIsNotNone(runtime_state.worktree_evidence)
            self.assertEqual(runtime_state.worktree_evidence.changed_path_count, 2)
            self.assertEqual(runtime_state.worktree_evidence.summary, "This turn has touched 2 repo files so far.")

    def test_read_runtime_state_marks_pending_queen_turn_for_guarded_recovery(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.json"
            checkpoint = ManagedSessionResumeCheckpoint(
                queen_session_id="queen-session-2",
                worker_session_id="worker-session-2",
                loop_turn_count=5,
                queen_turn_count=3,
                worker_turn_count=2,
                human_input_offset=256,
            )
            pending_turn = ManagedSessionPendingTurn(
                agent_name="queen",
                loop_turn_count=6,
                started_at="2026-04-01T09:00:06+00:00",
                message_preview="Queen was still processing the latest reply.",
            )

            write_runtime_state(
                state_path,
                "running",
                "Queen is processing a reply.",
                datetime(2026, 4, 1, 9, 0, 6, tzinfo=timezone.utc),
                progress_phase="reviewing_worker_result",
                progress_tone="info",
                progress_note="Queen is reviewing the latest worker result.",
                resume_checkpoint=checkpoint,
                pending_turn=pending_turn,
            )

            runtime_state = read_runtime_state(state_path)
            self.assertIsNotNone(runtime_state.pending_turn)
            self.assertTrue(runtime_state.pending_turn.is_queen_turn)
            self.assertTrue(runtime_state.has_recoverable_pending_queen_turn)
            self.assertEqual(runtime_state.progress_phase, "reviewing_worker_result")
            self.assertEqual(runtime_state.progress_tone, "info")
            self.assertEqual(runtime_state.progress_note, "Queen is reviewing the latest worker result.")


class ConversationLoopResumeTests(unittest.TestCase):
    def test_resume_uses_saved_human_offset_and_commits_new_offset_after_reply(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            inbox_path = temp_root / "human_inbox.jsonl"
            state_path = temp_root / "state.json"
            transcript_path = temp_root / "transcript.jsonl"

            old_message = json.dumps({"message": "old browser reply", "timestamp": "2026-04-01T09:00:00Z"}) + "\n"
            new_message = json.dumps({"message": "new browser reply", "timestamp": "2026-04-01T09:01:00Z"}) + "\n"
            inbox_path.write_text(old_message + new_message, encoding="utf-8")

            checkpoint = ManagedSessionResumeCheckpoint(
                queen_session_id="queen-session-1",
                worker_session_id="worker-session-1",
                loop_turn_count=3,
                queen_turn_count=2,
                worker_turn_count=1,
                human_input_offset=len(old_message),
            )
            write_runtime_state(
                state_path,
                "awaiting_human",
                "Need the browser reply before continuing.",
                datetime(2026, 4, 1, 9, 1, 0, tzinfo=timezone.utc),
                resume_checkpoint=checkpoint,
            )

            queen = _FakeAgent(
                agent_name="queen",
                session_id="queen-session-1",
                user_id=1,
                turn_count=2,
                responses=[
                    "Let's continue with the worker first.",
                    "[done] Final answer for the user.",
                ],
            )
            worker = _FakeAgent(
                agent_name="heisenberg",
                session_id="worker-session-1",
                user_id=2,
                turn_count=1,
                responses=["[done] Worker completed the requested slice."],
            )

            loop = ConversationLoop(
                queen=queen,  # type: ignore[arg-type]
                worker=worker,  # type: ignore[arg-type]
                max_turns=8,
                cooldown_seconds=0,
                transcript_path=transcript_path,
                human_input_path=inbox_path,
                human_state_path=state_path,
                resume_checkpoint=checkpoint,
            )

            transcript = loop.resume(reason="Need the browser reply before continuing.")
            loop.stop()

            self.assertEqual(transcript[0]["role"], "human")
            self.assertEqual(transcript[0]["text"], "new browser reply")
            self.assertIn("Human resume message from the browser-managed session:", queen.received_messages[0])
            self.assertIn("new browser reply", queen.received_messages[0])
            self.assertNotIn("old browser reply", queen.received_messages[0])

            runtime_state = read_runtime_state(state_path)
            self.assertEqual(runtime_state.status, "completed")
            self.assertEqual(runtime_state.progress_phase, "completed")
            self.assertEqual(runtime_state.progress_tone, "success")
            self.assertEqual(runtime_state.progress_note, "Queen completed the managed session.")
            self.assertIsNotNone(runtime_state.resume_checkpoint)
            self.assertEqual(
                runtime_state.resume_checkpoint.human_input_offset,
                len(old_message + new_message),
            )
            self.assertEqual(runtime_state.resume_checkpoint.loop_turn_count, 5)

    def test_worker_turn_pending_marker_is_cleared_after_safe_reply_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            state_path = temp_root / "state.json"
            transcript_path = temp_root / "transcript.jsonl"

            queen = _FakeAgent(
                agent_name="queen",
                session_id="queen-session-1",
                user_id=1,
                turn_count=0,
                responses=[
                    "Please investigate this failing worker path.",
                    "[done] Thanks, the worker result is enough.",
                ],
            )
            worker = _FakeAgent(
                agent_name="heisenberg",
                session_id="worker-session-1",
                user_id=2,
                turn_count=0,
                responses=["[done] Worker completed the investigation."],
            )

            loop = ConversationLoop(
                queen=queen,  # type: ignore[arg-type]
                worker=worker,  # type: ignore[arg-type]
                max_turns=8,
                cooldown_seconds=0,
                transcript_path=transcript_path,
                human_state_path=state_path,
            )

            transcript = loop.run("Investigate the failing worker path.")
            loop.stop()

            runtime_state = read_runtime_state(state_path)
            self.assertEqual(runtime_state.status, "completed")
            self.assertIsNone(runtime_state.pending_turn)
            self.assertEqual(transcript[-1]["role"], "queen")
            self.assertEqual(runtime_state.progress_phase, "completed")
            self.assertEqual(runtime_state.progress_tone, "success")

    def test_queen_turn_pending_marker_is_preserved_when_queen_turn_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            state_path = temp_root / "state.json"
            transcript_path = temp_root / "transcript.jsonl"

            queen = _FakeAgent(
                agent_name="queen",
                session_id="queen-session-1",
                user_id=1,
                turn_count=0,
                responses=[],
            )
            worker = _FakeAgent(
                agent_name="heisenberg",
                session_id="worker-session-1",
                user_id=2,
                turn_count=0,
                responses=["[done] Worker should never be reached."],
            )

            loop = ConversationLoop(
                queen=queen,  # type: ignore[arg-type]
                worker=worker,  # type: ignore[arg-type]
                max_turns=8,
                cooldown_seconds=0,
                transcript_path=transcript_path,
                human_state_path=state_path,
            )

            transcript = loop.run("Investigate the queen crash boundary.")
            loop.stop()

            self.assertEqual(transcript, [])

            runtime_state = read_runtime_state(state_path)
            self.assertEqual(runtime_state.status, "failed")
            self.assertIsNotNone(runtime_state.pending_turn)
            self.assertTrue(runtime_state.pending_turn.is_queen_turn)
            self.assertTrue(runtime_state.has_recoverable_pending_queen_turn)

    def test_direct_run_writes_runtime_sidecar_without_resume_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            transcript_path = temp_root / "queen_run_20260402_010000_task_807.jsonl"
            state_path = runtime_state_path_for_transcript(transcript_path)

            queen = _FakeAgent(
                agent_name="queen",
                session_id="queen-session-1",
                user_id=1,
                turn_count=0,
                responses=[
                    "Please investigate this direct-run observability slice.",
                    "[done] Final answer for the user.",
                ],
            )
            worker = _FakeAgent(
                agent_name="heisenberg",
                session_id="worker-session-1",
                user_id=2,
                turn_count=0,
                responses=["[done] Worker completed the requested slice."],
            )

            loop = ConversationLoop(
                queen=queen,  # type: ignore[arg-type]
                worker=worker,  # type: ignore[arg-type]
                max_turns=8,
                cooldown_seconds=0,
                transcript_path=transcript_path,
            )

            transcript = loop.run("Investigate the direct-run observability slice.")
            loop.stop()

            self.assertEqual(transcript[-1]["role"], "queen")
            self.assertTrue(state_path.exists())

            runtime_state = read_runtime_state(state_path)
            self.assertEqual(runtime_state.status, "completed")
            self.assertEqual(runtime_state.progress_phase, "completed")
            self.assertEqual(runtime_state.progress_note, "Queen completed the direct run.")
            self.assertEqual(runtime_state.process_id, os.getpid())
            self.assertIsNone(runtime_state.resume_checkpoint)
            self.assertIsNone(runtime_state.pending_turn)

    def test_direct_run_failure_keeps_pending_turn_in_runtime_sidecar(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            transcript_path = temp_root / "queen_run_20260402_010100_task_807.jsonl"
            state_path = runtime_state_path_for_transcript(transcript_path)

            queen = _FakeAgent(
                agent_name="queen",
                session_id="queen-session-1",
                user_id=1,
                turn_count=0,
                responses=["Investigate the worker crash path."],
            )
            worker = _FakeAgent(
                agent_name="heisenberg",
                session_id="worker-session-1",
                user_id=2,
                turn_count=0,
                responses=[],
            )

            loop = ConversationLoop(
                queen=queen,  # type: ignore[arg-type]
                worker=worker,  # type: ignore[arg-type]
                max_turns=8,
                cooldown_seconds=0,
                transcript_path=transcript_path,
            )

            transcript = loop.run("Investigate the direct worker crash path.")
            loop.stop()

            self.assertEqual(transcript[-1]["role"], "queen")

            runtime_state = read_runtime_state(state_path)
            self.assertEqual(runtime_state.status, "failed")
            self.assertEqual(runtime_state.progress_phase, "failed")
            self.assertEqual(runtime_state.progress_note, "Heisenberg failed before Queen received a reply.")
            self.assertIsNotNone(runtime_state.pending_turn)
            self.assertTrue(runtime_state.pending_turn.is_worker_turn)
            self.assertIsNone(runtime_state.resume_checkpoint)


class SingleWorkerAutopilotLoopTests(unittest.TestCase):
    def test_build_qap_continue_message_reminds_next_allowed_phase_for_strict_test_profile(self) -> None:
        message = build_qap_continue_message(
            "Implement the agreed slice.",
            "Phase 2: Plan & Delegate",
            "strict_test",
        )

        self.assertIn("QAP phase pacing profile for this run: `strict_test`.", message)
        self.assertIn("Your previous handoff ended at Phase 2: Plan & Delegate.", message)
        self.assertIn("end no later than Phase 3: Work Verbosely.", message)
        self.assertIn("Do not output [DONE] unless your handoff ends at Phase 6: Close the Loop.", message)

    def test_build_qap_initial_message_uses_balanced_profile_by_default(self) -> None:
        message = build_qap_initial_message("Inspect the current flow.")

        self.assertIn("QAP phase pacing profile for this run: `balanced`.", message)
        self.assertIn("Phase checkpoints for this profile: Phase 3: Work Verbosely -> Phase 6: Close the Loop.", message)
        self.assertIn("end no later than Phase 3: Work Verbosely.", message)

    def test_build_qap_continue_transcript_message_is_short_and_human_facing(self) -> None:
        message = build_qap_continue_transcript_message(
            "Write the final recommendation and keep the transcript readable while preserving the next action.",
            "Phase 3: Work Verbosely",
            "balanced",
        )

        self.assertEqual(
            message,
            "\n".join([
                "Continue from Phase 3: Work Verbosely.",
                "End this reply no later than Phase 6: Close the Loop.",
                "Pacing: balanced.",
                "Next: Write the final recommendation and keep the transcript readable while preserving the next action.",
            ]),
        )
        self.assertNotIn("Autopilot pacing instructions:", message)

    def test_autopilot_direct_run_writes_public_done_transcript_and_runtime_sidecar(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            transcript_path = temp_root / "queen_run_20260402_020000_task_807.jsonl"
            state_path = runtime_state_path_for_transcript(transcript_path)

            worker = _FakeAgent(
                agent_name="heisenberg",
                session_id="worker-session-1",
                user_id=2,
                turn_count=0,
                responses=[
                    _build_qap_reply(
                        summary="Oriented to the autopilot slice and planned the verification-first approach.",
                        next_step="Run final verification for the autopilot slice.",
                        phase_start="Phase 1: Orient",
                        phase_end="Phase 3: Work Verbosely",
                        evidence=["targeted tests pass"],
                    ),
                    _build_qap_reply(
                        summary="Final user-facing summary with evidence.",
                        done=True,
                        phase_start="Phase 3: Work Verbosely",
                        phase_end="Phase 6: Close the Loop",
                        evidence=["integration checks pass"],
                    ),
                ],
            )

            loop = SingleWorkerAutopilotLoop(
                worker=worker,  # type: ignore[arg-type]
                max_turns=8,
                cooldown_seconds=0,
                transcript_path=transcript_path,
            )

            transcript = loop.run("Implement the autopilot slice.")
            loop.stop()

            self.assertIn("Implement the autopilot slice.", worker.received_messages[0])
            self.assertIn("Autopilot pacing instructions:", worker.received_messages[0])
            self.assertIn(
                "Prefer one coherent implementation or verification stretch per turn.",
                worker.received_messages[0],
            )
            self.assertEqual(
                worker.received_messages[1],
                build_qap_continue_message(
                    "Run final verification for the autopilot slice.",
                    "Phase 3: Work Verbosely",
                ),
            )
            self.assertEqual(transcript[-1]["role"], "queen")
            self.assertEqual(transcript[-1]["agent"], "heisenberg")

            runtime_state = read_runtime_state(state_path)
            self.assertEqual(runtime_state.status, "completed")
            self.assertEqual(runtime_state.progress_phase, "completed")
            self.assertEqual(runtime_state.progress_note, "Heisenberg completed the autopilot direct run.")
            self.assertEqual(runtime_state.process_id, os.getpid())
            self.assertIsNone(runtime_state.pending_turn)

    def test_autopilot_direct_run_transcript_includes_controller_messages(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            transcript_path = temp_root / "queen_run_20260402_020010_task_807.jsonl"

            worker = _FakeAgent(
                agent_name="heisenberg",
                session_id="worker-session-1",
                user_id=2,
                turn_count=0,
                responses=[
                    _build_qap_reply(
                        summary="Completed the orientation handoff.",
                        next_step="Perform the next planned implementation step.",
                        phase_start="Phase 1: Orient",
                        phase_end="Phase 3: Work Verbosely",
                    ),
                    _build_qap_reply(
                        summary="Finished the smoke test.",
                        done=True,
                        phase_start="Phase 3: Work Verbosely",
                        phase_end="Phase 6: Close the Loop",
                        evidence=["smoke test passes"],
                    ),
                ],
            )

            loop = SingleWorkerAutopilotLoop(
                worker=worker,  # type: ignore[arg-type]
                max_turns=8,
                cooldown_seconds=0,
                transcript_path=transcript_path,
            )

            transcript = loop.run("Show the controller messages in the transcript.")
            loop.stop()

            self.assertEqual(len(transcript), 2)

            transcript_entries = _read_transcript_entries(transcript_path)
            self.assertEqual(
                [(entry["role"], entry["agent"]) for entry in transcript_entries],
                [
                    ("human", "human"),
                    ("controller", "QAP controller"),
                    ("queen", "heisenberg"),
                    ("controller", "QAP controller"),
                    ("queen", "heisenberg"),
                ],
            )
            self.assertEqual(
                transcript_entries[1]["text"],
                build_qap_initial_transcript_message(),
            )
            self.assertEqual(
                transcript_entries[1][QAP_SUMMARY_CHIPS_KEY],
                build_qap_initial_transcript_summary()[QAP_SUMMARY_CHIPS_KEY],
            )
            self.assertEqual(
                transcript_entries[1].get(QAP_SUMMARY_NOTE_KEY, ""),
                "",
            )
            self.assertEqual(
                transcript_entries[1][QAP_CONTROLLER_DEBUG_TEXT_KEY],
                build_qap_initial_message("Show the controller messages in the transcript."),
            )
            first_handoff = _build_qap_reply(
                summary="Completed the orientation handoff.",
                next_step="Perform the next planned implementation step.",
                phase_start="Phase 1: Orient",
                phase_end="Phase 3: Work Verbosely",
            )
            first_handoff_summary = build_qap_handoff_transcript_summary(parse_handoff(first_handoff))
            self.assertEqual(
                transcript_entries[3]["text"],
                build_qap_continue_transcript_message(
                    "Perform the next planned implementation step.",
                    "Phase 3: Work Verbosely",
                ),
            )
            self.assertEqual(
                transcript_entries[3][QAP_SUMMARY_CHIPS_KEY],
                build_qap_continue_transcript_summary(
                    "Perform the next planned implementation step.",
                    "Phase 3: Work Verbosely",
                )[QAP_SUMMARY_CHIPS_KEY],
            )
            self.assertEqual(
                transcript_entries[3][QAP_SUMMARY_NOTE_KEY],
                build_qap_continue_transcript_summary(
                    "Perform the next planned implementation step.",
                    "Phase 3: Work Verbosely",
                )[QAP_SUMMARY_NOTE_KEY],
            )
            self.assertEqual(
                transcript_entries[3][QAP_CONTROLLER_DEBUG_TEXT_KEY],
                build_qap_continue_message(
                    "Perform the next planned implementation step.",
                    "Phase 3: Work Verbosely",
                ),
            )
            self.assertEqual(
                transcript_entries[2][QAP_SUMMARY_CHIPS_KEY],
                first_handoff_summary[QAP_SUMMARY_CHIPS_KEY],
            )
            self.assertEqual(
                transcript_entries[2][QAP_SUMMARY_NOTE_KEY],
                first_handoff_summary[QAP_SUMMARY_NOTE_KEY],
            )
            self.assertEqual(
                transcript_entries[4][QAP_SUMMARY_CHIPS_KEY],
                build_qap_handoff_transcript_summary(
                    parse_handoff(
                        _build_qap_reply(
                            summary="Finished the smoke test.",
                            done=True,
                            phase_start="Phase 3: Work Verbosely",
                            phase_end="Phase 6: Close the Loop",
                            evidence=["smoke test passes"],
                        )
                    )
                )[QAP_SUMMARY_CHIPS_KEY],
            )

    def test_autopilot_direct_run_stops_on_awaiting_human_without_blocking(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            transcript_path = temp_root / "queen_run_20260402_020100_task_807.jsonl"
            state_path = runtime_state_path_for_transcript(transcript_path)

            worker = _FakeAgent(
                agent_name="heisenberg",
                session_id="worker-session-1",
                user_id=2,
                turn_count=0,
                responses=[
                    _build_qap_reply(
                        summary="I narrowed the safe rollout choices.",
                        blocked=True,
                        block_reason="Which rollout path should I take?",
                        phase_start="Phase 2: Plan & Delegate",
                        phase_end="Phase 2: Plan & Delegate",
                    ),
                ],
            )

            loop = SingleWorkerAutopilotLoop(
                worker=worker,  # type: ignore[arg-type]
                max_turns=8,
                cooldown_seconds=0,
                transcript_path=transcript_path,
            )

            transcript = loop.run("Choose the safest rollout path.")
            loop.stop()

            self.assertEqual(transcript[-1]["role"], "queen")
            self.assertEqual(transcript[-1]["agent"], "heisenberg")

            runtime_state = read_runtime_state(state_path)
            self.assertEqual(runtime_state.status, "awaiting_human")
            self.assertEqual(runtime_state.progress_phase, "awaiting_human")
            self.assertEqual(runtime_state.reason, "Which rollout path should I take?")
            self.assertIsNone(runtime_state.pending_turn)

    def test_autopilot_direct_run_stops_at_max_turns(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            transcript_path = temp_root / "queen_run_20260402_020200_task_807.jsonl"
            state_path = runtime_state_path_for_transcript(transcript_path)

            worker = _FakeAgent(
                agent_name="heisenberg",
                session_id="worker-session-1",
                user_id=2,
                turn_count=0,
                responses=[
                    _build_qap_reply(
                        summary="Still working on the first implementation step.",
                        next_step="Continue with the second implementation step.",
                        phase_start="Phase 1: Orient",
                        phase_end="Phase 2: Plan & Delegate",
                    ),
                    _build_qap_reply(
                        summary="Still working on the second implementation step.",
                        next_step="Keep going until verification is complete.",
                        phase_start="Phase 2: Plan & Delegate",
                        phase_end="Phase 3: Work Verbosely",
                    ),
                ],
            )

            loop = SingleWorkerAutopilotLoop(
                worker=worker,  # type: ignore[arg-type]
                max_turns=2,
                cooldown_seconds=0,
                transcript_path=transcript_path,
            )

            transcript = loop.run("Keep going until the turn limit stops you.")
            loop.stop()

            self.assertEqual(len(transcript), 2)

            runtime_state = read_runtime_state(state_path)
            self.assertEqual(runtime_state.status, "stopped")
            self.assertEqual(runtime_state.progress_phase, "stopped")
            self.assertEqual(runtime_state.reason, "MAX_TURNS (2) reached.")
            self.assertIsNone(runtime_state.pending_turn)

    def test_autopilot_direct_run_emits_runtime_heartbeat_during_long_turn(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            transcript_path = temp_root / "queen_run_20260402_020300_task_807.jsonl"
            state_path = runtime_state_path_for_transcript(transcript_path)
            observed_notes: list[str] = []

            worker = _SlowFakeAgent(
                agent_name="heisenberg",
                session_id="worker-session-1",
                user_id=2,
                turn_count=0,
                responses=["[DONE] Finished after one slow turn."],
                delay_seconds=0.05,
            )

            original_write_runtime_state = write_runtime_state

            def capture_runtime_state(*args, **kwargs):
                progress_note = str(kwargs.get("progress_note", "")).strip()
                if progress_note:
                    observed_notes.append(progress_note)
                return original_write_runtime_state(*args, **kwargs)

            with patch(f"{_QUEEN_PACKAGE}.conversation_loop.AGENT_TURN_HEARTBEAT_SECONDS", 0.01):
                with patch(f"{_QUEEN_PACKAGE}.conversation_loop.write_runtime_state", side_effect=capture_runtime_state):
                    loop = SingleWorkerAutopilotLoop(
                        worker=worker,  # type: ignore[arg-type]
                        max_turns=4,
                        cooldown_seconds=0,
                        transcript_path=transcript_path,
                    )

                    transcript = loop.run("Keep working until done.")
                    loop.stop()

            self.assertEqual(len(transcript), 1)
            self.assertTrue(
                any("still working on the current turn" in note for note in observed_notes),
                observed_notes,
            )

            runtime_state = read_runtime_state(state_path)
            self.assertEqual(runtime_state.status, "completed")
            self.assertEqual(runtime_state.progress_phase, "completed")
            self.assertIsNone(runtime_state.pending_turn)

    def test_autopilot_direct_run_still_accepts_legacy_done_signal_without_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            transcript_path = temp_root / "queen_run_20260402_020305_task_807.jsonl"
            state_path = runtime_state_path_for_transcript(transcript_path)

            worker = _FakeAgent(
                agent_name="heisenberg",
                session_id="worker-session-1",
                user_id=2,
                turn_count=0,
                responses=["[DONE] Finished through the legacy marker path."],
            )

            loop = SingleWorkerAutopilotLoop(
                worker=worker,  # type: ignore[arg-type]
                max_turns=4,
                cooldown_seconds=0,
                transcript_path=transcript_path,
            )

            transcript = loop.run("Finish the legacy path.")
            loop.stop()

            self.assertEqual(len(transcript), 1)
            runtime_state = read_runtime_state(state_path)
            self.assertEqual(runtime_state.status, "completed")

    def test_autopilot_direct_run_preserves_worktree_evidence_from_heartbeat(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            transcript_path = temp_root / "queen_run_20260402_020330_task_807.jsonl"
            state_path = runtime_state_path_for_transcript(transcript_path)

            worker = _SlowFakeAgent(
                agent_name="heisenberg",
                session_id="worker-session-1",
                user_id=2,
                turn_count=0,
                responses=["[DONE] Finished after one slow turn."],
                delay_seconds=0.05,
            )
            worktree_evidence = ManagedSessionWorktreeEvidence(
                captured_at="2026-04-02T00:03:30Z",
                changed_path_count=2,
                changed_paths=[
                    "filterest/app/server_tools/lib/sql_dump_policy.sh",
                    "server_tools/deploy_to_production.sh",
                ],
                summary="This turn has touched 2 repo files so far.",
            )

            with patch(f"{_QUEEN_PACKAGE}.conversation_loop.AGENT_TURN_HEARTBEAT_SECONDS", 0.01):
                with patch.object(
                    SingleWorkerAutopilotLoop,
                    "_capture_current_turn_worktree_evidence",
                    return_value=worktree_evidence,
                ):
                    loop = SingleWorkerAutopilotLoop(
                        worker=worker,  # type: ignore[arg-type]
                        max_turns=4,
                        cooldown_seconds=0,
                        transcript_path=transcript_path,
                    )

                    transcript = loop.run("Keep working until done.")
                    loop.stop()

            self.assertEqual(len(transcript), 1)

            runtime_state = read_runtime_state(state_path)
            self.assertEqual(runtime_state.status, "completed")
            self.assertIsNotNone(runtime_state.worktree_evidence)
            self.assertEqual(runtime_state.worktree_evidence.changed_path_count, 2)
            self.assertEqual(
                runtime_state.worktree_evidence.changed_paths,
                [
                    "filterest/app/server_tools/lib/sql_dump_policy.sh",
                    "server_tools/deploy_to_production.sh",
                ],
            )


if __name__ == "__main__":
    unittest.main()
