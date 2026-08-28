"""test_project_python_venv_paths.py
What: Verifies the shared Python environment location across supported layouts.
Between what: Sources the real shell helper inside synthetic repository trees.
Why: Ensures generated environments never default inside standalone app/ source.
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess


SOURCE_HELPER = (
    Path(__file__).resolve().parents[2]
    / "server_tools/lib/project_python_venv.sh"
)


def _copy_helper(application_root: Path) -> Path:
    helper = application_root / "server_tools/lib/project_python_venv.sh"
    helper.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE_HELPER, helper)
    return helper


def _mark_application_root(application_root: Path) -> None:
    application_root.mkdir(parents=True, exist_ok=True)
    (application_root / "go.mod").write_text(
        "module example.invalid/filterest\n",
        encoding="utf-8",
    )
    (application_root / "VERSION_APP").write_text("9.1.0\n", encoding="utf-8")


def _resolve_venv(helper: Path, overrides: dict[str, str] | None = None) -> list[str]:
    environment = os.environ.copy()
    for variable_name in (
        "PROJECT_ROOT",
        "FILTEREST_PROJECT_VENV_DIR",
        "EASELECT_PROJECT_VENV_DIR",
    ):
        environment.pop(variable_name, None)
    environment.update(overrides or {})
    result = subprocess.run(
        [
            "bash",
            "--noprofile",
            "--norc",
            "-c",
            (
                'source "$1"\n'
                'printf "%s\\n%s\\n%s\\n%s\\n" '
                '"$FILTEREST_PROJECT_VENV_DIR" '
                '"$EASELECT_PROJECT_VENV_DIR" '
                '"$FILTEREST_PROJECT_PYTHON" '
                '"$PROJECT_ROOT"'
            ),
            "venv-path-test",
            str(helper),
        ],
        check=True,
        capture_output=True,
        text=True,
        env=environment,
    )
    return result.stdout.splitlines()


def test_nested_standalone_venv_uses_installation_runtime_data(tmp_path: Path) -> None:
    installation_root = tmp_path / "filterest"
    application_root = installation_root / "app"
    _mark_application_root(application_root)
    helper = _copy_helper(application_root)

    filterest_venv, legacy_venv, python_path, project_root = _resolve_venv(helper)
    expected = installation_root / "data/runtime/python/venv"

    assert filterest_venv == str(expected)
    assert legacy_venv == str(expected)
    assert python_path == str(expected / "bin/python3")
    assert project_root == str(installation_root)
    assert filterest_venv != str(application_root / ".venv")


def test_embedded_easelect_venv_remains_at_outer_project_root(tmp_path: Path) -> None:
    easelect_root = tmp_path / "easelect"
    application_root = easelect_root / "filterest/app"
    _mark_application_root(application_root)
    (easelect_root / ".git").mkdir(parents=True)
    (easelect_root / "VERSION_EASELECT").write_text("9.0.0\n", encoding="utf-8")
    helper = _copy_helper(application_root)

    filterest_venv, legacy_venv, python_path, project_root = _resolve_venv(helper)
    expected = easelect_root / ".venv"

    assert filterest_venv == str(expected)
    assert legacy_venv == str(expected)
    assert python_path == str(expected / "bin/python3")
    assert project_root == str(easelect_root)


def test_legacy_flat_checkout_venv_remains_root_local(tmp_path: Path) -> None:
    project_root = tmp_path / "legacy-filterest"
    _mark_application_root(project_root)
    helper = _copy_helper(project_root)

    filterest_venv, legacy_venv, _, resolved_project_root = _resolve_venv(helper)

    assert filterest_venv == str(project_root / ".venv")
    assert legacy_venv == filterest_venv
    assert resolved_project_root == str(project_root)


def test_primary_and_legacy_venv_overrides_remain_compatible(tmp_path: Path) -> None:
    installation_root = tmp_path / "filterest"
    application_root = installation_root / "app"
    _mark_application_root(application_root)
    helper = _copy_helper(application_root)
    primary_override = tmp_path / "primary-venv"
    legacy_override = tmp_path / "legacy-venv"

    primary_paths = _resolve_venv(
        helper,
        {
            "FILTEREST_PROJECT_VENV_DIR": str(primary_override),
            "EASELECT_PROJECT_VENV_DIR": str(legacy_override),
        },
    )
    legacy_paths = _resolve_venv(
        helper,
        {"EASELECT_PROJECT_VENV_DIR": str(legacy_override)},
    )

    assert primary_paths[0] == str(primary_override)
    assert primary_paths[1] == str(primary_override)
    assert legacy_paths[0] == str(legacy_override)
    assert legacy_paths[1] == str(legacy_override)
