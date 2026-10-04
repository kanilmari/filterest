"""Proves the Node project-folder rule answers exactly as the Python one.
Bridges filterest_project_boundary.cjs with resolve_embedded_project_root.
Exists so browser tools and Python tools never choose different project folders,
including for links, absent paths and invalid markers.
"""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess

import pytest

try:
    from filterest.app.server_tools.lib.easelect_private_paths import resolve_embedded_project_root
except ModuleNotFoundError:
    from server_tools.lib.easelect_private_paths import resolve_embedded_project_root


SOURCE_ROOT = Path(__file__).resolve().parents[2]
BOUNDARY_MODULE = SOURCE_ROOT / "server_tools/lib/filterest_project_boundary.cjs"


def mark_application(application_root: Path) -> None:
    application_root.mkdir(parents=True, exist_ok=True)
    (application_root / "go.mod").write_text("module filterest\n", encoding="utf-8")
    (application_root / "VERSION_APP").write_text("test\n", encoding="utf-8")


def mark_easelect(workspace: Path, *, git_file: bool = False, version_directory: bool = False) -> None:
    workspace.mkdir(parents=True, exist_ok=True)
    if git_file:
        (workspace / ".git").write_text("gitdir: /elsewhere\n", encoding="utf-8")
    else:
        (workspace / ".git").mkdir()
    if version_directory:
        (workspace / "VERSION_EASELECT").mkdir()
    else:
        (workspace / "VERSION_EASELECT").write_text("test\n", encoding="utf-8")


def node_boundaries(cases: list[tuple[str, dict[str, str]]]) -> list[str]:
    script = (
        "const boundary = require(process.argv[1]);"
        "const cases = JSON.parse(process.argv[2]);"
        "console.log(JSON.stringify(cases.map(([root, environment]) =>"
        " boundary.resolveFilterestProjectBoundary(root, environment))));"
    )
    completed = subprocess.run(
        ["node", "-e", script, str(BOUNDARY_MODULE), json.dumps(cases)],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def test_node_and_python_choose_the_same_project_folder(tmp_path: Path) -> None:
    if shutil.which("node") is None:
        pytest.skip("Node.js is required for the JavaScript rule")
    root = tmp_path.resolve()
    standalone = root / "standalone" / "filterest" / "app"
    mark_application(standalone)
    composed = root / "easelect"
    mark_easelect(composed)
    mark_application(composed / "filterest" / "app")
    unmarked = root / "unmarked-easelect"
    mark_easelect(unmarked)
    (unmarked / "filterest" / "app").mkdir(parents=True)
    flat = root / "flat-easelect"
    mark_easelect(flat)
    mark_application(flat / "filterest")
    linked = root / "linked-easelect"
    mark_easelect(linked)
    mark_application(root / "sibling" / "app")
    (linked / "filterest").symlink_to(Path("..") / "sibling")
    worktree = root / "worktree"
    mark_easelect(worktree, git_file=True)
    mark_application(worktree / "filterest" / "app")
    directory_marker = root / "directory-marker"
    mark_easelect(directory_marker, version_directory=True)
    mark_application(directory_marker / "filterest" / "app")
    (root / "workspace-link").symlink_to(composed)

    # Each case and the folder both rules must choose for it.
    cases = [
        (standalone, {}, standalone.parent),
        (composed / "filterest" / "app", {}, composed),
        (unmarked / "filterest" / "app", {}, unmarked / "filterest" / "app"),
        (root / "missing" / "filterest" / "app", {}, root / "missing" / "filterest" / "app"),
        (flat / "filterest", {}, flat),
        (linked / "filterest" / "app", {}, root / "sibling"),
        (worktree / "filterest" / "app", {}, worktree),
        (directory_marker / "filterest" / "app", {}, directory_marker / "filterest"),
        (root / "workspace-link" / "filterest" / "app", {}, composed),
        (standalone, {"FILTEREST_PROJECT_ROOT_OVERRIDE": str(root / "workspace-link")}, composed),
        (
            standalone,
            {"FILTEREST_PROJECT_ROOT_OVERRIDE": str(root / "missing" / "override")},
            root / "missing" / "override",
        ),
    ]

    python = [str(resolve_embedded_project_root(case, environment)) for case, environment, _ in cases]
    node = node_boundaries([(str(case), environment) for case, environment, _ in cases])

    assert python == [str(expected) for _, _, expected in cases]
    assert node == python
