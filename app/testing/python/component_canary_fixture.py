"""Materialize the shared Go/browser component canary only in temporary trees.
Connect guard tests across languages to one reviewed fixture manifest.
Keep all synthetic routes, keys and component files out of the application.
"""

import json
from pathlib import Path

MANIFEST = Path(__file__).resolve().parents[1] / "fixtures/component_canary.json"


def write_canary(root: Path) -> dict:
    for path, text in json.loads(MANIFEST.read_text()).items():
        file = root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text)
    for directory in ("app/backend", "app/frontend"):
        (root / directory).mkdir(exist_ok=True)
    return json.loads((root / "app/testing/python/relevant_check_map.json").read_text())
