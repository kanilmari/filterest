"""test_dev_status_path_resolver.py
What: Verifies dev-status source and mutable paths in every supported layout.
Between what: Exercises synthetic Easelect, nested Filterest, and flat checkouts.
Why: Guards immutable app/ source from accidental runtime-path ownership.
"""

from __future__ import annotations

import json
from pathlib import Path

from server_tools.agent_tools.dev_status import (
    collect_shared_dev_storage_status,
    read_current_app_version,
    read_current_manifest_row,
    read_required_text,
)
from server_tools.lib.dev_status_path_resolver import resolve_dev_status_paths


def _write_identity_files(root: Path, app_version: str, db_version: str) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / "go.mod").write_text("module example.invalid/filterest\n", encoding="utf-8")
    (root / "VERSION_APP").write_text(f"{app_version}\n", encoding="utf-8")
    (root / "VERSION_DB").write_text(f"{db_version}\n", encoding="utf-8")


def _write_manifest(path: Path, app_version: str, db_version: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "app_version": app_version,
                "min_db_version": db_version,
                "target_db_version": db_version,
            }
        )
        + "\n",
        encoding="utf-8",
    )


def test_nested_standalone_reads_identity_from_app_and_state_from_install_root(
    tmp_path: Path,
) -> None:
    installation_root = tmp_path / "filterest"
    application_root = installation_root / "app"
    _write_identity_files(application_root, "9.1.0", "9.6.8")
    manifest_path = (
        application_root / "server_tools/versioning/app_db_compatibility.jsonl"
    )
    _write_manifest(manifest_path, "9.1.0", "9.6.8")

    paths = resolve_dev_status_paths(application_root, {})
    app_version, version_file = read_current_app_version(paths)
    storage_status = collect_shared_dev_storage_status({}, paths)

    assert paths.project_root == installation_root
    assert paths.version_root == application_root
    assert paths.db_version_path == application_root / "VERSION_DB"
    assert read_required_text(paths.db_version_path) == "9.6.8"
    assert (app_version, version_file) == ("9.1.0", "VERSION_APP")
    assert paths.manifest_path == manifest_path
    assert read_current_manifest_row(app_version, paths)["target_db_version"] == "9.6.8"
    assert storage_status["local"]["storage_path"] == str(
        installation_root / "data/storage"
    )
    assert storage_status["local"]["storage_deleted_path"] == str(
        installation_root / "data/storage_deleted"
    )
    assert storage_status["local"]["state_dir"] == str(
        installation_root / "data/runtime/shared_dev_storage"
    )
    assert application_root not in paths.storage_path.parents
    assert application_root not in paths.shared_dev_storage_state_dir.parents


def test_embedded_easelect_keeps_outer_versions_storage_and_manifest_override(
    tmp_path: Path,
) -> None:
    easelect_root = tmp_path / "easelect"
    application_root = easelect_root / "filterest/app"
    _write_identity_files(application_root, "9.1.0", "9.6.8")
    (easelect_root / ".git").mkdir(parents=True)
    (easelect_root / "VERSION_EASELECT").write_text("9.0.0\n", encoding="utf-8")
    (easelect_root / "VERSION_DB").write_text("9.6.7\n", encoding="utf-8")
    private_manifest = (
        easelect_root
        / "filterest_private/server_tools/versioning/app_db_compatibility.jsonl"
    )
    _write_manifest(private_manifest, "9.0.0", "9.6.7")

    paths = resolve_dev_status_paths(
        application_root,
        {
            "FILTEREST_APP_DB_COMPATIBILITY_MANIFEST": (
                "filterest_private/server_tools/versioning/app_db_compatibility.jsonl"
            )
        },
    )

    assert paths.embedded_easelect
    assert not paths.nested_standalone
    assert paths.project_root == easelect_root
    assert paths.version_root == easelect_root
    assert read_current_app_version(paths) == ("9.0.0", "VERSION_EASELECT")
    assert read_required_text(paths.db_version_path) == "9.6.7"
    assert paths.manifest_path == private_manifest
    assert read_current_manifest_row("9.0.0", paths)["target_db_version"] == "9.6.7"
    assert paths.storage_path == easelect_root / "storage"
    assert paths.storage_deleted_path == easelect_root / "storage_deleted"
    assert paths.shared_dev_storage_state_dir == (
        easelect_root / "data/shared_dev_storage"
    )


def test_legacy_flat_public_checkout_remains_root_local(tmp_path: Path) -> None:
    project_root = tmp_path / "legacy-filterest"
    _write_identity_files(project_root, "8.9.9", "9.6.6")
    manifest_path = project_root / "server_tools/versioning/app_db_compatibility.jsonl"
    _write_manifest(manifest_path, "8.9.9", "9.6.6")

    paths = resolve_dev_status_paths(project_root, {})

    assert not paths.embedded_easelect
    assert not paths.nested_standalone
    assert paths.project_root == project_root
    assert paths.version_root == project_root
    assert read_current_app_version(paths) == ("8.9.9", "VERSION_APP")
    assert paths.manifest_path == manifest_path
    assert paths.storage_path == project_root / "storage"
    assert paths.storage_deleted_path == project_root / "storage_deleted"
    assert paths.shared_dev_storage_state_dir == project_root / "data/shared_dev_storage"
