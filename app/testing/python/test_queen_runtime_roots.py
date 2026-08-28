"""Verify standalone Queen writes only below installation-owned mutable data.

Bridges the public Queen launcher, runtime-state resolver, direct-run locking,
and imported db_task dump implementation. Exists to keep immutable app/ clean.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

from filterest.app.server_tools.queen import main as queen_main
from filterest.app.server_tools.queen.runtime_paths import resolve_queen_state_root
from filterest.app.server_tools.queen.session_store import managed_session_registry_dir


APP_ROOT = Path(__file__).resolve().parents[2]


def test_explicit_queen_state_root_owns_transcripts_locks_and_sessions(
    tmp_path: Path,
    monkeypatch,
) -> None:
    installation_root = tmp_path / "filterest"
    state_root = installation_root / "data/runtime/queen"
    monkeypatch.setenv("FILTEREST_QUEEN_STATE_ROOT", str(state_root))

    transcript_path = queen_main._default_transcript_path(installation_root, 42)
    assert resolve_queen_state_root(installation_root) == state_root
    assert transcript_path.parent == state_root / "transcripts"
    assert managed_session_registry_dir(installation_root) == state_root / "session_registry"

    with queen_main._hold_direct_run_task_guard(
        installation_root,
        42,
        transcript_path,
    ):
        lock_path = state_root / "run_guards/queen_task_42.lock"
        assert lock_path.is_file()
        assert f"transcript_path={transcript_path}" in lock_path.read_text(
            encoding="utf-8"
        )

    assert not (installation_root / ".queen").exists()


def test_imported_db_task_writes_dump_to_explicit_mutable_root(tmp_path: Path) -> None:
    installation_root = tmp_path / "filterest"
    dump_root = installation_root / "data/runtime/agent_tasks/_db_dump"
    environment = os.environ.copy()
    environment.update(
        {
            "PYTHONPATH": str(APP_ROOT),
            "FILTEREST_PROJECT_ROOT_OVERRIDE": str(installation_root),
            "FILTEREST_TASK_DUMP_DIR": str(dump_root),
        }
    )
    task = {
        "id": 42,
        "title": "Standalone dump",
        "status": "in_progress",
        "content": "Runtime-owned evidence.",
    }
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            "import json, os; "
            "from server_tools.agent_tools import db_task; "
            "print(db_task._dump_task(json.loads(os.environ['FILTEREST_TEST_TASK'])))",
        ],
        cwd=installation_root.parent,
        env={**environment, "FILTEREST_TEST_TASK": json.dumps(task)},
        check=True,
        capture_output=True,
        text=True,
    )

    dump_path = Path(completed.stdout.strip())
    assert dump_path.is_file()
    assert dump_path.is_relative_to(dump_root)
    assert not (installation_root / "agent_tasks").exists()
