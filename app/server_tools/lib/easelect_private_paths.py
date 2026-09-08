"""Resolve Easelect/Filterest private env and TLS paths from a dynamic key home.

Bridges Python developer tools with the same source/runtime boundary used by
shell, Node, and Go startup. Easelect defaults to its ignored keys/ directory;
legacy flat public runtimes retain their existing root-local file layout.
"""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Mapping

from .filterest_paths import (
    is_private_easelect_source_checkout,
    is_nested_filterest_installation,
    resolve_filterest_homes,
)


@dataclass(frozen=True)
class EaselectPrivatePaths:
    runtime_env_file: Path
    development_env_file: Path
    tls_certificate_file: Path
    tls_private_key_file: Path


def resolve_embedded_project_root(
    canonical_filterest_root: Path | str,
    environment: Mapping[str, str] | None = None,
) -> Path:
    """Select the outer Easelect root only when Filterest is embedded there.

    A root launcher can bind an explicit project boundary before delegating to
    the shared implementation. This keeps the public root standalone even
    inside the Easelect source workspace, while Easelect's private bridges bind
    the outer composition deliberately.

    Public tools live under ``filterest/`` in the private source checkout, but
    the outer Easelect workspace remains the native development project. A
    copied or cloned Filterest tree has no private parent marker and therefore
    remains completely root-local.
    """

    source_environment = os.environ if environment is None else environment
    explicit_root = source_environment.get("FILTEREST_PROJECT_ROOT_OVERRIDE", "").strip()
    if explicit_root:
        return Path(explicit_root).expanduser().resolve()

    canonical_root = Path(canonical_filterest_root).resolve()
    product_root = (
        canonical_root.parent
        if is_nested_filterest_installation(canonical_root.parent)
        else canonical_root
    )
    outer_root = product_root.parent
    if is_private_easelect_source_checkout(outer_root):
        return outer_root
    return product_root


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
        ("FILTEREST_RUNTIME_DATA_HOME", "FILTEREST_RUNTIME_DATA_HOME_CONFIGURED"),
        (
            "FILTEREST_MAINTAINER_TOOLS_HOME",
            "FILTEREST_MAINTAINER_TOOLS_HOME_CONFIGURED",
        ),
        ("FILTEREST_OPERATIONS_HOME", "FILTEREST_OPERATIONS_HOME_CONFIGURED"),
    ):
        if resolved_environment.get(configured_key) == "0":
            resolved_environment.pop(value_key, None)
    homes = resolve_filterest_homes(resolved_project_root, resolved_environment)
    private_source = is_private_easelect_source_checkout(resolved_project_root)
    if (
        not private_source
        and not is_nested_filterest_installation(resolved_project_root)
        and not homes.keys_home_configured
    ):
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
