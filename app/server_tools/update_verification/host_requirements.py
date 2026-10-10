# host_requirements.py
# Checks native host facts and shared-filesystem capacity against signed requirements.
# Connects fresh operator observations and statvfs measurements to offline preflight.
# Prevents per-purpose checks from double-spending the same free space or inodes.
"""No service, database or image commands are invoked while checking the host."""
from __future__ import annotations

from datetime import datetime, timezone
import os
import platform

from server_tools.release.bundle_contract import BundleError
from server_tools.update_verification.installation_evidence import (
    exact_keys, no_symlinks, positive_integer, semantic_version,
)


def check_platform(manifest, observation):
    """Require the actual local CPU/OS plus fresh, independently collected service versions."""
    try:
        sampled = datetime.strptime(observation["observed_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError as error:
        raise BundleError("observation time must be canonical UTC") from error
    age = (datetime.now(timezone.utc) - sampled).total_seconds()
    if age < -5 or age > 300:
        raise BundleError("installation observation is stale or from the future")
    facts = observation["platform"]
    exact_keys(facts, {"os", "architecture", "cpu_features", "postgresql_major", "extensions",
                       "docker_engine_version", "docker_compose_version"}, "host platform")
    local_arch = {"x86_64": "amd64", "aarch64": "arm64"}.get(platform.machine())
    if facts["os"] != platform.system().lower() or facts["architecture"] != local_arch:
        raise BundleError("observed platform differs from this installation host")
    if not isinstance(facts["cpu_features"], list) or any(not isinstance(item, str) for item in facts["cpu_features"]):
        raise BundleError("host CPU features must be an array")
    docker = manifest["platform"].get("docker")
    if docker is None:
        raise BundleError("this managed verifier requires a signed prebuilt OCI image and Docker requirements")
    if (semantic_version(facts["docker_engine_version"]) < semantic_version(docker["min_engine_version"])
            or semantic_version(facts["docker_compose_version"]) < semantic_version(docker["min_compose_version"])):
        raise BundleError("host Docker engine or Compose version is below the signed requirement")
    pg = manifest["platform"]["postgresql"]
    positive_integer(facts["postgresql_major"], "PostgreSQL major")
    if not pg["min_major"] <= facts["postgresql_major"] <= pg["max_major"]:
        raise BundleError("host PostgreSQL major is outside the approved range")
    if not isinstance(facts["extensions"], dict):
        raise BundleError("host PostgreSQL extension versions must be an object")
    for extension in pg["extensions"]:
        if (extension["name"] not in facts["extensions"]
                or semantic_version(facts["extensions"][extension["name"]]) < semantic_version(extension["min_version"])):
            raise BundleError("required PostgreSQL extension is absent or too old: " + extension["name"])
    if set(manifest["protocol"]["required_capabilities"]) - set(observation["capabilities"]):
        raise BundleError("host lacks required updater capabilities")
    return facts


def check_capacity(manifest, observation, payload):
    """Measure available bytes/inodes now; aggregate allocations and reserves by device."""
    requirements = manifest["capacity"]
    allocations = requirements["allocations"]
    purposes = {item["purpose"] for item in allocations}
    if set(observation["capacity_paths"]) != purposes or set(observation["capacity_minimums"]) != purposes:
        raise BundleError("capacity observations must cover every signed allocation purpose exactly")
    floors = {
        "staging": {"bytes": sum(payload["sizes"].values()), "inodes": len(payload["sizes"])},
        "expanded_release": {"bytes": payload["expanded_bytes"], "inodes": payload["source_inodes"]},
        "docker_storage": {"bytes": payload["image_expanded_bytes"], "inodes": payload["image_inodes"]},
    }
    devices = {}
    for allocation in allocations:
        purpose = allocation["purpose"]
        minimum = observation["capacity_minimums"][purpose]
        exact_keys(minimum, {"bytes", "inodes"}, "observed capacity minimum")
        for key in minimum:
            positive_integer(minimum[key], "observed capacity " + key)
        path_value = observation["capacity_paths"][purpose]
        if not isinstance(path_value, str) or not path_value.startswith("/"):
            raise BundleError("capacity mount paths must be absolute")
        path = no_symlinks(path_value)
        if not path.is_dir():
            raise BundleError("capacity mount must be an existing directory")
        metadata, available = path.stat(), os.statvfs(path)
        if available.f_flag & getattr(os, "ST_RDONLY", 1):
            raise BundleError("capacity mount is read-only")
        device = str(metadata.st_dev)
        sampled = {"available_bytes": available.f_bavail * available.f_frsize,
                   "total_bytes": available.f_blocks * available.f_frsize,
                   "available_inodes": available.f_favail}
        group = devices.setdefault(device, {**sampled, "required_bytes": 0, "required_inodes": 0, "purposes": []})
        # A shared device can expose tighter quotas through another path. Never
        # keep the more generous sample or apply a separate reserve per purpose.
        group["available_bytes"] = min(group["available_bytes"], sampled["available_bytes"])
        group["available_inodes"] = min(group["available_inodes"], sampled["available_inodes"])
        group["total_bytes"] = max(group["total_bytes"], sampled["total_bytes"])
        floor = floors.get(purpose, {"bytes": 0, "inodes": 0})
        group["required_bytes"] += max(allocation["bytes"], minimum["bytes"], floor["bytes"])
        group["required_inodes"] += max(allocation["inodes"], minimum["inodes"], floor["inodes"])
        group["purposes"].append(purpose)
    for group in devices.values():
        group["reserve_bytes"] = requirements["reserve_bytes"] + (group["total_bytes"] * requirements["reserve_percent"] + 99) // 100
        if (group["available_bytes"] < group["required_bytes"] + group["reserve_bytes"]
                or group["available_inodes"] < group["required_inodes"]):
            raise BundleError("insufficient free bytes or inodes for combined allocations and reserve")
    return devices
