"""The shared libraries and data an installation's lifecycle scripts read at start.

Bridges the tests that copy the installer, the updater or the ./filterest
launcher into a temporary installation folder.
Exists so a newly shared library is added to every such fixture in one place.
"""

from __future__ import annotations

LIFECYCLE_LIBRARY_FILES = (
    "server_tools/lib/easelect_private_paths.sh",
    "server_tools/lib/filterest_paths.py",
    "server_tools/lib/filterest_port_preflight.sh",
    "server_tools/lib/native_development_ports.env",
    "server_tools/lib/database_dump_options.sh",
    "server_tools/lib/docker_deployment_settings.sh",
    "server_tools/lib/docker_network_validator.py",
    "server_tools/lib/installation_records.sh",
)
