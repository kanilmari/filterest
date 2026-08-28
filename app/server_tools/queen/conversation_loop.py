# conversation_loop.py
# Turn-taking orchestration for Queen persistent agent sessions.
# Bridges PersistentAgents with the message bus and rate limiter.
# Exists to enforce the "message-only passing" contract between agents.

from __future__ import annotations

import hashlib
import json
import logging
import os
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from .persistent_agent import PersistentAgent
from .session_store import (
    ManagedSessionPendingTurn,
    ManagedSessionResumeCheckpoint,
    ManagedSessionWorktreeEvidence,
    runtime_state_path_for_transcript,
    write_runtime_state,
)
from .simple_qap import (
    HandoffJSON,
    QAP_CONTROLLER_AGENT_NAME,
    QAP_CONTROLLER_DEBUG_TEXT_KEY,
    QAP_CONTROLLER_ROLE,
    QAP_DEFAULT_PHASE_PACING,
    QAP_SUMMARY_CHIPS_KEY,
    QAP_SUMMARY_NOTE_KEY,
    build_qap_continue_transcript_message,
    build_qap_continue_message,
    build_qap_continue_transcript_summary,
    build_qap_handoff_transcript_summary,
    build_qap_initial_transcript_message,
    build_qap_initial_message,
    build_qap_initial_transcript_summary,
    parse_handoff,
)

logger = logging.getLogger("queen.loop")

# Safety limits
MAX_TURNS = 20          # Total turns (queen + worker combined) before forced stop
COOLDOWN_SECONDS = 2    # Pause between turns to avoid hammering APIs
MAX_CONSECUTIVE_EMPTY = 2  # Abort if this many consecutive turns return empty
AWAITING_HUMAN_POLL_SECONDS = 0.25
AGENT_TURN_HEARTBEAT_SECONDS = 20.0
def _build_autopilot_initial_message(initial_prompt: str, phase_pacing: str) -> str:
    """Append pacing guidance to the first autopilot worker message."""
    return build_qap_initial_message(initial_prompt, phase_pacing)


def _build_autopilot_handoff_progress_note(handoff: HandoffJSON) -> str:
    """Render one concise runtime progress note from the structured QAP handoff."""
    summary = " ".join(str(handoff.mita_tehtiin or "").split()).strip()
    phase_end = " ".join(str(handoff.tyovaihe_loppu or "").split()).strip()
    next_step = " ".join(str(handoff.ehdotus_jatkoon or "").split()).strip()

    if summary and phase_end:
        return f"{phase_end}: {summary}"
    if summary:
        return summary
    if next_step:
        return f"Next suggested step: {next_step}"
    return "Heisenberg completed a QAP turn and is ready for the next implementation step."


def _format_elapsed_label(elapsed_seconds: float) -> str:
    """Render one human-friendly elapsed label for long-turn heartbeat notes."""
    total_seconds = max(1, int(elapsed_seconds))
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours > 0:
        return f"{hours}h {minutes}m"
    if minutes > 0:
        return f"{minutes}m {seconds}s"
    return f"{seconds}s"


def _parse_git_status_path(raw_line: str) -> str:
    """Extract the current repo-relative path from one porcelain status line."""
    payload = raw_line[3:].strip()
    if " -> " in payload:
        return payload.rsplit(" -> ", 1)[-1].strip()
    return payload


def _fingerprint_worktree_path(project_root: Path, relative_path: str) -> str:
    """Hash one worktree path so turn-local changes survive pre-existing dirty files."""
    path = project_root / relative_path
    if not path.exists():
        return "missing"
    if path.is_dir():
        return "directory"
    try:
        digest = hashlib.sha1(path.read_bytes()).hexdigest()
    except OSError:
        return "unreadable"
    return f"file:{digest}"


def _capture_dirty_worktree_fingerprints(project_root: Path) -> dict[str, str]:
    """Snapshot the current dirty/untracked repo files into path -> fingerprint form."""
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain=v1", "-uall"],
            cwd=project_root,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        logger.warning("Could not inspect git status for autopilot worktree evidence: %s", exc)
        return {}

    if result.returncode != 0:
        stderr = result.stderr.strip()
        if stderr:
            logger.warning("git status failed while collecting autopilot worktree evidence: %s", stderr)
        return {}

    fingerprints: dict[str, str] = {}
    for raw_line in result.stdout.splitlines():
        if len(raw_line) < 4:
            continue
        relative_path = _parse_git_status_path(raw_line)
        if not relative_path:
            continue
        fingerprints[relative_path] = _fingerprint_worktree_path(project_root, relative_path)
    return fingerprints


def _build_worktree_evidence_summary(changed_paths: list[str]) -> str:
    """Render one concise human summary for files touched during the current turn."""
    if not changed_paths:
        return ""
    count = len(changed_paths)
    noun = "file" if count == 1 else "files"
    return f"This turn has touched {count} repo {noun} so far."


def _build_worktree_evidence_preview(changed_paths: list[str], *, max_paths: int = 3) -> str:
    """Render a short preview of changed repo paths for runtime progress notes."""
    if not changed_paths:
        return ""
    preview = changed_paths[:max_paths]
    suffix = ""
    remaining = len(changed_paths) - len(preview)
    if remaining > 0:
        suffix = f", +{remaining} more"
    return f"{', '.join(preview)}{suffix}"


def _extract_done_signal(text: str) -> bool:
    """
    Check if the agent's reply signals that the task is complete.

    Looks for a JSON block with next_action=report_to_user or status=done,
    or a plain-text DONE marker.
    """
    lower = text.lower()

    if "[done]" in lower or "[task complete]" in lower:
        return True

    try:
        brace_start = text.find("{")
        if brace_start >= 0:
            for end in range(len(text) - 1, brace_start, -1):
                if text[end] == "}":
                    try:
                        obj = json.loads(text[brace_start:end + 1])
                        if obj.get("next_action") == "report_to_user":
                            return True
                        if obj.get("status") == "done":
                            return True
                    except (json.JSONDecodeError, AttributeError):
                        continue
    except Exception:
        pass

    return False


def _extract_awaiting_human_signal(text: str) -> bool:
    """Return True when Queen explicitly signals that a human decision is required."""
    lower = text.lower()
    if "[awaiting_human]" in lower or "[human_decision_required]" in lower:
        return True

    try:
        brace_start = text.find("{")
        if brace_start >= 0:
            for end in range(len(text) - 1, brace_start, -1):
                if text[end] == "}":
                    try:
                        obj = json.loads(text[brace_start:end + 1])
                    except (json.JSONDecodeError, AttributeError):
                        continue
                    next_action = str(obj.get("next_action", "")).strip().lower()
                    status = str(obj.get("status", "")).strip().lower()
                    if next_action in {"await_human", "awaiting_human", "wait_for_human"}:
                        return True
                    if status == "awaiting_human":
                        return True
    except Exception:
        pass

    return False


def _extract_awaiting_human_reason(text: str) -> str:
    """Summarize the reason Queen is waiting for a human response."""
    try:
        brace_start = text.find("{")
        if brace_start >= 0:
            for end in range(len(text) - 1, brace_start, -1):
                if text[end] == "}":
                    try:
                        obj = json.loads(text[brace_start:end + 1])
                    except (json.JSONDecodeError, AttributeError):
                        continue
                    for key in ("question", "reason", "human_question", "summary"):
                        value = str(obj.get(key, "")).strip()
                        if value:
                            return value[:280]
    except Exception:
        pass

    cleaned = text.replace("[AWAITING_HUMAN]", "").replace("[awaiting_human]", "")
    cleaned = cleaned.replace("[HUMAN_DECISION_REQUIRED]", "").replace("[human_decision_required]", "")
    normalized = " ".join(cleaned.split()).strip()
    if not normalized:
        return "Queen is awaiting a human decision."
    return normalized[:280]


class ConversationLoop:
    """
    Orchestrates turn-taking between two persistent agents.

    Contract:
    - Each agent receives ONLY the other agent's written message text.
    - Each agent's CLI history, tool outputs, and reasoning stay private
      inside their own persistent session.
    - Messages are archived to bee_messages for observability.
    - The loop stops when queen signals done or MAX_TURNS is reached.
    """

    def __init__(
        self,
        queen: PersistentAgent,
        worker: PersistentAgent,
        task_id: int | None = None,
        bus: object | None = None,
        max_turns: int = MAX_TURNS,
        cooldown_seconds: float = COOLDOWN_SECONDS,
        transcript_path: str | Path | None = None,
        human_input_path: str | Path | None = None,
        human_state_path: str | Path | None = None,
        resume_checkpoint: ManagedSessionResumeCheckpoint | None = None,
    ):
        self.queen = queen
        self.worker = worker
        self.project_root = Path(worker.project_root)
        self.task_id = task_id
        self.bus = bus
        self.max_turns = max_turns
        self.cooldown_seconds = cooldown_seconds
        self.transcript_path = Path(transcript_path) if transcript_path else None
        self.human_input_path = Path(human_input_path) if human_input_path else None
        self.human_state_path = Path(human_state_path) if human_state_path else None
        self.runtime_state_path = self.human_state_path or (
            runtime_state_path_for_transcript(self.transcript_path)
            if self.transcript_path is not None
            else None
        )
        self._human_input_offset = resume_checkpoint.human_input_offset if resume_checkpoint else 0
        self._pending_human_followups: list[str] = []
        self._turn_count = resume_checkpoint.loop_turn_count if resume_checkpoint else 0
        self._checkpoint = resume_checkpoint
        self._pending_turn: ManagedSessionPendingTurn | None = None

        if self.max_turns < 1:
            raise ValueError("max_turns must be at least 1")
        if self.cooldown_seconds < 0:
            raise ValueError("cooldown_seconds cannot be negative")
        if self.transcript_path is not None:
            self.transcript_path.parent.mkdir(parents=True, exist_ok=True)
        if self.human_input_path is not None:
            self.human_input_path.parent.mkdir(parents=True, exist_ok=True)
            self.human_input_path.touch(exist_ok=True)
        if self.human_state_path is not None:
            self.human_state_path.parent.mkdir(parents=True, exist_ok=True)
        if self.runtime_state_path is not None:
            self.runtime_state_path.parent.mkdir(parents=True, exist_ok=True)
        if self._checkpoint is None:
            self._commit_checkpoint()
        if self.runtime_state_path is not None and resume_checkpoint is None:
            self._write_runtime_state(
                "running",
                progress_phase="started",
                progress_note=self._started_progress_note(),
            )

    def run(self, initial_prompt: str) -> list[dict]:
        """
        Run the conversation loop.

        Args:
            initial_prompt: The human's task description / kickoff message.

        Returns:
            List of message dicts [{role, agent, text, turn}] for the full conversation.
        """
        transcript: list[dict] = []

        logger.info("=== Queen loop starting (task_id=%s, max_turns=%d) ===", self.task_id, self.max_turns)

        self._archive("human", initial_prompt)
        self._append_transcript_entry(
            transcript,
            self._record(role="human", agent_name="human", text=initial_prompt, turn=0),
            include_in_result=False,
        )

        try:
            self._commit_checkpoint()
            self._mark_pending_turn(self.queen, initial_prompt)
            queen_reply = self._agent_turn(self.queen, initial_prompt)
        except RuntimeError as exc:
            logger.error("Queen failed on initial turn: %s", exc)
            self._write_runtime_state(
                "failed",
                reason=str(exc),
                progress_phase="failed",
                progress_note="Queen failed on the initial turn.",
            )
            return transcript
        self._clear_pending_turn(status="running")
        self._append_transcript_entry(
            transcript,
            self._record(role="queen", agent_name=self.queen.agent_name, text=queen_reply, turn=self._turn_count),
        )
        return self._drive_from_queen_reply(transcript, queen_reply)

    def resume(self, reason: str = "") -> list[dict]:
        """Resume a managed session after a browser-authored human follow-up."""
        if self._checkpoint is None or not self._checkpoint.is_valid:
            raise RuntimeError("Conversation loop resume requested without a valid checkpoint")

        transcript: list[dict] = []
        logger.info(
            "=== Queen loop resuming (task_id=%s, turn=%d, human_offset=%d) ===",
            self.task_id,
            self._turn_count,
            self._human_input_offset,
        )
        if reason:
            self._write_runtime_state(
                "resuming",
                reason=reason,
                progress_phase="resuming",
                progress_note=self._resuming_progress_note(),
            )
        human_followup = self._wait_for_human_resume()
        if reason:
            self._write_runtime_state(
                "resuming",
                reason=reason,
                progress_phase="resuming",
                progress_note=self._resuming_progress_note(),
            )
        self._archive("human", human_followup)
        self._append_transcript_entry(
            transcript,
            self._record(role="human", agent_name="human", text=human_followup, turn=self._turn_count),
        )
        try:
            self._commit_checkpoint()
            self._mark_pending_turn(self.queen, self._format_human_followup_for_queen(human_followup))
            queen_reply = self._agent_turn(
                self.queen,
                self._format_human_followup_for_queen(human_followup),
            )
        except RuntimeError as exc:
            logger.error("Queen failed on resumed human follow-up turn: %s", exc)
            self._write_runtime_state(
                "failed",
                reason=str(exc),
                progress_phase="failed",
                progress_note="Queen failed while resuming from a human reply.",
            )
            return transcript
        self._clear_pending_turn(status="running")
        self._append_transcript_entry(
            transcript,
            self._record(role="queen", agent_name=self.queen.agent_name, text=queen_reply, turn=self._turn_count),
        )
        self._commit_checkpoint()
        return self._drive_from_queen_reply(transcript, queen_reply)

    def _drive_from_queen_reply(self, transcript: list[dict], queen_reply: str) -> list[dict]:
        """Continue the loop after a Queen reply has already been produced."""
        while self._turn_count < self.max_turns:
            if _extract_done_signal(queen_reply):
                self._write_runtime_state(
                    "completed",
                    progress_phase="completed",
                    progress_note=self._completed_progress_note(),
                )
                logger.info("Queen signaled done at turn %d", self._turn_count)
                break

            if _extract_awaiting_human_signal(queen_reply):
                awaiting_reason = _extract_awaiting_human_reason(queen_reply)
                self._commit_checkpoint()
                self._write_runtime_state(
                    "awaiting_human",
                    reason=awaiting_reason,
                    progress_phase="awaiting_human",
                    progress_note="Queen is awaiting a human reply.",
                )
                human_followup = self._wait_for_human_resume()
                self._write_runtime_state(
                    "resuming",
                    reason=awaiting_reason,
                    progress_phase="resuming",
                    progress_note=self._resuming_progress_note(),
                )
                self._archive("human", human_followup)
                self._append_transcript_entry(
                    transcript,
                    self._record(role="human", agent_name="human", text=human_followup, turn=self._turn_count),
                )
                try:
                    self._commit_checkpoint()
                    self._mark_pending_turn(self.queen, self._format_human_followup_for_queen(human_followup))
                    queen_reply = self._agent_turn(
                        self.queen,
                        self._format_human_followup_for_queen(human_followup),
                    )
                except RuntimeError as exc:
                    logger.error("Queen failed on resume turn: %s", exc)
                    self._write_runtime_state(
                        "failed",
                        reason=str(exc),
                        progress_phase="failed",
                        progress_note="Queen failed while resuming from a human reply.",
                    )
                    break
                self._clear_pending_turn(status="running")
                self._append_transcript_entry(
                    transcript,
                    self._record(role="queen", agent_name=self.queen.agent_name, text=queen_reply, turn=self._turn_count),
                )
                self._commit_checkpoint()
                continue

            self._write_runtime_state(
                "running",
                progress_phase="delegating_to_worker",
                progress_note="Queen delegated the next step to Heisenberg.",
            )
            time.sleep(self.cooldown_seconds)

            self._commit_checkpoint()
            self._mark_pending_turn(self.worker, queen_reply)
            try:
                worker_reply = self._agent_turn(self.worker, queen_reply)
            except RuntimeError as exc:
                logger.error("Worker failed — ending loop: %s", exc)
                self._write_runtime_state(
                    "failed",
                    reason=str(exc),
                    progress_phase="failed",
                    progress_note="Heisenberg failed before Queen received a reply.",
                )
                break
            self._append_transcript_entry(
                transcript,
                self._record(role="worker", agent_name=self.worker.agent_name, text=worker_reply, turn=self._turn_count),
            )
            self._commit_checkpoint()
            self._clear_pending_turn(status="running")

            if _extract_done_signal(worker_reply):
                self._write_runtime_state(
                    "running",
                    progress_phase="reviewing_worker_result",
                    progress_note="Queen is preparing the final user handoff.",
                )
                time.sleep(self.cooldown_seconds)
                try:
                    self._commit_checkpoint()
                    self._mark_pending_turn(self.queen, worker_reply)
                    queen_reply = self._agent_turn(self.queen, worker_reply)
                except RuntimeError as exc:
                    logger.error("Queen failed on final turn: %s", exc)
                    self._write_runtime_state(
                        "failed",
                        reason=str(exc),
                        progress_phase="failed",
                        progress_note="Queen failed while preparing the final handoff.",
                    )
                    break
                self._clear_pending_turn(
                    status="completed",
                    progress_phase="completed",
                    progress_note=self._completed_progress_note(),
                )
                self._append_transcript_entry(
                    transcript,
                    self._record(role="queen", agent_name=self.queen.agent_name, text=queen_reply, turn=self._turn_count),
                )
                self._commit_checkpoint()
                logger.info("Worker signaled done, queen had last word at turn %d", self._turn_count)
                break

            time.sleep(self.cooldown_seconds)

            self._write_runtime_state(
                "running",
                progress_phase="reviewing_worker_result",
                progress_note="Queen is reviewing the latest worker result.",
            )
            try:
                self._commit_checkpoint()
                self._mark_pending_turn(self.queen, worker_reply)
                queen_reply = self._agent_turn(self.queen, worker_reply)
            except RuntimeError as exc:
                logger.error("Queen failed — ending loop: %s", exc)
                self._write_runtime_state(
                    "failed",
                    reason=str(exc),
                    progress_phase="failed",
                    progress_note="Queen failed while reviewing the latest worker result.",
                )
                break
            self._clear_pending_turn(status="running")
            self._append_transcript_entry(
                transcript,
                self._record(role="queen", agent_name=self.queen.agent_name, text=queen_reply, turn=self._turn_count),
            )

        if self._turn_count >= self.max_turns:
            logger.warning("MAX_TURNS (%d) reached — forcing stop", self.max_turns)
            self._write_runtime_state(
                "stopped",
                reason=f"MAX_TURNS ({self.max_turns}) reached.",
                progress_phase="stopped",
                progress_note="Queen stopped after reaching the configured turn limit.",
            )

        logger.info("=== Queen loop finished: %d turns, %d messages ===", self._turn_count, len(transcript))
        return transcript

    def _append_transcript_entry(self, transcript: list[dict], entry: dict, *, include_in_result: bool = True) -> None:
        """Store a transcript entry in memory and append it to the JSONL transcript file."""
        if include_in_result:
            transcript.append(entry)
        if self.transcript_path is None:
            return

        with self.transcript_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")

    def _agent_turn(self, agent: PersistentAgent, message: str) -> str:
        """Execute one agent turn and archive the result."""
        self._turn_count += 1
        try:
            reply = agent.turn(message)
        except RuntimeError as exc:
            logger.error("Agent %s failed on turn %d: %s", agent.agent_name, self._turn_count, exc)
            raise

        if not reply.strip():
            logger.error(
                "Agent %s returned empty reply on turn %d — aborting to prevent empty-message loop",
                agent.agent_name,
                self._turn_count,
            )
            raise RuntimeError(
                f"Agent {agent.agent_name} returned empty reply on turn {self._turn_count}. "
                f"Aborting conversation loop to prevent infinite empty-message cycling."
            )

        self._archive(agent.agent_name, reply, agent.user_id)
        return reply

    def _archive(self, sender: str, text: str, user_id: int = 1) -> None:
        """Post message to bee_messages for observability. Non-blocking on failure."""
        if self.bus is None or self.task_id is None:
            return
        try:
            self.bus.send(
                user_id=user_id,
                content={"message": text, "source": "queen"},
                task_id=self.task_id,
                title=f"[queen:{sender}]",
            )
        except Exception as exc:
            logger.warning("Failed to archive message from %s: %s", sender, exc)

    def _record(self, role: str, agent_name: str, text: str, turn: int) -> dict:
        """Build a transcript entry."""
        return {
            "role": role,
            "agent": agent_name,
            "text": text,
            "turn": turn,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def _wait_for_human_resume(self) -> str:
        """Block until one queued browser-authored resume message becomes available."""
        poll_seconds = self.cooldown_seconds if self.cooldown_seconds > 0 else AWAITING_HUMAN_POLL_SECONDS
        while True:
            human_followup = self._consume_human_followup()
            if human_followup is not None:
                return human_followup
            time.sleep(poll_seconds)

    def _consume_human_followup(self) -> str | None:
        """Return the next queued browser follow-up message, if any."""
        if self._pending_human_followups:
            return self._pending_human_followups.pop(0)

        if self.human_input_path is None or not self.human_input_path.exists():
            return None

        with self.human_input_path.open("r", encoding="utf-8") as handle:
            handle.seek(self._human_input_offset)
            while True:
                line_start = handle.tell()
                raw_line = handle.readline()
                if not raw_line:
                    break
                if not raw_line.endswith("\n"):
                    handle.seek(line_start)
                    break

                self._human_input_offset = handle.tell()
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    logger.warning("Ignoring invalid human follow-up JSONL line: %r", line)
                    continue
                if not isinstance(payload, dict):
                    continue
                message = str(payload.get("message", "")).strip()
                if message:
                    self._pending_human_followups.append(message)

        if self._pending_human_followups:
            return self._pending_human_followups.pop(0)
        return None

    def _write_runtime_state(
        self,
        status: str,
        reason: str = "",
        *,
        progress_phase: str = "",
        progress_note: str = "",
    ) -> None:
        """Persist the browser-visible runtime state to JSON."""
        if self.runtime_state_path is None:
            return

        write_runtime_state(
            self.runtime_state_path,
            status,
            reason,
            datetime.now(timezone.utc),
            progress_phase=progress_phase,
            progress_note=progress_note,
            process_id=os.getpid(),
            resume_checkpoint=self._checkpoint if self.human_state_path is not None else None,
            preserve_checkpoint=self.human_state_path is not None,
            pending_turn=self._pending_turn,
        )

    def _mark_pending_turn(self, agent: PersistentAgent, message: str) -> None:
        """Persist one in-flight agent turn before the CLI call begins."""
        preview = " ".join(message.split()).strip()[:280]
        self._pending_turn = ManagedSessionPendingTurn(
            agent_name=agent.agent_name,
            loop_turn_count=max(0, self._turn_count),
            started_at=datetime.now(timezone.utc).isoformat(),
            message_preview=preview,
        )
        self._write_runtime_state("running")

    def _clear_pending_turn(
        self,
        *,
        status: str,
        reason: str = "",
        progress_phase: str = "",
        progress_note: str = "",
    ) -> None:
        """Clear any in-flight turn marker once a new safe boundary is committed."""
        if self.runtime_state_path is None:
            self._pending_turn = None
            return
        self._pending_turn = None
        write_runtime_state(
            self.runtime_state_path,
            status,
            reason,
            datetime.now(timezone.utc),
            progress_phase=progress_phase,
            progress_note=progress_note,
            process_id=os.getpid(),
            resume_checkpoint=self._checkpoint if self.human_state_path is not None else None,
            preserve_checkpoint=self.human_state_path is not None,
            pending_turn=None,
            preserve_pending_turn=False,
        )

    def _build_checkpoint(self) -> ManagedSessionResumeCheckpoint | None:
        """Snapshot the resumable boundary for this loop."""
        queen_session_id = self.queen.session_id or ""
        worker_session_id = self.worker.session_id or ""
        checkpoint = ManagedSessionResumeCheckpoint(
            queen_session_id=queen_session_id,
            worker_session_id=worker_session_id,
            loop_turn_count=max(0, self._turn_count),
            queen_turn_count=max(0, self.queen.turn_count),
            worker_turn_count=max(0, self.worker.turn_count),
            human_input_offset=max(0, self._human_input_offset),
        )
        if checkpoint.is_valid:
            return checkpoint
        return None

    def _commit_checkpoint(self) -> None:
        """Persist the last fully completed loop boundary in memory."""
        checkpoint = self._build_checkpoint()
        if checkpoint is not None:
            self._checkpoint = checkpoint

    def _format_human_followup_for_queen(self, followup: str) -> str:
        """Build the Queen-facing input for one browser-authored resume message."""
        return "\n".join([
            "Human resume message from the browser-managed session:",
            followup,
        ])

    def _started_progress_note(self) -> str:
        """Return the browser-visible kickoff note for this run flavor."""
        if self.human_state_path is not None:
            return "Queen started working on this conversation."
        return "Queen started working on this direct run."

    def _resuming_progress_note(self) -> str:
        """Return the browser-visible resume note for this run flavor."""
        if self.human_state_path is not None:
            return "Queen is resuming from a browser reply."
        return "Queen is resuming from a human follow-up."

    def _completed_progress_note(self) -> str:
        """Return the browser-visible completion note for this run flavor."""
        if self.human_state_path is not None:
            return "Queen completed the managed session."
        return "Queen completed the direct run."

    def stop(self) -> None:
        """Tear down both agent sessions."""
        for agent in (self.queen, self.worker):
            try:
                agent.stop()
            except Exception as exc:
                logger.warning("Error stopping %s: %s", agent.agent_name, exc)


class SingleWorkerAutopilotLoop:
    """Run one persistent worker session until it finishes, needs a human, or hits the turn cap."""

    def __init__(
        self,
        worker: PersistentAgent,
        task_id: int | None = None,
        bus: object | None = None,
        max_turns: int = MAX_TURNS,
        cooldown_seconds: float = COOLDOWN_SECONDS,
        phase_pacing: str = QAP_DEFAULT_PHASE_PACING,
        transcript_path: str | Path | None = None,
        human_state_path: str | Path | None = None,
    ):
        self.worker = worker
        self.project_root = Path(worker.project_root)
        self.task_id = task_id
        self.bus = bus
        self.max_turns = max_turns
        self.cooldown_seconds = cooldown_seconds
        self.phase_pacing = phase_pacing
        self.transcript_path = Path(transcript_path) if transcript_path else None
        self.human_state_path = Path(human_state_path) if human_state_path else None
        self.runtime_state_path = self.human_state_path or (
            runtime_state_path_for_transcript(self.transcript_path)
            if self.transcript_path is not None
            else None
        )
        self._turn_count = 0
        self._pending_turn: ManagedSessionPendingTurn | None = None
        self._pending_turn_baseline: dict[str, str] | None = None
        self._worktree_evidence: ManagedSessionWorktreeEvidence | None = None

        if self.max_turns < 1:
            raise ValueError("max_turns must be at least 1")
        if self.cooldown_seconds < 0:
            raise ValueError("cooldown_seconds cannot be negative")
        if self.transcript_path is not None:
            self.transcript_path.parent.mkdir(parents=True, exist_ok=True)
        if self.human_state_path is not None:
            self.human_state_path.parent.mkdir(parents=True, exist_ok=True)
        if self.runtime_state_path is not None:
            self.runtime_state_path.parent.mkdir(parents=True, exist_ok=True)
            self._write_runtime_state(
                "running",
                progress_phase="worker_running",
                progress_note=self._started_progress_note(),
            )

    def run(self, initial_prompt: str) -> list[dict]:
        """Run the single-worker autopilot loop from one initial human prompt."""
        transcript: list[dict] = []
        reached_terminal_status = False

        logger.info(
            "=== Single-worker autopilot loop starting (task_id=%s, max_turns=%d) ===",
            self.task_id,
            self.max_turns,
        )

        self._archive("human", initial_prompt)
        self._append_transcript_entry(
            transcript,
            self._record(role="human", agent_name="human", text=initial_prompt, turn=0),
            include_in_result=False,
        )

        current_message = _build_autopilot_initial_message(initial_prompt, self.phase_pacing)
        current_transcript_message = build_qap_initial_transcript_message(self.phase_pacing)
        current_transcript_summary = build_qap_initial_transcript_summary(self.phase_pacing)
        while self._turn_count < self.max_turns:
            self._append_transcript_entry(
                transcript,
                self._record(
                    role=QAP_CONTROLLER_ROLE,
                    agent_name=QAP_CONTROLLER_AGENT_NAME,
                    text=current_transcript_message,
                    turn=self._turn_count + 1,
                    extra={
                        QAP_CONTROLLER_DEBUG_TEXT_KEY: current_message,
                        QAP_SUMMARY_CHIPS_KEY: current_transcript_summary.get(QAP_SUMMARY_CHIPS_KEY, []),
                        QAP_SUMMARY_NOTE_KEY: current_transcript_summary.get(QAP_SUMMARY_NOTE_KEY, ""),
                    },
                ),
                include_in_result=False,
            )
            self._write_runtime_state(
                "running",
                progress_phase="worker_running",
                progress_note="Heisenberg is continuing implementation.",
            )
            self._mark_pending_turn(self.worker, current_message)
            try:
                worker_reply = self._agent_turn(self.worker, current_message)
            except RuntimeError as exc:
                logger.error("Autopilot worker failed — ending loop: %s", exc)
                self._write_runtime_state(
                    "failed",
                    reason=str(exc),
                    progress_phase="failed",
                    progress_note="Heisenberg failed during the autopilot run.",
                )
                reached_terminal_status = True
                break

            handoff = parse_handoff(worker_reply)
            handoff_summary = build_qap_handoff_transcript_summary(handoff) if handoff is not None else {}
            self._clear_pending_turn(status="running")
            self._append_transcript_entry(
                transcript,
                self._record(
                    role="queen",
                    agent_name=self.worker.agent_name,
                    text=worker_reply,
                    turn=self._turn_count,
                    extra=handoff_summary or None,
                ),
            )
            if handoff is not None:
                self._write_runtime_state(
                    "running",
                    progress_phase="worker_running",
                    progress_note=_build_autopilot_handoff_progress_note(handoff),
                )

                if handoff.koodin_tila_vastaa_tavoitetta:
                    self._write_runtime_state(
                        "completed",
                        progress_phase="completed",
                        progress_note=self._completed_progress_note(),
                    )
                    logger.info("Autopilot worker completed the QAP handoff at turn %d", self._turn_count)
                    reached_terminal_status = True
                    break

                if not handoff.voidaanko_jatkaa:
                    awaiting_reason = " ".join(str(handoff.miksi_ei_voida_jatkaa or "").split()).strip()
                    if awaiting_reason == "":
                        awaiting_reason = " ".join(str(handoff.ehdotus_jatkoon or "").split()).strip()
                    if awaiting_reason == "":
                        awaiting_reason = "Heisenberg is awaiting a human reply."
                    self._write_runtime_state(
                        "awaiting_human",
                        reason=awaiting_reason,
                        progress_phase="awaiting_human",
                        progress_note="Heisenberg is awaiting a human reply.",
                    )
                    logger.info("Autopilot worker QAP handoff is awaiting human input at turn %d", self._turn_count)
                    reached_terminal_status = True
                    break

                current_message = build_qap_continue_message(
                    handoff.ehdotus_jatkoon,
                    handoff.tyovaihe_loppu,
                    self.phase_pacing,
                )
                current_transcript_message = build_qap_continue_transcript_message(
                    handoff.ehdotus_jatkoon,
                    handoff.tyovaihe_loppu,
                    self.phase_pacing,
                )
                current_transcript_summary = build_qap_continue_transcript_summary(
                    handoff.ehdotus_jatkoon,
                    handoff.tyovaihe_loppu,
                    self.phase_pacing,
                )
                if self.cooldown_seconds > 0:
                    time.sleep(self.cooldown_seconds)
                continue

            if _extract_done_signal(worker_reply):
                self._write_runtime_state(
                    "completed",
                    progress_phase="completed",
                    progress_note=self._completed_progress_note(),
                )
                logger.info("Autopilot worker signaled done at turn %d", self._turn_count)
                reached_terminal_status = True
                break

            if _extract_awaiting_human_signal(worker_reply):
                awaiting_reason = _extract_awaiting_human_reason(worker_reply)
                self._write_runtime_state(
                    "awaiting_human",
                    reason=awaiting_reason,
                    progress_phase="awaiting_human",
                    progress_note="Heisenberg is awaiting a human reply.",
                )
                logger.info("Autopilot worker is awaiting human input at turn %d", self._turn_count)
                reached_terminal_status = True
                break

            current_message = build_qap_continue_message(phase_pacing=self.phase_pacing)
            current_transcript_message = build_qap_continue_transcript_message(phase_pacing=self.phase_pacing)
            current_transcript_summary = build_qap_continue_transcript_summary(phase_pacing=self.phase_pacing)
            if self.cooldown_seconds > 0:
                time.sleep(self.cooldown_seconds)

        if not reached_terminal_status and self._turn_count >= self.max_turns:
            logger.warning("MAX_TURNS (%d) reached — forcing autopilot stop", self.max_turns)
            self._write_runtime_state(
                "stopped",
                reason=f"MAX_TURNS ({self.max_turns}) reached.",
                progress_phase="stopped",
                progress_note="Heisenberg stopped after reaching the configured turn limit.",
            )

        logger.info("=== Single-worker autopilot loop finished: %d turns, %d messages ===", self._turn_count, len(transcript))
        return transcript

    def _append_transcript_entry(self, transcript: list[dict], entry: dict, *, include_in_result: bool = True) -> None:
        """Store a transcript entry in memory and append it to the JSONL transcript file."""
        if include_in_result:
            transcript.append(entry)
        if self.transcript_path is None:
            return

        with self.transcript_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")

    def _agent_turn(self, agent: PersistentAgent, message: str) -> str:
        """Execute one agent turn and archive the result."""
        self._turn_count += 1
        reply_holder: dict[str, str] = {}
        error_holder: dict[str, Exception] = {}
        completed = threading.Event()
        turn_started_at = time.monotonic()

        def run_turn() -> None:
            try:
                reply_holder["reply"] = agent.turn(message)
            except Exception as exc:  # pragma: no cover - re-raised on the main thread
                error_holder["error"] = exc
            finally:
                completed.set()

        worker_thread = threading.Thread(
            target=run_turn,
            name=f"queen-autopilot-{agent.agent_name}-turn-{self._turn_count}",
            daemon=True,
        )
        worker_thread.start()

        while not completed.wait(timeout=AGENT_TURN_HEARTBEAT_SECONDS):
            self._emit_turn_heartbeat(agent, time.monotonic() - turn_started_at)

        worker_thread.join(timeout=0)
        if "error" in error_holder:
            exc = error_holder["error"]
            logger.error("Agent %s failed on turn %d: %s", agent.agent_name, self._turn_count, exc)
            raise exc

        reply = reply_holder.get("reply", "")

        if not reply.strip():
            logger.error(
                "Agent %s returned empty reply on turn %d — aborting to prevent empty-message loop",
                agent.agent_name,
                self._turn_count,
            )
            raise RuntimeError(
                f"Agent {agent.agent_name} returned empty reply on turn {self._turn_count}. "
                f"Aborting conversation loop to prevent infinite empty-message cycling."
            )

        self._archive(agent.agent_name, reply, agent.user_id)
        return reply

    def _emit_turn_heartbeat(self, agent: PersistentAgent, elapsed_seconds: float) -> None:
        """Refresh runtime-sidecar progress during a long in-flight worker turn."""
        agent_label = agent.agent_name.strip() or "Worker"
        elapsed_label = _format_elapsed_label(elapsed_seconds)
        progress_note = f"{agent_label.capitalize()} is still working on the current turn ({elapsed_label} elapsed)."
        worktree_evidence = self._capture_current_turn_worktree_evidence()
        if worktree_evidence is not None and worktree_evidence.changed_path_count > 0:
            preview = _build_worktree_evidence_preview(worktree_evidence.changed_paths)
            if preview:
                progress_note = f"{progress_note} Touched files so far: {preview}."
        logger.info("%s", progress_note)
        self._write_runtime_state(
            "running",
            progress_note=progress_note,
            worktree_evidence=worktree_evidence,
        )

    def _archive(self, sender: str, text: str, user_id: int = 1) -> None:
        """Post message to bee_messages for observability. Non-blocking on failure."""
        if self.bus is None or self.task_id is None:
            return
        try:
            self.bus.send(
                user_id=user_id,
                content={"message": text, "source": "queen"},
                task_id=self.task_id,
                title=f"[queen:{sender}]",
            )
        except Exception as exc:
            logger.warning("Failed to archive message from %s: %s", sender, exc)

    def _record(
        self,
        role: str,
        agent_name: str,
        text: str,
        turn: int,
        extra: dict | None = None,
    ) -> dict:
        """Build a transcript entry."""
        entry = {
            "role": role,
            "agent": agent_name,
            "text": text,
            "turn": turn,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if extra:
            entry.update(extra)
        return entry

    def _write_runtime_state(
        self,
        status: str,
        reason: str = "",
        *,
        progress_phase: str = "",
        progress_note: str = "",
        worktree_evidence: ManagedSessionWorktreeEvidence | None = None,
        preserve_worktree_evidence: bool = True,
    ) -> None:
        """Persist the browser-visible runtime state to JSON."""
        if self.runtime_state_path is None:
            return
        if worktree_evidence is not None:
            self._worktree_evidence = worktree_evidence

        write_runtime_state(
            self.runtime_state_path,
            status,
            reason,
            datetime.now(timezone.utc),
            progress_phase=progress_phase,
            progress_note=progress_note,
            process_id=os.getpid(),
            pending_turn=self._pending_turn,
            worktree_evidence=self._worktree_evidence,
            preserve_worktree_evidence=preserve_worktree_evidence,
        )

    def _mark_pending_turn(self, agent: PersistentAgent, message: str) -> None:
        """Persist one in-flight worker turn before the CLI call begins."""
        preview = " ".join(message.split()).strip()[:280]
        self._pending_turn_baseline = _capture_dirty_worktree_fingerprints(self.project_root)
        self._worktree_evidence = None
        self._pending_turn = ManagedSessionPendingTurn(
            agent_name=agent.agent_name,
            loop_turn_count=max(0, self._turn_count),
            started_at=datetime.now(timezone.utc).isoformat(),
            message_preview=preview,
        )
        self._write_runtime_state("running", preserve_worktree_evidence=False)

    def _clear_pending_turn(
        self,
        *,
        status: str,
        reason: str = "",
        progress_phase: str = "",
        progress_note: str = "",
    ) -> None:
        """Clear any in-flight turn marker once a new safe boundary is committed."""
        if self.runtime_state_path is None:
            self._pending_turn = None
            return
        self._pending_turn = None
        self._pending_turn_baseline = None
        write_runtime_state(
            self.runtime_state_path,
            status,
            reason,
            datetime.now(timezone.utc),
            progress_phase=progress_phase,
            progress_note=progress_note,
            process_id=os.getpid(),
            pending_turn=None,
            preserve_pending_turn=False,
            preserve_checkpoint=False,
            worktree_evidence=self._worktree_evidence,
        )

    def _started_progress_note(self) -> str:
        """Return the browser-visible kickoff note for the autopilot run."""
        if self.human_state_path is not None:
            return "Heisenberg started the autopilot managed session."
        return "Heisenberg started the autopilot direct run."

    def _completed_progress_note(self) -> str:
        """Return the browser-visible completion note for the autopilot run."""
        if self.human_state_path is not None:
            return "Heisenberg completed the autopilot managed session."
        return "Heisenberg completed the autopilot direct run."

    def _capture_current_turn_worktree_evidence(self) -> ManagedSessionWorktreeEvidence | None:
        """Return one structured snapshot of repo files changed during the current turn."""
        if self._pending_turn_baseline is None:
            return None

        current_fingerprints = _capture_dirty_worktree_fingerprints(self.project_root)
        changed_paths = sorted(
            path
            for path, fingerprint in current_fingerprints.items()
            if self._pending_turn_baseline.get(path) != fingerprint
        )
        if not changed_paths:
            return None

        return ManagedSessionWorktreeEvidence(
            captured_at=datetime.now(timezone.utc).isoformat(),
            changed_path_count=len(changed_paths),
            changed_paths=changed_paths[:8],
            summary=_build_worktree_evidence_summary(changed_paths),
        )

    def stop(self) -> None:
        """Tear down the worker session."""
        try:
            self.worker.stop()
        except Exception as exc:
            logger.warning("Error stopping %s: %s", self.worker.agent_name, exc)
