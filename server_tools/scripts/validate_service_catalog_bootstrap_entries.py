#!/usr/bin/env python3
from __future__ import annotations

from service_catalog_bootstrap_manifest import (
    DEFAULT_MANIFEST_PATH,
    load_manifest,
    validate_manifest,
    validate_seed_sql_sync,
)


def main() -> None:
    manifest = load_manifest()
    validate_manifest(manifest)
    seed_data_path = validate_seed_sql_sync(manifest)
    print(f"OK: {DEFAULT_MANIFEST_PATH} -> {seed_data_path}")


if __name__ == "__main__":
    main()
