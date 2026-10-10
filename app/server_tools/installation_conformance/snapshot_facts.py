"""snapshot_facts.py
Adapt saved redacted site-shape sections into bounded comparable facts.
Connect historical collector evidence to the public installation contract.
Keep absent, failed and malformed evidence unknown without exposing raw sections.
"""

from __future__ import annotations

from datetime import datetime
import ipaddress
import json
import re

from server_tools.installation_conformance.compose_standard import EvidenceError, digest, tmpfs_facts

ENVIRONMENT_KEY = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
HASH = re.compile(r"[0-9a-f]{64}\Z")


def unique_object(pairs: list) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise EvidenceError("Duplicate JSON keys are invalid evidence")
        result[key] = value
    return result


def parse_json(text: str) -> object:
    """Reject duplicate keys and non-JSON numbers, including inside section text."""
    def reject_constant(value):
        raise EvidenceError("Non-finite JSON numbers are invalid evidence")
    return json.loads(text, object_pairs_hook=unique_object, parse_constant=reject_constant)


class SnapshotFacts:
    """Keep each evidence failure local so unrelated findings survive."""

    def __init__(self, snapshot: object):
        self.snapshot = snapshot
        self.problems = []
        self.observed_at = None
        self.source_sha256 = None
        self.sections = {}
        if not isinstance(snapshot, dict) or type(snapshot.get("schema")) is not int or snapshot["schema"] != 1:
            self.problems.append("Snapshot must use saved site-shape schema 1")
            return
        if isinstance(snapshot.get("sections"), dict):
            self.sections = snapshot["sections"]
        else:
            self.problems.append("Snapshot sections are missing or invalid")
        try:
            time = snapshot["collected_at"]
            if not isinstance(time, str) or datetime.fromisoformat(time.replace("Z", "+00:00")).tzinfo is None:
                raise ValueError("invalid observation time")
            self.observed_at = time
        except (KeyError, TypeError, ValueError):
            self.problems.append("Snapshot observation time is missing or invalid")
        # Identify the saved source without publishing registry/site records.
        identity = {key: snapshot[key] for key in ("domain", "ssh_target") if key in snapshot}
        if len(identity) == 2 and all(isinstance(value, str) and value for value in identity.values()):
            self.source_sha256 = digest(identity)
        else:
            self.problems.append("Snapshot observation source identity is missing or invalid")

    def section(self, name: str) -> dict | None:
        section = self.sections.get(name)
        if not isinstance(section, dict) or type(section.get("exit")) is not int or section["exit"] != 0:
            return None
        try:
            parsed = parse_json(section["text"])
            if isinstance(parsed, list) and len(parsed) == 1:
                parsed = parsed[0]
            return parsed if isinstance(parsed, dict) else None
        except (EvidenceError, KeyError, TypeError, ValueError, RecursionError):
            return None

    def container_fact(self, role: str, name: str) -> object:
        container = self.section(f"{role}_inspect")
        if container is None:
            return None
        try:
            if name == "mounts":
                mounts = []
                for mount in container["mounts"]:
                    if (not all(isinstance(mount[key], str) for key in ("Type", "Source", "Destination"))
                            or type(mount["RW"]) is not bool):
                        return None
                    # Tmpfs options are checked by the hardening fact. Avoid
                    # counting that same writable tmpfs twice when inspect also
                    # lists it among mounts; unaccounted mounts remain visible.
                    tmpfs = container.get("host_config", {}).get("Tmpfs") or {}
                    if (mount["Type"] == "tmpfs" and mount["Source"] == "" and mount["RW"]
                            and isinstance(tmpfs, dict) and mount["Destination"] in tmpfs):
                        continue
                    mounts.append({"type": mount["Type"], "source": mount["Source"],
                                   "target": mount["Destination"], "read_only": not mount["RW"]})
                return sorted(mounts, key=lambda item: (item["target"], item["source"]))
            if name == "ports":
                ports = []
                bindings = container["host_config"]["PortBindings"]
                if bindings is not None and not isinstance(bindings, dict):
                    return None
                for target, published in (bindings or {}).items():
                    number, protocol = target.split("/")
                    if not 1 <= int(number) <= 65535 or protocol not in ("tcp", "udp", "sctp"):
                        return None
                    for port in published or []:
                        if not 1 <= int(port["HostPort"]) <= 65535:
                            return None
                        ports.append({"target": int(number), "protocol": protocol,
                                      "host_ip": str(ipaddress.ip_address(port["HostIp"])),
                                      "published": int(port["HostPort"])})
                return sorted(ports, key=lambda item: (item["target"], item["host_ip"]))
            if name == "authority":
                labels = container["labels"]
                values = {"project": labels["com.docker.compose.project"],
                          "service": labels["com.docker.compose.service"],
                          "working_directory": labels["com.docker.compose.project.working_dir"],
                          "config_files": labels["com.docker.compose.project.config_files"].split(",")}
                if not all(isinstance(values[key], str) and values[key]
                           for key in ("project", "service", "working_directory")):
                    return None
                return values
        except (KeyError, TypeError, ValueError, AttributeError):
            return None
        return None

    def environment_keys(self, role: str) -> dict | None:
        # Compose declarations are the coverage boundary. Image-inherited keys
        # do not establish that the public Compose contract supplies a site key.
        shape = self.section("compose_shape")
        if shape is None:
            return None
        authority = self.container_fact(role, "authority")
        service = authority["service"] if authority else role
        try:
            environment = shape["services"][service]["environment"]
            if not isinstance(environment, (dict, list)):
                return None
            keys = list(environment)
            if any(not isinstance(key, str) or not ENVIRONMENT_KEY.fullmatch(key) for key in keys):
                return None
            container = self.section(f"{role}_inspect")
            runtime_keys = container["env_keys"]
            if (not isinstance(runtime_keys, list) or
                    any(not isinstance(key, str) or not ENVIRONMENT_KEY.fullmatch(key) for key in runtime_keys)):
                return None
            return {"declared": sorted(set(keys)), "runtime_keys": sorted(set(runtime_keys))}
        except (KeyError, TypeError):
            return None

    def hardening(self) -> dict | None:
        application = self.section("app_inspect")
        if application is None or not isinstance(application.get("host_config"), dict):
            return None
        host = application["host_config"]
        result = {}
        for key, field in (("read_only", "ReadonlyRootfs"), ("privileged", "Privileged")):
            result[key] = host[field] if type(host.get(field)) is bool else None
        for key, field in (("cap_drop", "CapDrop"), ("cap_add", "CapAdd"), ("security_opt", "SecurityOpt")):
            values = host.get(field)
            if field not in host or (values is not None and not isinstance(values, list)):
                result[key] = None
                continue
            values = values or []
            if not all(isinstance(item, str) for item in values):
                result[key] = None
                continue
            if field == "SecurityOpt":
                # Docker may spell the boolean option with '=' or omit ':true'.
                values = [option.replace("=", ":") for option in values]
                values = ["no-new-privileges:true" if option == "no-new-privileges" else option for option in values]
            result[key] = sorted(values)
        try:
            result["tmpfs"] = tmpfs_facts(host["Tmpfs"] or {})
        except (KeyError, TypeError, ValueError, AttributeError, IndexError):
            result["tmpfs"] = None
        return result

    def network_facts(self) -> tuple[dict | None, dict | None]:
        names = sorted(name for name in self.sections if name.startswith("network/"))
        if len(names) != 1:
            return None, None
        network = self.section(names[0])
        if network is None:
            return None, None
        authority = None
        addressing = None
        try:
            labels = network["Labels"]
            authority = {"name": network["Name"], "project": labels["com.docker.compose.project"],
                         "network": labels["com.docker.compose.network"]}
            if any(not isinstance(value, str) or not value for value in authority.values()):
                raise ValueError("invalid network authority")
            for role in ("app", "db"):
                container = self.section(f"{role}_inspect")
                if not isinstance(container["networks"], dict):
                    raise ValueError("invalid network membership")
                authority[f"{role}_networks"] = sorted(container["networks"])
        except (KeyError, TypeError, ValueError):
            authority = None
        try:
            shape = self.section("compose_shape")
            networks = shape["networks"]
            if not isinstance(networks, dict) or len(networks) != 1:
                return authority, None
            declared = next(iter(networks.values())) or {}
            pinned = bool(declared.get("ipam", {}).get("config"))
            config = network["IPAM"]["Config"]
            if not isinstance(config, list) or len(config) != 1:
                return authority, None
            observed = config[0]
            subnet = ipaddress.IPv4Network(observed["Subnet"], strict=True)
            gateway = ipaddress.IPv4Address(observed["Gateway"])
            interfaces = [self.section(f"{role}_inspect")["networks"][network["Name"]] for role in ("app", "db")]
            addresses = [ipaddress.IPv4Address(interface["IPAddress"]) for interface in interfaces]
            usable_interfaces = len(set(addresses)) == 2 and all(
                interface["Gateway"] == str(gateway) and interface["IPPrefixLen"] == subnet.prefixlen
                and address in subnet and address not in (subnet.network_address, subnet.broadcast_address, gateway)
                for interface, address in zip(interfaces, addresses))
            addressing = {"allocation": "pinned" if pinned else "automatic",
                          "config": [{"subnet": str(subnet), "gateway": str(gateway)}],
                          "container_addresses_usable": usable_interfaces,
                          "usable_gateway": gateway in subnet and gateway not in
                          (subnet.network_address, subnet.broadcast_address)}
        except (KeyError, TypeError, ValueError, AttributeError):
            pass
        return authority, addressing

    def application_identity(self) -> dict | None:
        identity = self.section("application_identity")
        keys = ("INSTANCE_NAME", "SESSION_COOKIE_MODE", "SESSION_COOKIE_NAME")
        if identity is None or any(not isinstance(identity.get(key), str) for key in keys):
            return None
        return {"sha256": digest({key: identity[key] for key in keys})}

    def effective_configuration(self) -> dict | None:
        evidence = self.section("effective_configuration")
        if (evidence is None or evidence.get("algorithm") != "filterest-conformance-facts-v1"
                or not isinstance(evidence.get("sha256"), str) or not HASH.fullmatch(evidence["sha256"])):
            return None
        return {"algorithm": evidence["algorithm"], "sha256": evidence["sha256"]}
