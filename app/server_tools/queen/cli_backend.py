# cli_backend.py
# Abstract CLI backend interface for Queen persistent agent sessions.
# Bridges agent logic with specific CLI tools (Claude Code, Codex).
# Exists to allow swapping the underlying LLM CLI without changing agent code.

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import signal
import subprocess
import tempfile
import threading
import time
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("queen.cli_backend")
PROCESS_PROGRESS_POLL_SECONDS = 5.0

# Registry of backend implementations keyed by family name.
_BACKENDS: dict[str, type[CLIBackend]] = {}


@dataclass
class _ProcessOutcome:
    stdout: str
    stderr: str
    returncode: int
    soft_timed_out: bool = False


def _log_output_tails(stdout: str | None, stderr: str | None, *, context: str, level: int) -> None:
    stdout_tail = ((stdout or "").strip() or "(empty)")[-300:]
    stderr_tail = ((stderr or "").strip() or "(empty)")[-300:]
    logger.log(level, "%s; stdout tail: %s", context, stdout_tail)
    logger.log(level, "%s; stderr tail: %s", context, stderr_tail)


def _parse_git_status_path(raw_line: str) -> str:
    """Extract one repo-relative path from a porcelain status line."""
    payload = raw_line[3:].strip()
    if " -> " in payload:
        return payload.rsplit(" -> ", 1)[-1].strip()
    return payload


class _CodexProgressProbe:
    """Detect meaningful Codex turn progress from output-file or worktree changes."""

    def __init__(self, project_root: str | None, output_path: str) -> None:
        self.project_root = Path(project_root) if project_root else None
        self.output_path = Path(output_path)
        self._last_output_signature = self._read_output_signature()
        self._last_worktree_signature = self._read_worktree_signature()

    def __call__(self) -> bool:
        progressed = False

        output_signature = self._read_output_signature()
        if output_signature != self._last_output_signature:
            self._last_output_signature = output_signature
            progressed = True

        worktree_signature = self._read_worktree_signature()
        if worktree_signature != self._last_worktree_signature:
            self._last_worktree_signature = worktree_signature
            progressed = True

        return progressed

    def _read_output_signature(self) -> tuple[int, int]:
        try:
            stat = self.output_path.stat()
        except OSError:
            return (0, 0)
        return (int(stat.st_size), int(stat.st_mtime_ns))

    def _read_worktree_signature(self) -> tuple[str, int]:
        if self.project_root is None:
            return ("", 0)

        try:
            result = subprocess.run(
                ["git", "status", "--porcelain=v1", "-uall"],
                cwd=str(self.project_root),
                capture_output=True,
                text=True,
                check=False,
                timeout=10,
            )
        except (OSError, subprocess.TimeoutExpired):
            return ("", 0)

        if result.returncode != 0:
            return ("", 0)

        raw_status = result.stdout or ""
        status_hash = hashlib.sha1(raw_status.encode("utf-8")).hexdigest() if raw_status else ""
        latest_mtime_ns = 0
        for raw_line in raw_status.splitlines():
            if len(raw_line) < 4:
                continue
            relative_path = _parse_git_status_path(raw_line)
            if not relative_path:
                continue
            path = self.project_root / relative_path
            try:
                stat = path.stat()
            except OSError:
                continue
            latest_mtime_ns = max(latest_mtime_ns, int(stat.st_mtime_ns))

        return (status_hash, latest_mtime_ns)


def _run_process_with_timeouts(
    cmd: list[str],
    *,
    cwd: str | None,
    soft_timeout: int | float,
    hard_timeout: int | float,
    soft_timeout_log: str,
    recovered_context: str,
    timed_out_context: str,
    timeout_error_message: str,
    progress_probe: Callable[[], bool] | None = None,
) -> _ProcessOutcome:
    """Run one CLI command with a soft timeout and optional progress-aware idle reset."""
    logger.debug("Running: %s", " ".join(cmd[:6]) + "...")
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
        text=True,
        start_new_session=True,
    )
    outcome_holder: dict[str, str] = {}
    error_holder: dict[str, BaseException] = {}
    completed = threading.Event()
    soft_timed_out = False
    last_progress_at = time.monotonic()
    poll_seconds = max(0.05, min(float(soft_timeout), PROCESS_PROGRESS_POLL_SECONDS))

    def _communicate() -> None:
        try:
            stdout, stderr = proc.communicate()
            outcome_holder["stdout"] = stdout or ""
            outcome_holder["stderr"] = stderr or ""
        except BaseException as exc:  # pragma: no cover - defensive subprocess wrapper
            error_holder["error"] = exc
        finally:
            completed.set()

    worker = threading.Thread(target=_communicate, name="queen-cli-timeout-runner", daemon=True)
    worker.start()

    while not completed.wait(timeout=poll_seconds):
        now = time.monotonic()
        if progress_probe is not None:
            try:
                if progress_probe():
                    last_progress_at = now
            except Exception as exc:
                logger.warning("Ignoring progress probe failure during CLI timeout wait: %s", exc)

        if now - last_progress_at < float(soft_timeout):
            continue

        soft_timed_out = True
        logger.warning("%s", soft_timeout_log)
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGINT)
        except OSError:
            pass

        remaining = max(1.0, float(hard_timeout) - float(soft_timeout))
        if completed.wait(timeout=remaining):
            _log_output_tails(
                outcome_holder.get("stdout", ""),
                outcome_holder.get("stderr", ""),
                context=recovered_context,
                level=logging.INFO,
            )
        else:
            logger.error("%s", timeout_error_message)
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except OSError:
                proc.kill()
            completed.wait(timeout=1)
            _log_output_tails(
                outcome_holder.get("stdout", ""),
                outcome_holder.get("stderr", ""),
                context=timed_out_context,
                level=logging.WARNING,
            )
            raise RuntimeError(timeout_error_message) from None
        break

    worker.join(timeout=0)
    if "error" in error_holder:
        raise RuntimeError(f"CLI process runner failed: {error_holder['error']}") from error_holder["error"]

    return _ProcessOutcome(
        stdout=outcome_holder.get("stdout", ""),
        stderr=outcome_holder.get("stderr", ""),
        returncode=proc.returncode or 0,
        soft_timed_out=soft_timed_out,
    )


def _read_positive_int_env(name: str) -> int | None:
    """Return a positive integer env override, or None when unset/invalid."""
    raw_value = os.environ.get(name, "").strip()
    if not raw_value:
        return None
    try:
        parsed_value = int(raw_value)
    except ValueError:
        logger.warning("Ignoring invalid %s=%r; expected integer seconds", name, raw_value)
        return None
    if parsed_value <= 0:
        logger.warning("Ignoring non-positive %s=%r; expected integer seconds > 0", name, raw_value)
        return None
    return parsed_value


def get_backend(family: str, **kwargs) -> CLIBackend:
    """Instantiate a CLI backend by family name."""
    cls = _BACKENDS.get(family)
    if cls is None:
        available = ", ".join(sorted(_BACKENDS)) or "(none)"
        raise ValueError(f"Unknown backend family {family!r}. Available: {available}")
    return cls(**kwargs)


class CLIBackend(ABC):
    """
    Abstract interface for a persistent CLI session.

    Lifecycle:
      1. __init__  — configure (no process started yet)
      2. start()   — open the session, send the system/role prompt
      3. send()    — send a user message, get the assistant's text reply
      4. stop()    — tear down the session
    """

    family: str = ""  # Overridden by subclasses

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if cls.family:
            _BACKENDS[cls.family] = cls

    @abstractmethod
    def start(self, role_prompt: str, session_name: str) -> None:
        """Open a new persistent session and prime it with the role prompt."""

    @abstractmethod
    def send(self, message: str) -> str:
        """Send a user-turn message and return the assistant's text reply."""

    @abstractmethod
    def attach(self, session_id: str) -> None:
        """Reattach this backend wrapper to an existing persistent CLI session."""

    @abstractmethod
    def stop(self) -> None:
        """Tear down the session."""

    @property
    @abstractmethod
    def is_alive(self) -> bool:
        """Whether the session is active and accepting messages."""

    @property
    @abstractmethod
    def session_id(self) -> str | None:
        """Return the underlying CLI session id when one is available."""


class ClaudeBackend(CLIBackend):
    """
    Claude Code CLI backend.

    Uses `claude -p` with `--resume` to maintain a persistent session.
    Each send() continues the same named session, preserving full context
    (tool calls, outputs, reasoning) inside Claude Code's own state.
    """

    family = "claude"

    # Two-phase timeout: soft warning then hard kill.
    DEFAULT_SOFT_TIMEOUT = 600   # seconds — send "wrap up" warning
    DEFAULT_HARD_TIMEOUT = 750   # seconds — kill process
    DEFAULT_STARTUP_SOFT_TIMEOUT = 30
    DEFAULT_STARTUP_HARD_TIMEOUT = 45
    DEFAULT_START_RETRIES = 1
    DEFAULT_SEND_RETRIES = 2
    DEFAULT_SEND_BACKOFF_SECONDS = 2.0

    def __init__(self, project_root: str | Path | None = None,
                 soft_timeout: int | None = None, hard_timeout: int | None = None,
                 allowed_tools: str = "Bash,Read,Write,Edit,Grep,Glob"):
        self.project_root = str(project_root) if project_root else None
        self.soft_timeout = soft_timeout or self.DEFAULT_SOFT_TIMEOUT
        self.hard_timeout = hard_timeout or self.DEFAULT_HARD_TIMEOUT
        self.allowed_tools = allowed_tools
        self.startup_soft_timeout = min(self.soft_timeout, self.DEFAULT_STARTUP_SOFT_TIMEOUT)
        self.startup_hard_timeout = min(self.hard_timeout, self.DEFAULT_STARTUP_HARD_TIMEOUT)
        self.start_retries = self.DEFAULT_START_RETRIES
        self.send_retries = self.DEFAULT_SEND_RETRIES
        self.send_backoff_seconds = self.DEFAULT_SEND_BACKOFF_SECONDS
        self._session_name: str | None = None
        self._session_id: str | None = None  # UUID captured from first call
        self._started = False

    def start(self, role_prompt: str, session_name: str) -> None:
        self._session_name = session_name
        # First message uses JSON output to capture the session UUID.
        cmd = self._build_cmd(role_prompt, first=True)
        last_error: Exception | None = None

        for attempt in range(1, self.start_retries + 2):
            try:
                raw = self._run_raw(
                    cmd,
                    soft_timeout=self.startup_soft_timeout,
                    hard_timeout=self.startup_hard_timeout,
                    phase_label=f"startup attempt {attempt}",
                )
                self._session_id = self._extract_session_id(raw)
                self._started = True
                logger.info(
                    "Claude session started: %s (session_id=%s)",
                    session_name, self._session_id,
                )
                return
            except Exception as exc:
                last_error = exc
                if attempt > self.start_retries:
                    break
                logger.warning(
                    "Claude session start failed for %s on attempt %d/%d: %s",
                    session_name,
                    attempt,
                    self.start_retries + 1,
                    exc,
                )

        assert last_error is not None
        raise RuntimeError(
            f"Claude session start failed for {session_name} after {self.start_retries + 1} attempts"
        ) from last_error

    def send(self, message: str) -> str:
        if not self._started:
            raise RuntimeError("Session not started — call start() first")
        cmd = self._build_cmd(message, first=False)
        last_error: Exception | None = None

        for attempt in range(1, self.send_retries + 2):
            try:
                raw = self._run_raw(cmd)
                return self._extract_result_text(raw)
            except Exception as exc:
                last_error = exc
                if attempt > self.send_retries:
                    break

                sleep_seconds = self.send_backoff_seconds * (2 ** (attempt - 1))
                logger.warning(
                    "Claude send failed for %s on attempt %d/%d: %s; retrying in %.1fs",
                    self._session_name,
                    attempt,
                    self.send_retries + 1,
                    exc,
                    sleep_seconds,
                )
                time.sleep(sleep_seconds)

        assert last_error is not None
        raise RuntimeError(
            f"Claude send failed for {self._session_name} after {self.send_retries + 1} attempts"
        ) from last_error

    def attach(self, session_id: str) -> None:
        trimmed_session_id = session_id.strip()
        if trimmed_session_id == "":
            raise RuntimeError("Claude session_id is required for attach()")
        self._session_id = trimmed_session_id
        self._session_name = f"resume-{trimmed_session_id[:8]}"
        self._started = True
        logger.info("Claude session reattached: %s", self._session_id)

    def stop(self) -> None:
        self._started = False
        logger.info("Claude session stopped: %s (id=%s)", self._session_name, self._session_id)

    @property
    def is_alive(self) -> bool:
        return self._started

    @property
    def session_id(self) -> str | None:
        return self._session_id

    def _build_cmd(self, message: str, first: bool) -> list[str]:
        # Always use JSON output so we can parse structured responses.
        cmd = ["claude", "-p", message, "--output-format", "json"]
        if first:
            cmd.extend(["-n", self._session_name])
        else:
            cmd.extend(["--resume", self._session_id])
        if self.allowed_tools:
            cmd.extend(["--allowedTools", self.allowed_tools])
        return cmd

    def _run_raw(
        self,
        cmd: list[str],
        *,
        soft_timeout: int | None = None,
        hard_timeout: int | None = None,
        phase_label: str = "request",
    ) -> str:
        """Run a CLI command with two-phase timeout: soft warning then hard kill.

        Phase 1 (soft_timeout): Send SIGINT to give the process a chance to
        wrap up gracefully.  If the session has a UUID we also fire a follow-up
        ``claude --resume`` with a "wrap up now" message — the interrupted
        process may still be draining so this is best-effort.

        Phase 2 (hard_timeout): Kill the process group.
        """
        soft_timeout = soft_timeout or self.soft_timeout
        hard_timeout = hard_timeout or self.hard_timeout
        outcome = _run_process_with_timeouts(
            cmd,
            cwd=self.project_root,
            soft_timeout=soft_timeout,
            hard_timeout=hard_timeout,
            soft_timeout_log=f"Claude {phase_label} hit soft timeout after {soft_timeout}s",
            recovered_context=f"Claude {phase_label} recovered after soft timeout",
            timed_out_context=f"Claude {phase_label} timed out",
            timeout_error_message=f"Claude {phase_label} timed out after {hard_timeout}s",
        )

        if outcome.returncode != 0:
            stderr_tail = (outcome.stderr or "")[-500:] or "(empty)"
            logger.error("Claude CLI failed (exit %d): %s", outcome.returncode, stderr_tail)
            raise RuntimeError(f"Claude CLI exit {outcome.returncode}: {stderr_tail}")
        return (outcome.stdout or "").strip()

    def _extract_session_id(self, raw_json: str) -> str:
        """Parse JSON output and extract session_id UUID."""
        try:
            data = json.loads(raw_json)
            sid = data.get("session_id", "")
            if sid:
                return sid
        except (json.JSONDecodeError, AttributeError):
            pass
        raise RuntimeError(f"Could not extract session_id from Claude output: {raw_json[:200]}")

    def _extract_result_text(self, raw_json: str) -> str:
        """Parse JSON output and extract the result text.

        Raises RuntimeError if the extracted text is empty — an empty response
        from the CLI almost always means a timeout recovery produced no output,
        and forwarding it would cause the conversation loop to spin on empties.
        """
        if not raw_json.strip():
            raise RuntimeError("Claude CLI returned empty output")
        try:
            data = json.loads(raw_json)
            result = data.get("result", raw_json)
        except (json.JSONDecodeError, AttributeError):
            result = raw_json
        if not result.strip():
            raise RuntimeError("Claude CLI returned empty result text")
        return result


class CodexBackend(CLIBackend):
    """
    OpenAI Codex CLI backend.

    Uses `codex exec` for the first turn and `codex exec resume <session_id>`
    for continuation. The first turn yields a session id that we track so
    concurrent Queen agents do not collide on a shared `--last` pointer.
    """

    family = "codex"

    DEFAULT_SOFT_TIMEOUT = 2400
    DEFAULT_HARD_TIMEOUT = 2550
    DEFAULT_WRAP_UP_TIMEOUT = 120
    SOFT_TIMEOUT_ENV = "QUEEN_CODEX_SOFT_TIMEOUT"
    HARD_TIMEOUT_ENV = "QUEEN_CODEX_HARD_TIMEOUT"
    WRAP_UP_TIMEOUT_ENV = "QUEEN_CODEX_WRAP_UP_TIMEOUT"
    DEFAULT_FULL_AUTO = True
    DEFAULT_DISABLED_FEATURES = ("multi_agent",)
    WRAP_UP_PROMPT = (
        "The previous Queen worker turn hit the soft timeout. Do not continue coding or "
        "run more tools. Reply with a concise wrap-up for Queen that includes: what you "
        "finished, what you verified, any blockers or remaining work, and the exact files "
        "you touched. Keep it brief and end now."
    )

    def __init__(
        self,
        project_root: str | Path | None = None,
        timeout: int | None = None,
        hard_timeout: int | None = None,
        full_auto: bool | None = None,
        disabled_features: tuple[str, ...] | None = None,
    ):
        self.project_root = str(project_root) if project_root else None
        resolved_timeout = timeout
        if resolved_timeout is None:
            resolved_timeout = _read_positive_int_env(self.SOFT_TIMEOUT_ENV) or self.DEFAULT_SOFT_TIMEOUT

        resolved_hard_timeout = hard_timeout
        if resolved_hard_timeout is None:
            resolved_hard_timeout = (
                _read_positive_int_env(self.HARD_TIMEOUT_ENV) or self.DEFAULT_HARD_TIMEOUT
            )
        resolved_wrap_up_timeout = (
            _read_positive_int_env(self.WRAP_UP_TIMEOUT_ENV) or self.DEFAULT_WRAP_UP_TIMEOUT
        )

        self.timeout = resolved_timeout
        self.hard_timeout = max(self.timeout, resolved_hard_timeout)
        self.wrap_up_timeout = resolved_wrap_up_timeout
        self.full_auto = self.DEFAULT_FULL_AUTO if full_auto is None else full_auto
        self.disabled_features = (
            self.DEFAULT_DISABLED_FEATURES if disabled_features is None else disabled_features
        )
        self._started = False
        self._turn_count = 0
        self._session_id: str | None = None

    def start(self, role_prompt: str, session_name: str) -> None:
        raw, result = self._run_capture_last_message(self._build_exec_cmd(role_prompt))
        self._session_id = self._extract_session_id(raw)
        self._started = True
        self._turn_count = 1
        logger.info(
            "Codex session started (session_id=%s, init response: %d chars)",
            self._session_id,
            len(result),
        )

    def send(self, message: str) -> str:
        if not self._started:
            raise RuntimeError("Session not started — call start() first")
        if not self._session_id:
            raise RuntimeError("Codex session missing session_id after start()")
        _, result = self._run_capture_last_message(self._build_exec_cmd(message, resume=True))
        self._turn_count += 1
        return result

    def attach(self, session_id: str) -> None:
        trimmed_session_id = session_id.strip()
        if trimmed_session_id == "":
            raise RuntimeError("Codex session_id is required for attach()")
        self._session_id = trimmed_session_id
        self._started = True
        self._turn_count = 0
        logger.info("Codex session reattached: %s", self._session_id)

    def stop(self) -> None:
        self._started = False
        logger.info("Codex session stopped after %d turns", self._turn_count)

    @property
    def is_alive(self) -> bool:
        return self._started

    @property
    def session_id(self) -> str | None:
        return self._session_id

    def _extract_session_id(self, raw_output: str) -> str:
        match = re.search(r"session id:\s*([0-9a-fA-F-]+)", raw_output)
        if match:
            return match.group(1)
        raise RuntimeError(f"Could not extract Codex session id from output: {raw_output[:200]}")

    def _build_exec_cmd(
        self,
        message: str,
        *,
        resume: bool = False,
        session_id: str | None = None,
    ) -> list[str]:
        """Build a Codex CLI command that keeps Queen writable across resumed turns."""
        cmd = ["codex", "exec"]
        if resume:
            cmd.append("resume")
        # Queen runs are meant to execute implementation work, not stay trapped in
        # Codex's default read-only mode. `--full-auto` is available on both the
        # initial exec and the resume subcommand, unlike `--sandbox`.
        if self.full_auto:
            cmd.append("--full-auto")
        # Queen already provides its own persistent multi-agent topology. Leaving
        # Codex's internal multi_agent feature enabled causes nested agent/session
        # orchestration, which can interrupt turns and break resume stability.
        for feature in self.disabled_features:
            cmd.extend(["--disable", feature])
        cmd.extend(["-o", "__OUTPUT_FILE__"])
        if resume:
            resolved_session_id = (session_id or self._session_id or "").strip()
            if not resolved_session_id:
                raise RuntimeError("Codex session_id is required for resume commands")
            cmd.extend([resolved_session_id, message])
        else:
            cmd.append(message)
        return cmd

    def _run_capture_last_message(self, cmd: list[str]) -> tuple[str, str]:
        with tempfile.NamedTemporaryFile(prefix="queen_codex_", suffix=".txt", delete=False) as fh:
            output_path = fh.name
        final_cmd = [output_path if token == "__OUTPUT_FILE__" else token for token in cmd]
        try:
            progress_probe = _CodexProgressProbe(self.project_root, output_path)
            outcome = self._run(
                final_cmd,
                soft_timeout=self.timeout,
                hard_timeout=self.hard_timeout,
                progress_probe=progress_probe,
            )
            raw_output = self._combine_output(outcome.stdout, outcome.stderr)
            last_message = Path(output_path).read_text(encoding="utf-8").strip()
            if last_message:
                if outcome.returncode != 0 and not outcome.soft_timed_out:
                    stderr_tail = (outcome.stderr or "")[-500:] or "(empty)"
                    raise RuntimeError(f"Codex CLI exit {outcome.returncode}: {stderr_tail}")
                if outcome.returncode != 0 and outcome.soft_timed_out:
                    logger.warning(
                        "Codex soft-timeout turn exited %d after SIGINT but produced a last message; accepting it",
                        outcome.returncode,
                    )
                return raw_output, last_message

            if outcome.soft_timed_out:
                wrap_up_session_id = self._recover_session_id(raw_output)
                if wrap_up_session_id:
                    logger.warning(
                        "Codex turn ended without a last message after soft timeout; requesting wrap-up resume "
                        "for session %s",
                        wrap_up_session_id,
                    )
                    return self._run_wrap_up_resume(wrap_up_session_id)

            if outcome.returncode != 0:
                stderr_tail = (outcome.stderr or "")[-500:] or "(empty)"
                raise RuntimeError(f"Codex CLI exit {outcome.returncode}: {stderr_tail}")
            raise RuntimeError("Codex CLI did not write a last message to the output file")
        finally:
            Path(output_path).unlink(missing_ok=True)

    def _run_wrap_up_resume(self, session_id: str) -> tuple[str, str]:
        with tempfile.NamedTemporaryFile(prefix="queen_codex_wrapup_", suffix=".txt", delete=False) as fh:
            output_path = fh.name
        final_cmd = [
            output_path if token == "__OUTPUT_FILE__" else token
            for token in self._build_exec_cmd(
                self.WRAP_UP_PROMPT,
                resume=True,
                session_id=session_id,
            )
        ]
        try:
            wrap_up_hard_timeout = max(self.wrap_up_timeout, self.wrap_up_timeout + 30)
            progress_probe = _CodexProgressProbe(self.project_root, output_path)
            outcome = self._run(
                final_cmd,
                soft_timeout=self.wrap_up_timeout,
                hard_timeout=wrap_up_hard_timeout,
                progress_probe=progress_probe,
            )
            raw_output = self._combine_output(outcome.stdout, outcome.stderr)
            last_message = Path(output_path).read_text(encoding="utf-8").strip()
            if not last_message:
                if outcome.returncode != 0:
                    stderr_tail = (outcome.stderr or "")[-500:] or "(empty)"
                    raise RuntimeError(f"Codex wrap-up resume exit {outcome.returncode}: {stderr_tail}")
                raise RuntimeError("Codex wrap-up resume did not write a last message to the output file")
            if outcome.returncode != 0 and not outcome.soft_timed_out:
                stderr_tail = (outcome.stderr or "")[-500:] or "(empty)"
                raise RuntimeError(f"Codex wrap-up resume exit {outcome.returncode}: {stderr_tail}")
            return raw_output, last_message
        finally:
            Path(output_path).unlink(missing_ok=True)

    def _run(
        self,
        cmd: list[str],
        *,
        soft_timeout: int | float,
        hard_timeout: int | float,
        progress_probe: Callable[[], bool] | None = None,
    ) -> _ProcessOutcome:
        return _run_process_with_timeouts(
            cmd,
            cwd=self.project_root,
            soft_timeout=soft_timeout,
            hard_timeout=hard_timeout,
            soft_timeout_log=f"Codex request hit soft timeout after {soft_timeout}s without progress",
            recovered_context="Codex request recovered after soft timeout",
            timed_out_context="Codex request timed out",
            timeout_error_message=f"Codex CLI timed out after {hard_timeout}s",
            progress_probe=progress_probe,
        )

    def _combine_output(self, stdout: str | None, stderr: str | None) -> str:
        # Codex CLI writes the agent's last message to stdout/output-file, but the
        # session banner (including "session id: ...") currently arrives on stderr
        # when the process is piped. Combine both streams so start() can still
        # recover the resumable session id without relying on TTY-specific output.
        return "\n".join(part for part in ((stdout or "").strip(), (stderr or "").strip()) if part).strip()

    def _recover_session_id(self, raw_output: str) -> str | None:
        if self._session_id:
            return self._session_id
        try:
            return self._extract_session_id(raw_output)
        except RuntimeError:
            return None
