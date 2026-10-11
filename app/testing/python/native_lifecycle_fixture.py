"""native_lifecycle_fixture.py
Build isolated installation/update fixtures and recorder tools for lifecycle tests.
Connect installation roots, update suites and recovery importers to shared support.
Keep fixtures non-collected and recorder monkeypatches on their owning module.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess

from installation_fixture_files import LIFECYCLE_LIBRARY_FILES, RECOVERY_PSQL_FAKE


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


def copy_lifecycle_libraries(app_root: Path) -> None:
    for relative_path in LIFECYCLE_LIBRARY_FILES:
        destination = app_root / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SOURCE_ROOT / relative_path, destination)


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
    # The launcher reads the standalone native port through the port library.
    for relative_path in (
        "server_tools/lib/python_bytecode_cache.sh",
        *LIFECYCLE_LIBRARY_FILES,
    ):
        helper = application_root / relative_path
        helper.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SOURCE_ROOT / relative_path, helper)
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
    FILTEREST_GO_RUN_PROCESS_PATTERN \
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

RECORD_CALL = (
    "#!/usr/bin/env bash\n"
    "set -eu\n"
    "if [ -e /proc/self/fd/9 ]; then lock=open; else lock=closed; fi\n"
    "printf '%s %s ENABLE_SQL_MIGRATIONS=%s EASELECT_MIGRATION_FILE_ALLOWLIST=%s fd9=%s\\n' "
    "\"$(basename \"$0\")\" \"$*\" \"${ENABLE_SQL_MIGRATIONS-<unset>}\" "
    "\"${EASELECT_MIGRATION_FILE_ALLOWLIST-<unset>}\" \"$lock\" >> \"$FILTEREST_TEST_LOG\"\n"
)

FAKE_UPDATE_TOOLS = {
    "dpkg-query": "#!/usr/bin/env bash\nprintf 'install ok installed'\n",
    # Release evidence for api.github.com, and readiness for /system/ready.
    "curl": (
        "#!/usr/bin/env bash\n"
        "set -eu\n"
        "out=/dev/stdout\n"
        "url=''\n"
        "while [ \"$#\" -gt 0 ]; do\n"
        "    case \"$1\" in\n"
        "        --output) out=$2; shift 2 ;;\n"
        "        --header|--write-out|--cacert|--connect-timeout|--max-time) shift 2 ;;\n"
        "        -*) shift ;;\n"
        "        *) url=$1; shift ;;\n"
        "    esac\n"
        "done\n"
        "printf 'curl %s\\n' \"$url\" >> \"$FILTEREST_TEST_LOG\"\n"
        "case \"$url\" in\n"
        "    https://api.github.com/*)\n"
        "        printf '{\"tag_name\":\"%s\",\"draft\":false,\"prerelease\":false,"
        "\"published_at\":\"2026-08-28T12:00:00Z\"}\\n' \"$FILTEREST_TEST_RELEASE_TAG\" > \"$out\" ;;\n"
        "    */system/ready)\n"
        "        printf '{\"ready\":true,\"db_compatible\":true,\"reasons\":[],"
        "\"app_version\":\"%s\",\"instance_id\":\"%s\"}\\n' "
        "\"$FILTEREST_TEST_READY_VERSION\" \"$FILTEREST_TEST_INSTANCE\"\n"
        "        printf '200' ;;\n"
        "esac\n"
    ),
    "docker": (
        "#!/usr/bin/env bash\n"
        "set -eu\n"
        "if [ \"${1:-}\" = compose ] && [ \"${2:-}\" = --project-directory ]; then\n"
        "    shift 7\n"
        "fi\n"
        "printf 'docker %s\\n' \"$*\" >> \"$FILTEREST_TEST_LOG\"\n"
        "case \"$*\" in\n"
        "    'compose version --short') printf '2.40.3\\n' ;;\n"
        "    'volume inspect '*) exit 1 ;;\n"
        "    'ps --status running --services') printf 'app\\ndb\\n' ;;\n"
        "    'images --quiet app') printf 'sha256:previous-app-image\\n' ;;\n"
        "    'stop app')\n"
        "        sleep \"${FILTEREST_TEST_STOP_DELAY:-0}\"\n"
        "        if [ -n \"${FILTEREST_TEST_STOP_FAILS_AFTER_UP:-}\" ] && [ -e \"$FILTEREST_TEST_LOG.up\" ]; then\n"
        "            exit 1\n"
        "        fi\n"
        "        exit \"${FILTEREST_TEST_STOP_STATUS:-0}\" ;;\n"
        "    *'pg_dumpall --roles-only --no-role-passwords')\n"
        "        printf '%s\\n' 'CREATE ROLE docker_owner;' 'ALTER ROLE docker_owner WITH PASSWORD '\\''fake-role-verifier'\\'';' \
            '-- PostgreSQL database cluster dump complete'\n"
        "        exit \"${FILTEREST_TEST_ROLES_STATUS:-0}\" ;;\n"
        "    *psql*) exec psql ;;\n"
        "    'exec -T db sh -c '*)\n"
        "        printf 'PGDMP docker dump'\n"
        "        exit \"${FILTEREST_TEST_DUMP_STATUS:-0}\" ;;\n"
        "    'exec -T db pg_restore --list') cat > /dev/null ;;\n"
        "    'up '*)\n"
        "        touch \"$FILTEREST_TEST_LOG.up\"\n"
        "        if [ -e /proc/self/fd/9 ]; then lock=open; else lock=closed; fi\n"
        "        printf 'docker-up ENABLE_SQL_MIGRATIONS=%s "
        "EASELECT_MIGRATION_FILE_ALLOWLIST=%s fd9=%s FILTEREST_APP_VERSION=%s\\n' "
        "\"${ENABLE_SQL_MIGRATIONS-<unset>}\" "
        "\"${EASELECT_MIGRATION_FILE_ALLOWLIST-<unset>}\" \"$lock\" "
        "\"${FILTEREST_APP_VERSION-<unset>}\" >> \"$FILTEREST_TEST_LOG\"\n"
        "        exit \"${FILTEREST_TEST_UP_STATUS:-0}\" ;;\n"
        "esac\n"
    ),
    "psql": RECOVERY_PSQL_FAKE,
    "pg_dump": (
        "#!/usr/bin/env bash\n"
        "set -eu\n"
        "printf 'pg_dump %s\\n' \"$*\" >> \"$FILTEREST_TEST_LOG\"\n"
        "printf 'native dump'\n"
        "exit \"${FILTEREST_TEST_DUMP_STATUS:-0}\"\n"
    ),
    "pg_dumpall": (
        "#!/usr/bin/env bash\n"
        "printf 'pg_dumpall %s\\n' \"$*\" >> \"$FILTEREST_TEST_LOG\"\n"
        "printf '%s\\n' 'CREATE ROLE native_admin;' 'ALTER ROLE native_admin WITH PASSWORD '\\''fake-role-verifier'\\'';' \
            '-- PostgreSQL database cluster dump complete'\n"
        "exit \"${FILTEREST_TEST_ROLES_STATUS:-0}\"\n"
    ),
    "pg_restore": (
        "#!/usr/bin/env bash\n"
        "printf 'pg_restore %s\\n' \"$*\" >> \"$FILTEREST_TEST_LOG\"\n"
        "cat > /dev/null\n"
        "exit \"${FILTEREST_TEST_RESTORE_STATUS:-0}\"\n"
    ),
}


def git_output(root: Path, *arguments: str) -> str:
    return subprocess.run(
        ["git", *arguments], cwd=root, check=True, capture_output=True, text=True
    ).stdout.strip()


def build_update_fixture(tmp_path: Path, profile: str, *, real_native_installer=False, target_rename=False) -> dict[str, object]:
    """Create an installed 8.50.0 checkout whose origin publishes v8.51.0.

    The real updater and Docker runner run against it; Docker, curl, pg_dump,
    the installer, and both native launchers are recorders in one ordered log.
    """

    seed = tmp_path / "seed"
    remote = tmp_path / "origin.git"
    checkout = tmp_path / "checkout"
    fake_bin = tmp_path / "bin"
    log = tmp_path / "calls.log"
    seed.mkdir()
    fake_bin.mkdir()
    subprocess.run(["git", "init", "-b", "main"], cwd=seed, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Lifecycle Test"], cwd=seed, check=True)
    subprocess.run(
        ["git", "config", "user.email", "lifecycle@example.invalid"], cwd=seed, check=True
    )

    app_root = seed / "app"
    (app_root / "server_tools/lib").mkdir(parents=True)
    (app_root / "docker").mkdir()
    for relative_path in (
        "server_tools/update_filterest.sh",
        "server_tools/run_filterest_docker.sh",
        "docker/docker-compose.yml",
        ".env.example",
    ):
        shutil.copy2(SOURCE_ROOT / relative_path, app_root / relative_path)
    copy_lifecycle_libraries(app_root)
    shutil.copy2(SOURCE_ROOT.parent / "compose.yml", seed / "compose.yml")
    for recorder in (
        app_root / "server_tools/install_filterest.sh",
        app_root / "server_tools/run_filterest_admin.sh",
        seed / "ctl",
        seed / "filterest",
    ):
        if real_native_installer and recorder.name == "install_filterest.sh":
            shutil.copy2(INSTALLER, recorder)
        else:
            recorder.write_text(RECORD_CALL, encoding="utf-8")
        recorder.chmod(0o755)
    (app_root / "go.mod").write_text(
        "module example.invalid/filterest\n\ngo 1.26.5\n", encoding="utf-8"
    )
    (app_root / "VERSION_DB").write_text("9.0.0\n", encoding="utf-8")

    def commit_release(version: str) -> str:
        (app_root / "VERSION_APP").write_text(f"{version}\n", encoding="utf-8")
        (app_root / "BUILD_IDENTITY.json").write_text(
            json.dumps(
                {
                    "product": "filterest",
                    "app_version": version,
                    "channel": "stable",
                    "artifact_type": "runtime",
                    "maturity": "candidate",
                }
            )
            + "\n",
            encoding="utf-8",
        )
        subprocess.run(["git", "add", "."], cwd=seed, check=True)
        subprocess.run(["git", "commit", "-m", version], cwd=seed, check=True, capture_output=True)
        return git_output(seed, "rev-parse", "HEAD")

    if target_rename:
        (app_root / "OLD_RELEASE_NOTES.txt").write_text("release notes\n", encoding="utf-8")
    old_commit = commit_release("8.50.0")
    # A file new in the release, so an untracked copy can block the fast-forward.
    if target_rename:
        (app_root / "OLD_RELEASE_NOTES.txt").rename(app_root / "RELEASE_NOTES.txt")
    else:
        (app_root / "RELEASE_NOTES.txt").write_text("8.51.0\n", encoding="utf-8")
    target_commit = commit_release("8.51.0")
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

    for name, script in FAKE_UPDATE_TOOLS.items():
        (fake_bin / name).write_text(script, encoding="utf-8")
        (fake_bin / name).chmod(0o755)

    environment = clean_filterest_environment(checkout)
    environment["PATH"] = f"{fake_bin}:{environment['PATH']}"
    environment["FILTEREST_RELEASE_REPOSITORY"] = "kanilmari/filterest"
    environment["FILTEREST_TEST_LOG"] = str(log)
    environment["FILTEREST_TEST_RELEASE_TAG"] = "v8.51.0"
    environment["FILTEREST_TEST_READY_VERSION"] = "8.51.0"

    if profile == "docker":
        subprocess.run(
            ["bash", str(checkout / "app/server_tools/run_filterest_docker.sh"), "setup"],
            env=environment,
            check=True,
            capture_output=True,
        )
        settings = dict(
            line.split("=", 1)
            for line in (checkout / "keys/docker.env").read_text(encoding="utf-8").splitlines()
            if line and not line.startswith("#") and "=" in line
        )
        # A shell that already exports one of these would be refused by design.
        for key in settings:
            environment.pop(key, None)
        environment["FILTEREST_TEST_INSTANCE"] = settings["INSTANCE_NAME"]
    else:
        settings = {"DB_ADMIN_USER": "native_admin", "DB_ADMIN_PASSWORD": "native-test-secret"}
        runtime_settings = checkout / "keys/filterest_runtime/runtime_environment.env"
        runtime_settings.parent.mkdir(parents=True)
        runtime_settings.write_text(
            "DB_ADMIN_USER=native_admin\nDB_ADMIN_PASSWORD=native-test-secret\nAPP_PORT=58120\n",
            encoding="utf-8",
        )
        runtime_settings.chmod(0o600)
        (checkout / "data/runtime").mkdir(parents=True)
        (checkout / "data/runtime/filterest-setup-complete").write_text(
            f"profile={profile}\napp_version=8.50.0\ndb_version=9.0.0\n", encoding="utf-8"
        )
    (checkout / "data/storage").mkdir(parents=True, exist_ok=True)
    (checkout / "data/storage/upload.txt").write_text("operator upload\n", encoding="utf-8")

    return {
        "checkout": checkout,
        "environment": environment,
        "log": log,
        "old_commit": old_commit,
        "target_commit": target_commit,
        "settings": settings,
    }


def run_update(
    fixture: dict[str, object], *arguments: str, extra_environment: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    checkout = fixture["checkout"]
    assert isinstance(checkout, Path)
    environment = dict(fixture["environment"])  # type: ignore[arg-type]
    environment.update(extra_environment or {})
    return subprocess.run(
        ["bash", str(checkout / "app/server_tools/update_filterest.sh"), *arguments],
        cwd=checkout.parent,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )


def logged_calls(fixture: dict[str, object]) -> list[str]:
    log = fixture["log"]
    assert isinstance(log, Path)
    return log.read_text(encoding="utf-8").splitlines() if log.exists() else []


def update_backups(fixture: dict[str, object]) -> list[Path]:
    checkout = fixture["checkout"]
    assert isinstance(checkout, Path)
    return sorted((checkout / "backups").glob("update_*"))


def assert_calls_in_order(calls: list[str], steps: list[str]) -> None:
    """Each step must start a logged call that comes after the previous step's."""

    position = -1
    for step in steps:
        position = next(
            (
                index
                for index in range(position + 1, len(calls))
                if calls[index].startswith(step)
            ),
            -2,
        )
        assert position >= 0, f"{step!r} does not follow the previous step in {calls}"

