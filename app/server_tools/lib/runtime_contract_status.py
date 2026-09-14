"""runtime_contract_status.py
What: Describes configured runtime resources without contacting any service.
Between what: Reuses public path resolvers and dev_status's merged environment.
Why: Keeps local configuration evidence separate from live readiness and secrets.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from .dev_status_path_resolver import DevStatusPaths
from .filterest_paths import resolve_filterest_homes

DATABASE_ROLES = ("admin", "readonly", "confidential", "basic", "guest")
INSTALL_PROFILES = ("admin", "development", "docker")
CONFIGURATION_ERROR = "Runtime configuration could not be resolved; check the protected environment and path configuration."


def _public_target_value(value: str, pattern: str) -> str | None:
    # A mistakenly supplied URI/DSN can contain credentials. Never echo it.
    value = value.strip()
    if not value:
        return None
    return value if re.fullmatch(pattern, value) else "(redacted invalid value)"


def resolve_database_sslmode(environment: Mapping[str, str]) -> str:
    """Preserve the shared dev-status/backend SSL-mode fallback."""
    sslmode = environment.get("DB_SSLMODE", "").strip()
    if sslmode:
        return sslmode
    return "disable" if environment.get("ENVIRONMENT_TYPE", "").strip() == "dev" else "require"


def collect_runtime_contract(
    paths: DevStatusPaths, environment: Mapping[str, str]
) -> dict[str, Any]:
    """Describe configured paths and credential presence, not running identity.

    Uses the same read-only resolvers as dev_status; missing homes stay missing.
    Only allowlisted public fields escape the protected environment boundary.
    """
    profile = environment.get("FILTEREST_INSTALL_PROFILE", "").strip()
    result: dict[str, Any] = {
        "evidence": "configured_environment",
        "paths_evidence": "tooling_and_layout_configuration",
        "profile": {
            "configured": profile if profile in INSTALL_PROFILES else None,
            "state": ("configured" if profile in INSTALL_PROFILES else
                      "unknown" if profile else "not_configured"),
            "supported": list(INSTALL_PROFILES),
        },
        "paths": {},
        "database": {
            "target": {
                "host": _public_target_value(environment.get("DB_HOST", ""), r"[A-Za-z0-9_.:/\[\]-]+"),
                "port": _public_target_value(environment.get("DB_PORT", ""), r"[0-9]+"),
                "name": _public_target_value(environment.get("DB_NAME", ""), r"[A-Za-z0-9_.-]+"),
                "sslmode": _public_target_value(
                    resolve_database_sslmode(environment),
                    r"disable|allow|prefer|require|verify-ca|verify-full",
                ),
            },
            "role_credentials": {
                role: {
                    "user_present": bool(environment.get(f"DB_{role.upper()}_USER", "").strip()),
                    "password_present": bool(environment.get(f"DB_{role.upper()}_PASSWORD", "").strip()),
                }
                for role in DATABASE_ROLES
            },
        },
        "lifecycle": {
            "native": ["./filterest setup --profile admin",
                       "./filterest setup --profile development", "./filterest start", "./ctl"],
            "docker_compose": ["./filterest docker start", "./filterest docker stop",
                               "./filterest docker status", "./filterest docker logs"],
            "startup_may_run_migrations_and_bootstrap": True,
            "separate_migrate_bootstrap_serve_commands": False,
        },
        "liveness": {"status": "not_checked", "endpoint": "/health"},
        "readiness": {"status": "not_checked", "endpoint": "/system/ready",
                      "protected": True},
        "running_identity": {"status": "not_checked"},
        "warnings": [],
    }
    if profile and profile not in INSTALL_PROFILES:
        result["warnings"].append("The configured installation profile is not recognized; its value is not echoed.")
    try:
        homes = resolve_filterest_homes(paths.project_root, environment)
        resolved = {
            "application": paths.application_root,
            "project": paths.project_root,
            "projects_home": homes.projects_home,
            "keys_home": homes.keys_home,
            "runtime_data_home": homes.runtime_data_home,
            "storage": paths.storage_path,
            "storage_deleted": paths.storage_deleted_path,
        }
        result["paths"] = {
            name: {"resolved": str(path), "exists": path.exists()}
            for name, path in resolved.items()
        }
        if any(not item["exists"] for item in result["paths"].values()):
            result["warnings"].append("Some configured paths do not exist; this check did not create them.")
    except Exception:
        # Path configuration can carry secrets in an invalid value or exception.
        result["error"] = CONFIGURATION_ERROR
    return result


def print_runtime_contract(status: dict[str, Any]) -> None:
    """Render only the allowlisted runtime report, preserving the JSON meaning."""
    profile = status.get("profile", {})
    print("Runtime configuration (not a running-instance probe)")
    print(f"  configured profile: {profile.get('configured') or profile.get('state', 'unknown')}")
    print("  paths: tooling and layout configuration (not a universal backend relocation contract)")
    for name, item in status.get("paths", {}).items():
        suffix = "" if item["exists"] else " (missing)"
        print(f"  {name}: {item['resolved']}{suffix}")
    database = status.get("database", {})
    for name, value in database.get("target", {}).items():
        print(f"  database {name}: {value or '(not configured)'}")
    for role, flags in database.get("role_credentials", {}).items():
        print(f"  {role}: user_present={flags['user_present']} password_present={flags['password_present']}")
    print("  liveness: not_checked (/health)")
    print("  readiness: not_checked (protected /system/ready)")
    print("  running identity: not_checked")
    lifecycle = status.get("lifecycle", {})
    for mode in ("native", "docker_compose"):
        if lifecycle.get(mode):
            print(f"  {mode} commands: {', '.join(lifecycle[mode])}")
    print("  startup: may run migrations/bootstrap; no separate migrate/bootstrap/serve commands")
    for warning in status.get("warnings", []):
        print(f"  warning: {warning}")
    if status.get("error"):
        print(f"  error: {status['error']}")


def parse_status_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """Keep the established status flags and add the local-only runtime mode."""
    parser = argparse.ArgumentParser(
        description="Inspect the tracked app/DB pair and the active development DB."
    )
    parser.add_argument("--json", action="store_true",
                        help="Print machine-readable JSON instead of the human summary.")
    parser.add_argument("--strict", action="store_true",
                        help="Exit non-zero when warnings are present.")
    parser.add_argument("--runtime-only", action="store_true",
                        help="Describe local runtime configuration without DB, SSH or HTTP probes.")
    return parser.parse_args(argv)


def run_status_cli(
    args: argparse.Namespace,
    collect_status: Callable[[], dict[str, Any]],
    print_status: Callable[[dict[str, Any]], None],
    collect_runtime: Callable[[], dict[str, Any]],
) -> int:
    """Dispatch local configuration or existing live status without mixing probes.

    Normal status keeps its existing output and exit codes. Runtime-only errors
    are redacted before output because path/environment exceptions can be secret.
    """
    try:
        status = collect_runtime() if args.runtime_only else collect_status()
    except Exception as exc:
        if not args.runtime_only:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        status = {"evidence": "configured_environment", "error": CONFIGURATION_ERROR,
                  "readiness": {"status": "not_checked"},
                  "running_identity": {"status": "not_checked"}}
    if args.json:
        print(json.dumps(status, indent=2, default=str))
    elif args.runtime_only:
        print_runtime_contract(status)
    else:
        print_status(status)
    if status.get("error"):
        return 1
    if args.strict and status.get("warnings"):
        return 2
    return 0
