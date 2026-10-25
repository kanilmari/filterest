"""test_native_installation_roots.py
Verify setup, scaffold, dry-run updates and initial-admin installation roots.
Connect native installation commands with immutable source and mutable storage.
Prevent installation state and failed dependency downloads from changing source.
"""

from __future__ import annotations

import os
from pathlib import Path
import re
import shutil
import stat
import subprocess

import pytest

from native_lifecycle_fixture import (
    ADMIN_RUNNER,
    INSTALLER,
    SCAFFOLD,
    SETUP,
    SETUP_RUNTIME_PATHS,
    SOURCE_DEPENDENCY_INSTALLER,
    SOURCE_ROOT,
    UPDATER,
    clean_filterest_environment,
    copy_lifecycle_libraries,
    copy_scaffold_contract,
    source_snapshot,
)


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


@pytest.mark.parametrize("writer", ["scaffold", "installer"])
@pytest.mark.parametrize("initial", [None, "", " \t", "replace-me-with-32-plus-random-characters",
                                     "replace-me-custom", '"replace-me-quoted"', "c" * 64])
def test_native_env_writers_initialize_and_preserve_session_key(tmp_path: Path, writer: str, initial: str | None) -> None:
    """Exercise only local settings writers, with synthetic settings and no services."""
    root = tmp_path / "filterest"
    root.mkdir()
    app = copy_scaffold_contract(root)
    copy_lifecycle_libraries(app)
    settings = dict(SITE_NAME="Test", SITE_SLUG="test", DB_HOST="localhost", DB_PORT="5432",
                    DB_SSLMODE="disable", DB_NAME="test", INSTANCE_NAME="test",
                    PORT="8100", EASELECT_PORT="8100", APP_PORT="8100",
                    TLS_CERT_FILE="synthetic.crt", TLS_KEY_FILE="synthetic.key",
                    SESSION_KEY="s" * 40)
    for role in ("ADMIN", "READONLY", "CONFIDENTIAL", "BASIC", "GUEST"):
        settings[f"DB_{role}_USER"] = f"test_{role.lower()}"
        settings[f"DB_{role}_PASSWORD"] = "synthetic-existing-value"
    settings.update(DB_USER="test_admin", DB_PASSWORD="synthetic-existing-value")
    settings["DB_BASIC_PASSWORD"] = "replace-me-custom-existing"
    if initial is not None:
        settings["SESSION_SECRET_KEY"] = initial
    content = "".join(f"{key}={value}\n" for key, value in settings.items())
    (app / ".env.example").write_text(content)
    environment = clean_filterest_environment(root)
    files = [root / "keys/filterest_runtime" / name for name in
             ("runtime_environment.env", "development_environment.env")]
    if writer == "scaffold":
        command = ["bash", str(app / "server_tools/scaffold.sh"), "setup"]
    else:
        # Isolate the installer's own repair loop; scaffold has its own cases.
        (app / "server_tools/scaffold.sh").write_text("#!/bin/sh\nexit 0\n")
        (app / "server_tools/scaffold.sh").chmod(0o755)
        shutil.copy2(INSTALLER, app / "server_tools/install_filterest.sh")
        files[0].parent.mkdir(parents=True)
        for file in files:
            file.write_text(content)
            file.chmod(0o644)
        environment["FILTEREST_INSTALLER_LIBRARY_ONLY"] = "1"
        environment["INSTALLER_PATH"] = str(app / "server_tools/install_filterest.sh")
        command = ["bash", "-euc", '''source "$INSTALLER_PATH"
PROFILE=development
installation_native_port() { printf 8100; }
configure_installation_database_identity() { :; }
configure_environment_files''']
    generated = []
    for _ in range(2):
        result = subprocess.run(command, env=environment, capture_output=True, text=True, check=True)
        values = []
        for file in files:
            assert "DB_BASIC_PASSWORD=replace-me-custom-existing\n" in file.read_text()
            value = re.search(r"^SESSION_SECRET_KEY=(.*)$", file.read_text(), re.M)[1]
            assert re.fullmatch(r"[a-f0-9]{64}", value)
            assert stat.S_IMODE(file.stat().st_mode) == 0o600
            assert value not in result.stdout + result.stderr
            values.append(value)
        assert values[0] == values[1]
        if generated:
            assert values == generated  # A second setup never rotates a real key.
        generated = values
    if initial == "c" * 64:
        assert generated == [initial, initial]
    else:
        # Reset both inputs: another initialization must draw fresh randomness.
        for file in files:
            file.write_text(content)
        result = subprocess.run(command, env=environment, capture_output=True, text=True, check=True)
        for file in files:
            value = re.search(r"^SESSION_SECRET_KEY=(.*)$", file.read_text(), re.M)[1]
            assert re.fullmatch(r"[a-f0-9]{64}", value) and value != generated[0]
            assert stat.S_IMODE(file.stat().st_mode) == 0o600
            assert value not in result.stdout + result.stderr


def test_scaffold_retains_distinct_real_keys_and_reuses_existing_identity(tmp_path: Path) -> None:
    root = tmp_path / "filterest"
    root.mkdir()
    app = copy_scaffold_contract(root)
    (app / ".env.example").write_text("SESSION_SECRET_KEY=replace-me\n")
    files = [root / "keys/filterest_runtime" / name for name in
             ("runtime_environment.env", "development_environment.env")]
    files[0].parent.mkdir(parents=True)
    real = '"synthetic-existing # value"'
    files[0].write_text(f"SESSION_SECRET_KEY={real}\n")
    command = ["bash", str(app / "server_tools/scaffold.sh"), "setup"]
    environment = clean_filterest_environment(root)
    result = subprocess.run(command, env=environment, capture_output=True, text=True, check=True)
    assert files[0].read_bytes() == files[1].read_bytes()
    assert real not in result.stdout + result.stderr
    # Two established identities both remain verbatim, even if they differ.
    files[1].write_text("SESSION_SECRET_KEY=x\n")
    before = [file.read_bytes() for file in files]
    subprocess.run(command, env=environment, capture_output=True, text=True, check=True)
    assert [file.read_bytes() for file in files] == before
    assert all(stat.S_IMODE(file.stat().st_mode) == 0o600 for file in files)


def test_nested_installer_dry_run_preserves_app_tree(tmp_path: Path) -> None:
    installation_root = tmp_path / "filterest"
    app_root = installation_root / "app"
    (app_root / "server_tools/lib").mkdir(parents=True)
    shutil.copy2(INSTALLER, app_root / "server_tools/install_filterest.sh")
    copy_lifecycle_libraries(app_root)
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
    # The public product's native port, read from native_development_ports.env.
    assert "Browser address: https://localhost:8100/first-run" in completed.stdout
    assert "Open: https://localhost:8100/first-run" in completed.stdout
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
    copy_lifecycle_libraries(app_root)
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
        "out=/dev/stdout\n"
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
        "out=/dev/stdout\n"
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
    assert 'source "$SCRIPT_DIR/lib/setup_native_database.sh"' in setup
    setup += (
        SOURCE_ROOT / "server_tools/lib/setup_native_database.sh"
    ).read_text(encoding="utf-8")
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
    assert 'database_recovery_update.py" archive' in updater
    assert 'database_recovery_update.py" seal' in updater
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
