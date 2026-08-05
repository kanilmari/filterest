"""Categorize Easelect's collected Python tests and report the split.

The categories connect a large pytest collection with understandable ownership
areas. They exist so collection totals no longer imply that every Python item
starts the backend, frontend, database, or an external service.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import pytest


CATEGORY_MARKERS = {
    "release-artifact": "python_release_artifact",
    "agent-workflow": "python_agent_workflow",
    "platform-tooling": "python_platform_tooling",
}

RELEASE_ARTIFACT_TOKENS = (
    "artifact_maintenance",
    "bootstrap",
    "filterest",
    "final_release",
    "p0_",
    "public_",
    "publication",
)

AGENT_WORKFLOW_TOKENS = (
    "db_task",
    "queen",
    "worker_agent",
)


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--python-category",
        action="store",
        choices=tuple(CATEGORY_MARKERS),
        help="Run one Easelect Python category instead of the whole collection.",
    )


def pytest_configure(config: pytest.Config) -> None:
    for category, marker in CATEGORY_MARKERS.items():
        config.addinivalue_line(
            "markers",
            f"{marker}: automatically assigned Easelect Python category {category}",
        )


def category_for_path(path: Path) -> str:
    stem = path.stem.lower()
    if any(token in stem for token in RELEASE_ARTIFACT_TOKENS):
        return "release-artifact"
    if any(token in stem for token in AGENT_WORKFLOW_TOKENS):
        return "agent-workflow"
    return "platform-tooling"


def pytest_collection_modifyitems(
    config: pytest.Config,
    items: list[pytest.Item],
) -> None:
    # A nested conftest is discovered too late to register CLI options when
    # pytest starts from the repository root. Keep full-suite collection
    # working there while preserving the explicit category option for
    # `pytest testing/python ...` invocations.
    selected_category = config.getoption("--python-category", default=None)
    counts: Counter[str] = Counter()
    deselected: list[pytest.Item] = []
    selected: list[pytest.Item] = []

    for item in items:
        category = category_for_path(Path(str(item.path)))
        counts[category] += 1
        item.add_marker(getattr(pytest.mark, CATEGORY_MARKERS[category]))
        item.user_properties.append(("python_category", category))
        if selected_category and category != selected_category:
            deselected.append(item)
        else:
            selected.append(item)

    if deselected:
        config.hook.pytest_deselected(items=deselected)
        items[:] = selected

    config._easelect_python_category_counts = counts  # type: ignore[attr-defined]
    config._easelect_python_selected_category = selected_category  # type: ignore[attr-defined]


def pytest_terminal_summary(
    terminalreporter: pytest.TerminalReporter,
    exitstatus: int,
    config: pytest.Config,
) -> None:
    del exitstatus
    counts: Counter[str] = getattr(
        config,
        "_easelect_python_category_counts",
        Counter(),
    )
    selected_category = getattr(config, "_easelect_python_selected_category", None)

    terminalreporter.section("Easelect Python test categories")
    for category in CATEGORY_MARKERS:
        suffix = " (selected)" if category == selected_category else ""
        terminalreporter.write_line(f"{category}: {counts[category]} collected{suffix}")
