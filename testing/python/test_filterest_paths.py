"""Verify dynamic Filterest external homes and their safety boundaries."""

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
    resolve_project_source_path,
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
    assert private_homes.runtime_data_home == tmp_path / "filterest-runtime-data"
    assert private_homes.maintainer_tools_home == tmp_path / "filterest-maintainer-tools"
    assert private_homes.operations_home == tmp_path / "filterest-operations"
    assert private_homes.projects_apps_home == tmp_path / "filterest-projects/apps"

    public_root = tmp_path / "public-checkout"
    public_root.mkdir()
    (public_root / "VERSION_APP").write_text("test\n", encoding="utf-8")
    public_homes = resolve_filterest_homes(public_root, {})
    assert public_homes.projects_home == public_root / "filterest_projects"
    assert public_homes.runtime_data_home == public_root / "filterest_runtime_data"
    assert public_homes.maintainer_tools_home == public_root / "filterest_maintainer_tools"
    assert public_homes.operations_home == public_root / "filterest_operations"


def test_relative_and_absolute_homes_are_resolved_dynamically(tmp_path: Path) -> None:
    root = _checkout(tmp_path)
    absolute_keys = tmp_path / "operator data" / "keys"
    absolute_runtime = tmp_path / "operator data" / "runtime"
    absolute_maintainer = tmp_path / "operator data" / "maintainer"
    absolute_operations = tmp_path / "operator data" / "operations"
    locator = root / "filterest.paths.local"
    locator.write_text(
        "\n".join(
            (
                "schema_version=1",
                "projects_home=../shared/customer projects",
                f"keys_home={absolute_keys}",
                f"runtime_data_home={absolute_runtime}",
                f"maintainer_tools_home={absolute_maintainer}",
                f"operations_home={absolute_operations}",
                "",
            )
        ),
        encoding="utf-8",
    )
    locator.chmod(0o600)

    homes = resolve_filterest_homes(root, {})

    assert homes.projects_home == tmp_path / "shared/customer projects"
    assert homes.keys_home == absolute_keys
    assert homes.runtime_data_home == absolute_runtime
    assert homes.maintainer_tools_home == absolute_maintainer
    assert homes.operations_home == absolute_operations
    assert homes.projects_home_configured
    assert homes.keys_home_configured
    assert homes.runtime_data_home_configured
    assert homes.maintainer_tools_home_configured
    assert homes.operations_home_configured


def test_calculated_shell_exports_remain_defaults_in_direct_python_resolution(
    tmp_path: Path,
) -> None:
    root = _checkout(tmp_path)
    homes = resolve_filterest_homes(
        root,
        {
            "FILTEREST_PROJECTS_HOME": str(root / "filterest_projects"),
            "FILTEREST_KEYS_HOME": str(root / "filterest_keys"),
            "FILTEREST_RUNTIME_DATA_HOME": str(root / "filterest_runtime_data"),
            "FILTEREST_MAINTAINER_TOOLS_HOME": str(
                root / "filterest_maintainer_tools"
            ),
            "FILTEREST_OPERATIONS_HOME": str(root / "filterest_operations"),
            "FILTEREST_PROJECTS_HOME_CONFIGURED": "0",
            "FILTEREST_KEYS_HOME_CONFIGURED": "0",
            "FILTEREST_RUNTIME_DATA_HOME_CONFIGURED": "0",
            "FILTEREST_MAINTAINER_TOOLS_HOME_CONFIGURED": "0",
            "FILTEREST_OPERATIONS_HOME_CONFIGURED": "0",
        },
    )

    assert not homes.projects_home_configured
    assert not homes.keys_home_configured
    assert not homes.runtime_data_home_configured
    assert not homes.maintainer_tools_home_configured
    assert not homes.operations_home_configured


def test_environment_overrides_config_and_legacy_conflicts_fail(tmp_path: Path) -> None:
    root = _checkout(tmp_path, private=True)
    configured_keys = tmp_path / "configured-keys"
    environment_keys = tmp_path / "environment-keys"
    environment_runtime = tmp_path / "environment-runtime"
    environment_maintainer = tmp_path / "environment-maintainer"
    environment_operations = tmp_path / "environment-operations"
    (root / "filterest.paths").write_text(
        f"keys_home={configured_keys}\nprojects_home=portable-projects\n",
        encoding="utf-8",
    )

    homes = resolve_filterest_homes(
        root,
        {
            "FILTEREST_KEYS_HOME": str(environment_keys),
            "FILTEREST_PROJECTS_HOME": "../../project-packages",
            "FILTEREST_RUNTIME_DATA_HOME": str(environment_runtime),
            "FILTEREST_MAINTAINER_TOOLS_HOME": str(environment_maintainer),
            "FILTEREST_OPERATIONS_HOME": str(environment_operations),
        },
    )
    assert homes.keys_home == environment_keys
    assert homes.projects_home == tmp_path.parent / "project-packages"
    assert homes.runtime_data_home == environment_runtime
    assert homes.maintainer_tools_home == environment_maintainer
    assert homes.operations_home == environment_operations

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


@pytest.mark.parametrize(
    ("projects_home", "keys_home", "runtime_data_home"),
    (
        ("../shared", "../shared/keys", "../runtime"),
        ("../projects", "../shared", "../shared/runtime"),
        ("../projects", "../keys", "../projects/runtime"),
        ("../projects", "../keys", "../keys/runtime"),
        ("../projects", "../keys", "."),
        ("../projects", "../keys", ".git/runtime"),
        ("../projects", "../keys", "/"),
    ),
)
def test_runtime_home_rejects_overlap_checkout_and_git_metadata(
    tmp_path: Path,
    projects_home: str,
    keys_home: str,
    runtime_data_home: str,
) -> None:
    root = _checkout(tmp_path)

    with pytest.raises(ValueError):
        resolve_filterest_homes(
            root,
            {
                "FILTEREST_PROJECTS_HOME": projects_home,
                "FILTEREST_KEYS_HOME": keys_home,
                "FILTEREST_RUNTIME_DATA_HOME": runtime_data_home,
            },
        )


@pytest.mark.parametrize(
    "maintainer_tools_home",
    (
        ".",
        ".git/maintainer",
        "../projects/tools",
        "../keys/tools",
        "../runtime/tools",
        "/",
    ),
)
def test_maintainer_home_rejects_overlap_checkout_and_git_metadata(
    tmp_path: Path,
    maintainer_tools_home: str,
) -> None:
    root = _checkout(tmp_path)

    with pytest.raises(ValueError):
        resolve_filterest_homes(
            root,
            {
                "FILTEREST_PROJECTS_HOME": "../projects",
                "FILTEREST_KEYS_HOME": "../keys",
                "FILTEREST_RUNTIME_DATA_HOME": "../runtime",
                "FILTEREST_MAINTAINER_TOOLS_HOME": maintainer_tools_home,
            },
        )


@pytest.mark.parametrize(
    "operations_home",
    (
        ".",
        ".git/operations",
        "../projects/operations",
        "../keys/operations",
        "../runtime/operations",
        "../maintainer/operations",
        "/",
    ),
)
def test_operations_home_rejects_overlap_checkout_and_git_metadata(
    tmp_path: Path,
    operations_home: str,
) -> None:
    root = _checkout(tmp_path)

    with pytest.raises(ValueError):
        resolve_filterest_homes(
            root,
            {
                "FILTEREST_PROJECTS_HOME": "../projects",
                "FILTEREST_KEYS_HOME": "../keys",
                "FILTEREST_RUNTIME_DATA_HOME": "../runtime",
                "FILTEREST_MAINTAINER_TOOLS_HOME": "../maintainer",
                "FILTEREST_OPERATIONS_HOME": operations_home,
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
            "FILTEREST_RUNTIME_DATA_HOME": "mutable/runtime data",
            "FILTEREST_MAINTAINER_TOOLS_HOME": "private/maintainer tools",
            "FILTEREST_OPERATIONS_HOME": "private/operations",
        },
    )

    assert relative_protected_homes(homes) == [
        "customer data/projects",
        "private/runtime keys",
        "mutable/runtime data",
        "private/maintainer tools",
        "private/operations",
    ]
    outputs = render_dockerignore_files(homes)
    assert len(outputs) == 3
    for output in outputs:
        text = output.read_text(encoding="utf-8")
        assert "/customer data/projects/**" in text
        assert "/private/runtime keys/**" in text
        assert "/mutable/runtime data/**" in text
        assert "/private/maintainer tools/**" in text
        assert "/private/operations/**" in text
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
            "FILTEREST_RUNTIME_DATA_HOME": "../runtime-data",
            "FILTEREST_MAINTAINER_TOOLS_HOME": "../maintainer-tools",
            "FILTEREST_OPERATIONS_HOME": "../operations",
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
            "FILTEREST_RUNTIME_DATA_HOME": "mutable/runtime data",
            "FILTEREST_MAINTAINER_TOOLS_HOME": "private/maintainer tools",
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
    assert "/mutable/runtime data/**" in rendered
    assert "/private/maintainer tools/**" in rendered
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


def test_runtime_home_is_included_in_tracked_boundary_audit(tmp_path: Path) -> None:
    root = _checkout(tmp_path)
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    (root / "runtime data").mkdir()
    (root / "runtime data" / "must-stay-untracked.txt").write_text(
        "synthetic\n", encoding="utf-8"
    )
    subprocess.run(
        ["git", "-C", str(root), "add", "-f", "runtime data/must-stay-untracked.txt"],
        check=True,
    )
    homes = resolve_filterest_homes(
        root,
        {
            "FILTEREST_PROJECTS_HOME": "../projects",
            "FILTEREST_KEYS_HOME": "../keys",
            "FILTEREST_RUNTIME_DATA_HOME": "runtime data",
        },
    )

    with pytest.raises(ValueError, match="runtime-data home"):
        audit_path_boundaries(homes)


def test_project_source_prefers_apps_target_and_preserves_legacy_alias(
    tmp_path: Path,
) -> None:
    root = _checkout(tmp_path)
    projects_home = tmp_path / "projects"
    legacy = projects_home / "regfetch"
    legacy.mkdir(parents=True)
    homes = resolve_filterest_homes(
        root,
        {
            "FILTEREST_PROJECTS_HOME": str(projects_home),
            "FILTEREST_KEYS_HOME": str(tmp_path / "keys"),
            "FILTEREST_RUNTIME_DATA_HOME": str(tmp_path / "runtime"),
        },
    )

    legacy_resolution = resolve_project_source_path(homes, "regfetch")
    assert legacy_resolution.selected_path == legacy
    assert legacy_resolution.state == "legacy_alias"
    assert legacy_resolution.requires_move

    target = projects_home / "apps/regfetch"
    target.mkdir(parents=True)
    target_resolution = resolve_project_source_path(homes, "regfetch")
    assert target_resolution.selected_path == target
    assert target_resolution.state == "target_and_legacy_conflict"
    assert not target_resolution.requires_move


@pytest.mark.parametrize("slug", ("", "../regfetch", "RegFetch", "reg_fetch", "-demo"))
def test_project_source_rejects_unsafe_or_noncanonical_slugs(
    tmp_path: Path, slug: str
) -> None:
    homes = resolve_filterest_homes(_checkout(tmp_path), {})

    with pytest.raises(ValueError, match="invalid project slug"):
        resolve_project_source_path(homes, slug)


def test_cli_diagnostics_append_runtime_and_target_apps_without_reordering_legacy_lines(
    tmp_path: Path,
) -> None:
    root = _checkout(tmp_path)
    completed = subprocess.run(
        [
            "python3",
            str(Path(__file__).resolve().parents[2] / "server_tools/lib/filterest_paths.py"),
            "--project-root",
            str(root),
            "--format",
            "lines",
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    lines = completed.stdout.splitlines()
    assert lines[:4] == [
        str(root / "filterest_projects"),
        str(root / "filterest_keys"),
        "0",
        "0",
    ]
    assert lines[4:] == [
        str(root / "filterest_runtime_data"),
        "0",
        str(root / "filterest_projects/apps"),
        str(root / "filterest_maintainer_tools"),
        "0",
        str(root / "filterest_operations"),
        "0",
    ]


def test_private_deploy_packages_panel_from_operations_home() -> None:
    deploy = (
        Path(__file__).resolve().parents[2] / "server_tools/deploy_to_production.sh"
    ).read_text(encoding="utf-8")

    assert 'INSTANCE_CONTROL_PANEL_SOURCE="${FILTEREST_OPERATIONS_HOME}/instance_control_panel"' in deploy
    assert '"${INSTANCE_CONTROL_PANEL_SOURCE}/"' in deploy
    assert '"${PROJECT_ROOT}/apps/instance_control_panel/"' not in deploy
