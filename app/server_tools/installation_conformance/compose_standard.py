"""compose_standard.py
Render the shipped public Compose contract with synthetic secrets in memory.
Connect explicit non-secret deployment parameters to the shared fragment policy.
Keep operator files, inherited settings and the Docker engine outside this command.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import shutil
import subprocess

from server_tools.lib.docker_compose_contract import compose_options, edge_scheme

APP_ROOT = Path(__file__).resolve().parents[2]
ROOT = APP_ROOT.parent
PARAMETER_KEYS = {
    "installation_root", "COMPOSE_PROJECT_NAME", "INSTANCE_NAME", "APP_PORT", "DB_PORT",
    "APP_BIND_HOST", "DB_BIND_HOST", "FILTEREST_EDGE", "FILTEREST_PUBLISH_DB_PORT",
    "FILTEREST_NETWORK_SUBNET", "FILTEREST_NETWORK_GATEWAY", "BASE_URL",
    "SITE_NAME", "SITE_SLUG",
}
REQUIRED_SECRETS = (
    "DB_ADMIN_PASSWORD", "DB_READONLY_PASSWORD", "DB_CONFIDENTIAL_PASSWORD",
    "DB_BASIC_PASSWORD", "DB_GUEST_PASSWORD", "SESSION_KEY", "SESSION_SECRET_KEY",
)


class EvidenceError(ValueError):
    """A fixed, path-free refusal safe for the JSON diagnostic boundary."""


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                    ensure_ascii=True).encode()).hexdigest()


def tmpfs_facts(value: object) -> dict:
    """Normalize Compose lists and Docker maps to numeric tmpfs access limits."""
    if isinstance(value, list):
        value = dict(item.split(":", 1) for item in value)
    if not isinstance(value, dict):
        raise ValueError("invalid tmpfs")
    result = {}
    for target, options in value.items():
        fields = dict(item.split("=", 1) for item in options.split(","))
        size = fields["size"].lower()
        multiplier = {"k": 1024, "m": 1024 ** 2, "g": 1024 ** 3}.get(size[-1], 1)
        result[target] = {"mode": fields["mode"],
                          "size": int(size[:-1] if multiplier != 1 else size) * multiplier}
    return result


def validate_parameters(parameters: object) -> dict[str, str]:
    """Accept only operator-selected public settings; credentials are never inputs."""
    if not isinstance(parameters, dict) or set(parameters) - PARAMETER_KEYS:
        raise EvidenceError("Parameters must be an object containing only documented non-secret keys")
    settings = {}
    for key, value in parameters.items():
        if isinstance(value, bool):
            value = str(value).lower()
        elif isinstance(value, int):
            value = str(value)
        if not isinstance(value, str) or any(character in value for character in ("\n", "\r", "\x00")):
            raise EvidenceError("Parameter values must be single-line strings, integers or booleans")
        settings[key] = value
    root = settings.get("installation_root", "")
    if not root.startswith("/") or str(PurePosixPath(root)) != root or ".." in PurePosixPath(root).parts:
        raise EvidenceError("installation_root must be a canonical absolute POSIX path")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", settings.get("COMPOSE_PROJECT_NAME", "")):
        raise EvidenceError("COMPOSE_PROJECT_NAME must be explicitly selected using the public Compose identity syntax")
    for key, default in (("APP_PORT", "8100"), ("DB_PORT", "5433")):
        value = settings.setdefault(key, default)
        if not value.isascii() or not value.isdigit() or not 1 <= int(value) <= 65535:
            raise EvidenceError("Published ports must be integers between 1 and 65535")
    for key in ("APP_BIND_HOST", "DB_BIND_HOST"):
        try:
            ipaddress.ip_address(settings.setdefault(key, "127.0.0.1"))
        except ValueError:
            raise EvidenceError("Bind hosts must be literal IP addresses") from None
    try:
        scheme = edge_scheme(settings.get("FILTEREST_EDGE", ""))
        selected = compose_options(settings.get("FILTEREST_PUBLISH_DB_PORT", ""),
                                   settings.get("FILTEREST_NETWORK_SUBNET", ""),
                                   settings.get("FILTEREST_NETWORK_GATEWAY", ""))
    except ValueError as error:
        raise EvidenceError(str(error)) from None
    if scheme == "http" and settings["APP_BIND_HOST"] != "127.0.0.1":
        raise EvidenceError("Host-proxy mode requires the application loopback binding")
    settings.update(selected)
    settings["FILTEREST_LOCAL_TLS"] = "true" if scheme == "https" else "false"
    # These are Compose defaults, not a fresh-install identity generator. Old
    # installations may deliberately retain arbitrary stored instance names.
    settings.setdefault("INSTANCE_NAME", "filterest-local")
    return settings


def compose_environment(settings: dict[str, str]) -> dict[str, str]:
    """Build a fresh environment; no inherited Compose, credential or proxy state."""
    environment = {
        # Compose may be installed as a user CLI plugin. Use the actual account
        # home for discovery, not an inherited HOME/DOCKER_CONFIG override.
        "PATH": os.defpath, "LC_ALL": "C", "HOME": pwd.getpwuid(os.getuid()).pw_dir,
        "COMPOSE_DISABLE_ENV_FILE": "1", "COMPOSE_ANSI": "never",
        "DOCKER_HOST": "unix:///nonexistent-filterest-conformance-engine",
    }
    environment.update({key: value for key, value in settings.items() if key != "installation_root"})
    environment.update({key: "synthetic-conformance-secret" for key in REQUIRED_SECRETS})
    return environment


def source_identity(settings: dict[str, str]) -> dict:
    """Identify exact local contract bytes without Git or installation records."""
    paths = [ROOT / "compose.yml", APP_ROOT / "docker/docker-compose.yml",
             APP_ROOT / "docker/docker-compose.db-base.yml",
             APP_ROOT / "docker" / settings.get("FILTEREST_DB_PORTS_FILE", "docker-compose.db-published.yml"),
             APP_ROOT / "docker" / settings.get("FILTEREST_NETWORK_FILE", "docker-compose.network-auto.yml")]
    paths += [Path(__file__), APP_ROOT / "server_tools/lib/docker_compose_contract.py",
              APP_ROOT / "server_tools/lib/docker_network_validator.py",
              Path(__file__).with_name("snapshot_facts.py"), Path(__file__).with_name("check_installation.py")]
    hashes = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
              for path in sorted(paths)}
    return {"sha256": digest(hashes), "files": hashes}


def render_standard(settings: dict[str, str]) -> dict:
    """Use Compose config only; never build, inspect, start or contact the engine."""
    executable = shutil.which("docker")
    if executable is None:
        raise EvidenceError("docker compose CLI is required for offline config rendering; no engine is needed")
    try:
        completed = subprocess.run(
            [executable, "compose", "--file", str(ROOT / "compose.yml"), "--env-file", os.devnull,
             "--project-name", settings["COMPOSE_PROJECT_NAME"], "config", "--format", "json"],
            env=compose_environment(settings), cwd=ROOT, capture_output=True, text=True,
            timeout=30, check=False,
        )
        if completed.returncode:
            raise EvidenceError("docker compose config failed; install a CLI supporting the shipped include contract")
        rendered = json.loads(completed.stdout)
        if not isinstance(rendered, dict) or set(rendered.get("services", {})) != {"app", "db"}:
            raise EvidenceError("Compose did not render the complete public application/database contract")
        return rendered
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        raise EvidenceError("docker compose config could not produce valid offline evidence") from None


def installation_path(source: str, settings: dict[str, str]) -> str:
    """Relocate only shipped local bind sources, preserving exact target identities."""
    try:
        relative = Path(source).relative_to(ROOT)
    except ValueError:
        raise EvidenceError("Rendered bind source escaped the shipped installation layout") from None
    return str(PurePosixPath(settings["installation_root"]) / relative)


def standard_facts(rendered: dict, settings: dict[str, str]) -> dict:
    """Project Compose to redacted comparable facts; discard every environment value."""
    facts = {}
    for role in ("app", "db"):
        service = rendered["services"][role]
        facts[f"{role}_mounts"] = sorted([
            {"type": mount["type"], "source": installation_path(mount["source"], settings),
             "target": mount["target"], "read_only": mount.get("read_only", False)}
            for mount in service["volumes"]], key=lambda item: item["target"])
        facts[f"{role}_ports"] = sorted([
            {"target": int(port["target"]), "published": int(port["published"]),
             "host_ip": port.get("host_ip", "0.0.0.0"), "protocol": port.get("protocol", "tcp")}
            for port in service.get("ports", [])], key=lambda item: (item["target"], item["host_ip"]))
        facts[f"{role}_authority"] = {
            "project": settings["COMPOSE_PROJECT_NAME"], "service": role,
            "working_directory": settings["installation_root"],
            "config_files": [str(PurePosixPath(settings["installation_root"]) / "compose.yml")],
        }
        facts[f"{role}_environment_keys"] = {
            "declared": sorted(service["environment"]),
            "required_runtime": sorted(key for key, value in service["environment"].items() if value is not None),
        }
    facts["network_authority"] = {"name": rendered["networks"]["default"]["name"],
                                  "project": settings["COMPOSE_PROJECT_NAME"], "network": "default",
                                  "app_networks": [rendered["networks"]["default"]["name"]],
                                  "db_networks": [rendered["networks"]["default"]["name"]]}
    config = rendered["networks"]["default"].get("ipam", {}).get("config") or []
    facts["network_addressing"] = {"allocation": "pinned" if config else "automatic",
                                  "config": config}
    application = rendered["services"]["app"]
    facts["application_hardening"] = {
        "read_only": application["read_only"], "privileged": application.get("privileged", False),
        "cap_drop": sorted(application["cap_drop"]),
        "cap_add": sorted(application.get("cap_add", [])),
        "security_opt": sorted(application["security_opt"]),
        "tmpfs": {},
    }
    facts["application_hardening"]["tmpfs"] = tmpfs_facts(application["tmpfs"])
    # Compose config escapes literal dollars for serialization. Compare the
    # resulting runtime identity, preserving the operator's literal name.
    identity = {key: application["environment"][key].replace("$$", "$")
                for key in ("INSTANCE_NAME", "SESSION_COOKIE_MODE", "SESSION_COOKIE_NAME")}
    facts["application_identity"] = {"sha256": digest(identity)}
    return facts
