"""Regression coverage for immutable app and mutable installation lifecycle roots.
Bridges standalone lifecycle commands with their source and operator-owned storage boundaries.
Exists so starts, stops, imports, and generated state preserve the installation layout.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess

import pytest


SOURCE_ROOT = Path(__file__).resolve().parents[2]
INSTALLER = SOURCE_ROOT / "server_tools/install_filterest.sh"
UPDATER = SOURCE_ROOT / "server_tools/update_filterest.sh"
ADMIN_RUNNER = SOURCE_ROOT / "server_tools/run_filterest_admin.sh"
SETUP = SOURCE_ROOT / "server_tools/setup_local_dev_environment.sh"
SOURCE_DEPENDENCY_INSTALLER = (
    SOURCE_ROOT / "server_tools/lib/source_dependency_installer.sh"
)
SETUP_RUNTIME_PATHS = SOURCE_ROOT / "server_tools/lib/setup_runtime_paths.sh"
SCAFFOLD = SOURCE_ROOT / "server_tools/scaffold.sh"
CTL_LAUNCHER = SOURCE_ROOT / "ctl"
WORKER_LAUNCHER = SOURCE_ROOT / "worker_agent"


def source_snapshot(root: Path) -> dict[str, str]:
    """Return stable content evidence for every immutable source file."""

    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def copy_scaffold_contract(installation_root: Path) -> Path:
    """Create the smallest nested install that can exercise scaffold setup."""

    app_root = installation_root / "app"
    for relative_path in (
        "server_tools/scaffold.sh",
        "server_tools/ctl/lib/env_permissions.sh",
        "server_tools/lib/easelect_private_paths.sh",
        "server_tools/lib/filterest_paths.py",
    ):
        destination = app_root / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SOURCE_ROOT / relative_path, destination)
    shutil.copy2(SOURCE_ROOT / ".env.example", app_root / ".env.example")
    shutil.copy2(SOURCE_ROOT / "go.mod", app_root / "go.mod")
    shutil.copy2(SOURCE_ROOT / "VERSION_APP", app_root / "VERSION_APP")
    return app_root


def clean_filterest_environment(installation_root: Path) -> dict[str, str]:
    environment = os.environ.copy()
    for name in tuple(environment):
        if name.startswith("FILTEREST_") or name == "EASELECT_KEY_ROOT":
            environment.pop(name, None)
    environment.update(
        {
            "FILTEREST_ROOT": str(installation_root),
            "FILTEREST_PROJECT_ROOT_OVERRIDE": str(installation_root),
        }
    )
    return environment


def clean_direct_launcher_environment() -> dict[str, str]:
    """Remove caller state that could hide a launcher's derived layout."""

    environment = os.environ.copy()
    for name in tuple(environment):
        if name.startswith("FILTEREST_") or name in {
            "APP_PORT",
            "EASELECT_PORT",
            "GOCACHE",
            "GOMODCACHE",
            "GOWORK",
            "NODE_PATH",
            "PORT",
            "PYTHONPYCACHEPREFIX",
            "VITE_DEV_PORT",
            "VITE_HMR_PORT",
        }:
            environment.pop(name, None)
    return environment


def make_tree_read_only(root: Path) -> None:
    """Remove write bits from a synthetic immutable application tree."""

    for path in sorted(root.rglob("*"), reverse=True):
        path.chmod(path.stat().st_mode & ~0o222)
    root.chmod(root.stat().st_mode & ~0o222)


def copy_ctl_probe(application_root: Path) -> None:
    """Install the real app launcher around a minimal lifecycle probe."""

    shutil.copy2(CTL_LAUNCHER, application_root / "ctl")
    helper = application_root / "server_tools/lib/python_bytecode_cache.sh"
    helper.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE_ROOT / "server_tools/lib/python_bytecode_cache.sh", helper)
    resolver = application_root / "server_tools/ctl/lib/resolve_env.sh"
    resolver.parent.mkdir(parents=True, exist_ok=True)
    resolver.write_text(
        'cd "$PROJECT_ROOT"\nexport PROJECT_ROOT\n',
        encoding="utf-8",
    )
    ctl_main = application_root / "server_tools/ctl/ctl_main.sh"
    ctl_main.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
for private_hook in \
    FILTEREST_RESOLVE_ENV_LIB FILTEREST_PRIVATE_BOOTSTRAP_LIB \
    FILTEREST_LOCAL_DOCKER_COMPOSE_FILE FILTEREST_SHARED_DEV_STORAGE_HELPER \
    FILTEREST_INSTANCE_DOCKER_ROOT FILTEREST_INSTANCE_TEMPLATE_PATH \
    FILTEREST_SYNC_CONFIG_FILE FILTEREST_GO_BUILD_TARGET \
    FILTEREST_GO_RUN_PROCESS_PATTERN FILTEREST_QUEEN_PYTHON_MODULE \
    FILTEREST_DB_TASK_PYTHON_MODULE FILTEREST_SCAFFOLD_EXTENSION_ROOT \
    FILTEREST_SCAFFOLD_EXTENSION_ENV_SOURCES \
    FILTEREST_SCAFFOLD_EXTENSION_ENV_TEMPLATES \
    FILTEREST_MACHINE_TRANSFER_COMMAND FILTEREST_AUTOMATED_PREVIEW_INITIAL_ADMIN \
    ALLOW_UNGUARDED_FILTEREST_PREVIEW_RECREATE \
    ALLOW_INCOMPLETE_LOCAL_SETUP_RECREATE; do
    if [[ -n "${!private_hook+x}" ]]; then
        printf 'inherited private hook: %s\n' "$private_hook" >&2
        exit 90
    fi
done
project_root="${FILTEREST_PROJECT_ROOT_OVERRIDE:-$PWD}"
build_root="${FILTEREST_BUILD_ROOT_OVERRIDE:-$project_root}"
runtime_root="${FILTEREST_RUNTIME_ROOT_OVERRIDE:-$project_root/runtime}"
log_file="${FILTEREST_LOG_FILE_OVERRIDE:-$project_root/server_output.log}"
mkdir -p "$runtime_root/bin" "$(dirname "$log_file")"
go build "$build_root"
: > "$log_file"
printf 'project=%s\nbuild=%s\nruntime=%s\nlog=%s\nnode=%s\n' \
    "$project_root" "$build_root" "$runtime_root" "$log_file" \
    "${FILTEREST_NODE_MODULES_ROOT:-unset}"
printf 'gomod=%s\ngocache=%s\npycache=%s\n' \
    "${GOMODCACHE:-unset}" "${GOCACHE:-unset}" "$PYTHONPYCACHEPREFIX"
""",
        encoding="utf-8",
    )
    ctl_main.chmod(ctl_main.stat().st_mode | stat.S_IXUSR)


def parse_line_values(output: str) -> dict[str, str]:
    """Parse a small key=value launcher probe without shell evaluation."""

    return dict(line.split("=", maxsplit=1) for line in output.splitlines())


def test_preview_port_guard_precedes_broad_local_cleanup() -> None:
    common = (SOURCE_ROOT / "server_tools/ctl/lib/common.sh").read_text(
        encoding="utf-8"
    )
    local = (SOURCE_ROOT / "server_tools/ctl/lib/local.sh").read_text(
        encoding="utf-8"
    )

    guard = '${FILTEREST_REFUSE_OCCUPIED_PORT:-0}'
    assert guard in common
    assert common.index(guard) < common.index('stop_all\n')
    assert guard in local
    assert local.index(guard) < local.index('_vite_dev_server_is_ready "$vite_port"')


def test_standalone_native_build_does_not_require_git_metadata() -> None:
    """Keep a transferred Gitless installation buildable through root ctl."""

    local = (SOURCE_ROOT / "server_tools/ctl/lib/local.sh").read_text(
        encoding="utf-8"
    )

    standalone_guard = "if filterest_uses_standalone_root_ctl; then"
    vcs_flag = 'go_build_args=(-buildvcs=false "${go_build_args[@]}")'
    build = 'go build "${go_build_args[@]}" "${FILTEREST_GO_BUILD_TARGET:-.}"'
    assert standalone_guard in local
    assert vcs_flag in local
    assert build in local
    assert local.index(standalone_guard) < local.index(vcs_flag) < local.index(build)


def test_runtime_node_tool_launchers_do_not_fall_back_to_npx_downloads() -> None:
    safe_test = (SOURCE_ROOT / "server_tools/scripts/safe_test.sh").read_text(
        encoding="utf-8"
    )
    guardian = (SOURCE_ROOT / "server_tools/scripts/guardian.sh").read_text(
        encoding="utf-8"
    )
    qa = (SOURCE_ROOT / "server_tools/scripts/qa.sh").read_text(encoding="utf-8")
    browser_audit = (
        SOURCE_ROOT / "server_tools/scripts/browser_audit.mjs"
    ).read_text(encoding="utf-8")

    for source in (safe_test, guardian, qa):
        assert "npx playwright" not in source
    assert "npx eslint" not in qa
    assert 'spawnSync("npx"' not in browser_audit
    assert 'spawnSync("lighthouse", args' in browser_audit


def test_nested_scaffold_writes_only_mutable_installation_siblings(tmp_path: Path) -> None:
    installation_root = tmp_path / "filterest"
    installation_root.mkdir()
    subprocess.run(["git", "init", "-q", str(installation_root)], check=True)
    app_root = copy_scaffold_contract(installation_root)
    before = source_snapshot(app_root)

    completed = subprocess.run(
        ["bash", str(app_root / "server_tools/scaffold.sh"), "setup"],
        cwd=tmp_path,
        env=clean_filterest_environment(installation_root),
        check=True,
        capture_output=True,
        text=True,
    )

    assert "Alustus valmis" in completed.stdout
    assert source_snapshot(app_root) == before
    for mutable_root in ("config", "keys", "projects", "data", "backups"):
        assert (installation_root / mutable_root).is_dir()
        assert stat.S_IMODE((installation_root / mutable_root).stat().st_mode) == 0o700
    assert (installation_root / "data/runtime/bin").is_dir()
    assert (installation_root / "data/runtime/logs").is_dir()
    assert (installation_root / "data/bootstrap").is_dir()
    assert stat.S_IMODE((installation_root / "data/bootstrap").stat().st_mode) == 0o700
    assert (installation_root / "data/storage").is_dir()
    assert (installation_root / "data/storage_deleted").is_dir()
    assert (installation_root / "config/filterest.paths").read_text(
        encoding="utf-8"
    ) == (
        "schema_version=1\n"
        "projects_home=projects\n"
        "keys_home=keys\n"
        "runtime_data_home=data/runtime\n"
        "maintainer_tools_home=data/maintainer_tools\n"
        "operations_home=data/operations\n"
    )
    assert (
        installation_root / "keys/filterest_runtime/runtime_environment.env"
    ).is_file()
    assert (
        installation_root / "keys/filterest_runtime/development_environment.env"
    ).is_file()
    for forbidden_root_entry in (".env", "dev_env.txt", "runtime", "storage", "storage_deleted", "testing"):
        assert not (installation_root / forbidden_root_entry).exists()


def test_nested_installer_dry_run_preserves_app_tree(tmp_path: Path) -> None:
    installation_root = tmp_path / "filterest"
    app_root = installation_root / "app"
    (app_root / "server_tools/lib").mkdir(parents=True)
    shutil.copy2(INSTALLER, app_root / "server_tools/install_filterest.sh")
    shutil.copy2(
        SOURCE_ROOT / "server_tools/lib/easelect_private_paths.sh",
        app_root / "server_tools/lib/easelect_private_paths.sh",
    )
    shutil.copy2(
        SOURCE_ROOT / "server_tools/lib/filterest_paths.py",
        app_root / "server_tools/lib/filterest_paths.py",
    )
    shutil.copy2(SOURCE_ROOT / "go.mod", app_root / "go.mod")
    shutil.copy2(SOURCE_ROOT / "VERSION_APP", app_root / "VERSION_APP")
    shutil.copy2(SOURCE_ROOT / "VERSION_DB", app_root / "VERSION_DB")
    before = source_snapshot(app_root)

    completed = subprocess.run(
        [
            "bash",
            str(app_root / "server_tools/install_filterest.sh"),
            "--profile",
            "admin",
            "--yes",
            "--dry-run",
            "--no-start",
        ],
        cwd=tmp_path,
        env=clean_filterest_environment(installation_root),
        check=True,
        capture_output=True,
        text=True,
    )

    assert "Filterest installation completed" in completed.stdout
    assert source_snapshot(app_root) == before


def test_nested_updater_dry_run_verifies_app_without_mutation(tmp_path: Path) -> None:
    seed = tmp_path / "seed"
    remote = tmp_path / "origin.git"
    checkout = tmp_path / "checkout"
    fake_bin = tmp_path / "bin"
    seed.mkdir()
    fake_bin.mkdir()
    subprocess.run(["git", "init", "-b", "main"], cwd=seed, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Lifecycle Test"], cwd=seed, check=True)
    subprocess.run(
        ["git", "config", "user.email", "lifecycle@example.invalid"],
        cwd=seed,
        check=True,
    )

    app_root = seed / "app"
    (app_root / "server_tools/lib").mkdir(parents=True)
    shutil.copy2(UPDATER, app_root / "server_tools/update_filterest.sh")
    shutil.copy2(
        SOURCE_ROOT / "server_tools/lib/easelect_private_paths.sh",
        app_root / "server_tools/lib/easelect_private_paths.sh",
    )
    shutil.copy2(
        SOURCE_ROOT / "server_tools/lib/filterest_paths.py",
        app_root / "server_tools/lib/filterest_paths.py",
    )
    (app_root / "server_tools/install_filterest.sh").write_text(
        "#!/usr/bin/env bash\nexit 0\n", encoding="utf-8"
    )
    (app_root / "go.mod").write_text("module example.invalid/filterest\n\ngo 1.26.5\n", encoding="utf-8")
    (app_root / "VERSION_DB").write_text("9.0.0\n", encoding="utf-8")

    def write_release(version: str) -> None:
        (app_root / "VERSION_APP").write_text(f"{version}\n", encoding="utf-8")
        (app_root / "BUILD_IDENTITY.json").write_text(
            '{"product":"filterest","app_version":"'
            + version
            + '","channel":"stable","artifact_type":"runtime","maturity":"candidate"}\n',
            encoding="utf-8",
        )

    write_release("8.50.0")
    subprocess.run(["git", "add", "."], cwd=seed, check=True)
    subprocess.run(["git", "commit", "-m", "8.50.0"], cwd=seed, check=True, capture_output=True)
    old_commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=seed, check=True, capture_output=True, text=True
    ).stdout.strip()
    write_release("8.51.0")
    subprocess.run(["git", "add", "."], cwd=seed, check=True)
    subprocess.run(["git", "commit", "-m", "8.51.0"], cwd=seed, check=True, capture_output=True)
    subprocess.run(["git", "tag", "v8.51.0"], cwd=seed, check=True)
    subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
    subprocess.run(["git", "remote", "add", "origin", str(remote)], cwd=seed, check=True)
    subprocess.run(["git", "push", "origin", "main", "--tags"], cwd=seed, check=True, capture_output=True)
    subprocess.run(
        ["git", "clone", "--branch", "main", str(remote), str(checkout)],
        check=True,
        capture_output=True,
    )
    subprocess.run(["git", "reset", "--hard", old_commit], cwd=checkout, check=True, capture_output=True)
    (checkout / "data/runtime").mkdir(parents=True)
    (checkout / "data/runtime/filterest-setup-complete").write_text(
        "profile=development\napp_version=8.50.0\ndb_version=9.0.0\n",
        encoding="utf-8",
    )

    fake_curl = fake_bin / "curl"
    fake_curl.write_text(
        "#!/usr/bin/env bash\n"
        "set -eu\n"
        "out=\n"
        "while [ \"$#\" -gt 0 ]; do\n"
        "  if [ \"$1\" = --output ]; then out=$2; shift 2; else shift; fi\n"
        "done\n"
        "printf '%s\\n' '{\"tag_name\":\"v8.51.0\",\"draft\":false,"
        "\"prerelease\":false,\"published_at\":\"2026-08-28T12:00:00Z\"}' > \"$out\"\n",
        encoding="utf-8",
    )
    fake_curl.chmod(fake_curl.stat().st_mode | stat.S_IXUSR)
    fake_pg_dump = fake_bin / "pg_dump"
    fake_pg_dump.write_text("#!/usr/bin/env bash\nexit 99\n", encoding="utf-8")
    fake_pg_dump.chmod(fake_pg_dump.stat().st_mode | stat.S_IXUSR)

    environment = clean_filterest_environment(checkout)
    environment["PATH"] = f"{fake_bin}:{environment['PATH']}"
    environment["FILTEREST_RELEASE_REPOSITORY"] = "kanilmari/filterest"
    before = source_snapshot(checkout / "app")
    completed = subprocess.run(
        ["bash", str(checkout / "app/server_tools/update_filterest.sh"), "--dry-run"],
        cwd=tmp_path,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )

    assert "Installed version: 8.50.0" in completed.stdout
    assert "Published version: 8.51.0" in completed.stdout
    assert "Dry run complete" in completed.stdout
    assert source_snapshot(checkout / "app") == before
    assert not (checkout / "backups").exists()
    assert (
        subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=checkout,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        == old_commit
    )

    operator_key = checkout / "keys/operator-owned.key"
    operator_key.parent.mkdir()
    operator_key.write_text("do not replace\n", encoding="utf-8")
    write_release("8.52.0")
    shipped_key = seed / "keys/should-not-ship.key"
    shipped_key.parent.mkdir()
    shipped_key.write_text("invalid release content\n", encoding="utf-8")
    subprocess.run(["git", "add", "."], cwd=seed, check=True)
    subprocess.run(
        ["git", "commit", "-m", "invalid mutable path"],
        cwd=seed,
        check=True,
        capture_output=True,
    )
    subprocess.run(["git", "tag", "v8.52.0"], cwd=seed, check=True)
    subprocess.run(
        ["git", "push", "origin", "main", "--tags"],
        cwd=seed,
        check=True,
        capture_output=True,
    )
    fake_curl.write_text(
        "#!/usr/bin/env bash\n"
        "set -eu\n"
        "out=\n"
        "while [ \"$#\" -gt 0 ]; do\n"
        "  if [ \"$1\" = --output ]; then out=$2; shift 2; else shift; fi\n"
        "done\n"
        "printf '%s\\n' '{\"tag_name\":\"v8.52.0\",\"draft\":false,"
        "\"prerelease\":false,\"published_at\":\"2026-08-28T12:00:00Z\"}' > \"$out\"\n",
        encoding="utf-8",
    )
    rejected = subprocess.run(
        ["bash", str(checkout / "app/server_tools/update_filterest.sh"), "--dry-run"],
        cwd=tmp_path,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )

    assert rejected.returncode != 0
    assert "tracked mutable installation paths" in rejected.stderr
    assert operator_key.read_text(encoding="utf-8") == "do not replace\n"
    assert (
        subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=checkout,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        == old_commit
    )


def test_lifecycle_scripts_use_source_and_install_roots_by_responsibility() -> None:
    installer = INSTALLER.read_text(encoding="utf-8")
    updater = UPDATER.read_text(encoding="utf-8")
    admin_runner = ADMIN_RUNNER.read_text(encoding="utf-8")
    setup = SETUP.read_text(encoding="utf-8")
    dependency_installer = SOURCE_DEPENDENCY_INSTALLER.read_text(encoding="utf-8")
    scaffold = SCAFFOLD.read_text(encoding="utf-8")

    for source in (installer, updater, admin_runner, setup, scaffold):
        assert 'SOURCE_ROOT' in source or 'FILTEREST_SOURCE_ROOT' in source
        assert 'INSTALLATION_ROOT' in source
        assert '$PROJECT_ROOT/server_tools' not in source
        assert '$PROJECT_ROOT/runtime' not in source

    assert 'RUNTIME_ROOT="$INSTALLATION_ROOT/data/runtime"' in installer
    assert 'RUNTIME_ROOT="$INSTALLATION_ROOT/data/runtime"' in admin_runner
    assert 'TLS_CERT_FILE="${TLS_CERT_FILE:-$EASELECT_TLS_CERT_FILE}"' in admin_runner
    assert 'BACKUP_ROOT="$INSTALLATION_ROOT/backups"' in updater
    assert '"$backup_dir/bootstrap.tar.gz" bootstrap' in updater
    assert '"$INSTALLATION_ROOT/data/storage"' in updater
    assert 'git -C "$INSTALLATION_ROOT" merge --ff-only "$TARGET_COMMIT"' in updater
    assert '${TARGET_COMMIT}:${GIT_SOURCE_PREFIX}go.mod' in updater
    assert 'NODE_DEPENDENCY_ROOT="$RUNTIME_ROOT/node"' in setup
    assert 'filterest_install_node_dependencies "$FILTEREST_BUILD_ROOT" "$RUNTIME_ROOT" "$NODE_DEPENDENCY_ROOT"' in setup
    assert 'ensure_nested_node_dependency_bridge' not in setup
    assert 'ln -s "$bridge_target"' not in setup
    assert ".filterest-source-manifests.sha256" in dependency_installer
    assert 'filterest_download_go_modules "$FILTEREST_SOURCE_ROOT" "$RUNTIME_ROOT"' in setup
    assert 'GOFLAGS=-mod=readonly' in dependency_installer
    assert 'GOMODCACHE="$runtime_root/go/module-cache"' in dependency_installer
    assert '"$INSTALLATION_ROOT/config"' in scaffold
    assert '"$INSTALLATION_ROOT/backups"' in scaffold


def test_failed_go_dependency_download_cannot_create_setup_completion_marker(
    tmp_path: Path,
) -> None:
    source_root = tmp_path / "app"
    runtime_root = tmp_path / "data/runtime"
    fake_bin = tmp_path / "fake-bin"
    completion_marker = runtime_root / "filterest-setup-complete"
    source_root.mkdir()
    fake_bin.mkdir()
    fake_go = fake_bin / "go"
    fake_go.write_text(
        "#!/usr/bin/env bash\nprintf '%s\\n' fake-go-download-failed >&2\nexit 42\n",
        encoding="utf-8",
    )
    fake_go.chmod(fake_go.stat().st_mode | stat.S_IXUSR)

    command = """
set -euo pipefail
source "$1"
if filterest_download_go_modules "$2" "$3"; then
    touch "$4"
    exit 0
fi
exit 1
"""
    environment = os.environ.copy()
    environment["PATH"] = f"{fake_bin}:{environment['PATH']}"
    completed = subprocess.run(
        [
            "bash",
            "-c",
            command,
            "dependency-download-test",
            str(SOURCE_DEPENDENCY_INSTALLER),
            str(source_root),
            str(runtime_root),
            str(completion_marker),
        ],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
    )

    assert completed.returncode != 0
    assert "fake-go-download-failed" in completed.stdout
    assert "setup is incomplete" in completed.stderr
    assert not completion_marker.exists()


def test_nested_initial_admin_handoff_stays_outside_read_only_app(
    tmp_path: Path,
) -> None:
    installation_root = tmp_path / "filterest"
    app_root = installation_root / "app"
    fake_bin = tmp_path / "fake-bin"
    go_arguments = tmp_path / "go-arguments.txt"
    app_root.mkdir(parents=True)
    fake_bin.mkdir()
    (app_root / "go.mod").write_text("module filterest\n", encoding="utf-8")
    (app_root / "VERSION_APP").write_text("test\n", encoding="utf-8")
    fake_go = fake_bin / "go"
    fake_go.write_text(
        "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\" > \"$FILTEREST_GO_ARGUMENTS\"\n",
        encoding="utf-8",
    )
    fake_go.chmod(fake_go.stat().st_mode | stat.S_IXUSR)
    before = source_snapshot(app_root)
    app_root.chmod(app_root.stat().st_mode & ~0o222)

    command = """
set -euo pipefail
source "$1"
handoff="$(filterest_resolve_initial_admin_handoff_file "$2" "$3" "")"
go -C "$2" run ./server_tools/initial_admin_bootstrap --handoff-file "$handoff"
printf '%s' "$handoff"
"""
    environment = os.environ.copy()
    environment["PATH"] = f"{fake_bin}:{environment['PATH']}"
    environment["FILTEREST_GO_ARGUMENTS"] = str(go_arguments)
    completed = subprocess.run(
        [
            "bash",
            "-c",
            command,
            "initial-admin-handoff-test",
            str(SETUP_RUNTIME_PATHS),
            str(app_root),
            str(installation_root),
        ],
        cwd=tmp_path,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )

    expected_handoff = (
        installation_root / "data/bootstrap/initial_admin_credentials.txt"
    )
    assert completed.stdout == str(expected_handoff)
    assert str(expected_handoff) in go_arguments.read_text(encoding="utf-8")
    assert source_snapshot(app_root) == before

    rejected = subprocess.run(
        [
            "bash",
            "-c",
            'source "$1"; filterest_resolve_initial_admin_handoff_file "$2" "$3" "$2/data/handoff.txt"',
            "initial-admin-handoff-rejection",
            str(SETUP_RUNTIME_PATHS),
            str(app_root),
            str(installation_root),
        ],
        capture_output=True,
        text=True,
    )
    assert rejected.returncode != 0
    assert "outside immutable app" in rejected.stderr


def test_embedded_and_legacy_initial_admin_handoff_contract_is_unchanged(
    tmp_path: Path,
) -> None:
    easelect_root = tmp_path / "easelect"
    embedded_app = easelect_root / "filterest/app"
    legacy_root = tmp_path / "legacy-filterest"
    embedded_app.mkdir(parents=True)
    legacy_root.mkdir()

    for source_root, installation_root in (
        (embedded_app, easelect_root),
        (legacy_root, legacy_root),
    ):
        completed = subprocess.run(
            [
                "bash",
                "-c",
                'source "$1"; filterest_resolve_initial_admin_handoff_file "$2" "$3" ""',
                "initial-admin-compatibility-test",
                str(SETUP_RUNTIME_PATHS),
                str(source_root),
                str(installation_root),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        assert completed.stdout == "data/bootstrap/initial_admin_credentials.txt"


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
                "FILTEREST_QUEEN_PYTHON_MODULE",
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
