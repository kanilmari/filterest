#!/usr/bin/env python3
from __future__ import annotations

from service_catalog_bootstrap_manifest import load_manifest, render_seed_sql


def main() -> None:
    print(render_seed_sql(load_manifest()))


if __name__ == "__main__":
    main()
