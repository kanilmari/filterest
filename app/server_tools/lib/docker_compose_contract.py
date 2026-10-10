#!/usr/bin/env python3
"""docker_compose_contract.py
Select the public edge transport and Compose fragments in one place.
Connect deployment planning and offline conformance to the same selection policy.
Keep defaults and explicit-selector writes stable without reading installation settings.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from server_tools.lib.docker_network_validator import PRIVATE_NETWORKS, pinned_network


def edge_scheme(edge: str) -> str:
    """Choose internal transport; the operator's public URL is independent."""
    if edge in ("", "local-tls"):
        return "https"
    if edge == "host-proxy":
        return "http"
    raise ValueError("FILTEREST_EDGE must be local-tls or host-proxy")


def compose_options(publish_db: str = "", subnet: str = "", gateway: str = "",
                    previous_ports: str = "", previous_network: str = "") -> dict[str, str]:
    """Plan selectors and a validated gateway, preserving default file contents.

    Previously stored selector presence causes an explicit reset to the default;
    its value never grants authority to load an arbitrary Compose file.
    """
    if publish_db not in ("", "true", "false"):
        raise ValueError("FILTEREST_PUBLISH_DB_PORT must be true or false")
    settings = {}
    ports_file = "docker-compose.db-private.yml" if publish_db == "false" else "docker-compose.db-published.yml"
    if publish_db or previous_ports:
        settings["FILTEREST_DB_PORTS_FILE"] = ports_file
    network_file = "docker-compose.network-auto.yml"
    if subnet:
        _, address = pinned_network(subnet, gateway)
        settings["FILTEREST_NETWORK_GATEWAY"] = str(address)
        network_file = "docker-compose.network-pinned.yml"
    elif gateway:
        raise ValueError("FILTEREST_NETWORK_GATEWAY requires FILTEREST_NETWORK_SUBNET")
    if subnet or previous_network:
        settings["FILTEREST_NETWORK_FILE"] = network_file
    return settings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("edge", "options"))
    parser.add_argument("--edge", default="")
    parser.add_argument("--publish-db", default="")
    parser.add_argument("--subnet", default="")
    parser.add_argument("--gateway", default="")
    parser.add_argument("--previous-ports", default="")
    parser.add_argument("--previous-network", default="")
    args = parser.parse_args()
    try:
        if args.action == "edge":
            print(edge_scheme(args.edge), end="")
        else:
            settings = compose_options(args.publish_db, args.subnet, args.gateway,
                                       args.previous_ports, args.previous_network)
            if args.subnet:
                network, _ = pinned_network(args.subnet, args.gateway)
                if not any(network.subnet_of(private) for private in PRIVATE_NETWORKS):
                    print("warning: Pinned Docker subnet is outside private RFC 1918 ranges; it can shadow public routes.", file=sys.stderr)
            for key, value in settings.items():
                print(f"{key}={value}")
        return 0
    except ValueError as error:
        # These errors are fixed policy explanations, never input values.
        prefix = "error: "
        if args.action == "options" and args.subnet and args.publish_db in ("", "true", "false"):
            prefix += "Invalid or conflicting Docker project/network: "
        print(prefix + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
