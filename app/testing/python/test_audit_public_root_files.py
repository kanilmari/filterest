"""Protect the curated Filterest repository-root contract.

Bridges the reviewed root list with the audit that `./filterest release build`
runs. Exists so a new root file cannot ship without its reviewed entry.
"""

from pathlib import Path

from server_tools.release import audit_public_root_files as audit


def test_default_manifest_keeps_application_files_under_app() -> None:
    root_files = audit.read_manifest(audit.DEFAULT_MANIFEST)

    assert ".dockerignore" in root_files
    assert "compose.yml" in root_files
    assert "filterest" in root_files
    assert "README.md" in root_files
    assert "VERSION_APP" not in root_files
    assert "BUILD_IDENTITY.json" not in root_files
    assert "go.mod" not in root_files
    assert "package.json" not in root_files


def create_reviewed_root(tmp_path: Path) -> tuple[Path, Path]:
    target = tmp_path / "filterest"
    target.mkdir()
    manifest = tmp_path / "root-files.txt"
    manifest.write_text("README.md\nVERSION_APP\nctl\n", encoding="utf-8")
    for filename in ("README.md", "VERSION_APP", "ctl"):
        (target / filename).write_text("test\n", encoding="utf-8")
    return target, manifest


def test_reviewed_root_passes(tmp_path: Path) -> None:
    target, manifest = create_reviewed_root(tmp_path)

    missing, unexpected = audit.audit_root_files(target, manifest)

    assert missing == []
    assert unexpected == []


def test_missing_root_file_fails_closed(tmp_path: Path) -> None:
    target, manifest = create_reviewed_root(tmp_path)
    (target / "ctl").unlink()

    missing, unexpected = audit.audit_root_files(target, manifest)

    assert missing == ["ctl"]
    assert unexpected == []


def test_unreviewed_root_file_fails_closed(tmp_path: Path) -> None:
    target, manifest = create_reviewed_root(tmp_path)
    (target / "temporary-report.txt").write_text("test\n", encoding="utf-8")

    missing, unexpected = audit.audit_root_files(target, manifest)

    assert missing == []
    assert unexpected == ["temporary-report.txt"]


def test_manifest_rejects_nested_paths(tmp_path: Path) -> None:
    manifest = tmp_path / "root-files.txt"
    manifest.write_text("docs/publication/report.md\n", encoding="utf-8")

    try:
        audit.read_manifest(manifest)
    except ValueError as error:
        assert "one filename" in str(error)
    else:
        raise AssertionError("nested root manifest entry was accepted")


def test_default_target_is_this_installation_root() -> None:
    installation_root = Path(__file__).resolve().parents[3]

    assert audit.DEFAULT_TARGET == installation_root
    assert audit.DEFAULT_MANIFEST.parent == installation_root / "app/server_tools/release"
    assert set(audit.read_manifest()) >= {"filterest", "ctl", "db", "api_crud"}
