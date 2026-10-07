#!/usr/bin/env python3
"""docker_network_validator.py
Validate pinned IPv4 ranges, Compose folder ownership and network selection changes.
Connect the public shell runner to read-only Docker container/network inventories.
Refuse ambiguous inspection before Compose can replace another installation's state.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
from pathlib import Path
import sys

# Explicit IPv4 special-use blocks avoid Python-version-dependent is_private
# classifications (which also classify documentation/benchmark ranges as private).
RESERVED_NETWORKS = tuple(map(ipaddress.IPv4Network, (
    "0.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
    "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "198.18.0.0/15",
    "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
)))
PRIVATE_NETWORKS = tuple(map(ipaddress.IPv4Network, (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
)))


def pinned_network(subnet: str, gateway: str) -> tuple[ipaddress.IPv4Network, ipaddress.IPv4Address]:
    network = ipaddress.IPv4Network(subnet, strict=True)
    if network.prefixlen > 29:
        raise ValueError("FILTEREST_NETWORK_SUBNET must leave addresses for the gateway and both containers (at least /29)")
    if str(network) != subnet:
        raise ValueError("FILTEREST_NETWORK_SUBNET must use canonical IPv4 CIDR notation")
    if any(network.overlaps(reserved) for reserved in RESERVED_NETWORKS):
        raise ValueError("FILTEREST_NETWORK_SUBNET overlaps a reserved/special-use IPv4 range")
    address = ipaddress.IPv4Address(gateway) if gateway else network.network_address + 1
    if address not in network or address in (network.network_address, network.broadcast_address):
        raise ValueError("FILTEREST_NETWORK_GATEWAY must be a usable address inside FILTEREST_NETWORK_SUBNET")
    return network, address


def read_inventory(path: Path, expected: int) -> list[dict]:
    inventory = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(inventory, list) or len(inventory) != expected:
        raise ValueError("Docker inspection returned an incomplete or invalid inventory")
    if any(not isinstance(item, dict) for item in inventory):
        raise ValueError("Invalid Docker inventory entry")
    return inventory


def check_project_ownership(project: str, working_directory: str,
                            networks: list[dict], containers: list[dict]) -> None:
    """Check running and stopped containers, and any network folder labels.

    Compose normally puts working_dir on containers only. A network without that
    label is valid; when the label is present it must identify this exact folder.
    Missing container ownership labels cannot establish a safe replacement.
    """
    for item in [*networks, *containers]:
        container = "Config" in item
        labels = item["Config"]["Labels"] if container else item.get("Labels") or {}
        if not isinstance(labels, dict):
            raise ValueError("Invalid Docker project labels")
        if labels.get("com.docker.compose.project") != project:
            continue
        directory = labels.get("com.docker.compose.project.working_dir")
        if directory is None and not container:
            continue
        if not isinstance(directory, str) or not directory or not Path(directory).is_absolute():
            raise ValueError(f"Compose project {project!r} has no usable working-directory label; cannot verify folder ownership")
        if Path(directory).resolve() != Path(working_directory).resolve():
            raise ValueError(f"Compose project {project!r} belongs to a different installation folder ({directory}); "
                             "if this installation moved, run ./filterest docker stop in that folder first, "
                             "otherwise choose a different project name")
    for item in containers:
        if item["Config"]["Labels"].get("com.docker.compose.project") != project:
            raise ValueError("Docker container inspection did not match the requested Compose project")


def check_collisions(network: ipaddress.IPv4Network | None, gateway: ipaddress.IPv4Address | None,
                     project: str, inventory: object, previous_selection: str) -> None:
    """Reject overlaps, IPAM drift and allocation-mode changes in either direction.

    The runner owns its stored fragment selector, which records the previous
    selection. Automatic networks also have Docker-assigned IPAM, so their actual
    addresses alone cannot tell whether the operator explicitly pinned them.
    """
    if not isinstance(inventory, list):
        raise ValueError("Docker network inventory must be a JSON list")
    selection = "docker-compose.network-pinned.yml" if network else "docker-compose.network-auto.yml"
    for item in inventory:
        if not isinstance(item, dict):
            raise ValueError("Invalid Docker network inventory entry")
        labels = item.get("Labels") or {}
        own_network = (labels.get("com.docker.compose.project") == project
                       and labels.get("com.docker.compose.network") == "default")
        if own_network and selection != previous_selection:
            raise ValueError("This project's network selection changed; stop first with ./filterest docker stop, then review and start again")
        configurations = item["IPAM"]["Config"] or []
        ipv4_configurations = []
        for configuration in configurations:
            subnet = configuration.get("Subnet")
            if not subnet:
                continue
            existing = ipaddress.ip_network(subnet, strict=True)
            if existing.version != 4:
                continue
            ipv4_configurations.append(configuration)
            if network and existing.overlaps(network) and not own_network:
                raise ValueError(f"Pinned subnet {network} overlaps Docker network {item.get('Name')!r} ({existing})")
        if network and own_network and (len(ipv4_configurations) != 1
                                       or ipv4_configurations[0].get("Subnet") != str(network)
                                       or ipv4_configurations[0].get("Gateway") != str(gateway)):
            raise ValueError("This project's existing default network has different IPAM settings; stop first with ./filterest docker stop and review the network change")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--subnet", default="")
    parser.add_argument("--gateway", default="")
    parser.add_argument("--project", default="")
    parser.add_argument("--working-directory", default="")
    parser.add_argument("--previous-selection", default="docker-compose.network-auto.yml")
    parser.add_argument("--networks", type=Path)
    parser.add_argument("--expected-networks", type=int, default=0)
    parser.add_argument("--containers", type=Path)
    parser.add_argument("--expected-containers", type=int, default=0)
    arguments = parser.parse_args()
    try:
        network, gateway = pinned_network(arguments.subnet, arguments.gateway) if arguments.subnet else (None, None)
        if arguments.networks:
            networks = read_inventory(arguments.networks, arguments.expected_networks)
            containers = read_inventory(arguments.containers, arguments.expected_containers)
            check_project_ownership(arguments.project, arguments.working_directory, networks, containers)
            check_collisions(network, gateway, arguments.project, networks, arguments.previous_selection)
        elif network and not any(network.subnet_of(private) for private in PRIVATE_NETWORKS):
            print("warning: Pinned Docker subnet is outside private RFC 1918 ranges; it can shadow public routes.", file=sys.stderr)
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        print(f"error: Invalid or conflicting Docker project/network: {error}", file=sys.stderr)
        return 1
    print(gateway or "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
