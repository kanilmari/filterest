"""test_import_boundaries.py
Enforce the portable frontend's dependency boundary in Filterest's public suite.
Connect the strict source guard to ordinary platform-tooling test selection.
Protect root resolution when the caller works outside this checkout.
"""

from pathlib import Path
import subprocess

from python_category_support import category_for_path
from python_test_tiers import tier_for_path


def test_import_boundary_guard_belongs_to_ordinary_platform_tooling():
    path = Path(__file__)
    assert tier_for_path(path) == "ordinary"
    assert category_for_path(path) == "platform-tooling"


def test_strict_import_boundaries_from_unrelated_working_directory(tmp_path):
    root = Path(__file__).resolve().parents[3]
    script = root / "app/server_tools/scripts/check_import_boundaries.sh"
    working_directory = tmp_path / "unrelated" / "working_directory"
    working_directory.mkdir(parents=True)

    result = subprocess.run(
        ["bash", str(script), "--strict"],
        cwd=working_directory,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
