"""Regression coverage for Python cache writes across Filterest source layouts.

Bridges public command launchers with the shared bytecode-cache resolver.
Exists so Python-backed operator commands never generate state inside immutable app/.
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import stat
import subprocess

import pytest


APPLICATION_SOURCE_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_SOURCE_ROOT = APPLICATION_SOURCE_ROOT.parent
BYTECODE_HELPER = APPLICATION_SOURCE_ROOT / "server_tools/lib/python_bytecode_cache.sh"


def _clean_environment() -> dict[str, str]:
    environment = os.environ.copy()
    for variable_name in tuple(environment):
        if variable_name.startswith("FILTEREST_") or variable_name in {
            "PYTHONPATH",
            "PYTHONPYCACHEPREFIX",
            "PYTHONDONTWRITEBYTECODE",
        }:
            environment.pop(variable_name, None)
    return environment


def _mark_application(application_root: Path) -> None:
    application_root.mkdir(parents=True, exist_ok=True)
    (application_root / "go.mod").write_text(
        "module example.invalid/filterest\n",
        encoding="utf-8",
    )
    (application_root / "VERSION_APP").write_text("9.0.0\n", encoding="utf-8")


def _copy_helper(application_root: Path) -> Path:
    helper = application_root / "server_tools/lib/python_bytecode_cache.sh"
    helper.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(BYTECODE_HELPER, helper)
    return helper


def _resolve_cache_root(
    helper: Path,
    application_root: Path,
    overrides: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    environment = _clean_environment()
    environment.update(overrides or {})
    return subprocess.run(
        [
            "bash",
            "--noprofile",
            "--norc",
            "-c",
            (
                "set -e\n"
                'source "$1"\n'
                'filterest_configure_python_bytecode_cache "$2"\n'
                'printf "%s\\n" "$PYTHONPYCACHEPREFIX"'
            ),
            "python-cache-path-test",
            str(helper),
            str(application_root),
        ],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
    )


def test_python_cache_roots_follow_supported_layouts(tmp_path: Path) -> None:
    standalone_root = tmp_path / "standalone/filterest"
    standalone_application = standalone_root / "app"
    _mark_application(standalone_application)
    standalone_helper = _copy_helper(standalone_application)

    embedded_root = tmp_path / "embedded/easelect"
    embedded_application = embedded_root / "filterest/app"
    _mark_application(embedded_application)
    (embedded_root / ".git").mkdir(parents=True)
    (embedded_root / "VERSION_EASELECT").write_text("9.0.0\n", encoding="utf-8")
    embedded_helper = _copy_helper(embedded_application)

    flat_application = tmp_path / "flat/filterest"
    _mark_application(flat_application)
    flat_helper = _copy_helper(flat_application)

    standalone = _resolve_cache_root(standalone_helper, standalone_application)
    embedded = _resolve_cache_root(embedded_helper, embedded_application)
    flat = _resolve_cache_root(flat_helper, flat_application)

    assert standalone.returncode == 0, standalone.stderr
    assert standalone.stdout.strip() == str(
        standalone_root / "data/runtime/python-cache"
    )
    assert embedded.returncode == 0, embedded.stderr
    assert embedded.stdout.strip() == str(embedded_root / "runtime/python-cache")
    assert flat.returncode == 0, flat.stderr
    assert flat.stdout.strip() == str(flat_application / "runtime/python-cache")


def test_nested_app_rejects_runtime_cache_override_inside_source(tmp_path: Path) -> None:
    installation_root = tmp_path / "filterest"
    application_root = installation_root / "app"
    _mark_application(application_root)
    helper = _copy_helper(application_root)

    completed = _resolve_cache_root(
        helper,
        application_root,
        {"FILTEREST_RUNTIME_ROOT_OVERRIDE": str(application_root / "runtime")},
    )

    assert completed.returncode != 0
    assert "outside immutable app/" in completed.stderr


def test_nested_app_preserves_explicit_external_bytecode_prefix(tmp_path: Path) -> None:
    installation_root = tmp_path / "filterest"
    application_root = installation_root / "app"
    _mark_application(application_root)
    helper = _copy_helper(application_root)
    configured_cache = installation_root / "data/custom-python-cache"

    completed = _resolve_cache_root(
        helper,
        application_root,
        {"PYTHONPYCACHEPREFIX": str(configured_cache)},
    )

    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip() == str(configured_cache)


def test_nested_app_rejects_explicit_bytecode_prefix_inside_source(
    tmp_path: Path,
) -> None:
    installation_root = tmp_path / "filterest"
    application_root = installation_root / "app"
    _mark_application(application_root)
    helper = _copy_helper(application_root)

    completed = _resolve_cache_root(
        helper,
        application_root,
        {"PYTHONPYCACHEPREFIX": str(application_root / "python-cache")},
    )

    assert completed.returncode != 0
    assert "outside immutable app/" in completed.stderr


def _write_python_fixture(application_root: Path) -> None:
    for package_directory in (
        application_root / "server_tools",
        application_root / "server_tools/agent_tools",
        application_root / "server_tools/queen",
    ):
        package_directory.mkdir(parents=True, exist_ok=True)
        (package_directory / "__init__.py").write_text("", encoding="utf-8")

    (application_root / "server_tools/cache_probe.py").write_text(
        "VALUE = 'cache-probe'\n",
        encoding="utf-8",
    )
    for module_name in ("db_task", "db_report"):
        (application_root / f"server_tools/agent_tools/{module_name}.py").write_text(
            "from server_tools.cache_probe import VALUE\nprint(VALUE)\n",
            encoding="utf-8",
        )
    (application_root / "server_tools/queen/__main__.py").write_text(
        "from server_tools.cache_probe import VALUE\nprint(VALUE)\n",
        encoding="utf-8",
    )
    scripts_root = application_root / "server_tools/scripts"
    scripts_root.mkdir(parents=True)
    (scripts_root / "cache_probe.py").write_text(
        "VALUE = 'cache-probe'\n",
        encoding="utf-8",
    )
    (scripts_root / "timestamp.py").write_text(
        "from cache_probe import VALUE\nprint(VALUE)\n",
        encoding="utf-8",
    )


def _make_read_only(root: Path) -> None:
    for path in sorted(root.rglob("*"), reverse=True):
        if path.is_dir():
            path.chmod(0o555)
        else:
            executable = bool(path.stat().st_mode & stat.S_IXUSR)
            path.chmod(0o555 if executable else 0o444)
    root.chmod(0o555)


def _make_writable(root: Path) -> None:
    for path in root.rglob("*"):
        if path.is_dir():
            path.chmod(0o755)
        else:
            executable = bool(path.stat().st_mode & stat.S_IXUSR)
            path.chmod(0o755 if executable else 0o644)
    root.chmod(0o755)


@pytest.mark.parametrize(
    ("launcher_scope", "launcher_name", "arguments"),
    [
        ("root", "filterest", ("timestamp",)),
        ("app", "filterest", ("timestamp",)),
        ("root", "db_task", ("--help",)),
        ("app", "db_task", ("--help",)),
        ("root", "db_report", ("--help",)),
        ("app", "db_report", ("--help",)),
        ("root", "queen", ("--help",)),
        ("app", "queen", ("--help",)),
    ],
)
def test_python_launchers_write_bytecode_beside_read_only_app(
    tmp_path: Path,
    launcher_scope: str,
    launcher_name: str,
    arguments: tuple[str, ...],
) -> None:
    installation_root = tmp_path / "filterest"
    application_root = installation_root / "app"
    _mark_application(application_root)
    _copy_helper(application_root)
    _write_python_fixture(application_root)

    for launcher in ("filterest", "db_task", "db_report", "queen"):
        shutil.copy2(PUBLIC_SOURCE_ROOT / launcher, installation_root / launcher)
        shutil.copy2(APPLICATION_SOURCE_ROOT / launcher, application_root / launcher)

    runtime_cache = installation_root / "data/runtime/python-cache"
    _make_read_only(application_root)
    try:
        launcher_root = installation_root if launcher_scope == "root" else application_root
        completed = subprocess.run(
            [str(launcher_root / launcher_name), *arguments],
            cwd=tmp_path,
            check=False,
            capture_output=True,
            text=True,
            env=_clean_environment(),
        )

        assert completed.returncode == 0, completed.stderr
        assert list(runtime_cache.rglob("*.pyc"))
        assert not list(application_root.rglob("__pycache__"))
    finally:
        _make_writable(application_root)


def test_all_public_python_launchers_install_the_cache_contract() -> None:
    for launcher in ("filterest", "ctl", "db_task", "db_report", "queen", "worker_agent"):
        root_source = (PUBLIC_SOURCE_ROOT / launcher).read_text(encoding="utf-8")
        assert "PYTHONPYCACHEPREFIX" in root_source, launcher

    for launcher in ("filterest", "ctl", "db_task", "db_report", "queen", "worker_agent"):
        app_source = (APPLICATION_SOURCE_ROOT / launcher).read_text(encoding="utf-8")
        assert "python_bytecode_cache.sh" in app_source, launcher
        assert "filterest_configure_python_bytecode_cache" in app_source, launcher

    qa_source = (
        APPLICATION_SOURCE_ROOT / "server_tools/scripts/qa.sh"
    ).read_text(encoding="utf-8")
    assert "python_bytecode_cache.sh" in qa_source
    assert qa_source.index("filterest_configure_python_bytecode_cache") < qa_source.index(
        "python3 ./server_tools/scripts/generate_go_contract_types.py"
    )
