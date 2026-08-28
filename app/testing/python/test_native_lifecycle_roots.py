"""Regression coverage for immutable app and mutable installation lifecycle roots."""

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
SCAFFOLD = SOURCE_ROOT / "server_tools/scaffold.sh"


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
    assert '"$INSTALLATION_ROOT/data/storage"' in updater
    assert 'git -C "$INSTALLATION_ROOT" merge --ff-only "$TARGET_COMMIT"' in updater
    assert '${TARGET_COMMIT}:${GIT_SOURCE_PREFIX}go.mod' in updater
    assert 'NODE_DEPENDENCY_ROOT="$RUNTIME_ROOT/node"' in setup
    assert 'npm --prefix "$NODE_DEPENDENCY_ROOT" ci --silent' in setup
    assert 'bridge_target="../data/runtime/node/node_modules"' in setup
    assert 'ensure_nested_node_dependency_bridge' in setup
    assert ".filterest-source-manifests.cksum" in setup
    assert 'GOFLAGS=-mod=readonly' in setup
    assert 'GOMODCACHE="$RUNTIME_ROOT/go/module-cache"' in setup
    assert '"$INSTALLATION_ROOT/config"' in scaffold
    assert '"$INSTALLATION_ROOT/backups"' in scaffold


def test_fresh_nested_development_layout_runs_standard_npm_commands(
    tmp_path: Path,
) -> None:
    if shutil.which("node") is None or shutil.which("npm") is None:
        pytest.skip("Node.js and npm are required for the development profile")

    installation_root = tmp_path / "filterest"
    app_root = installation_root / "app"
    runtime_modules = installation_root / "data/runtime/node/node_modules"
    (app_root / "frontend").mkdir(parents=True)
    (app_root / "server_tools/scripts").mkdir(parents=True)
    (runtime_modules / ".bin").mkdir(parents=True)
    probe_package = runtime_modules / "filterest-runtime-probe"
    probe_package.mkdir()
    (probe_package / "package.json").write_text(
        json.dumps(
            {
                "name": "filterest-runtime-probe",
                "type": "module",
                "exports": "./index.js",
            }
        ),
        encoding="utf-8",
    )
    (probe_package / "index.js").write_text(
        "export default 'runtime-import-ok';\n", encoding="utf-8"
    )
    probe_binary = runtime_modules / ".bin/filterest-node-probe"
    probe_binary.write_text(
        "#!/usr/bin/env bash\nprintf '%s\\n' runtime-bin-ok\n", encoding="utf-8"
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
    (app_root / "frontend/probe.mjs").write_text(
        "import value from 'filterest-runtime-probe'; console.log(value);\n",
        encoding="utf-8",
    )
    (app_root / "package.json").write_text(
        json.dumps(
            {
                "name": "filterest-fresh-layout-probe",
                "type": "module",
                "scripts": {
                    "dev": "filterest-node-probe",
                    "build": "node frontend/probe.mjs",
                    "test": "node server_tools/scripts/vitest_process_runner.mjs run",
                },
            }
        ),
        encoding="utf-8",
    )
    (app_root / "node_modules").symlink_to(
        "../data/runtime/node/node_modules", target_is_directory=True
    )

    for command, expected in (
        ("dev", "runtime-bin-ok"),
        ("build", "runtime-import-ok"),
        ("test", "runtime-vitest-ok"),
    ):
        completed = subprocess.run(
            ["npm", "--prefix", str(app_root), "run", command, "--silent"],
            cwd=tmp_path,
            check=True,
            capture_output=True,
            text=True,
        )
        assert expected in completed.stdout
