#!/usr/bin/env python3
"""
dev_status.py - inspect the tracked app/DB pair and the active development DB.

This command is intentionally read-only:
- reads VERSION_EASELECT or VERSION_APP plus VERSION_DB from git-tracked files
- reads the compatibility manifest row for the current app version
- connects with DB_READONLY_* credentials
- reports latest system_db_version and optional system_database_identity state
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor


PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server_tools.lib.easelect_private_paths import resolve_easelect_private_paths


MANIFEST_PATH = PROJECT_ROOT / "server_tools" / "versioning" / "app_db_compatibility.jsonl"
SHARED_DEV_STORAGE_STATE_DIR = PROJECT_ROOT / "data" / "shared_dev_storage"


def load_env_file(path: Path) -> dict[str, str]:
    """Read KEY=VALUE pairs from one env file, ignoring comments and blanks."""
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def resolve_environment() -> dict[str, str]:
    """
    Mirror backend precedence as closely as possible:
    process env > native development env > native runtime env.
    """
    private_paths = resolve_easelect_private_paths(PROJECT_ROOT)
    merged = load_env_file(private_paths.runtime_env_file)
    merged.update(load_env_file(private_paths.development_env_file))
    merged.update(os.environ)
    return merged


def normalize_bool(raw_value: str) -> bool:
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def read_required_text(path: Path) -> str:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise RuntimeError(f"{path} is empty")
    return text


def read_current_app_version() -> tuple[str, str]:
    for file_name in ("VERSION_EASELECT", "VERSION_APP"):
        path = PROJECT_ROOT / file_name
        if path.exists():
            return read_required_text(path), file_name
    raise RuntimeError("missing VERSION_EASELECT or VERSION_APP")


def read_current_manifest_row(app_version: str) -> dict[str, Any] | None:
    if not MANIFEST_PATH.exists():
        raise RuntimeError(f"compatibility manifest not found: {MANIFEST_PATH}")

    for raw_line in MANIFEST_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        row = json.loads(line)
        if row.get("app_version") == app_version:
            return row
    return None


def resolve_sslmode(env: dict[str, str]) -> str:
    sslmode = env.get("DB_SSLMODE", "").strip()
    if sslmode:
        return sslmode
    if env.get("ENVIRONMENT_TYPE", "").strip() == "dev":
        return "disable"
    return "require"


def read_state_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def count_files(root: Path) -> int:
    if not root.exists():
        return 0
    return sum(1 for path in root.rglob("*") if path.is_file())


def pid_is_running(pid_text: str | None) -> bool:
    if not pid_text:
        return False
    try:
        os.kill(int(pid_text), 0)
    except (OSError, ValueError):
        return False
    return True


def probe_remote_shared_dev_storage(
    *,
    host: str,
    user: str,
    remote_root: str,
    ssh_key: str,
    strict_host_key_checking: str,
) -> dict[str, Any]:
    remote_script = """
set -euo pipefail
remote_root="$1"
storage_root="$remote_root/storage/current/storage"
deleted_root="$remote_root/storage/current/storage_deleted"
lease_file="$remote_root/storage/leases/active/lease.env"
echo "remote_reachable=yes"
[[ -d "$storage_root" ]] && echo "storage_present=yes" || echo "storage_present=no"
[[ -d "$deleted_root" ]] && echo "storage_deleted_present=yes" || echo "storage_deleted_present=no"
if [[ -d "$storage_root" ]]; then
  echo "storage_file_count=$(find "$storage_root" -type f | wc -l | tr -d '[:space:]')"
fi
if [[ -d "$deleted_root" ]]; then
  echo "storage_deleted_file_count=$(find "$deleted_root" -type f | wc -l | tr -d '[:space:]')"
fi
if [[ -f "$lease_file" ]]; then
  set -a
  . "$lease_file"
  set +a
  echo "lease_owner_tag=${LEASE_OWNER_TAG:-}"
  echo "lease_owner_host=${LEASE_OWNER_HOST:-}"
  echo "lease_owner_user=${LEASE_OWNER_USER:-}"
  echo "lease_age_seconds=$(( $(date +%s) - ${LEASE_EPOCH:-0} ))"
  echo "lease_iso_utc=${LEASE_ISO_UTC:-}"
fi
"""

    command = [
        "ssh",
        "-i",
        ssh_key,
        "-o",
        "BatchMode=yes",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        f"StrictHostKeyChecking={strict_host_key_checking}",
        f"{user}@{host}",
        "bash",
        "-s",
        "--",
        remote_root,
    ]
    result = subprocess.run(
        command,
        input=remote_script,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )

    if result.returncode != 0:
        return {
            "reachable": False,
            "error": (result.stderr or result.stdout).strip() or "SSH probe failed.",
        }

    rows: dict[str, str] = {}
    for raw_line in result.stdout.splitlines():
        line = raw_line.strip()
        if not line or "=" not in line:
            continue
        key, value = line.split("=", 1)
        rows[key.strip()] = value.strip()

    return {
        "reachable": rows.get("remote_reachable") == "yes",
        "storage_present": rows.get("storage_present"),
        "storage_deleted_present": rows.get("storage_deleted_present"),
        "storage_file_count": rows.get("storage_file_count"),
        "storage_deleted_file_count": rows.get("storage_deleted_file_count"),
        "lease_owner_tag": rows.get("lease_owner_tag"),
        "lease_owner_host": rows.get("lease_owner_host"),
        "lease_owner_user": rows.get("lease_owner_user"),
        "lease_age_seconds": rows.get("lease_age_seconds"),
        "lease_iso_utc": rows.get("lease_iso_utc"),
        "error": None,
    }


def collect_shared_dev_storage_status(env: dict[str, str]) -> dict[str, Any]:
    enabled = normalize_bool(env.get("SHARED_DEV_STORAGE_ENABLED", "false"))
    state_dir = SHARED_DEV_STORAGE_STATE_DIR
    pid_file = state_dir / "sync_daemon.pid"
    log_file = state_dir / "sync_daemon.log"
    session_file = state_dir / "session.env"
    last_pull_file = state_dir / "last_pull.env"
    last_push_file = state_dir / "last_push.env"
    local_storage_path = PROJECT_ROOT / "storage"
    local_storage_deleted_path = PROJECT_ROOT / "storage_deleted"

    ssh_key = (
        env.get("SHARED_DEV_STORAGE_SSH_KEY_PATH", "").strip()
        or env.get("SHARED_DEV_DB_SSH_KEY_PATH", "").strip()
        or env.get("DOCKER_VPS_SSH_KEY_PATH", "").strip()
        or env.get("DEPLOY_SSH_KEY_PATH", "").strip()
        or str(Path.home() / ".ssh" / "easelect_key")
    )
    strict_host_key_checking = (
        env.get("SHARED_DEV_STORAGE_SSH_STRICT_HOST_KEY_CHECKING", "").strip()
        or env.get("SHARED_DEV_DB_SSH_STRICT_HOST_KEY_CHECKING", "").strip()
        or "accept-new"
    )

    session_state = read_state_file(session_file)
    last_pull_state = read_state_file(last_pull_file)
    last_push_state = read_state_file(last_push_file)
    pid_text = pid_file.read_text(encoding="utf-8").strip() if pid_file.exists() else ""
    daemon_running = pid_is_running(pid_text or None)

    status: dict[str, Any] = {
        "enabled": enabled,
        "target": {
            "host": env.get("SHARED_DEV_VPS_HOST", "").strip(),
            "user": env.get("SHARED_DEV_VPS_USER", "").strip(),
            "root": env.get("SHARED_DEV_ROOT", "").strip() or "/srv/easelect-dev",
            "ssh_key": ssh_key,
            "strict_host_key_checking": strict_host_key_checking,
            "sync_interval_seconds": env.get("SHARED_DEV_STORAGE_SYNC_INTERVAL_SECONDS", "").strip() or "5",
            "lease_ttl_seconds": env.get("SHARED_DEV_STORAGE_LEASE_TTL_SECONDS", "").strip() or "120",
        },
        "local": {
            "storage_path": str(local_storage_path),
            "storage_deleted_path": str(local_storage_deleted_path),
            "storage_file_count": count_files(local_storage_path),
            "storage_deleted_file_count": count_files(local_storage_deleted_path),
            "state_dir": str(state_dir),
            "pid_file": str(pid_file),
            "log_file": str(log_file),
            "session_state": session_state,
            "last_pull_state": last_pull_state,
            "last_push_state": last_push_state,
            "daemon_pid": pid_text or None,
            "daemon_running": daemon_running,
        },
        "remote": None,
    }

    if not enabled:
        return status

    host = status["target"]["host"]
    user = status["target"]["user"]
    remote_root = status["target"]["root"]
    if not host or not user:
        status["remote"] = {
            "reachable": False,
            "error": "SHARED_DEV_VPS_HOST / SHARED_DEV_VPS_USER missing.",
        }
        return status

    if not Path(ssh_key).exists():
        status["remote"] = {
            "reachable": False,
            "error": f"SSH key not found: {ssh_key}",
        }
        return status

    status["remote"] = probe_remote_shared_dev_storage(
        host=host,
        user=user,
        remote_root=remote_root,
        ssh_key=ssh_key,
        strict_host_key_checking=strict_host_key_checking,
    )
    return status


def fetch_optional_single_row(
    cursor: RealDictCursor,
    *,
    table_name: str,
    query: str,
) -> dict[str, Any] | None:
    cursor.execute(
        """
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = %s
        ) AS present
        """,
        (table_name,),
    )
    row = cursor.fetchone() or {}
    if not row.get("present"):
        return None
    cursor.execute(query)
    return cursor.fetchone()


def collect_status() -> dict[str, Any]:
    env = resolve_environment()
    repo_app_version, repo_app_version_file = read_current_app_version()
    repo_db_version = read_required_text(PROJECT_ROOT / "VERSION_DB")
    manifest_row = read_current_manifest_row(repo_app_version)

    db_host = env.get("DB_HOST", "localhost").strip() or "localhost"
    db_port = env.get("DB_PORT", "5432").strip() or "5432"
    db_name = env.get("DB_NAME", "easelect").strip() or "easelect"
    db_user = env.get("DB_READONLY_USER", "readeronly").strip() or "readeronly"
    db_password = env.get("DB_READONLY_PASSWORD", "")
    db_sslmode = resolve_sslmode(env)

    status: dict[str, Any] = {
        "repo": {
            "app_version": repo_app_version,
            "app_version_file": repo_app_version_file,
            "db_version": repo_db_version,
        },
        "manifest": manifest_row,
        "database_target": {
            "host": db_host,
            "port": db_port,
            "name": db_name,
            "readonly_user": db_user,
            "sslmode": db_sslmode,
        },
        "database": {
            "latest_version_row": None,
            "identity_row": None,
        },
        "shared_dev_storage": collect_shared_dev_storage_status(env),
        "checks": [],
        "warnings": [],
    }

    if manifest_row is None:
        status["warnings"].append(
            f"Manifest row missing for {repo_app_version_file} {repo_app_version}."
        )
    elif manifest_row.get("target_db_version") != repo_db_version:
        status["warnings"].append(
            "Manifest target_db_version does not match VERSION_DB."
        )

    try:
        conn = psycopg2.connect(
            host=db_host,
            port=db_port,
            dbname=db_name,
            user=db_user,
            password=db_password,
            sslmode=db_sslmode,
        )
    except Exception as exc:
        status["error"] = f"Database connection failed: {exc}"
        return status

    try:
        with conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                latest_version_row = fetch_optional_single_row(
                    cursor,
                    table_name="system_db_version",
                    query="""
                    SELECT id, version, applied_at, description
                    FROM system_db_version
                    ORDER BY applied_at DESC NULLS LAST, id DESC
                    LIMIT 1
                    """,
                )
                identity_row = fetch_optional_single_row(
                    cursor,
                    table_name="system_database_identity",
                    query="""
                    SELECT
                        id,
                        database_id,
                        database_role,
                        source_database_id,
                        source_db_version,
                        source_app_version,
                        source_git_commit,
                        notes,
                        created,
                        updated,
                        last_refresh_at
                    FROM system_database_identity
                    ORDER BY id ASC
                    LIMIT 1
                    """,
                )

                status["database"]["latest_version_row"] = latest_version_row
                status["database"]["identity_row"] = identity_row
    finally:
        conn.close()

    latest_version = None
    if status["database"]["latest_version_row"] is None:
        status["warnings"].append("system_db_version table is missing or empty.")
    else:
        latest_version = str(status["database"]["latest_version_row"]["version"])
        if latest_version != repo_db_version:
            status["warnings"].append(
                f"DB latest version {latest_version} does not match VERSION_DB {repo_db_version}."
            )

    if status["database"]["identity_row"] is None:
        status["warnings"].append("system_database_identity table is missing or empty.")

    shared_dev_storage = status["shared_dev_storage"]
    if shared_dev_storage["enabled"]:
        remote = shared_dev_storage.get("remote") or {}
        local = shared_dev_storage["local"]
        if not remote or not remote.get("reachable"):
            remote_error = remote.get("error") or "Shared-dev storage VPS is unreachable."
            status["warnings"].append(f"Shared-dev storage unreachable: {remote_error}")
        else:
            if remote.get("storage_present") != "yes":
                status["warnings"].append("Shared-dev VPS storage/ root is missing.")
            if remote.get("storage_deleted_present") != "yes":
                status["warnings"].append("Shared-dev VPS storage_deleted/ root is missing.")
        if not local["last_pull_state"]:
            status["warnings"].append(
                "Shared-dev storage is enabled, but this machine has not pulled the VPS storage cache yet."
            )
        if local["session_state"] and not local["daemon_running"]:
            status["warnings"].append(
                "Shared-dev storage session is prepared locally, but the sync daemon is not running."
            )

    status["checks"] = [
        {
            "name": "manifest_row_present",
            "level": "ok" if manifest_row is not None else "warn",
            "message": (
                f"Manifest row found for app {repo_app_version}."
                if manifest_row is not None
                else f"Manifest row missing for app {repo_app_version}."
            ),
        },
        {
            "name": "manifest_targets_repo_db_version",
            "level": (
                "ok"
                if manifest_row is not None and manifest_row.get("target_db_version") == repo_db_version
                else "warn"
            ),
            "message": (
                f"Manifest target_db_version matches VERSION_DB {repo_db_version}."
                if manifest_row is not None and manifest_row.get("target_db_version") == repo_db_version
                else "Manifest target_db_version does not match VERSION_DB."
            ),
        },
        {
            "name": "db_version_matches_repo",
            "level": "ok" if latest_version == repo_db_version else "warn",
            "message": (
                f"Latest DB version matches VERSION_DB {repo_db_version}."
                if latest_version == repo_db_version
                else f"Latest DB version is {latest_version or 'missing'}, expected {repo_db_version}."
            ),
        },
        {
            "name": "identity_table_present",
            "level": "ok" if status["database"]["identity_row"] is not None else "warn",
            "message": (
                "system_database_identity row found."
                if status["database"]["identity_row"] is not None
                else "system_database_identity row missing."
            ),
        },
    ]

    if shared_dev_storage["enabled"]:
        remote = shared_dev_storage.get("remote") or {}
        local = shared_dev_storage["local"]
        status["checks"].extend(
            [
                {
                    "name": "shared_dev_storage_remote_reachable",
                    "level": "ok" if remote.get("reachable") else "warn",
                    "message": (
                        "Shared-dev storage VPS is reachable."
                        if remote.get("reachable")
                        else f"Shared-dev storage VPS is unreachable: {remote.get('error', 'unknown error')}."
                    ),
                },
                {
                    "name": "shared_dev_storage_cache_pulled",
                    "level": "ok" if local["last_pull_state"] else "warn",
                    "message": (
                        "This machine has pulled the shared-dev storage cache."
                        if local["last_pull_state"]
                        else "This machine has not pulled the shared-dev storage cache yet."
                    ),
                },
                {
                    "name": "shared_dev_storage_sync_daemon",
                    "level": "ok" if (not local["session_state"] or local["daemon_running"]) else "warn",
                    "message": (
                        "Shared-dev storage sync daemon is running for the active local session."
                        if local["session_state"] and local["daemon_running"]
                        else (
                            "No active shared-dev storage session is currently held locally."
                            if not local["session_state"]
                            else "Shared-dev storage sync daemon is not running for the active local session."
                        )
                    ),
                },
            ]
        )

    return status


def print_human_status(status: dict[str, Any]) -> None:
    print("Easelect dev status")
    print("===================")
    print("")

    repo = status["repo"]
    manifest = status.get("manifest")
    database_target = status["database_target"]
    database = status["database"]
    shared_dev_storage = status["shared_dev_storage"]

    print("Repo")
    print(f"  {repo.get('app_version_file', 'VERSION_EASELECT')}: {repo['app_version']}")
    print(f"  VERSION_DB:       {repo['db_version']}")
    print("")

    print("Manifest")
    if manifest is None:
        print("  current row:      missing")
    else:
        print(f"  app_version:      {manifest.get('app_version', '')}")
        print(f"  min_db_version:   {manifest.get('min_db_version', '')}")
        print(f"  target_db_version:{' ' if len(str(manifest.get('target_db_version', ''))) < 1 else ''}{manifest.get('target_db_version', '')}")
        print(f"  schema_snapshot:  {manifest.get('schema_snapshot_path', '')}")
        bootstrap_path = manifest.get("bootstrap_seed_artifact_path")
        print(f"  bootstrap_seed:   {bootstrap_path or '(not set)'}")
    print("")

    print("Database target")
    print(f"  host:             {database_target['host']}")
    print(f"  port:             {database_target['port']}")
    print(f"  name:             {database_target['name']}")
    print(f"  readonly_user:    {database_target['readonly_user']}")
    print(f"  sslmode:          {database_target['sslmode']}")
    print("")

    if status.get("error"):
        print("Database state")
        print(f"  error:            {status['error']}")
    else:
        print("Database state")
        latest_version_row = database["latest_version_row"]
        if latest_version_row is None:
            print("  latest_version:   missing")
        else:
            print(f"  latest_version:   {latest_version_row.get('version')}")
            print(f"  applied_at:       {latest_version_row.get('applied_at')}")
            print(f"  description:      {latest_version_row.get('description') or '(empty)'}")

        identity_row = database["identity_row"]
        if identity_row is None:
            print("  identity_row:     missing")
        else:
            print(f"  database_id:      {identity_row.get('database_id')}")
            print(f"  database_role:    {identity_row.get('database_role')}")
            print(f"  source_database_id:{' ' if len(str(identity_row.get('source_database_id') or '')) < 1 else ''}{identity_row.get('source_database_id') or '(none)'}")
            print(f"  source_db_version:{' ' if len(str(identity_row.get('source_db_version') or '')) < 1 else ''}{identity_row.get('source_db_version') or '(none)'}")
            print(f"  last_refresh_at:  {identity_row.get('last_refresh_at') or '(none)'}")
    print("")

    print("Shared-dev storage")
    print(
        "  enabled:          "
        + ("yes" if shared_dev_storage["enabled"] else "no")
    )
    target = shared_dev_storage["target"]
    print(f"  host:             {target['host'] or '(not set)'}")
    print(f"  user:             {target['user'] or '(not set)'}")
    print(f"  root:             {target['root']}")
    local_storage = shared_dev_storage["local"]
    print(f"  storage_files:    {local_storage['storage_file_count']}")
    print(f"  deleted_files:    {local_storage['storage_deleted_file_count']}")
    print(
        f"  sync_daemon:      "
        f"{'running' if local_storage['daemon_running'] else 'stopped'}"
    )
    print(
        f"  last_pull:        "
        f"{local_storage['last_pull_state'].get('UPDATED_ISO_UTC', '(never)')}"
    )
    print(
        f"  last_push:        "
        f"{local_storage['last_push_state'].get('UPDATED_ISO_UTC', '(never)')}"
    )
    remote_storage = shared_dev_storage.get("remote") or {}
    if shared_dev_storage["enabled"]:
        print(
            f"  remote_status:    "
            f"{'reachable' if remote_storage.get('reachable') else 'unreachable'}"
        )
        if remote_storage.get("reachable"):
            print(f"  remote_storage:   {remote_storage.get('storage_present')}")
            print(f"  remote_deleted:   {remote_storage.get('storage_deleted_present')}")
            print(
                f"  remote_lease:     "
                f"{remote_storage.get('lease_owner_tag') or '(none)'}"
            )
        else:
            print(f"  remote_error:     {remote_storage.get('error') or '(unknown)'}")
    print("")

    print("Checks")
    for check in status["checks"]:
        marker = "OK" if check["level"] == "ok" else "WARN"
        print(f"  [{marker}] {check['message']}")

    if status.get("warnings"):
        print("")
        print("Warnings")
        for warning in status["warnings"]:
            print(f"  - {warning}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inspect the tracked app/DB pair and the active development DB."
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable JSON instead of the human summary.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero when warnings are present.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        status = collect_status()
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(status, indent=2, default=str))
    else:
        print_human_status(status)

    if status.get("error"):
        return 1
    if args.strict and status.get("warnings"):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
