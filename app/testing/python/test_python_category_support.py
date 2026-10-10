"""test_python_category_support.py
Verify real pytest selection, summaries and composed-suite scope boundaries.
Connect the category plugin to tiny synthetic collections, never product tests.
Protect old ownership commands and the exact ordinary/heavy partition.
"""

from __future__ import annotations

from collections import Counter
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest

from python_category_support import (
    CATEGORY_MARKERS,
    TIER_MARKERS,
    configure_categories,
    modify_category_items,
    register_category_option,
    write_category_summary,
)


SUPPORT_ROOT = Path(__file__).resolve().parent


@pytest.fixture
def mini_suite(tmp_path: Path) -> Path:
    conftest = f'''
import sys
from pathlib import Path
sys.path.insert(0, {str(SUPPORT_ROOT)!r})
from python_category_support import (
    register_category_option, configure_categories, modify_category_items, write_category_summary,
)
def pytest_addoption(parser):
    register_category_option(parser)
    register_category_option(parser)
def pytest_configure(config):
    configure_categories(config)
    configure_categories(config)
def pytest_collection_modifyitems(config, items):
    modify_category_items(config, items, scope_root=Path(__file__).parent)
def pytest_terminal_summary(terminalreporter, exitstatus, config):
    write_category_summary(terminalreporter, config)
    write_category_summary(terminalreporter, config)
'''
    (tmp_path / "conftest.py").write_text(conftest, encoding="utf-8")
    for filename in (
        "test_database_recovery.py", "test_public_example.py",
        "test_worker_agent_example.py", "test_local_example.py",
    ):
        (tmp_path / filename).write_text("def test_example():\n    pass\n", encoding="utf-8")
    return tmp_path


def collect_mini_suite(root: Path, *options: str) -> subprocess.CompletedProcess[str]:
    environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1"}
    environment.pop("PYTEST_ADDOPTS", None)
    return subprocess.run(
        [sys.executable, "-B", "-m", "pytest", "--collect-only", "-q", *options],
        cwd=root, env=environment, capture_output=True, text=True, timeout=30,
    )


@pytest.mark.parametrize("option", ["--category", "--python-category"])
@pytest.mark.parametrize("selection,expected", [
    ("ordinary", {"test_public_example.py", "test_worker_agent_example.py", "test_local_example.py"}),
    ("heavy-installation", {"test_database_recovery.py"}),
    ("release-artifact", {"test_public_example.py"}),
    ("agent-workflow", {"test_worker_agent_example.py"}),
    ("platform-tooling", {"test_database_recovery.py", "test_local_example.py"}),
])
def test_real_pytest_selects_tiers_and_preserves_ownership_categories(mini_suite, option, selection, expected):
    result = collect_mini_suite(mini_suite, option, selection)
    assert result.returncode == 0, result.stdout + result.stderr
    filenames = {line.split("::")[0] for line in result.stdout.splitlines() if "::test_example" in line}
    assert filenames == expected
    assert result.stdout.count("Filterest Python test categories") == 1
    assert result.stdout.count("Filterest Python test tiers") == 1
    assert "ordinary: 3 collected" in result.stdout
    assert "heavy-installation: 1 collected" in result.stdout
    assert f"{selection}: {len(expected)} collected (selected)" in result.stdout


def test_real_collections_form_an_exact_partition(mini_suite):
    collections = []
    for options in ((), ("--category", "ordinary"), ("--category", "heavy-installation")):
        result = collect_mini_suite(mini_suite, *options)
        assert result.returncode == 0, result.stdout + result.stderr
        collections.append({line for line in result.stdout.splitlines() if "::test_example" in line})
    full, ordinary, heavy = collections
    assert not ordinary & heavy
    assert ordinary | heavy == full


def test_unknown_category_is_a_cli_error(mini_suite):
    result = collect_mini_suite(mini_suite, "--category", "unknown")
    assert result.returncode == 4
    assert "invalid choice" in result.stderr


def test_option_registration_does_not_hide_other_parser_errors():
    class BrokenParser:
        def addoption(self, *arguments, **keywords):
            raise ValueError("unrelated parser failure")

    with pytest.raises(ValueError, match="unrelated parser failure"):
        register_category_option(BrokenParser())


def test_composed_scopes_keep_foreign_items_and_aggregate_once(tmp_path):
    deselections = []
    config = SimpleNamespace(
        getoption=lambda *args, **kwargs: "heavy-installation",
        hook=SimpleNamespace(pytest_deselected=lambda **kwargs: deselections.extend(kwargs["items"])),
    )

    def item(path):
        result = SimpleNamespace(path=path, user_properties=[], markers=[])
        result.add_marker = result.markers.append
        return result

    heavy = item(tmp_path / "public/test_database_recovery.py")
    ordinary = item(tmp_path / "public/test_local_example.py")
    foreign = item(tmp_path / "private/test_worker_agent_example.py")
    items = [heavy, ordinary, foreign]
    modify_category_items(config, items, scope_root=tmp_path / "public")
    assert items == [heavy, foreign]
    assert deselections == [ordinary]
    assert foreign.user_properties == []
    assert ("python_tier", "heavy-installation") in heavy.user_properties
    assert {marker.name for marker in heavy.markers} == {"python_platform_tooling", "python_heavy_installation"}
    modify_category_items(config, items, scope_root=tmp_path / "private")
    assert items == [heavy]
    assert config._filterest_python_tier_counts == Counter({"ordinary": 2, "heavy-installation": 1})
    assert config._filterest_python_category_counts == Counter({"platform-tooling": 2, "agent-workflow": 1})


def test_marker_configuration_and_empty_summary_are_idempotent():
    marker_lines, sections, lines = [], [], []
    config = SimpleNamespace(addinivalue_line=lambda name, value: marker_lines.append((name, value)))
    configure_categories(config)
    configure_categories(config)
    assert len(marker_lines) == len(CATEGORY_MARKERS) + len(TIER_MARKERS)
    reporter = SimpleNamespace(section=sections.append, write_line=lines.append)
    write_category_summary(reporter, config)
    write_category_summary(reporter, config)
    assert len(sections) == 2
    assert "ordinary: 0 collected" in lines
    assert "heavy-installation: 0 collected" in lines
