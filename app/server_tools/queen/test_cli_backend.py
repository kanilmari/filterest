# test_cli_backend.py
# Unit tests for Queen CLI backend timeout configuration.
# Bridges timeout policy expectations with CodexBackend construction behavior.
# Exists to stop Codex timeout regressions from silently shrinking again.

import os
import sys
import tempfile
import unittest
from unittest.mock import patch

from .cli_backend import (
    ClaudeBackend,
    CodexBackend,
    _ProcessOutcome,
    _run_process_with_timeouts,
)


_QUEEN_PACKAGE = __package__ or "server_tools.queen"


class _TempFileStub:
    def __init__(self, path: str) -> None:
        self.name = path

    def __enter__(self) -> "_TempFileStub":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class CodexBackendTimeoutTests(unittest.TestCase):
    def test_codex_backend_uses_longer_default_timeout_window(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            backend = CodexBackend()

        self.assertEqual(backend.timeout, 2400)
        self.assertEqual(backend.hard_timeout, 2550)
        self.assertEqual(backend.wrap_up_timeout, 120)

    def test_codex_backend_reads_env_overrides(self) -> None:
        with patch.dict(
            os.environ,
            {
                "QUEEN_CODEX_SOFT_TIMEOUT": "900",
                "QUEEN_CODEX_HARD_TIMEOUT": "840",
                "QUEEN_CODEX_WRAP_UP_TIMEOUT": "75",
            },
            clear=True,
        ):
            backend = CodexBackend()

        self.assertEqual(backend.timeout, 900)
        self.assertEqual(backend.hard_timeout, 900)
        self.assertEqual(backend.wrap_up_timeout, 75)

    def test_soft_timeout_without_last_message_requests_wrap_up_resume(self) -> None:
        backend = CodexBackend()
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        temp_paths = iter(
            [
                os.path.join(tmpdir.name, "first.txt"),
                os.path.join(tmpdir.name, "wrap.txt"),
            ]
        )
        issued_commands: list[list[str]] = []

        def fake_named_tempfile(*args, **kwargs):  # type: ignore[no-untyped-def]
            return _TempFileStub(next(temp_paths))

        def fake_run(
            cmd: list[str],
            *,
            soft_timeout: int | float,
            hard_timeout: int | float,
            progress_probe=None,
        ) -> _ProcessOutcome:
            issued_commands.append(cmd)
            self.assertIsNotNone(progress_probe)
            output_path = cmd[cmd.index("-o") + 1]
            if "resume" in cmd:
                self.assertIn("11111111-2222-3333-4444-555555555555", cmd)
                self.assertEqual(soft_timeout, backend.wrap_up_timeout)
                self.assertEqual(hard_timeout, backend.wrap_up_timeout + 30)
                with open(output_path, "w", encoding="utf-8") as fh:
                    fh.write("Wrap-up reply for Queen")
                return _ProcessOutcome(
                    stdout="",
                    stderr="wrap-up complete",
                    returncode=0,
                    soft_timed_out=False,
                )

            with open(output_path, "w", encoding="utf-8") as fh:
                fh.write("")
            return _ProcessOutcome(
                stdout="",
                stderr="session id: 11111111-2222-3333-4444-555555555555",
                returncode=130,
                soft_timed_out=True,
            )

        with patch(f"{_QUEEN_PACKAGE}.cli_backend.tempfile.NamedTemporaryFile", side_effect=fake_named_tempfile):
            with patch.object(backend, "_run", side_effect=fake_run):
                raw_output, last_message = backend._run_capture_last_message(
                    backend._build_exec_cmd("Investigate the timeout", resume=False)
                )

        self.assertEqual(last_message, "Wrap-up reply for Queen")
        self.assertEqual(raw_output, "wrap-up complete")
        self.assertEqual(len(issued_commands), 2)

    def test_soft_timeout_accepts_existing_last_message_without_wrap_up_resume(self) -> None:
        backend = CodexBackend()
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        output_path = os.path.join(tmpdir.name, "first.txt")

        def fake_named_tempfile(*args, **kwargs):  # type: ignore[no-untyped-def]
            return _TempFileStub(output_path)

        def fake_run(
            cmd: list[str],
            *,
            soft_timeout: int | float,
            hard_timeout: int | float,
            progress_probe=None,
        ) -> _ProcessOutcome:
            self.assertIsNotNone(progress_probe)
            with open(output_path, "w", encoding="utf-8") as fh:
                fh.write("Partial but usable handoff")
            return _ProcessOutcome(
                stdout="",
                stderr="session id: 11111111-2222-3333-4444-555555555555",
                returncode=130,
                soft_timed_out=True,
            )

        with patch(f"{_QUEEN_PACKAGE}.cli_backend.tempfile.NamedTemporaryFile", side_effect=fake_named_tempfile):
            with patch.object(backend, "_run", side_effect=fake_run):
                with patch.object(
                    backend,
                    "_run_wrap_up_resume",
                    side_effect=AssertionError("wrap-up resume should not run when a last message already exists"),
                ):
                    raw_output, last_message = backend._run_capture_last_message(
                        backend._build_exec_cmd("Investigate the timeout", resume=False)
                    )

        self.assertEqual(last_message, "Partial but usable handoff")
        self.assertEqual(raw_output, "session id: 11111111-2222-3333-4444-555555555555")


class ClaudeBackendRunnerTests(unittest.TestCase):
    def test_run_raw_returns_stdout_on_success(self) -> None:
        backend = ClaudeBackend(project_root="/tmp/project", soft_timeout=12, hard_timeout=20)

        with patch(f"{_QUEEN_PACKAGE}.cli_backend._run_process_with_timeouts") as run_helper:
            run_helper.return_value = _ProcessOutcome(
                stdout='{"result":"ok"}',
                stderr="",
                returncode=0,
                soft_timed_out=False,
            )

            raw = backend._run_raw(["claude", "-p", "hello"])

        self.assertEqual(raw, '{"result":"ok"}')
        run_helper.assert_called_once_with(
            ["claude", "-p", "hello"],
            cwd="/tmp/project",
            soft_timeout=12,
            hard_timeout=20,
            soft_timeout_log="Claude request hit soft timeout after 12s",
            recovered_context="Claude request recovered after soft timeout",
            timed_out_context="Claude request timed out",
            timeout_error_message="Claude request timed out after 20s",
        )

    def test_run_raw_raises_when_runner_returns_nonzero_exit(self) -> None:
        backend = ClaudeBackend()

        with patch(f"{_QUEEN_PACKAGE}.cli_backend._run_process_with_timeouts") as run_helper:
            run_helper.return_value = _ProcessOutcome(
                stdout="",
                stderr="fatal backend issue",
                returncode=7,
                soft_timed_out=False,
            )

            with self.assertRaisesRegex(RuntimeError, "Claude CLI exit 7: fatal backend issue"):
                backend._run_raw(["claude", "-p", "hello"])


class ProcessRunnerProgressTests(unittest.TestCase):
    def test_progress_probe_resets_soft_timeout(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            progress_path = os.path.join(temp_dir, "progress.txt")
            code = (
                "import pathlib, sys, time\n"
                "path = pathlib.Path(sys.argv[1])\n"
                "for step in range(3):\n"
                "    time.sleep(0.05)\n"
                "    path.write_text(str(step), encoding='utf-8')\n"
                "print('done')\n"
            )
            last_signature = None

            def progress_probe() -> bool:
                nonlocal last_signature
                try:
                    stat = os.stat(progress_path)
                    signature = (stat.st_size, stat.st_mtime_ns)
                except OSError:
                    signature = None
                if signature != last_signature:
                    last_signature = signature
                    return signature is not None
                return False

            with patch(f"{_QUEEN_PACKAGE}.cli_backend.PROCESS_PROGRESS_POLL_SECONDS", 0.01):
                outcome = _run_process_with_timeouts(
                    [sys.executable, "-c", code, progress_path],
                    cwd=temp_dir,
                    soft_timeout=0.08,
                    hard_timeout=0.20,
                    soft_timeout_log="soft timeout",
                    recovered_context="recovered",
                    timed_out_context="timed out",
                    timeout_error_message="timeout",
                    progress_probe=progress_probe,
                )

            self.assertFalse(outcome.soft_timed_out)
            self.assertEqual(outcome.returncode, 0)
            self.assertIn("done", outcome.stdout)

    def test_process_runner_soft_times_out_when_probe_stays_idle(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            code = "import time\nfor _ in range(10):\n    time.sleep(0.05)\n"

            with patch(f"{_QUEEN_PACKAGE}.cli_backend.PROCESS_PROGRESS_POLL_SECONDS", 0.01):
                outcome = _run_process_with_timeouts(
                    [sys.executable, "-c", code],
                    cwd=temp_dir,
                    soft_timeout=0.05,
                    hard_timeout=0.15,
                    soft_timeout_log="soft timeout",
                    recovered_context="recovered",
                    timed_out_context="timed out",
                    timeout_error_message="timeout",
                    progress_probe=lambda: False,
                )

            self.assertTrue(outcome.soft_timed_out)
            self.assertNotEqual(outcome.returncode, 0)


if __name__ == "__main__":
    unittest.main()
