"""Connect Filterest's public Python tests to the shared category support."""

from __future__ import annotations

from pathlib import Path
import sys


_APP_ROOT = Path(__file__).resolve().parents[2]
_PRODUCT_PARENT = _APP_ROOT.parent.parent
for _IMPORT_ROOT in (_APP_ROOT, _PRODUCT_PARENT):
    if str(_IMPORT_ROOT) not in sys.path:
        sys.path.insert(0, str(_IMPORT_ROOT))

from python_category_support import (
    configure_categories,
    modify_category_items,
    register_category_option,
    write_category_summary,
)


_SCOPE_ROOT = Path(__file__).resolve().parent


def pytest_addoption(parser) -> None:
    register_category_option(parser)


def pytest_configure(config) -> None:
    configure_categories(config)


def pytest_collection_modifyitems(config, items) -> None:
    modify_category_items(config, items, scope_root=_SCOPE_ROOT)


def pytest_terminal_summary(terminalreporter, exitstatus, config) -> None:
    del exitstatus
    write_category_summary(terminalreporter, config)
