# main.py
# CLI entrypoint for Queen persistent agent system.
# Bridges user commands with persistent agent sessions and conversation loops.
# Exists to provide run, status, and chat commands.

import argparse
import concurrent.futures
import fcntl
import importlib
import json
import logging
import os
import re
import sys
import time
from contextlib import contextmanager, nullcontext
from pathlib import Path

from ..lib.easelect_private_paths import resolve_embedded_project_root

from .chat_viewer import (
    display_run,
    interactive_picker,
    print_managed_session_listing,
    print_run_listing,
    resolve_transcript_path,
)
from .persistent_agent import PersistentAgent
from .conversation_loop import ConversationLoop, SingleWorkerAutopilotLoop
from .session_store import (
    ManagedSessionError,
    ManagedSessionHumanReplyQueued,
    ManagedSessionNotAwaitingHuman,
    ManagedSessionNotFound,
    get_managed_session,
    list_managed_sessions,
    queue_human_reply,
    read_runtime_state,
)

# Keep ticket-message archiving optional so Queen can still run when the local
# application API is unavailable.
try:
    from .message_bus import MessageBus
except ImportError:
    MessageBus = None  # type: ignore[assignment,misc]

_QUEEN_DIR = Path(__file__).resolve().parent

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("queen")

_MULTI_TICKET_RELEASE_STATUSES = {
    "backlog",
    "backlog_later",
    "backlog_nice_to_have",
    "on_hold",
    "awaiting_human_decision",
    "done",
    "rejected",
    "aborted",
    "archived",
    "to_be_deleted",
}

_MULTI_TICKET_AUTO_SKIP_STATUSES = {
    "done",
    "rejected",
    "aborted",
    "archived",
    "to_be_deleted",
}


class DuplicateDirectRunError(RuntimeError):
    """Raised when a second direct Queen run targets an already-active task."""


def _resolve_project_root() -> Path:
    """Return the runtime project while keeping Queen source-owned by Filterest."""
    canonical_filterest_root = _QUEEN_DIR.parent.parent
    return resolve_embedded_project_root(canonical_filterest_root)


def _worker_defaults_path(project_root: Path | None = None) -> Path:
    """Return the canonical worker defaults file that Queen should follow."""
    del project_root
    return _QUEEN_DIR.parent / "agent_tools" / "worker_agent_defaults.sh"


def _resolve_default_family(project_root: Path | None = None) -> str:
    """Resolve Queen's default backend from worker runtime configuration."""
    env_override = os.environ.get("WORKER_AGENT_BACKEND", "").strip()
    if env_override in {"claude", "codex"}:
        return env_override

    defaults_path = _worker_defaults_path(project_root)
    try:
        defaults_text = defaults_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"Could not read worker defaults: {defaults_path}") from exc

    match = re.search(r'^DEFAULT_BACKEND="?(claude|codex)"?$', defaults_text, re.MULTILINE)
    if match:
        return match.group(1)

    raise RuntimeError(f"Could not resolve DEFAULT_BACKEND from {defaults_path}")


def _default_transcript_path(project_root: Path, task_id: int | None) -> Path:
    """Build the default JSONL transcript path for a queen run."""
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    task_label = f"task_{task_id}" if task_id is not None else "manual"
    return project_root / ".queen" / "transcripts" / f"queen_run_{timestamp}_{task_label}.jsonl"


def _direct_run_guard_path(project_root: Path, task_id: int) -> Path:
    """Return the task-scoped lock path that serializes direct Queen runs."""
    return project_root / ".queen" / "run_guards" / f"queen_task_{task_id}.lock"


def _read_direct_run_guard_metadata(lock_handle) -> dict[str, str]:
    """Parse the currently held direct-run lock payload into key/value strings."""
    lock_handle.seek(0)
    payload: dict[str, str] = {}
    for raw_line in lock_handle.readlines():
        key, separator, value = raw_line.partition("=")
        if not separator:
            continue
        payload[key.strip()] = value.strip()
    return payload


@contextmanager
def _hold_direct_run_task_guard(project_root: Path, task_id: int | None, transcript_path: Path):
    """Hold a non-blocking per-task lock for one direct Queen run."""
    if task_id is None:
        yield
        return

    lock_path = _direct_run_guard_path(project_root, task_id)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+", encoding="utf-8") as lock_handle:
        try:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            metadata = _read_direct_run_guard_metadata(lock_handle)
            details: list[str] = []
            pid = metadata.get("pid", "").strip()
            if pid:
                details.append(f"pid {pid}")
            active_transcript = metadata.get("transcript_path", "").strip()
            if active_transcript:
                details.append(f"transcript {active_transcript}")
            started_at = metadata.get("started_at", "").strip()
            if started_at:
                details.append(f"started {started_at}")
            detail_suffix = f" ({'; '.join(details)})" if details else ""
            raise DuplicateDirectRunError(
                f"Direct Queen run already active for task #{task_id}{detail_suffix}. "
                "Stop the existing run before launching another one."
            ) from exc

        lock_handle.seek(0)
        lock_handle.truncate()
        lock_handle.write(
            f"pid={os.getpid()}\n"
            f"task_id={task_id}\n"
            f"started_at={time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}\n"
            f"transcript_path={transcript_path}\n"
        )
        lock_handle.flush()

        try:
            yield
        finally:
            try:
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass


def _start_agents_in_parallel(*agents: PersistentAgent) -> None:
    """Start all agent sessions concurrently and stop partial startups on failure."""
    started_agents: list[PersistentAgent] = []
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(agents)) as executor:
            future_to_agent = {
                executor.submit(agent.start): agent
                for agent in agents
            }
            for future in concurrent.futures.as_completed(future_to_agent):
                agent = future_to_agent[future]
                future.result()
                started_agents.append(agent)
    except Exception:
        for agent in started_agents:
            try:
                agent.stop()
            except Exception as exc:
                logger.warning("Failed to stop partially started agent %s: %s", agent.agent_name, exc)
        raise


def _load_db_task_module():
    """Import the canonical DB task helper module on demand for batch runs."""
    module_name = os.environ.get(
        "FILTEREST_DB_TASK_PYTHON_MODULE",
        "server_tools.agent_tools.db_task",
    ).strip()
    try:
        return importlib.import_module(module_name)
    except ImportError as exc:
        raise RuntimeError(
            f"Could not import {module_name} for --multi-ticket mode."
        ) from exc


def _read_db_task_record(db_task_module, *, task_id: int | None = None, status: str | None = None, queue: str | None = None, groups: str | None = None):
    """Read one DB task record (or task list) through the shared db_task logic."""
    try:
        return db_task_module._read_tasks(
            argparse.Namespace(direct_db=False),
            status=status,
            task_id=task_id,
            queue=queue,
            groups=groups,
        )
    except SystemExit as exc:
        target = f"task #{task_id}" if task_id is not None else "task list"
        raise RuntimeError(f"db_task read failed while loading {target}.") from exc


def _claim_db_task_for_autopilot(db_task_module, task_id: int) -> dict:
    """Move one `new` DB ticket into `in_progress` before the worker starts."""
    try:
        db_task_module._api(
            "PATCH",
            "/api/app/agent-tools/tasks",
            data={"id": task_id, "status": "in_progress"},
        )
        task = db_task_module._read_single_task_reconciled(task_id)
    except SystemExit as exc:
        raise RuntimeError(f"Could not claim task #{task_id} for multi-ticket autopilot.") from exc

    if not isinstance(task, dict) or int(task.get("id") or 0) != task_id:
        raise RuntimeError(f"Claimed task #{task_id}, but the verification read returned no task payload.")

    dump_task = getattr(db_task_module, "_dump_task", None)
    if callable(dump_task):
        try:
            dump_task(task)
        except Exception as exc:
            logger.warning("Could not dump claimed task #%s after status update: %s", task_id, exc)
    return task


def _task_groups_label(task: dict) -> str:
    """Render one short comma-separated group label list for prompt context."""
    groups = task.get("groups") or []
    if not isinstance(groups, list):
        return "(none)"

    labels = []
    for group in groups:
        if not isinstance(group, dict):
            continue
        slug = str(group.get("slug") or "").strip()
        if slug:
            labels.append(slug)
    return ", ".join(labels) if labels else "(none)"


def _build_multi_ticket_prompt(base_prompt: str, task: dict, *, batch_index: int) -> str:
    """Wrap the user's batch instruction with one concrete ticket dispatch context."""
    task_id = int(task.get("id") or 0)
    title = str(task.get("title") or task.get("filename") or f"task-{task_id}").strip()
    issue_type = str(task.get("issue_type") or "task").strip() or "task"
    queue_label = str(task.get("queue_title") or task.get("queue_slug") or "(none)").strip() or "(none)"
    groups_label = _task_groups_label(task)
    status_label = str(task.get("status") or "(unknown)").strip() or "(unknown)"

    lines: list[str] = []
    cleaned_prompt = base_prompt.strip()
    if cleaned_prompt:
        lines.append(cleaned_prompt)
        lines.append("")

    lines.extend(
        [
            f"Multi-ticket autopilot batch item {batch_index}:",
            f"- Ticket ID: #{task_id}",
            f"- Title: {title}",
            f"- Issue type: {issue_type}",
            f"- Queue: {queue_label}",
            f"- Groups: {groups_label}",
            f"- Status at dispatch: {status_label}",
            "",
            "Batch-run rules:",
            f"- This dispatch is only for DB ticket #{task_id}. Do not jump ahead to other tickets inside this turn.",
            f"- Read the full ticket with ./db_task show {task_id} before changing code.",
            "- If the ticket was still `new`, the batch runner may already have claimed it; otherwise preserve the existing truthful status/ownership.",
            "- If you discover a real blocker, move the ticket to an appropriate non-active state and explain it.",
            "- Use [AWAITING_HUMAN] only for a real human decision or approval blocker.",
            "- Use [DONE] only when this ticket's current scope is complete for now and the ticket no longer remains in `new` or `in_progress`.",
            "- Always report concrete evidence: files changed, commands run, verification results, and git status --short.",
        ]
    )
    return "\n".join(lines)


def _list_multi_ticket_candidates(
    db_task_module,
    *,
    explicit_task_id: int | None,
    ticket_queue: str | None,
    ticket_groups: str | None,
    seen_task_ids: set[int],
) -> list[dict]:
    """Return deterministic ticket candidates for one batch-run dispatch step."""
    if explicit_task_id is not None:
        task = _read_db_task_record(db_task_module, task_id=explicit_task_id)
        if not isinstance(task, dict) or int(task.get("id") or 0) != explicit_task_id:
            raise RuntimeError(f"Task #{explicit_task_id} was not found for --multi-ticket dispatch.")
        return [task]

    tasks = _read_db_task_record(
        db_task_module,
        queue=ticket_queue,
        groups=ticket_groups,
    )
    if not isinstance(tasks, list):
        tasks = [tasks] if isinstance(tasks, dict) else []

    candidates: list[dict] = []
    for task in tasks:
        if not isinstance(task, dict):
            continue
        task_id = int(task.get("id") or 0)
        task_status = str(task.get("status") or "").strip()
        if task_id <= 0 or task_id in seen_task_ids:
            continue
        if task_status in _MULTI_TICKET_AUTO_SKIP_STATUSES:
            continue
        candidates.append(task)

    candidates.sort(key=lambda task: int(task.get("id") or 0))
    return candidates


def _run_autopilot_multi_ticket_batch(
    loop: SingleWorkerAutopilotLoop,
    *,
    project_root: Path,
    transcript_path: Path,
    base_prompt: str,
    initial_task_id: int | None,
    ticket_queue: str | None,
    ticket_groups: str | None,
) -> list[dict]:
    """Drive one persistent autopilot worker across multiple DB tickets in sequence."""
    db_task_module = _load_db_task_module()
    transcript: list[dict] = []
    seen_task_ids: set[int] = set()
    batch_index = 1
    next_explicit_task_id = initial_task_id
    dispatched_any = False

    while True:
        explicit_dispatch = next_explicit_task_id is not None
        candidates = _list_multi_ticket_candidates(
            db_task_module,
            explicit_task_id=next_explicit_task_id,
            ticket_queue=ticket_queue,
            ticket_groups=ticket_groups,
            seen_task_ids=seen_task_ids,
        )
        next_explicit_task_id = None

        if not candidates:
            if not dispatched_any:
                print("No eligible DB tickets matched the --multi-ticket filters.")
                loop._write_runtime_state(
                    "completed",
                    progress_phase="completed",
                    progress_note="Heisenberg found no claimable DB tickets for the multi-ticket direct run.",
                )
            break

        dispatched_this_round = False
        blocked_explicit_error: DuplicateDirectRunError | None = None

        for candidate in candidates:
            task_id = int(candidate.get("id") or 0)
            if task_id <= 0:
                continue

            try:
                with _hold_direct_run_task_guard(project_root, task_id, transcript_path):
                    current_task = _read_db_task_record(db_task_module, task_id=task_id)
                    if not isinstance(current_task, dict) or int(current_task.get("id") or 0) != task_id:
                        raise RuntimeError(f"Task #{task_id} disappeared before multi-ticket dispatch.")

                    current_status = str(current_task.get("status") or "").strip()
                    if not explicit_dispatch and current_status in _MULTI_TICKET_AUTO_SKIP_STATUSES:
                        logger.info(
                            "Skipping task #%s in multi-ticket autopilot because its status is %s, which is excluded from auto-selection.",
                            task_id,
                            current_status or "(empty)",
                        )
                        continue

                    if current_status == "new":
                        current_task = _claim_db_task_for_autopilot(db_task_module, task_id)

                    loop.task_id = task_id
                    segment = loop.run(
                        _build_multi_ticket_prompt(
                            base_prompt,
                            current_task,
                            batch_index=batch_index,
                        )
                    )
                    transcript.extend(segment)
                    dispatched_any = True
                    dispatched_this_round = True
                    seen_task_ids.add(task_id)

                    runtime_status = ""
                    if loop.runtime_state_path is not None:
                        runtime_status = read_runtime_state(loop.runtime_state_path).status

                    current_task = _read_db_task_record(db_task_module, task_id=task_id)
                    current_status = str((current_task or {}).get("status") or "").strip()
                    if runtime_status == "completed":
                        if current_status not in _MULTI_TICKET_RELEASE_STATUSES:
                            error = (
                                f"Autopilot worker signaled [DONE] for task #{task_id}, "
                                f"but the ticket still ended in active status '{current_status or 'unknown'}'."
                            )
                            loop._write_runtime_state(
                                "stopped",
                                reason=error,
                                progress_phase="stopped",
                                progress_note="Heisenberg stopped because a completed ticket kept active ownership.",
                            )
                            print(f"Error: {error}", file=sys.stderr)
                            sys.exit(1)
                        batch_index += 1
                        break

                    return transcript
            except DuplicateDirectRunError as exc:
                if explicit_dispatch:
                    blocked_explicit_error = exc
                    break
                logger.info(
                    "Skipping task #%s in multi-ticket autopilot because another direct Queen run already holds its guard.",
                    task_id,
                )
                continue

        if blocked_explicit_error is not None:
            loop._write_runtime_state(
                "stopped",
                reason=str(blocked_explicit_error),
                progress_phase="stopped",
                progress_note="Heisenberg could not start the requested ticket because another direct Queen run already holds it.",
            )
            raise blocked_explicit_error

        if not dispatched_this_round:
            if not dispatched_any:
                print("No eligible DB tickets were available after guard/status checks.")
                loop._write_runtime_state(
                    "completed",
                    progress_phase="completed",
                    progress_note="Heisenberg found no claimable DB tickets for the multi-ticket direct run.",
                )
            break

    return transcript


def cmd_run(args: argparse.Namespace) -> None:
    """Run a queen conversation loop."""
    project_root = _resolve_project_root()
    default_family = _resolve_default_family(project_root)
    autopilot_mode = bool(getattr(args, "autopilot", False) or getattr(args, "single_worker", False))
    multi_ticket_mode = bool(getattr(args, "multi_ticket", False))
    queen_family = args.queen_family or default_family
    worker_family = args.worker_family or default_family
    prompt = args.prompt
    resume_runtime_state = None
    resume_checkpoint = None
    recover_pending_worker_turn = False
    recover_pending_queen_turn = False

    if multi_ticket_mode and not autopilot_mode:
        print("Error: --multi-ticket requires --autopilot", file=sys.stderr)
        sys.exit(1)
    if not multi_ticket_mode and (getattr(args, "ticket_queue", None) or getattr(args, "ticket_groups", None)):
        print("Error: --ticket-queue and --ticket-groups require --multi-ticket", file=sys.stderr)
        sys.exit(1)
    if args.resume_managed_session and prompt:
        print("Error: prompt cannot be combined with --resume-managed-session", file=sys.stderr)
        sys.exit(1)
    if autopilot_mode and args.resume_managed_session:
        print("Error: --autopilot does not support --resume-managed-session yet", file=sys.stderr)
        sys.exit(1)
    if not args.resume_managed_session and not prompt:
        print("Error: prompt is required", file=sys.stderr)
        sys.exit(1)
    if args.resume_managed_session:
        if args.human_state_path is None:
            print("Error: --human-state-path is required with --resume-managed-session", file=sys.stderr)
            sys.exit(1)
        if args.human_inbox_path is None:
            print("Error: --human-inbox-path is required with --resume-managed-session", file=sys.stderr)
            sys.exit(1)
        resume_runtime_state = read_runtime_state(args.human_state_path)
        resume_checkpoint = resume_runtime_state.resume_checkpoint
        if resume_checkpoint is None or not resume_checkpoint.is_valid:
            print(
                f"Error: managed session {args.resume_managed_session} has no resumable checkpoint",
                file=sys.stderr,
            )
            sys.exit(1)
        recover_pending_worker_turn = resume_runtime_state.has_recoverable_pending_worker_turn
        recover_pending_queen_turn = resume_runtime_state.has_recoverable_pending_queen_turn
        if recover_pending_queen_turn:
            print(
                f"Error: managed session {args.resume_managed_session} crashed while Queen was mid-turn. "
                "The safest recovery is to start a new managed session from the transcript.",
                file=sys.stderr,
            )
            sys.exit(1)

    logger.info(
        "Queen run: queen=%s, worker=%s, task_id=%s, resume_session=%s, recover_pending_worker_turn=%s, recover_pending_queen_turn=%s, autopilot=%s, qap_phase_pacing=%s",
        queen_family,
        worker_family,
        args.task_id,
        args.resume_managed_session or "",
        recover_pending_worker_turn,
        recover_pending_queen_turn,
        autopilot_mode,
        getattr(args, "qap_phase_pacing", "balanced"),
    )
    transcript_path = args.transcript_path or _default_transcript_path(project_root, args.task_id)
    transcript: list[dict] = []
    try:
        run_guard = (
            nullcontext()
            if multi_ticket_mode
            else _hold_direct_run_task_guard(
                project_root,
                None if args.resume_managed_session else args.task_id,
                transcript_path,
            )
        )
        with run_guard:
            # Load agents
            queen_dir = _QUEEN_DIR / "queen"
            worker_dir = _QUEEN_DIR / ("autopilot_worker" if autopilot_mode else "heisenberg")

            if not autopilot_mode and not queen_dir.exists():
                print(f"Error: queen agent dir not found: {queen_dir}", file=sys.stderr)
                sys.exit(1)
            if not worker_dir.exists():
                label = "autopilot worker" if autopilot_mode else "worker"
                print(f"Error: {label} agent dir not found: {worker_dir}", file=sys.stderr)
                sys.exit(1)
            worker = PersistentAgent(worker_dir, family=worker_family, project_root=project_root)
            queen = None
            if not autopilot_mode:
                queen = PersistentAgent(queen_dir, family=queen_family, project_root=project_root)

            # Optional: connect to message bus for archiving
            bus = None
            if MessageBus is not None and (args.task_id or multi_ticket_mode):
                try:
                    bus = MessageBus()
                except Exception as exc:
                    logger.warning("Could not connect to message bus: %s (continuing without archiving)", exc)

            if autopilot_mode:
                worker.start()
            elif resume_checkpoint is None:
                # Start both sessions concurrently; each CLI startup is expensive.
                _start_agents_in_parallel(queen, worker)
            else:
                queen.attach(resume_checkpoint.queen_session_id, turn_count=resume_checkpoint.queen_turn_count)
                if recover_pending_worker_turn:
                    logger.info(
                        "Recovering from a crashed worker turn; reusing Queen session %s and starting a fresh worker session",
                        resume_checkpoint.queen_session_id,
                    )
                    worker.start()
                else:
                    worker.attach(resume_checkpoint.worker_session_id, turn_count=resume_checkpoint.worker_turn_count)

            if autopilot_mode:
                loop = SingleWorkerAutopilotLoop(
                    worker=worker,
                    task_id=args.task_id,
                    bus=bus,
                    max_turns=args.max_turns,
                    cooldown_seconds=args.cooldown_seconds,
                    phase_pacing=args.qap_phase_pacing,
                    transcript_path=transcript_path,
                    human_state_path=args.human_state_path,
                )
            else:
                loop = ConversationLoop(
                    queen=queen,
                    worker=worker,
                    task_id=args.task_id,
                    bus=bus,
                    max_turns=args.max_turns,
                    cooldown_seconds=args.cooldown_seconds,
                    transcript_path=transcript_path,
                    human_input_path=args.human_inbox_path,
                    human_state_path=args.human_state_path,
                    resume_checkpoint=resume_checkpoint,
                )

            try:
                if multi_ticket_mode:
                    transcript = _run_autopilot_multi_ticket_batch(
                        loop,
                        project_root=project_root,
                        transcript_path=transcript_path,
                        base_prompt=prompt or "",
                        initial_task_id=args.task_id,
                        ticket_queue=getattr(args, "ticket_queue", None),
                        ticket_groups=getattr(args, "ticket_groups", None),
                    )
                elif autopilot_mode or resume_checkpoint is None:
                    transcript = loop.run(prompt)
                else:
                    transcript = loop.resume(reason=resume_runtime_state.reason if resume_runtime_state else "")
            except KeyboardInterrupt:
                logger.info("Interrupted by user")
                transcript = []
            finally:
                loop.stop()
    except DuplicateDirectRunError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)

    # Print final transcript summary
    print(f"\n=== Queen conversation complete: {len(transcript)} messages ===")
    for entry in transcript:
        role = entry["role"]
        agent = entry["agent"]
        text = entry["text"]
        turn = entry["turn"]
        # Show first 120 chars of each message
        preview = text[:120].replace("\n", " ")
        if len(text) > 120:
            preview += "..."
        print(f"  [{turn:2d}] {role:6s} ({agent}): {preview}")


def cmd_status(args: argparse.Namespace) -> None:
    """Show queen agent configuration."""
    default_family = _resolve_default_family(_resolve_project_root())
    print("=== Queen Status ===\n")
    print("Agent directories:")
    for agent_name in ("queen", "heisenberg"):
        agent_dir = _QUEEN_DIR / agent_name
        config_path = agent_dir / "config.json"
        if config_path.exists():
            with open(config_path) as f:
                config = json.load(f)
            print(f"  {agent_name:12s}  user_id={config.get('user_id', '?')}")
        else:
            print(f"  {agent_name:12s}  (no config.json)")

    print("\nAvailable backends: claude, codex")
    print(f"Resolved default family: {default_family}")


def cmd_chat(args: argparse.Namespace) -> None:
    """View Queen transcript files as a chat timeline."""
    project_root = _resolve_project_root()
    transcript_dir = args.transcript_dir or (project_root / ".queen" / "transcripts")

    if args.list_sessions:
        print_managed_session_listing(list_managed_sessions(project_root), project_root)
        return

    if args.session_id and args.transcript:
        print("Error: choose either a transcript path or --session <id>", file=sys.stderr)
        sys.exit(1)

    if args.list_runs_flag:
        print_run_listing(transcript_dir)
        return

    transcript_path: Path | None
    if args.session_id:
        try:
            session = get_managed_session(project_root, args.session_id)
        except ManagedSessionNotFound as exc:
            print(f"Error: {exc}", file=sys.stderr)
            sys.exit(1)
        transcript_path = session.transcript_path
        print(f"Managed session {session.id} — {session.status}")
        if session.status_reason:
            print(f"Reason: {session.status_reason}")
        print(f"Transcript: {transcript_path}\n")
    elif args.transcript:
        try:
            transcript_path = resolve_transcript_path(args.transcript, transcript_dir)
        except (FileNotFoundError, ValueError) as exc:
            print(f"Error: {exc}", file=sys.stderr)
            sys.exit(1)
    else:
        try:
            transcript_path = interactive_picker(transcript_dir)
        except (EOFError, KeyboardInterrupt):
            print("")
            return

    if transcript_path is None:
        return

    display_run(transcript_path, follow=args.follow)


def cmd_reply(args: argparse.Namespace) -> None:
    """Queue one human reply into an existing managed Queen session."""
    project_root = _resolve_project_root()
    message = " ".join(args.message_parts).strip()
    try:
        session = queue_human_reply(project_root, args.session_id, message)
    except ManagedSessionNotFound as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
    except ManagedSessionNotAwaitingHuman as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
    except ManagedSessionHumanReplyQueued as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
    except ManagedSessionError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"Queued human reply for managed session {session.id}.")
    print(f"Status: {session.status}")
    if session.status_reason:
        print(f"Reason: {session.status_reason}")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="queen",
        description="Queen — Persistent Session Agent System",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # run
    p_run = sub.add_parser("run", help="Run a queen conversation loop")
    p_run.add_argument("prompt", nargs="?", help="The task prompt")
    p_run.add_argument("--queen-family",
                       help="CLI backend for queen agent (default: current worker_agent backend)")
    p_run.add_argument("--worker-family",
                       help="CLI backend for worker agent (default: current worker_agent backend)")
    p_run.add_argument("--autopilot", action="store_true",
                       help="Experimental: skip Queen review turns and let one persistent worker continue through structured QAP handoffs until done, awaiting human input, or max-turns")
    p_run.add_argument("--single-worker", dest="autopilot", action="store_true",
                       help=argparse.SUPPRESS)
    p_run.add_argument("--multi-ticket", action="store_true",
                       help="In autopilot mode, keep working through the next matching eligible DB ticket after each completed ticket")
    p_run.add_argument("--ticket-queue",
                       help="Optional DB ticket queue slug filter for --multi-ticket selection")
    p_run.add_argument("--ticket-groups",
                       help="Optional comma-separated DB ticket group filter for --multi-ticket selection")
    p_run.add_argument("--task-id", type=int, help="Task ID for bee_messages archiving")
    p_run.add_argument("--max-turns", type=int, default=20,
                       help="Maximum total turns before forcing the loop to stop")
    p_run.add_argument("--qap-phase-pacing",
                       choices=["strict_test", "balanced", "compact"],
                       default="balanced",
                       help="QAP phase pacing profile for autopilot mode (default: balanced)")
    p_run.add_argument("--cooldown-seconds", type=float, default=2.0,
                       help="Pause between turns to avoid hammering APIs")
    p_run.add_argument("--transcript-path", type=Path,
                       help="Optional JSONL transcript path; defaults to .queen/transcripts/")
    p_run.add_argument("--human-inbox-path", type=Path,
                       help="Optional JSONL inbox for browser-authored follow-up messages")
    p_run.add_argument("--human-state-path", type=Path,
                       help="Optional JSON status file for awaiting_human/resume state")
    p_run.add_argument("--resume-managed-session",
                       help="Internal helper: reattach a managed session after a restart using the saved checkpoint")
    p_run.set_defaults(func=cmd_run)

    # status
    p_status = sub.add_parser("status", help="Show queen configuration")
    p_status.set_defaults(func=cmd_status)

    # chat
    p_chat = sub.add_parser("chat", help="View Queen run transcripts as a chat timeline")
    p_chat.add_argument("transcript", nargs="?", help="Transcript filename or explicit path")
    p_chat.add_argument("--session", dest="session_id",
                        help="Attach to a managed session by id and view its transcript")
    p_chat.add_argument("--sessions", dest="list_sessions", action="store_true",
                        help="List managed Queen sessions from .queen/session_registry")
    p_chat.add_argument("--follow", "-f", action="store_true", help="Live-tail an active run")
    p_chat.add_argument("--list", "-l", dest="list_runs_flag", action="store_true",
                        help="List recent runs")
    p_chat.add_argument("--transcript-dir", type=Path,
                        help="Optional transcript directory override (default: .queen/transcripts/)")
    p_chat.set_defaults(func=cmd_chat)

    p_reply = sub.add_parser("reply", help="Queue one human reply into a managed Queen session")
    p_reply.add_argument("session_id", help="Managed session id")
    p_reply.add_argument("message_parts", nargs="+", help="Human reply message to queue")
    p_reply.set_defaults(func=cmd_reply)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
