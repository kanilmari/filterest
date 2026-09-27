"""Connect Filterest's public Python tests to the shared category support."""

from __future__ import annotations

import os
from pathlib import Path
import sys


_APP_ROOT = Path(__file__).resolve().parents[2]
_PRODUCT_PARENT = _APP_ROOT.parent.parent
for _IMPORT_ROOT in (_APP_ROOT, _PRODUCT_PARENT):
    if str(_IMPORT_ROOT) not in sys.path:
        sys.path.insert(0, str(_IMPORT_ROOT))

# Go commands started by tests use this installation's own caches, the same
# data/runtime/go folders the root ./filterest launcher exports. Why: running
# pytest directly with the project interpreter otherwise fills the user's global
# Go module cache and downloads the dependency graph in the middle of a test run.
_GO_RUNTIME_ROOT = _APP_ROOT.parent / "data" / "runtime" / "go"
os.environ.setdefault("GOMODCACHE", str(_GO_RUNTIME_ROOT / "module-cache"))
os.environ.setdefault("GOCACHE", str(_GO_RUNTIME_ROOT / "build-cache"))

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
