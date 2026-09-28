"""The native development origin of one checkout: its port and its exact URL.

Bridges the agent tools that send development credentials, and trust a
self-signed certificate, only to this checkout's own native server.
Exists so the port rule and the exact-origin test are each stated once; the
port numbers live in native_development_ports.env, which the shell and
JavaScript tools read too.
"""

from __future__ import annotations

from pathlib import Path
import urllib.parse

from .filterest_paths import is_private_easelect_source_checkout


NATIVE_PORTS_FILE = Path(__file__).resolve().with_name("native_development_ports.env")


def read_native_development_ports(path: Path = NATIVE_PORTS_FILE) -> tuple[int, int]:
    """Return (public Filterest port, private Easelect port), refusing a bad file."""

    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator:
            raise ValueError(f"{path}: every setting must be KEY=VALUE")
        values[key.strip()] = value.strip()

    ports = []
    for key in ("FILTEREST_NATIVE_PORT", "EASELECT_NATIVE_PORT"):
        raw_value = values.get(key, "")
        if not raw_value.isdigit() or not 1 <= int(raw_value) <= 65535:
            raise ValueError(f"{path}: {key} must be a port number")
        ports.append(int(raw_value))
    return ports[0], ports[1]


FILTEREST_NATIVE_PORT, EASELECT_NATIVE_PORT = read_native_development_ports()


def native_port_for_checkout(private_easelect: bool) -> int:
    """Return the native development port of the private Easelect checkout or of the public product."""

    return EASELECT_NATIVE_PORT if private_easelect else FILTEREST_NATIVE_PORT


def native_development_port(project_root: str | Path) -> int:
    """Return the port this checkout's own native development server uses."""

    return native_port_for_checkout(
        is_private_easelect_source_checkout(Path(project_root).resolve())
    )


def native_development_base_url(project_root: str | Path) -> str:
    return f"https://localhost:{native_development_port(project_root)}"


def is_local_native_base_url(base_url: object, native_port: int) -> bool:
    """Recognize only the exact native loopback origin used for development."""

    try:
        parsed = urllib.parse.urlsplit(base_url)
        port = parsed.port
    except (TypeError, ValueError):
        return False

    return (
        parsed.scheme == "https"
        and parsed.hostname in {"localhost", "127.0.0.1"}
        and port == native_port
        and parsed.username is None
        and parsed.password is None
        and parsed.path in {"", "/"}
        and not parsed.query
        and not parsed.fragment
    )
