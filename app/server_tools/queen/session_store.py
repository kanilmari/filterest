"""Managed-session file helpers for Queen CLI/browser handoff.

This module reads and writes the same on-disk session contract as the Go
managed-session backend. It lets the terminal CLI discover existing sessions,
attach to their transcript files, and queue one human reply at a turn
boundary without going through HTTP.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path


class ManagedSessionError(RuntimeError):
    """Base error for managed-session file contract access."""


class ManagedSessionNotFound(ManagedSessionError):
    """Raised when a requested managed session manifest does not exist."""


class ManagedSessionNotAwaitingHuman(ManagedSessionError):
    """Raised when a human reply is queued for a non-awaiting session."""


class ManagedSessionHumanReplyQueued(ManagedSessionError):
    """Raised when one follow-up is already queued for the session."""


@dataclass(slots=True)
class ManagedSessionRecord:
    """One managed Queen session reconstructed from the on-disk contract."""

    id: str
    status: str
    prompt: str
    transcript_path: Path
    human_inbox_path: Path
    session_state_path: Path
    project_root: Path
    created_at: str
    updated_at: str
    task_id: int | None = None
    status_reason: str = ""
    human_followup_queued: bool = False
    human_followup_queued_at: str | None = None
    process_id: int = 0
    manifest_path: Path | None = None

    @property
    def can_accept_human_followup(self) -> bool:
        """Mirror the managed-session API's reply gate."""
        return self.status == "awaiting_human" and not self.human_followup_queued


@dataclass(slots=True)
class ManagedSessionResumeCheckpoint:
    """Serializable restart checkpoint for one managed Queen session boundary."""

    queen_session_id: str
    worker_session_id: str
    loop_turn_count: int
    queen_turn_count: int
    worker_turn_count: int
    human_input_offset: int
    version: int = 1

    @property
    def is_valid(self) -> bool:
        """Return True when the checkpoint can reattach both CLI sessions."""
        return (
            self.queen_session_id.strip() != ""
            and self.worker_session_id.strip() != ""
            and self.loop_turn_count >= 0
            and self.queen_turn_count >= 0
            and self.worker_turn_count >= 0
            and self.human_input_offset >= 0
        )

    def to_payload(self) -> dict[str, object]:
        """Convert the checkpoint to the shared JSON payload format."""
        return {
            "version": self.version,
            "queen_session_id": self.queen_session_id,
            "worker_session_id": self.worker_session_id,
            "loop_turn_count": self.loop_turn_count,
            "queen_turn_count": self.queen_turn_count,
            "worker_turn_count": self.worker_turn_count,
            "human_input_offset": self.human_input_offset,
        }

    @classmethod
    def from_payload(cls, payload: object) -> "ManagedSessionResumeCheckpoint | None":
        """Parse the shared JSON payload format into a validated checkpoint."""
        if not isinstance(payload, dict):
            return None
        try:
            checkpoint = cls(
                queen_session_id=str(payload.get("queen_session_id", "")).strip(),
                worker_session_id=str(payload.get("worker_session_id", "")).strip(),
                loop_turn_count=max(0, int(payload.get("loop_turn_count", 0))),
                queen_turn_count=max(0, int(payload.get("queen_turn_count", 0))),
                worker_turn_count=max(0, int(payload.get("worker_turn_count", 0))),
                human_input_offset=max(0, int(payload.get("human_input_offset", 0))),
                version=max(1, int(payload.get("version", 1))),
            )
        except (TypeError, ValueError):
            return None
        return checkpoint if checkpoint.is_valid else None


@dataclass(slots=True)
class ManagedSessionPendingTurn:
    """One in-flight agent turn captured before the CLI call finishes."""

    agent_name: str
    loop_turn_count: int
    started_at: str
    message_preview: str = ""
    version: int = 1

    @property
    def is_valid(self) -> bool:
        """Return True when the pending-turn payload is usable for recovery."""
        return self.agent_name.strip() != "" and self.loop_turn_count >= 0 and self.started_at.strip() != ""

    @property
    def is_worker_turn(self) -> bool:
        """Return True when the pending turn belongs to Heisenberg/worker."""
        lowered = self.agent_name.strip().lower()
        return lowered in {"worker", "heisenberg"}

    @property
    def is_queen_turn(self) -> bool:
        """Return True when the pending turn belongs to Queen."""
        return self.agent_name.strip().lower() == "queen"

    def to_payload(self) -> dict[str, object]:
        """Convert the pending-turn marker to the shared JSON payload format."""
        return {
            "version": self.version,
            "agent_name": self.agent_name,
            "loop_turn_count": self.loop_turn_count,
            "started_at": self.started_at,
            "message_preview": self.message_preview,
        }

    @classmethod
    def from_payload(cls, payload: object) -> "ManagedSessionPendingTurn | None":
        """Parse the shared JSON payload format into a validated pending-turn marker."""
        if not isinstance(payload, dict):
            return None
        try:
            pending_turn = cls(
                agent_name=str(payload.get("agent_name", "")).strip(),
                loop_turn_count=max(0, int(payload.get("loop_turn_count", 0))),
                started_at=str(payload.get("started_at", "")).strip(),
                message_preview=str(payload.get("message_preview", "")).strip(),
                version=max(1, int(payload.get("version", 1))),
            )
        except (TypeError, ValueError):
            return None
        return pending_turn if pending_turn.is_valid else None


@dataclass(slots=True)
class ManagedSessionWorktreeEvidence:
    """One runtime snapshot of repo files touched during the current in-flight turn."""

    captured_at: str
    changed_path_count: int = 0
    changed_paths: list[str] = field(default_factory=list)
    summary: str = ""
    version: int = 1

    @property
    def is_valid(self) -> bool:
        """Return True when the evidence snapshot has enough structure to display."""
        return self.captured_at.strip() != "" and self.changed_path_count >= 0

    def to_payload(self) -> dict[str, object]:
        """Convert the evidence snapshot to the shared JSON payload format."""
        return {
            "version": self.version,
            "captured_at": self.captured_at,
            "changed_path_count": self.changed_path_count,
            "changed_paths": list(self.changed_paths),
            "summary": self.summary,
        }

    @classmethod
    def from_payload(cls, payload: object) -> "ManagedSessionWorktreeEvidence | None":
        """Parse the shared JSON payload format into a validated evidence snapshot."""
        if not isinstance(payload, dict):
            return None
        changed_paths_payload = payload.get("changed_paths", [])
        if not isinstance(changed_paths_payload, list):
            changed_paths_payload = []
        try:
            evidence = cls(
                captured_at=str(payload.get("captured_at", "")).strip(),
                changed_path_count=max(0, int(payload.get("changed_path_count", len(changed_paths_payload)))),
                changed_paths=[
                    str(path).strip()
                    for path in changed_paths_payload
                    if str(path).strip() != ""
                ],
                summary=str(payload.get("summary", "")).strip(),
                version=max(1, int(payload.get("version", 1))),
            )
        except (TypeError, ValueError):
            return None
        return evidence if evidence.is_valid else None


@dataclass(slots=True)
class ManagedSessionRuntimeState:
    """Current browser/runtime status plus optional restart checkpoint."""

    status: str = ""
    reason: str = ""
    updated_at: str = ""
    process_id: int = 0
    progress_phase: str = ""
    progress_tone: str = ""
    progress_note: str = ""
    resume_checkpoint: ManagedSessionResumeCheckpoint | None = None
    pending_turn: ManagedSessionPendingTurn | None = None
    worktree_evidence: ManagedSessionWorktreeEvidence | None = None

    @property
    def can_resume_awaiting_human(self) -> bool:
        """Return True when the state can resume from an awaiting-human boundary."""
        return (
            self.status in {"awaiting_human", "resuming"}
            and self.resume_checkpoint is not None
            and self.resume_checkpoint.is_valid
        )

    @property
    def has_recoverable_pending_worker_turn(self) -> bool:
        """Return True when a dead worker turn can be recovered from last safe boundary."""
        return (
            self.resume_checkpoint is not None
            and self.resume_checkpoint.is_valid
            and self.pending_turn is not None
            and self.pending_turn.is_worker_turn
        )

    @property
    def has_recoverable_pending_queen_turn(self) -> bool:
        """Return True when a dead Queen turn should fail with a guarded recovery reason."""
        return (
            self.resume_checkpoint is not None
            and self.resume_checkpoint.is_valid
            and self.pending_turn is not None
            and self.pending_turn.is_queen_turn
        )


def runtime_state_path_for_transcript(transcript_path: Path) -> Path:
    """Derive the sidecar runtime-state path for one Queen transcript file."""
    normalized = Path(transcript_path).expanduser()
    if normalized.suffix:
        return normalized.with_suffix(".runtime.json")
    return normalized.with_name(f"{normalized.name}.runtime.json")


def managed_session_registry_dir(project_root: Path) -> Path:
    """Return the canonical managed-session manifest directory."""
    return project_root / ".queen" / "session_registry"


def list_managed_sessions(project_root: Path) -> list[ManagedSessionRecord]:
    """Read managed-session manifests from disk, newest first."""
    registry_dir = managed_session_registry_dir(project_root)
    if not registry_dir.exists():
        return []

    sessions: list[ManagedSessionRecord] = []
    for manifest_path in registry_dir.glob("queen_session_*.json"):
        if not manifest_path.is_file():
            continue
        try:
            sessions.append(read_managed_session(manifest_path))
        except (OSError, json.JSONDecodeError, ValueError):
            continue

    sessions.sort(key=lambda session: session.created_at or session.updated_at, reverse=True)
    return sessions


def get_managed_session(project_root: Path, session_id: str) -> ManagedSessionRecord:
    """Load one managed session by id from the registry directory."""
    manifest_path = managed_session_registry_dir(project_root) / f"queen_session_{session_id}.json"
    if not manifest_path.exists():
        raise ManagedSessionNotFound(f"Managed session not found: {session_id}")
    return read_managed_session(manifest_path)


def queue_human_reply(
    project_root: Path,
    session_id: str,
    message: str,
    *,
    source: str = "cli",
) -> ManagedSessionRecord:
    """Append one human reply to a managed session and mark it resuming."""
    record = get_managed_session(project_root, session_id)
    trimmed_message = message.strip()
    if trimmed_message == "":
        raise ManagedSessionError("message is required")
    if record.status != "awaiting_human":
        raise ManagedSessionNotAwaitingHuman(f"Managed session {session_id} is not awaiting human input")
    if record.human_followup_queued:
        raise ManagedSessionHumanReplyQueued(f"Managed session {session_id} already has a queued human reply")

    now = datetime.now(timezone.utc)
    payload = {
        "message": trimmed_message,
        "timestamp": _format_timestamp(now),
        "source": source,
    }
    record.human_inbox_path.parent.mkdir(parents=True, exist_ok=True)
    with record.human_inbox_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")

    resume_reason = "Human reply received from the terminal. Queen is resuming."
    write_runtime_state(
        record.session_state_path,
        "resuming",
        resume_reason,
        now,
        progress_phase="resuming",
        progress_note="Queen is resuming from a terminal reply.",
    )
    _update_manifest(
        record,
        status="resuming",
        status_reason=resume_reason,
        human_followup_queued=True,
        human_followup_queued_at=_format_timestamp(now),
        updated_at=_format_timestamp(now),
    )
    return get_managed_session(project_root, session_id)


def read_managed_session(manifest_path: Path) -> ManagedSessionRecord:
    """Reconstruct one managed session from a registry manifest on disk."""
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Managed session manifest must be a JSON object: {manifest_path}")

    transcript_path = Path(str(payload.get("transcript_path", ""))).expanduser()
    human_inbox_path = Path(str(payload.get("human_inbox_path", ""))).expanduser()
    session_state_path = Path(str(payload.get("session_state_path", ""))).expanduser()
    project_root = Path(str(payload.get("project_root", ""))).expanduser()

    status = str(payload.get("status", "unknown")).strip() or "unknown"
    status_reason = str(payload.get("status_reason", "")).strip()
    updated_at = str(payload.get("updated_at", "")).strip()
    human_followup_queued = bool(payload.get("human_followup_queued", False))

    runtime_state = read_runtime_state(session_state_path)
    human_followup_queued_at = _string_or_none(payload.get("human_followup_queued_at"))
    status_from_runtime = False
    if not _is_terminal_status(status):
        runtime_status = runtime_state.status.strip()
        status_from_runtime = runtime_status != ""
        if runtime_status:
            status = runtime_status
        runtime_reason = runtime_state.reason.strip()
        if runtime_reason:
            status_reason = runtime_reason
        runtime_updated_at = runtime_state.updated_at.strip()
        if runtime_updated_at:
            updated_at = runtime_updated_at

    if status_from_runtime and status == "awaiting_human":
        human_followup_queued = False
        human_followup_queued_at = None
    elif status_from_runtime and status == "resuming":
        human_followup_queued = True
        if human_followup_queued_at is None:
            human_followup_queued_at = runtime_state.updated_at.strip() or None

    task_id_raw = payload.get("task_id")
    task_id = int(task_id_raw) if isinstance(task_id_raw, int) else None

    return ManagedSessionRecord(
        id=str(payload.get("id", "")).strip(),
        status=status,
        prompt=str(payload.get("prompt", "")),
        transcript_path=transcript_path,
        human_inbox_path=human_inbox_path,
        session_state_path=session_state_path,
        project_root=project_root,
        created_at=str(payload.get("created_at", "")).strip(),
        updated_at=updated_at,
        task_id=task_id,
        status_reason=status_reason,
        human_followup_queued=human_followup_queued,
        human_followup_queued_at=human_followup_queued_at,
        process_id=int(payload.get("process_id", 0) or 0),
        manifest_path=manifest_path,
    )


def _update_manifest(
    record: ManagedSessionRecord,
    *,
    status: str,
    status_reason: str,
    human_followup_queued: bool,
    human_followup_queued_at: str | None,
    updated_at: str,
) -> None:
    """Persist the minimal manifest fields that the CLI mutates."""
    if record.manifest_path is None:
        raise ManagedSessionError(f"Managed session {record.id} has no manifest path")

    payload = json.loads(record.manifest_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Managed session manifest must be a JSON object: {record.manifest_path}")

    payload["status"] = status
    payload["status_reason"] = status_reason
    payload["human_followup_queued"] = human_followup_queued
    payload["human_followup_queued_at"] = human_followup_queued_at
    payload["updated_at"] = updated_at

    temp_path = record.manifest_path.with_name(f"{record.manifest_path.name}.tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp_path.replace(record.manifest_path)


def read_runtime_state(session_state_path: Path) -> ManagedSessionRuntimeState:
    """Load the current runtime state JSON if the file exists."""
    if not session_state_path.exists():
        return ManagedSessionRuntimeState()
    payload = json.loads(session_state_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        return ManagedSessionRuntimeState()
    raw_process_id = payload.get("process_id", 0)
    try:
        process_id = max(0, int(raw_process_id or 0))
    except (TypeError, ValueError):
        process_id = 0
    return ManagedSessionRuntimeState(
        status=str(payload.get("status", "")),
        reason=str(payload.get("reason", "")),
        updated_at=str(payload.get("updated_at", "")),
        process_id=process_id,
        progress_phase=str(payload.get("progress_phase", "")),
        progress_tone=str(payload.get("progress_tone", "")),
        progress_note=str(payload.get("progress_note", "")),
        resume_checkpoint=ManagedSessionResumeCheckpoint.from_payload(payload.get("resume_checkpoint")),
        pending_turn=ManagedSessionPendingTurn.from_payload(payload.get("pending_turn")),
        worktree_evidence=ManagedSessionWorktreeEvidence.from_payload(payload.get("worktree_evidence")),
    )


def write_runtime_state(
    session_state_path: Path,
    status: str,
    reason: str,
    now: datetime,
    *,
    progress_phase: str = "",
    progress_tone: str = "",
    progress_note: str = "",
    process_id: int | None = None,
    resume_checkpoint: ManagedSessionResumeCheckpoint | None = None,
    preserve_checkpoint: bool = True,
    pending_turn: ManagedSessionPendingTurn | None = None,
    preserve_pending_turn: bool = True,
    worktree_evidence: ManagedSessionWorktreeEvidence | None = None,
    preserve_worktree_evidence: bool = True,
) -> None:
    """Write the runtime state file while preserving any resumable checkpoint."""
    session_state_path.parent.mkdir(parents=True, exist_ok=True)
    current_state = read_runtime_state(session_state_path)
    checkpoint = resume_checkpoint
    if checkpoint is None and preserve_checkpoint:
        checkpoint = current_state.resume_checkpoint
    current_pending_turn = pending_turn
    if current_pending_turn is None and preserve_pending_turn:
        current_pending_turn = current_state.pending_turn
    current_worktree_evidence = worktree_evidence
    if current_worktree_evidence is None and preserve_worktree_evidence:
        current_worktree_evidence = current_state.worktree_evidence
    payload = {
        "status": status,
        "reason": reason,
        "updated_at": _format_timestamp(now),
    }
    current_process_id = max(0, int(process_id if process_id is not None else current_state.process_id))
    if current_process_id > 0:
        payload["process_id"] = current_process_id
    current_progress_phase = progress_phase.strip() or current_state.progress_phase.strip()
    if current_progress_phase:
        payload["progress_phase"] = current_progress_phase
        current_progress_tone = progress_tone.strip() or _progress_tone_for_phase(current_progress_phase)
        if current_progress_tone:
            payload["progress_tone"] = current_progress_tone
        current_progress_note = progress_note.strip() or current_state.progress_note.strip()
        if current_progress_note:
            payload["progress_note"] = current_progress_note
    if checkpoint is not None and checkpoint.is_valid:
        payload["resume_checkpoint"] = checkpoint.to_payload()
    if current_pending_turn is not None and current_pending_turn.is_valid:
        payload["pending_turn"] = current_pending_turn.to_payload()
    if current_worktree_evidence is not None and current_worktree_evidence.is_valid:
        payload["worktree_evidence"] = current_worktree_evidence.to_payload()
    temp_path = session_state_path.with_name(f"{session_state_path.name}.tmp")
    temp_path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    temp_path.replace(session_state_path)


def _format_timestamp(moment: datetime) -> str:
    """Format timestamps like the runtime state files do."""
    return moment.astimezone(timezone.utc).isoformat()


def _is_terminal_status(status: str) -> bool:
    """Mirror the managed-session backend's terminal status handling."""
    return status in {"completed", "failed", "stopped"}


def _string_or_none(value: object) -> str | None:
    """Return a trimmed string when the value is usable."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _progress_tone_for_phase(progress_phase: str) -> str:
    """Return a safe display tone for one orchestration progress phase."""
    phase = progress_phase.strip().lower()
    if phase in {"awaiting_human"}:
        return "warning"
    if phase in {"completed"}:
        return "success"
    if phase in {"stopped"}:
        return "stopped"
    if phase in {"started", "delegating_to_worker", "reviewing_worker_result", "resuming"}:
        return "info"
    if phase in {"failed"}:
        return "danger"
    return "info"
