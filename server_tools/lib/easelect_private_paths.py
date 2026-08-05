"""Resolve Easelect/Filterest private env and TLS paths from a dynamic key home.

Bridges Python developer tools with the same source/runtime boundary used by
shell, Node, and Go startup. Existing runtimes remain root-local until an
explicit dynamic keys_home is configured.
"""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Mapping

from server_tools.lib.filterest_paths import (
    is_private_easelect_source_checkout,
    resolve_filterest_homes,
)


@dataclass(frozen=True)
class EaselectPrivatePaths:
    runtime_env_file: Path
    development_env_file: Path
    tls_certificate_file: Path
    tls_private_key_file: Path


def resolve_easelect_private_paths(
    project_root: Path | str,
    environment: Mapping[str, str] | None = None,
) -> EaselectPrivatePaths:
    """Derive private file paths from the compatible dynamic home contract."""

    resolved_project_root = Path(project_root).resolve()
    source_environment = os.environ if environment is None else environment
    resolved_environment = dict(source_environment)
    # Shell path resolution exports calculated defaults for child processes.
    # Keep those values from becoming false operator overrides when Python
    # resolves the same public checkout again.
    for value_key, configured_key in (
        ("FILTEREST_PROJECTS_HOME", "FILTEREST_PROJECTS_HOME_CONFIGURED"),
        ("FILTEREST_KEYS_HOME", "FILTEREST_KEYS_HOME_CONFIGURED"),
    ):
        if resolved_environment.get(configured_key) == "0":
            resolved_environment.pop(value_key, None)
    homes = resolve_filterest_homes(resolved_project_root, resolved_environment)
    private_source = is_private_easelect_source_checkout(resolved_project_root)
    if not private_source and not homes.keys_home_configured:
        return EaselectPrivatePaths(
            runtime_env_file=resolved_project_root / ".env",
            development_env_file=resolved_project_root / "dev_env.txt",
            tls_certificate_file=resolved_project_root / "dev-cert.crt",
            tls_private_key_file=resolved_project_root / "dev-cert.key",
        )

    profile_name = "easelect_development" if private_source else "filterest_runtime"
    development_root = homes.keys_home / profile_name
    tls_root = development_root / "local_tls_certificate"
    return EaselectPrivatePaths(
        runtime_env_file=development_root / "runtime_environment.env",
        development_env_file=development_root / "development_environment.env",
        tls_certificate_file=tls_root / "localhost_certificate.crt",
        tls_private_key_file=tls_root / "localhost_private_key.key",
    )
