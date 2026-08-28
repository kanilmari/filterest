"""dev_status_path_resolver.py
What: Resolves immutable version inputs and mutable status paths for dev_status.
Between what: Connects embedded Easelect, nested Filterest, and legacy flat layouts.
Why: Prevents a standalone installation from reading or writing runtime state in app/.
"""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Mapping

from .easelect_private_paths import resolve_embedded_project_root
from .filterest_paths import (
    is_nested_filterest_installation,
    is_private_easelect_source_checkout,
)


DEFAULT_COMPATIBILITY_MANIFEST = Path(
    "server_tools/versioning/app_db_compatibility.jsonl"
)


@dataclass(frozen=True)
class DevStatusPaths:
    """Describe source-owned identity files and operator-owned status paths."""

    application_root: Path
    project_root: Path
    version_root: Path
    app_version_paths: tuple[Path, ...]
    db_version_path: Path
    manifest_path: Path
    shared_dev_storage_state_dir: Path
    storage_path: Path
    storage_deleted_path: Path
    embedded_easelect: bool
    nested_standalone: bool


def resolve_dev_status_paths(
    canonical_filterest_root: Path | str,
    environment: Mapping[str, str] | None = None,
) -> DevStatusPaths:
    """Resolve status paths without crossing the immutable app boundary.

    The public implementation passes its own application root. An embedded
    Easelect checkout deliberately selects the outer private composition,
    while a nested standalone checkout keeps source reads in ``app/`` and
    runtime reads in the installation root.
    """

    source_environment = os.environ if environment is None else environment
    application_root = Path(canonical_filterest_root).expanduser().resolve()
    project_root = resolve_embedded_project_root(
        application_root,
        source_environment,
    )
    embedded_easelect = is_private_easelect_source_checkout(project_root)
    nested_standalone = (
        not embedded_easelect
        and project_root != application_root
        and is_nested_filterest_installation(project_root)
    )

    if embedded_easelect:
        version_root = project_root
        app_version_names = ("VERSION_EASELECT", "VERSION_APP")
        default_manifest_root = project_root
        shared_dev_storage_state_dir = project_root / "data" / "shared_dev_storage"
        storage_path = project_root / "storage"
        storage_deleted_path = project_root / "storage_deleted"
    elif nested_standalone:
        version_root = application_root
        app_version_names = ("VERSION_APP",)
        default_manifest_root = application_root
        shared_dev_storage_state_dir = (
            project_root / "data" / "runtime" / "shared_dev_storage"
        )
        storage_path = project_root / "data" / "storage"
        storage_deleted_path = project_root / "data" / "storage_deleted"
    else:
        # Legacy public checkouts kept immutable and mutable files together.
        version_root = application_root
        app_version_names = ("VERSION_APP", "VERSION_EASELECT")
        default_manifest_root = application_root
        shared_dev_storage_state_dir = project_root / "data" / "shared_dev_storage"
        storage_path = project_root / "storage"
        storage_deleted_path = project_root / "storage_deleted"

    configured_manifest = str(
        source_environment.get("FILTEREST_APP_DB_COMPATIBILITY_MANIFEST", "")
    ).strip()
    if configured_manifest:
        manifest_path = Path(configured_manifest).expanduser()
        if not manifest_path.is_absolute():
            manifest_path = project_root / manifest_path
    else:
        manifest_path = default_manifest_root / DEFAULT_COMPATIBILITY_MANIFEST

    return DevStatusPaths(
        application_root=application_root,
        project_root=project_root,
        version_root=version_root,
        app_version_paths=tuple(
            version_root / file_name for file_name in app_version_names
        ),
        db_version_path=version_root / "VERSION_DB",
        manifest_path=manifest_path.resolve(strict=False),
        shared_dev_storage_state_dir=shared_dev_storage_state_dir,
        storage_path=storage_path,
        storage_deleted_path=storage_deleted_path,
        embedded_easelect=embedded_easelect,
        nested_standalone=nested_standalone,
    )
