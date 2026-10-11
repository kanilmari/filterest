"""test_native_launcher_roots.py
Verify direct control, worker and Node launchers across installation layouts.
Connect native launchers with immutable source and installation-owned output.
Prevent runtime caches, logs and dependencies from entering application source.
"""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import stat
import subprocess

import pytest

from native_lifecycle_fixture import (
    SOURCE_ROOT,
    WORKER_LAUNCHER,
    clean_direct_launcher_environment,
    copy_ctl_probe,
    make_tree_read_only,
    parse_line_values,
    source_snapshot,
)


def test_direct_nested_ctl_writes_build_state_only_to_installation_runtime(
    tmp_path: Path,
) -> None:
    installation_root = tmp_path / "filterest"
    application_root = installation_root / "app"
    fake_bin = tmp_path / "fake-bin"
    fake_go_log = tmp_path / "fake-go.log"
    application_root.mkdir(parents=True)
    fake_bin.mkdir()
    (application_root / "go.mod").write_text("module filterest\n", encoding="utf-8")
    (application_root / "VERSION_APP").write_text("test\n", encoding="utf-8")
    copy_ctl_probe(application_root)
    fake_go = fake_bin / "go"
    fake_go.write_text(
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n"
        'mkdir -p "$GOMODCACHE/probe" "$GOCACHE/probe"\n'
        ': > "$GOMODCACHE/probe/module"\n'
        ': > "$GOCACHE/probe/build"\n'
        'printf "%s\\n" "$*" > "$FILTEREST_FAKE_GO_LOG"\n',
        encoding="utf-8",
    )
    fake_go.chmod(fake_go.stat().st_mode | stat.S_IXUSR)

    before = source_snapshot(application_root)
    make_tree_read_only(application_root)
    environment = clean_direct_launcher_environment()
    environment["PATH"] = f"{fake_bin}:{environment['PATH']}"
    environment["FILTEREST_FAKE_GO_LOG"] = str(fake_go_log)
    environment.update(
        {
            name: "/hostile/private-hook"
            for name in (
                "FILTEREST_RESOLVE_ENV_LIB",
                "FILTEREST_PRIVATE_BOOTSTRAP_LIB",
                "FILTEREST_LOCAL_DOCKER_COMPOSE_FILE",
                "FILTEREST_SHARED_DEV_STORAGE_HELPER",
                "FILTEREST_INSTANCE_DOCKER_ROOT",
                "FILTEREST_INSTANCE_TEMPLATE_PATH",
                "FILTEREST_SYNC_CONFIG_FILE",
                "FILTEREST_GO_BUILD_TARGET",
                "FILTEREST_GO_RUN_PROCESS_PATTERN",
                "FILTEREST_DB_TASK_PYTHON_MODULE",
                "FILTEREST_SCAFFOLD_EXTENSION_ROOT",
                "FILTEREST_SCAFFOLD_EXTENSION_ENV_SOURCES",
                "FILTEREST_SCAFFOLD_EXTENSION_ENV_TEMPLATES",
                "FILTEREST_MACHINE_TRANSFER_COMMAND",
                "FILTEREST_AUTOMATED_PREVIEW_INITIAL_ADMIN",
                "ALLOW_UNGUARDED_FILTEREST_PREVIEW_RECREATE",
                "ALLOW_INCOMPLETE_LOCAL_SETUP_RECREATE",
            )
        }
    )
    completed = subprocess.run(
        [str(application_root / "ctl"), "--probe"],
        cwd=tmp_path,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )

    values = parse_line_values(completed.stdout)
    runtime_root = installation_root / "data/runtime"
    assert values == {
        "project": str(installation_root),
        "build": str(application_root),
        "runtime": str(runtime_root),
        "log": str(runtime_root / "logs/server_output.log"),
        "node": str(runtime_root / "node/node_modules"),
        "gomod": str(runtime_root / "go/module-cache"),
        "gocache": str(runtime_root / "go/build-cache"),
        "pycache": str(runtime_root / "python-cache"),
    }
    assert fake_go_log.read_text(encoding="utf-8").strip() == f"build {application_root}"
    assert (runtime_root / "go/module-cache/probe/module").is_file()
    assert (runtime_root / "go/build-cache/probe/build").is_file()
    assert (runtime_root / "logs/server_output.log").is_file()
    assert source_snapshot(application_root) == before
    assert not (application_root / "runtime").exists()
    assert not (application_root / "server_output.log").exists()
    assert not (application_root / "node_modules").exists()


def test_direct_embedded_and_legacy_ctl_roots_remain_compatible(
    tmp_path: Path,
) -> None:
    embedded_root = tmp_path / "easelect"
    embedded_application = embedded_root / "filterest/app"
    legacy_application = tmp_path / "legacy-filterest"
    fake_bin = tmp_path / "fake-bin"
    fake_bin.mkdir()
    fake_go = fake_bin / "go"
    fake_go.write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")
    fake_go.chmod(fake_go.stat().st_mode | stat.S_IXUSR)

    for application_root in (embedded_application, legacy_application):
        application_root.mkdir(parents=True)
        (application_root / "go.mod").write_text(
            "module filterest\n", encoding="utf-8"
        )
        (application_root / "VERSION_APP").write_text("test\n", encoding="utf-8")
        copy_ctl_probe(application_root)
    (embedded_root / ".git").mkdir()
    (embedded_root / "VERSION_EASELECT").write_text("test\n", encoding="utf-8")

    embedded_before = source_snapshot(embedded_application)
    make_tree_read_only(embedded_application)
    environment = clean_direct_launcher_environment()
    environment["PATH"] = f"{fake_bin}:{environment['PATH']}"
    embedded = subprocess.run(
        [str(embedded_application / "ctl"), "--probe"],
        cwd=tmp_path,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    embedded_values = parse_line_values(embedded.stdout)
    assert embedded_values == {
        "project": str(embedded_root),
        "build": str(embedded_root),
        "runtime": str(embedded_root / "runtime"),
        "log": str(embedded_root / "server_output.log"),
        "node": "unset",
        "gomod": "unset",
        "gocache": "unset",
        "pycache": str(embedded_root / "runtime/python-cache"),
    }
    assert source_snapshot(embedded_application) == embedded_before

    legacy = subprocess.run(
        [str(legacy_application / "ctl"), "--probe"],
        cwd=tmp_path,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    legacy_values = parse_line_values(legacy.stdout)
    assert legacy_values == {
        "project": str(legacy_application),
        "build": str(legacy_application),
        "runtime": str(legacy_application / "runtime"),
        "log": str(legacy_application / "server_output.log"),
        "node": "unset",
        "gomod": "unset",
        "gocache": "unset",
        "pycache": str(legacy_application / "runtime/python-cache"),
    }


def test_direct_nested_worker_uses_installation_owned_output_roots(
    tmp_path: Path,
) -> None:
    installation_root = tmp_path / "filterest"
    application_root = installation_root / "app"
    worker_core = (
        application_root
        / "server_tools/agent_tools/worker_agent/worker_agent_core.sh"
    )
    worker_core.parent.mkdir(parents=True)
    shutil.copy2(WORKER_LAUNCHER, application_root / "worker_agent")
    helper = application_root / "server_tools/lib/python_bytecode_cache.sh"
    helper.parent.mkdir(parents=True)
    shutil.copy2(SOURCE_ROOT / "server_tools/lib/python_bytecode_cache.sh", helper)
    (application_root / "go.mod").write_text("module filterest\n", encoding="utf-8")
    (application_root / "VERSION_APP").write_text("test\n", encoding="utf-8")
    worker_core.write_text(
        """#!/usr/bin/env bash
printf 'workspace=%s\nruntime=%s\noutput=%s\nlegacy=%s\npycache=%s\nroutine=%s\nroutines=%s\n' \
    "$FILTEREST_WORKSPACE_ROOT" "$FILTEREST_RUNTIME_ROOT_OVERRIDE" \
    "$FILTEREST_WORKER_OUTPUT_DIR_REL" "$FILTEREST_WORKER_LEGACY_OUTPUT_DIR_REL" \
    "$PYTHONPYCACHEPREFIX" "${FILTEREST_WORKER_ROUTINE_RUNNER:-unset}" \
    "${FILTEREST_WORKER_ROUTINES_DIR:-unset}"
""",
        encoding="utf-8",
    )

    before = source_snapshot(application_root)
    make_tree_read_only(application_root)
    completed = subprocess.run(
        [str(application_root / "worker_agent"), "--probe"],
        cwd=tmp_path,
        env={
            **clean_direct_launcher_environment(),
            "FILTEREST_WORKER_ROUTINE_RUNNER": "/hostile/private-routine.sh",
            "FILTEREST_WORKER_ROUTINES_DIR": "/hostile/private-routines",
        },
        check=True,
        capture_output=True,
        text=True,
    )

    runtime_root = installation_root / "data/runtime"
    assert parse_line_values(completed.stdout) == {
        "workspace": str(installation_root),
        "runtime": str(runtime_root),
        "output": "data/runtime/agent_tasks/_artifacts/worker_runs",
        "legacy": "data/runtime/agent_tasks/20_in_progress",
        "pycache": str(runtime_root / "python-cache"),
        "routine": "unset",
        "routines": "unset",
    }
    assert source_snapshot(application_root) == before
    assert not (application_root / "agent_tasks").exists()


def test_fresh_nested_development_layout_runs_root_node_commands_without_app_bridge(
    tmp_path: Path,
) -> None:
    if shutil.which("node") is None or shutil.which("npm") is None:
        pytest.skip("Node.js and npm are required for the development profile")

    installation_root = tmp_path / "filterest"
    app_root = installation_root / "app"
    runtime_modules = installation_root / "data/runtime/node/node_modules"
    (app_root / "server_tools/scripts").mkdir(parents=True)
    (runtime_modules / ".bin").mkdir(parents=True)

    probe_binary = runtime_modules / ".bin/filterest-node-probe"
    probe_binary.write_text(
        "#!/usr/bin/env bash\n"
        "test \"$FILTEREST_NODE_MODULES_ROOT\" = \"${0%/.bin/filterest-node-probe}\"\n"
        "printf '%s\\n' runtime-bin-ok\n",
        encoding="utf-8",
    )
    probe_binary.chmod(probe_binary.stat().st_mode | stat.S_IXUSR)
    (runtime_modules / "vitest").mkdir()
    (runtime_modules / "vitest/vitest.mjs").write_text(
        "console.log('runtime-vitest-ok');\n", encoding="utf-8"
    )
    shutil.copy2(
        SOURCE_ROOT / "server_tools/scripts/vitest_process_runner.mjs",
        app_root / "server_tools/scripts/vitest_process_runner.mjs",
    )
    shutil.copy2(
        SOURCE_ROOT / "server_tools/scripts/vitest_process_config.mjs",
        app_root / "server_tools/scripts/vitest_process_config.mjs",
    )
    (app_root / "server_tools/lib").mkdir()
    shutil.copy2(
        SOURCE_ROOT / "server_tools/lib/python_bytecode_cache.sh",
        app_root / "server_tools/lib/python_bytecode_cache.sh",
    )
    shutil.copy2(
        SOURCE_ROOT / "server_tools/lib/project_python_venv.sh",
        app_root / "server_tools/lib/project_python_venv.sh",
    )
    shutil.copy2(
        SOURCE_ROOT / "server_tools/lib/installation_records.sh",
        app_root / "server_tools/lib/installation_records.sh",
    )
    (app_root / "package.json").write_text(
        json.dumps(
            {
                "name": "filterest-fresh-layout-probe",
                "type": "module",
                "scripts": {
                    "build": "filterest-node-probe",
                    "test": "node server_tools/scripts/vitest_process_runner.mjs run",
                },
            }
        ),
        encoding="utf-8",
    )
    shutil.copy2(SOURCE_ROOT / "filterest", app_root / "filterest")
    shutil.copy2(SOURCE_ROOT.parent / "filterest", installation_root / "filterest")
    (app_root / "go.mod").write_text("module filterest\n", encoding="utf-8")
    (app_root / "VERSION_APP").write_text("test\n", encoding="utf-8")

    before = source_snapshot(app_root)
    for path in sorted(app_root.rglob("*"), reverse=True):
        path.chmod(path.stat().st_mode & ~0o222)
    app_root.chmod(app_root.stat().st_mode & ~0o222)

    for command, expected in (
        ("build", "runtime-bin-ok"),
        ("test-unit", "runtime-vitest-ok"),
    ):
        completed = subprocess.run(
            [str(installation_root / "filterest"), command],
            cwd=tmp_path,
            check=True,
            capture_output=True,
            text=True,
        )
        assert expected in completed.stdout

    assert not (app_root / "node_modules").exists()
    assert source_snapshot(app_root) == before


def test_public_gitignore_defensively_ignores_accidental_app_node_modules(
    tmp_path: Path,
) -> None:
    installation_root = tmp_path / "filterest"
    app_root = installation_root / "app"
    runtime_modules = installation_root / "data/runtime/node/node_modules"
    app_root.mkdir(parents=True)
    runtime_modules.mkdir(parents=True)
    shutil.copy2(SOURCE_ROOT.parent / ".gitignore", installation_root / ".gitignore")
    (app_root / "VERSION_APP").write_text("9.0.0\n", encoding="utf-8")

    subprocess.run(["git", "init", "-q", str(installation_root)], check=True)
    subprocess.run(
        ["git", "config", "user.name", "Lifecycle Test"],
        cwd=installation_root,
        check=True,
    )
    subprocess.run(
        ["git", "config", "user.email", "lifecycle@example.invalid"],
        cwd=installation_root,
        check=True,
    )
    subprocess.run(
        ["git", "add", ".gitignore", "app/VERSION_APP"],
        cwd=installation_root,
        check=True,
    )
    subprocess.run(
        ["git", "commit", "-qm", "fixture"], cwd=installation_root, check=True
    )

    (app_root / "node_modules").mkdir()
    (app_root / "node_modules/accidental-cache").write_text(
        "must not enter source control\n", encoding="utf-8"
    )

    assert "node_modules/" in (
        installation_root / ".gitignore"
    ).read_text(encoding="utf-8").splitlines()
    assert subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=installation_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout == ""
