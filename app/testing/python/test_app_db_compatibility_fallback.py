"""Verify compatibility checks in a Gitless canonical Filterest source copy."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path


FILTEREST_ROOT = Path(__file__).resolve().parents[2]
VALIDATOR_PATH = (
    FILTEREST_ROOT / "server_tools" / "scripts" / "validate_app_db_compatibility.py"
)


def load_validator():
    spec = importlib.util.spec_from_file_location(
        "filterest_validate_app_db_compatibility",
        VALIDATOR_PATH,
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_public_bootstrap_fallback_needs_no_git_repository(tmp_path: Path) -> None:
    validator = load_validator()
    (tmp_path / "VERSION_APP").write_text("1.2.3\n", encoding="utf-8")
    (tmp_path / "VERSION_DB").write_text("4.5.6\n", encoding="utf-8")

    bootstrap_root = tmp_path / "server_tools" / "public_bootstrap"
    bootstrap_root.mkdir(parents=True)
    generated_files: dict[str, dict[str, str]] = {}
    for relative_path, content in (
        ("server_tools/public_bootstrap/schema.sql", "CREATE TABLE example ();\n"),
        ("server_tools/public_bootstrap/seed_data.sql", "-- empty seed\n"),
    ):
        artifact_path = tmp_path / relative_path
        artifact_path.write_text(content, encoding="utf-8")
        generated_files[relative_path] = {
            "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest()
        }

    (bootstrap_root / "manifest.json").write_text(
        json.dumps(
            {
                "artifact": "filterest-public-bootstrap",
                "format_version": 2,
                "app_version": "1.2.3",
                "db_version": "4.5.6",
                "generated_files": generated_files,
            }
        ),
        encoding="utf-8",
    )

    assert not (tmp_path / ".git").exists()
    assert validator.validate_manifest(tmp_path) == 0


def test_tracked_artifact_check_ignores_a_calling_repository_git_context(
    tmp_path: Path, monkeypatch
) -> None:
    """A hook in another repository must not make this repository's files look untracked."""
    import subprocess

    validator = load_validator()
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    artifact = repo / "snapshot.sql"
    artifact.write_text("-- schema\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", "snapshot.sql"], check=True)

    # `git commit -a` in a sibling repository exports its temporary index.
    other = tmp_path / "other"
    subprocess.run(["git", "init", "-q", str(other)], check=True)
    monkeypatch.setenv("GIT_INDEX_FILE", str(other / ".git" / "next-index.lock"))
    monkeypatch.setenv("GIT_DIR", str(other / ".git"))

    errors = validator.validate_repo_artifact_path(
        repo_root=repo,
        artifact_root=repo,
        manifest_path=repo / "manifest.jsonl",
        line_no=1,
        field_name="schema_snapshot_path",
        raw_path="snapshot.sql",
    )
    assert errors == []


def build_transition_source(tmp_path: Path, *, snapshot: bool, migration: bool) -> Path:
    """A source tree whose VERSION_DB is ahead of the published compatibility row."""
    root = tmp_path / "source"
    (root / "server_tools" / "migrations").mkdir(parents=True)
    (root / "server_tools" / "versioning" / "schema_snapshots").mkdir(parents=True)
    if snapshot:
        (root / "server_tools" / "versioning" / "schema_snapshots" / "db-4.5.7.sql").write_text(
            "CREATE TABLE example ();\n", encoding="utf-8"
        )
    if migration:
        (root / "server_tools" / "migrations" / "20260918000001_record_transition.sql").write_text(
            "-- VERSION_DB: 4.5.7\nSELECT 1;\n", encoding="utf-8"
        )
    return root


def test_reviewed_database_transition_is_accepted_before_its_release(tmp_path: Path) -> None:
    """The new VERSION_DB, its migrations and snapshot are committed before release preparation."""
    validator = load_validator()
    root = build_transition_source(tmp_path, snapshot=True, migration=True)

    state = validator.reviewed_db_transition_state(
        repo_root=root, artifact_root=root,
        published_db_version="4.5.6", source_db_version="4.5.7",
    )

    assert "4.5.6 -> 4.5.7" in state and "--db-transition-from 4.5.6" in state


def test_a_bare_version_mismatch_is_still_an_error(tmp_path: Path) -> None:
    validator = load_validator()

    without_migration = build_transition_source(tmp_path / "a", snapshot=True, migration=False)
    without_snapshot = build_transition_source(tmp_path / "b", snapshot=False, migration=True)
    complete = build_transition_source(tmp_path / "c", snapshot=True, migration=True)

    for root, published, source in (
        (without_migration, "4.5.6", "4.5.7"),
        (without_snapshot, "4.5.6", "4.5.7"),
        (complete, "4.5.7", "4.5.6"),
    ):
        assert validator.reviewed_db_transition_state(
            repo_root=root, artifact_root=root,
            published_db_version=published, source_db_version=source,
        ) == ""
