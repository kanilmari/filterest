"""test_file_length_guard.py
Prove the source-length guard's added roots and retired legacy exemption.
Connect the real shell checker to isolated, temporary application trees.
Keep new overruns from silently inheriting a missing root or stale exemption.
"""

from pathlib import Path
import shutil
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = Path("server_tools/scripts/check_file_length.sh")


@pytest.fixture
def guarded_app(tmp_path):
    app = tmp_path / "app"
    for directory in (
        "frontend/core_components",
        "frontend/reusable_components",
        "backend/core_components",
        "backend/reusable_components",
        "components",
        "backend/pipeline",
        "server_tools/scripts",
        "testing",
    ):
        (app / directory).mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / "app" / SCRIPT, app / SCRIPT)
    return app


def assert_length_boundary(app, relative_path):
    path = app / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("// line\n" * 700, encoding="utf-8")
    command = ["bash", str(app / SCRIPT), "--strict", "--show-legacy"]
    within_limit = subprocess.run(command, cwd=app.parent, capture_output=True, text=True, timeout=10)
    assert within_limit.returncode == 0, within_limit.stdout + within_limit.stderr
    assert "All files within 700-line limit" in within_limit.stdout

    path.write_text("// line\n" * 701, encoding="utf-8")
    over_limit = subprocess.run(command, cwd=app.parent, capture_output=True, text=True, timeout=10)
    assert over_limit.returncode == 1, over_limit.stdout + over_limit.stderr
    assert f"{relative_path} (701 lines) [NEW]" in over_limit.stdout
    assert "1 new, 0 legacy" in over_limit.stdout


@pytest.mark.parametrize("relative_path", (
    "backend/pipeline/nested/new_overrun.go",
    "server_tools/nested/new_overrun.py",
    "testing/python/nested/new_overrun.py",
))
def test_new_roots_enforce_the_700_line_boundary(guarded_app, relative_path):
    assert_length_boundary(guarded_app, relative_path)


def test_pruned_legacy_path_cannot_exempt_a_new_overrun(guarded_app):
    assert_length_boundary(
        guarded_app,
        "backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_delete/delete_row.go",
    )
