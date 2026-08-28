# chat_viewer.py
# Terminal transcript viewer utilities for Queen JSONL chat logs.
# Bridges .queen/transcripts files with colored terminal rendering and selection.
# Exists so humans can inspect finished or live Queen runs without raw JSONL parsing.

from __future__ import annotations

import json
import logging
import os
import re
import textwrap
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .session_store import ManagedSessionRecord

logger = logging.getLogger("queen.chat")

_RUN_PREFIX_RE = re.compile(r"^queen_run_(?P<date>\d{8})_(?P<time>\d{4,6})")
_TASK_ID_RE = re.compile(r"(?:^|_)task_(?P<task_id>\d+)(?:_|$)")

_ANSI_RESET = "\033[0m"
_ANSI_BOLD = "\033[1m"
_ANSI_CYAN = "\033[36m"
_ANSI_MAGENTA = "\033[35m"
_ANSI_GREEN = "\033[32m"
_ANSI_DIM = "\033[90m"
_HUMAN_INDENT = "      "
_HELSINKI_TZ = ZoneInfo("Europe/Helsinki")


def list_runs(transcript_dir: Path) -> list[dict]:
    """List transcript files with parsed metadata, newest first."""
    runs: list[dict] = []
    if not transcript_dir.exists():
        return runs

    for filepath in transcript_dir.glob("*.jsonl"):
        if not filepath.is_file():
            continue

        parsed_name = _parse_run_filename(filepath)
        if parsed_name is None:
            logger.debug("Skipping transcript with unexpected filename format: %s", filepath.name)
            continue

        timestamp, task_id = parsed_name
        message_count, roles = _scan_transcript_file(filepath)
        runs.append(
            {
                "filename": filepath.name,
                "path": filepath,
                "timestamp": timestamp.strftime("%Y-%m-%d %H:%M:%S"),
                "task_id": task_id,
                "message_count": message_count,
                "roles": roles,
                "sort_key": timestamp,
            }
        )

    runs.sort(key=lambda run: run["sort_key"], reverse=True)
    for run in runs:
        run.pop("sort_key", None)
    return runs


def format_message(entry: dict, max_width: int = 120) -> str:
    """Render one transcript entry as a colored chat block."""
    role = str(entry.get("role", "unknown"))
    agent = str(entry.get("agent", "unknown"))
    turn = entry.get("turn", "?")
    timestamp = _format_display_timestamp(entry.get("timestamp", "unknown"))
    text = str(entry.get("text", ""))

    style = _role_style(role, agent)
    width = _resolve_display_width(max_width=max_width)
    message_indent = _message_indent(role)
    header = f"[turn {turn}] {role} ({agent}) — {timestamp}"
    wrapped_body = _wrap_message_text(text, width=width, indent=f"{message_indent}  ")
    divider_width = max(20, min(width - len(message_indent), 72))
    divider = f"{message_indent}{_ANSI_DIM}{'-' * divider_width}{_ANSI_RESET}"

    return f"{message_indent}{style}{header}{_ANSI_RESET}\n{wrapped_body}\n\n{divider}\n"


def _format_display_timestamp(raw_timestamp: object) -> str:
    """Normalize transcript timestamps for human display in Finland local time."""
    raw = str(raw_timestamp or "").strip()
    if raw == "":
        return "unknown"

    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return raw

    if parsed.tzinfo is None:
        return raw

    return parsed.astimezone(_HELSINKI_TZ).strftime("%Y-%m-%d %H:%M:%S")


def display_run(filepath: Path, follow: bool = False) -> None:
    """Print a transcript file, optionally tailing it as it grows."""
    if not filepath.exists():
        raise FileNotFoundError(f"Transcript not found: {filepath}")
    if not filepath.is_file():
        raise ValueError(f"Transcript is not a file: {filepath}")

    printed_messages = 0
    read_offset = 0
    pending_fragment = ""
    warned_about_partial = False
    announced_waiting = False

    try:
        while True:
            if filepath.exists():
                if filepath.stat().st_size < read_offset:
                    logger.warning("Transcript %s was truncated; restarting from the beginning", filepath.name)
                    read_offset = 0
                    pending_fragment = ""
                    warned_about_partial = False
            else:
                logger.warning("Transcript %s is not available yet", filepath.name)

            chunk = ""
            if filepath.exists():
                with filepath.open("r", encoding="utf-8") as handle:
                    handle.seek(read_offset)
                    chunk = handle.read()
                    read_offset = handle.tell()

            if chunk:
                pending_fragment += chunk
                warned_about_partial = False
                announced_waiting = False

                while True:
                    newline_index = pending_fragment.find("\n")
                    if newline_index < 0:
                        break

                    raw_line = pending_fragment[:newline_index]
                    pending_fragment = pending_fragment[newline_index + 1:]

                    entry = _parse_transcript_line(raw_line, filepath=filepath)
                    if entry is None:
                        continue

                    print(format_message(entry), end="")
                    printed_messages += 1

            if pending_fragment and not warned_about_partial:
                logger.warning(
                    "Transcript %s has an incomplete last line; waiting for the write to finish",
                    filepath.name,
                )
                warned_about_partial = True

            if not follow:
                if printed_messages == 0:
                    if pending_fragment.strip():
                        print(f"No complete messages available yet in {filepath.name}.")
                    else:
                        print(f"No messages found in {filepath.name}.")
                return

            if printed_messages == 0 and not pending_fragment.strip() and not announced_waiting:
                print(f"Following {filepath.name}. Waiting for messages...")
                announced_waiting = True

            time.sleep(2)
    except KeyboardInterrupt:
        if follow:
            print(f"\nStopped following {filepath.name}.")


def interactive_picker(transcript_dir: Path) -> Path | None:
    """Show recent runs and let the user choose one interactively."""
    runs = list_runs(transcript_dir)
    if not runs:
        print(f"No transcripts found in {transcript_dir}.")
        return None

    limited_runs = runs[:20]
    _print_run_list(limited_runs, transcript_dir=transcript_dir)
    print("\nSelect a transcript by number, or press Enter to cancel.")

    while True:
        selection = input("> ").strip()
        if selection == "":
            return None
        if selection.lower() in {"q", "quit", "exit"}:
            return None
        if not selection.isdigit():
            print("Enter a number from the list, or press Enter to cancel.")
            continue

        index = int(selection)
        if 1 <= index <= len(limited_runs):
            return limited_runs[index - 1]["path"]

        print(f"Enter a number between 1 and {len(limited_runs)}.")


def _parse_run_filename(filepath: Path) -> tuple[datetime, str] | None:
    """Extract a sortable timestamp and task label from a Queen transcript filename."""
    filename = filepath.name
    if not filename.startswith("queen_run_") or not filename.endswith(".jsonl"):
        return None

    timestamp = _timestamp_from_filename(filename)
    if timestamp is None:
        timestamp = datetime.fromtimestamp(filepath.stat().st_mtime)

    task_id_match = _TASK_ID_RE.search(filename[:-6])
    task_id = task_id_match.group("task_id") if task_id_match else "manual"
    return timestamp, task_id


def _timestamp_from_filename(filename: str) -> datetime | None:
    """Parse timestamp prefixes from canonical and suffixed Queen transcript filenames."""
    match = _RUN_PREFIX_RE.match(filename)
    if match is None:
        return None

    stamp = f"{match.group('date')}_{match.group('time')}"
    time_digits = match.group("time")
    try:
        if len(time_digits) == 4:
            return datetime.strptime(stamp, "%Y%m%d_%H%M")
        if len(time_digits) == 6:
            return datetime.strptime(stamp, "%Y%m%d_%H%M%S")
    except ValueError:
        return None
    return None


def _scan_transcript_file(filepath: Path) -> tuple[int, list[str]]:
    """Count valid messages and discover roles in one transcript file."""
    message_count = 0
    roles: set[str] = set()

    with filepath.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            entry = _parse_transcript_line(raw_line, filepath=filepath, warn_on_partial=False)
            if entry is None:
                continue
            message_count += 1
            role = str(entry.get("role", "")).strip()
            if role:
                roles.add(role)

    return message_count, sorted(roles)


def _parse_transcript_line(raw_line: str, filepath: Path, warn_on_partial: bool = True) -> dict | None:
    """Parse one JSONL line, skipping blank or incomplete content safely."""
    if not raw_line.strip():
        return None

    try:
        entry = json.loads(raw_line)
    except json.JSONDecodeError as exc:
        if warn_on_partial and raw_line.strip():
            logger.warning("Skipping malformed transcript line in %s: %s", filepath.name, exc)
        return None

    if not isinstance(entry, dict):
        logger.warning("Skipping non-object transcript entry in %s", filepath.name)
        return None

    return entry


def _print_run_list(runs: list[dict], transcript_dir: Path) -> None:
    """Print a transcript listing in a compact human-readable format."""
    print(f"Transcript directory: {transcript_dir}")
    if not runs:
        print("No transcripts found.")
        return

    for index, run in enumerate(runs, start=1):
        task_label = f"task {run['task_id']}" if run["task_id"] != "manual" else "manual"
        roles = ", ".join(run["roles"]) if run["roles"] else "none"
        print(
            f"{index:2d}. {run['timestamp']}  {task_label:8s}  "
            f"{run['message_count']:3d} messages  roles: {roles}  {run['filename']}"
        )


def print_managed_session_listing(sessions: list[ManagedSessionRecord], project_root: Path) -> None:
    """Print the available managed sessions from the shared file registry."""
    registry_dir = project_root / ".queen" / "session_registry"
    print(f"Managed-session registry: {registry_dir}")
    if not sessions:
        print("No managed sessions found.")
        return

    for session in sessions:
        task_label = f"task {session.task_id}" if session.task_id is not None else "manual"
        transcript_name = session.transcript_path.name or str(session.transcript_path)
        print(
            f"{session.id:10s}  {session.status:15s}  {task_label:10s}  "
            f"{transcript_name}"
        )
        if session.status_reason:
            print(f"             reason: {session.status_reason}")


def _resolve_display_width(max_width: int) -> int:
    """Clamp output width to terminal size while keeping wrapped output readable."""
    try:
        terminal_width = os.get_terminal_size().columns
    except OSError:
        terminal_width = max_width

    return max(40, min(max_width, terminal_width - 2))


def _role_style(role: str, agent: str) -> str:
    """Choose ANSI style based on transcript role and agent identity."""
    normalized_role = role.lower()
    normalized_agent = agent.lower()

    if normalized_role == "human":
        return f"{_ANSI_CYAN}{_ANSI_BOLD}"
    if normalized_role == "queen":
        return f"{_ANSI_MAGENTA}{_ANSI_BOLD}"
    if normalized_role == "worker" or normalized_agent == "heisenberg":
        return f"{_ANSI_GREEN}{_ANSI_BOLD}"
    return _ANSI_BOLD


def _message_indent(role: str) -> str:
    """Right-shift human messages slightly to improve transcript scanning."""
    return _HUMAN_INDENT if role.lower() == "human" else ""


def _wrap_message_text(text: str, width: int, indent: str = "  ") -> str:
    """Wrap transcript body text while preserving paragraph breaks."""
    body_width = max(20, width - len(indent))
    wrapped_paragraphs: list[str] = []

    for paragraph in text.splitlines():
        if not paragraph.strip():
            wrapped_paragraphs.append("")
            continue
        wrapped_paragraphs.append(
            textwrap.fill(
                paragraph,
                width=body_width,
                initial_indent=indent,
                subsequent_indent=indent,
                replace_whitespace=False,
                drop_whitespace=False,
            )
        )

    if not wrapped_paragraphs:
        return indent
    return "\n".join(wrapped_paragraphs)


def resolve_transcript_path(transcript: str, transcript_dir: Path) -> Path:
    """Resolve a transcript argument as either a direct path or a file inside transcript_dir."""
    direct_path = Path(transcript).expanduser()
    if direct_path.exists():
        return direct_path.resolve()

    candidate = transcript_dir / transcript
    if candidate.exists():
        return candidate.resolve()

    raise FileNotFoundError(f"Transcript not found: {transcript}")


def print_run_listing(transcript_dir: Path) -> None:
    """Print the available transcript files in transcript_dir."""
    _print_run_list(list_runs(transcript_dir), transcript_dir=transcript_dir)
