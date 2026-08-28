"""Single-source Python test categorization shared by composed source trees."""

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


def register_category_option(parser: pytest.Parser) -> None:
    """Register the shared option once even when two sibling suites compose."""

    try:
        parser.addoption(
            "--python-category",
            action="store",
            choices=tuple(CATEGORY_MARKERS),
            help="Run one Filterest Python category instead of the whole collection.",
        )
    except ValueError as exc:
        if "--python-category" not in str(exc):
            raise


def configure_categories(config: pytest.Config) -> None:
    if getattr(config, "_filterest_python_categories_configured", False):
        return
    for category, marker in CATEGORY_MARKERS.items():
        config.addinivalue_line(
            "markers",
            f"{marker}: automatically assigned Filterest Python category {category}",
        )
    config._filterest_python_categories_configured = True  # type: ignore[attr-defined]


def category_for_path(path: Path) -> str:
    stem = path.stem.lower()
    if any(token in stem for token in RELEASE_ARTIFACT_TOKENS):
        return "release-artifact"
    if any(token in stem for token in AGENT_WORKFLOW_TOKENS):
        return "agent-workflow"
    return "platform-tooling"


def _is_below(path: Path, scope_root: Path) -> bool:
    try:
        path.resolve().relative_to(scope_root)
    except ValueError:
        return False
    return True


def modify_category_items(
    config: pytest.Config,
    items: list[pytest.Item],
    *,
    scope_root: Path,
) -> None:
    """Classify only one suite so sibling conftests never double-process items."""

    selected_category = config.getoption("--python-category", default=None)
    counts: Counter[str] = Counter()
    deselected: list[pytest.Item] = []
    selected: list[pytest.Item] = []

    for item in items:
        path = Path(str(item.path))
        if not _is_below(path, scope_root):
            selected.append(item)
            continue

        category = category_for_path(path)
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

    aggregate: Counter[str] = getattr(
        config,
        "_filterest_python_category_counts",
        Counter(),
    )
    aggregate.update(counts)
    config._filterest_python_category_counts = aggregate  # type: ignore[attr-defined]
    config._filterest_python_selected_category = selected_category  # type: ignore[attr-defined]


def write_category_summary(
    terminalreporter: pytest.TerminalReporter,
    config: pytest.Config,
) -> None:
    if getattr(config, "_filterest_python_category_summary_written", False):
        return
    config._filterest_python_category_summary_written = True  # type: ignore[attr-defined]

    counts: Counter[str] = getattr(
        config,
        "_filterest_python_category_counts",
        Counter(),
    )
    selected_category = getattr(config, "_filterest_python_selected_category", None)

    terminalreporter.section("Filterest Python test categories")
    for category in CATEGORY_MARKERS:
        suffix = " (selected)" if category == selected_category else ""
        terminalreporter.write_line(f"{category}: {counts[category]} collected{suffix}")
