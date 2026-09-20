"""Verify Filterest's standalone worker routine contract.

Connects the public worker launcher, routine lookup, and prompt rendering.
Exists so a plain Filterest checkout retains routines without an Easelect
maintenance-shell dependency while still supporting explicit private overlays.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


FILTEREST_ROOT = Path(__file__).resolve().parents[3]
PUBLIC_APP_WORKER = FILTEREST_ROOT / "app/worker_agent"
PUBLIC_ROUTINE_RUNNER = (
    FILTEREST_ROOT
    / "app/server_tools/agent_tools/worker_agent/routine_runner.sh"
)


def test_public_worker_lists_product_routine() -> None:
    completed = subprocess.run(
        [str(FILTEREST_ROOT / "worker_agent"), "--routine", "--list"],
        cwd=FILTEREST_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    assert "file_name_convention_checker" in completed.stdout


def test_private_routine_overrides_same_named_product_routine(tmp_path: Path) -> None:
    override_dir = tmp_path / "private-routines"
    override_dir.mkdir()
    override_routine = {
        "name": "file_name_convention_checker",
        "description": "private override selected",
        "steps": [],
    }
    (override_dir / "file_name_convention_checker.json").write_text(
        json.dumps(override_routine),
        encoding="utf-8",
    )

    completed = subprocess.run(
        ["bash", str(PUBLIC_ROUTINE_RUNNER), "--list"],
        cwd=FILTEREST_ROOT,
        env={
            **os.environ,
            "FILTEREST_WORKER_ROUTINES_DIR": str(override_dir),
        },
        check=True,
        capture_output=True,
        text=True,
    )

    assert "private override selected" in completed.stdout
    assert completed.stdout.count("file_name_convention_checker") == 1
    assert "Audit frontend filename meaning" not in completed.stdout


def test_public_product_routine_renders_a_complete_dry_run(tmp_path: Path) -> None:
    completed = subprocess.run(
        [
            str(PUBLIC_APP_WORKER),
            "--routine",
            "file_name_convention_checker",
            "--dry-run",
        ],
        cwd=FILTEREST_ROOT,
        env={
            **os.environ,
            "FILTEREST_WORKSPACE_ROOT": str(tmp_path),
            "FILTEREST_WORKER_OUTPUT_DIR_REL": "worker-output",
            "FILTEREST_WORKER_ROUTINE_RUNNER": "",
            "FILTEREST_WORKER_ROUTINES_DIR": "",
        },
        check=True,
        capture_output=True,
        text=True,
    )

    rendered = completed.stdout + completed.stderr
    assert "Step 1/2: audit_naming_and_imports" in rendered
    assert "Step 2/2: fix_violations" in rendered
    assert str(FILTEREST_ROOT / "app") in rendered
    assert "{{FILTEREST_APPLICATION_ROOT}}" not in rendered
