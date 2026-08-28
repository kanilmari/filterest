"""Resolve Queen-owned mutable runtime paths without moving its source root.

Bridges standalone Filterest's root launcher with Queen transcripts, locks, and
managed-session state. Defaults preserve Easelect's historical ``.queen`` tree.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Mapping


def resolve_queen_state_root(
    project_root: Path,
    environment: Mapping[str, str] | None = None,
) -> Path:
    """Return the explicit mutable Queen root or the legacy project-local root."""

    source_environment = os.environ if environment is None else environment
    configured_root = source_environment.get("FILTEREST_QUEEN_STATE_ROOT", "").strip()
    if configured_root:
        return Path(configured_root).expanduser().resolve()
    return Path(project_root).resolve() / ".queen"
