# test_chat_viewer.py
# Unit tests for Queen chat viewer CLI hardening.
# Covers graceful failure on missing files and non-interactive stdin.
# Exists to prevent regressions from #809 chat viewer follow-up.

import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from .chat_viewer import (
    display_run,
    format_message,
    interactive_picker,
    list_runs,
    resolve_transcript_path,
)
from .main import cmd_chat
from .session_store import ManagedSessionRecord


_QUEEN_PACKAGE = __package__ or "server_tools.queen"


class ResolveTranscriptPathTests(unittest.TestCase):
    def test_missing_file_raises_file_not_found(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(FileNotFoundError):
                resolve_transcript_path("nonexistent.jsonl", Path(tmp))

    def test_existing_file_resolves(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "test.jsonl"
            f.touch()
            result = resolve_transcript_path("test.jsonl", Path(tmp))
            self.assertEqual(result, f.resolve())


class ListRunsTests(unittest.TestCase):
    def test_list_runs_keeps_suffixed_task_transcripts_visible(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            transcript_dir = Path(tmp)
            filenames = [
                "queen_run_20260330_1748_task_417_auth_session.jsonl",
                "queen_run_20260330_1804_task_417_impl.jsonl",
                "queen_run_20260331_0846x_task_417_supervised.jsonl",
            ]
            for name in filenames:
                (transcript_dir / name).write_text(
                    '{"role":"human","agent":"user","turn":1,"timestamp":"2026-01-01","text":"hi"}\n',
                    encoding="utf-8",
                )

            runs = list_runs(transcript_dir)

            self.assertEqual(len(runs), 3)
            listed_files = {run["filename"] for run in runs}
            self.assertEqual(listed_files, set(filenames))


class DisplayRunTests(unittest.TestCase):
    def test_missing_file_raises_file_not_found(self) -> None:
        with self.assertRaises(FileNotFoundError):
            display_run(Path("/tmp/queen_test_definitely_missing.jsonl"))


class FormatMessageTests(unittest.TestCase):
    def test_human_messages_are_slightly_right_indented(self) -> None:
        rendered = format_message(
            {
                "role": "human",
                "agent": "user",
                "turn": 4,
                "timestamp": "2026-03-31T19:00:00Z",
                "text": "Please prioritize the CLI handoff.",
            },
            max_width=80,
        )

        self.assertIn("\n        Please prioritize the CLI handoff.", rendered)
        self.assertIn("      \x1b[36m\x1b[1m[turn 4] human (user)", rendered)

    def test_iso_timestamps_render_in_finland_winter_time(self) -> None:
        rendered = format_message(
            {
                "role": "human",
                "agent": "user",
                "turn": 4,
                "timestamp": "2026-01-15T09:22:27Z",
                "text": "Winter timestamp check.",
            },
            max_width=80,
        )

        self.assertIn("2026-01-15 11:22:27", rendered)

    def test_iso_timestamps_render_in_finland_summer_time(self) -> None:
        rendered = format_message(
            {
                "role": "human",
                "agent": "user",
                "turn": 4,
                "timestamp": "2026-07-15T09:22:27Z",
                "text": "Summer timestamp check.",
            },
            max_width=80,
        )

        self.assertIn("2026-07-15 12:22:27", rendered)


class InteractivePickerTests(unittest.TestCase):
    def test_eoferror_on_closed_stdin(self) -> None:
        """interactive_picker raises EOFError when stdin has no data."""
        with tempfile.TemporaryDirectory() as tmp:
            transcript_dir = Path(tmp)
            # Create a valid transcript file so the picker has something to show
            f = transcript_dir / "queen_run_20260101_120000_manual.jsonl"
            f.write_text('{"role":"human","agent":"user","turn":1,"timestamp":"2026-01-01","text":"hi"}\n')

            with patch("sys.stdout", new=io.StringIO()):
                with patch("builtins.input", side_effect=EOFError):
                    with self.assertRaises(EOFError):
                        interactive_picker(transcript_dir)

    def test_empty_dir_returns_none(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with patch("sys.stdout", new=io.StringIO()):
                result = interactive_picker(Path(tmp))
            self.assertIsNone(result)


class CmdChatMissingFileTests(unittest.TestCase):
    """cmd_chat should exit with code 1 and a friendly message for missing files."""

    def test_missing_transcript_exits_with_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = _make_chat_args(transcript="nonexistent.jsonl", transcript_dir=Path(tmp))
            stderr = io.StringIO()
            with patch("sys.stderr", stderr):
                with self.assertRaises(SystemExit) as ctx:
                    cmd_chat(args)
            self.assertEqual(ctx.exception.code, 1)
            self.assertIn("not found", stderr.getvalue())

    def test_conflicting_transcript_and_session_exits_with_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = _make_chat_args(
                transcript="existing.jsonl",
                transcript_dir=Path(tmp),
                session_id="qs_demo",
            )
            stderr = io.StringIO()
            with patch("sys.stderr", stderr):
                with self.assertRaises(SystemExit) as ctx:
                    cmd_chat(args)
            self.assertEqual(ctx.exception.code, 1)
            self.assertIn("either a transcript path or --session", stderr.getvalue())


class CmdChatNonInteractiveTests(unittest.TestCase):
    """cmd_chat should handle EOFError gracefully when stdin is closed."""

    def test_eoferror_handled_gracefully(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            transcript_dir = Path(tmp)
            f = transcript_dir / "queen_run_20260101_120000_manual.jsonl"
            f.write_text('{"role":"human","agent":"user","turn":1,"timestamp":"2026-01-01","text":"hi"}\n')

            args = _make_chat_args(transcript=None, transcript_dir=transcript_dir)
            with patch("sys.stdout", new=io.StringIO()):
                with patch("builtins.input", side_effect=EOFError):
                    # Should NOT raise — cmd_chat catches EOFError
                    cmd_chat(args)


class CmdChatManagedSessionTests(unittest.TestCase):
    def test_session_mode_uses_managed_session_transcript(self) -> None:
        session = ManagedSessionRecord(
            id="qs_demo",
            status="awaiting_human",
            prompt="Investigate",
            transcript_path=Path("/tmp/queen_demo.jsonl"),
            human_inbox_path=Path("/tmp/inbox.jsonl"),
            session_state_path=Path("/tmp/state.json"),
            project_root=Path("/tmp"),
            created_at="2026-03-31T19:00:00+00:00",
            updated_at="2026-03-31T19:00:00+00:00",
            status_reason="Need a decision",
        )
        args = _make_chat_args(transcript=None, session_id="qs_demo")
        stdout = io.StringIO()

        with patch(f"{_QUEEN_PACKAGE}.main.get_managed_session", return_value=session), patch(
            f"{_QUEEN_PACKAGE}.main.display_run"
        ) as display_run_mock, patch("sys.stdout", stdout):
            cmd_chat(args)

        display_run_mock.assert_called_once_with(session.transcript_path, follow=False)
        self.assertIn("Managed session qs_demo", stdout.getvalue())

    def test_sessions_listing_uses_managed_session_registry(self) -> None:
        args = _make_chat_args(transcript=None, list_sessions=True)

        with patch(f"{_QUEEN_PACKAGE}.main.list_managed_sessions", return_value=[]), patch(
            f"{_QUEEN_PACKAGE}.main.print_managed_session_listing"
        ) as listing_mock:
            cmd_chat(args)

        listing_mock.assert_called_once()


def _make_chat_args(
    transcript: str | None,
    transcript_dir: Path | None = None,
    *,
    session_id: str | None = None,
    list_sessions: bool = False,
) -> object:
    """Build a minimal namespace mimicking argparse output for cmd_chat."""

    class _NS:
        pass

    ns = _NS()
    ns.transcript = transcript  # type: ignore[attr-defined]
    ns.transcript_dir = transcript_dir  # type: ignore[attr-defined]
    ns.session_id = session_id  # type: ignore[attr-defined]
    ns.list_sessions = list_sessions  # type: ignore[attr-defined]
    ns.list_runs_flag = False  # type: ignore[attr-defined]
    ns.follow = False  # type: ignore[attr-defined]
    return ns  # type: ignore[return-value]


if __name__ == "__main__":
    unittest.main()
