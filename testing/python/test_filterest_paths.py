"""Verify dynamic Filterest project/key homes and their safety boundaries."""

from __future__ import annotations

from pathlib import Path
import subprocess

import pytest

from server_tools.lib.filterest_paths import (
    audit_path_boundaries,
    relative_protected_homes,
    render_dockerignore_files,
    render_git_exclude,
    resolve_filterest_homes,
)


def _checkout(tmp_path: Path, *, private: bool = False) -> Path:
    root = tmp_path / "checkout"
    root.mkdir()
    if private:
        (root / ".git").mkdir()
        (root / "VERSION_EASELECT").write_text("test\n", encoding="utf-8")
    else:
        (root / "VERSION_APP").write_text("test\n", encoding="utf-8")
    return root


def test_private_and_public_project_defaults_remain_distinct(tmp_path: Path) -> None:
    private_root = _checkout(tmp_path, private=True)
    private_homes = resolve_filterest_homes(private_root, {})
    assert private_homes.projects_home == tmp_path / "filterest-projects"

    public_root = tmp_path / "public-checkout"
    public_root.mkdir()
    (public_root / "VERSION_APP").write_text("test\n", encoding="utf-8")
    public_homes = resolve_filterest_homes(public_root, {})
    assert public_homes.projects_home == public_root / "filterest_projects"


def test_relative_and_absolute_homes_are_resolved_dynamically(tmp_path: Path) -> None:
    root = _checkout(tmp_path)
    absolute_keys = tmp_path / "operator data" / "keys"
    locator = root / "filterest.paths.local"
    locator.write_text(
        "\n".join(
            (
                "schema_version=1",
                "projects_home=../shared/customer projects",
                f"keys_home={absolute_keys}",
                "",
            )
        ),
        encoding="utf-8",
    )
    locator.chmod(0o600)

    homes = resolve_filterest_homes(root, {})

    assert homes.projects_home == tmp_path / "shared/customer projects"
    assert homes.keys_home == absolute_keys
    assert homes.projects_home_configured
    assert homes.keys_home_configured


def test_environment_overrides_config_and_legacy_conflicts_fail(tmp_path: Path) -> None:
    root = _checkout(tmp_path, private=True)
    configured_keys = tmp_path / "configured-keys"
    environment_keys = tmp_path / "environment-keys"
    (root / "filterest.paths").write_text(
        f"keys_home={configured_keys}\nprojects_home=portable-projects\n",
        encoding="utf-8",
    )

    homes = resolve_filterest_homes(
        root,
        {
            "FILTEREST_KEYS_HOME": str(environment_keys),
            "FILTEREST_PROJECTS_HOME": "../../project-packages",
        },
    )
    assert homes.keys_home == environment_keys
    assert homes.projects_home == tmp_path.parent / "project-packages"

    with pytest.raises(ValueError, match="conflicts"):
        resolve_filterest_homes(
            root,
            {
                "FILTEREST_KEYS_HOME": str(environment_keys),
                "EASELECT_KEY_ROOT": str(configured_keys),
            },
        )


def test_local_locator_rejects_group_or_other_write_access(tmp_path: Path) -> None:
    root = _checkout(tmp_path)
    locator = root / "filterest.paths.local"
    locator.write_text(
        "projects_home=projects\nkeys_home=keys\n",
        encoding="utf-8",
    )
    locator.chmod(0o666)

    with pytest.raises(ValueError, match="writable by group or others"):
        resolve_filterest_homes(root, {})


@pytest.mark.parametrize(
    ("projects_home", "keys_home"),
    (
        (".", "../keys"),
        ("../projects", "."),
        (".git/projects", "../keys"),
        ("../projects", ".git/keys"),
        ("../shared", "../shared"),
        ("../shared", "../shared/keys"),
        ("../shared/projects", "../shared"),
        ("/", "../keys"),
        ("projects[prod]", "../keys"),
        ("../projects", "keys*"),
        ("projects\\prod", "../keys"),
        ("projects\nprod", "../keys"),
    ),
)
def test_dangerous_or_overlapping_homes_are_rejected(
    tmp_path: Path,
    projects_home: str,
    keys_home: str,
) -> None:
    root = _checkout(tmp_path)
    with pytest.raises(ValueError):
        resolve_filterest_homes(
            root,
            {
                "FILTEREST_PROJECTS_HOME": projects_home,
                "FILTEREST_KEYS_HOME": keys_home,
            },
        )


def test_child_homes_drive_dynamic_protection_and_dockerignore(tmp_path: Path) -> None:
    root = _checkout(tmp_path)
    (root / "docker").mkdir()
    for name in ("Dockerfile", "Dockerfile.dev", "Dockerfile.db"):
        (root / "docker" / name).write_text("FROM scratch\n", encoding="utf-8")
    (root / ".dockerignore").write_text("node_modules/\n", encoding="utf-8")

    homes = resolve_filterest_homes(
        root,
        {
            "FILTEREST_PROJECTS_HOME": "customer data/projects",
            "FILTEREST_KEYS_HOME": "private/runtime keys",
        },
    )

    assert relative_protected_homes(homes) == [
        "customer data/projects",
        "private/runtime keys",
    ]
    outputs = render_dockerignore_files(homes)
    assert len(outputs) == 3
    for output in outputs:
        text = output.read_text(encoding="utf-8")
        assert "/customer data/projects/**" in text
        assert "/private/runtime keys/**" in text
        assert "/filterest.paths.local" in text


def test_child_symlink_ancestor_is_protected_from_sync_deletion(tmp_path: Path) -> None:
    root = _checkout(tmp_path)
    external_home = tmp_path / "external-projects"
    external_home.mkdir()
    (root / "linked-projects").symlink_to(external_home, target_is_directory=True)
    homes = resolve_filterest_homes(
        root,
        {
            "FILTEREST_PROJECTS_HOME": "linked-projects/customer",
            "FILTEREST_KEYS_HOME": "../keys",
        },
    )

    assert homes.projects_home == external_home / "customer"
    assert relative_protected_homes(homes) == ["linked-projects"]


def test_dynamic_child_homes_are_added_to_local_git_exclude(tmp_path: Path) -> None:
    root = _checkout(tmp_path)
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    exclude_path = root / ".git" / "info" / "exclude"
    exclude_path.write_text("# keep operator rule\n*.operator\n", encoding="utf-8")
    homes = resolve_filterest_homes(
        root,
        {
            "FILTEREST_PROJECTS_HOME": "customer data/projects",
            "FILTEREST_KEYS_HOME": "private/runtime keys",
        },
    )

    rendered_path = render_git_exclude(homes)
    render_git_exclude(homes)

    assert rendered_path == exclude_path
    rendered = exclude_path.read_text(encoding="utf-8")
    assert rendered.count("# filterest-paths:begin") == 1
    assert "*.operator" in rendered
    assert "/customer data/projects/**" in rendered
    assert "/private/runtime keys/**" in rendered
    assert "/filterest.paths.local" in rendered


def test_boundary_audit_rejects_tracked_files_below_dynamic_home(tmp_path: Path) -> None:
    root = _checkout(tmp_path)
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    (root / "private data").mkdir()
    (root / "private data" / "secret.txt").write_text("not-a-real-secret\n", encoding="utf-8")
    subprocess.run(
        ["git", "-C", str(root), "add", "private data/secret.txt"],
        check=True,
    )
    homes = resolve_filterest_homes(
        root,
        {
            "FILTEREST_PROJECTS_HOME": "projects",
            "FILTEREST_KEYS_HOME": "private data",
        },
    )

    with pytest.raises(ValueError, match="tracked files"):
        audit_path_boundaries(homes)
