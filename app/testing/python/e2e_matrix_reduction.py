"""e2e_matrix_reduction.py
Project browser proof selections through the owner's K549 reduction manifest.
Connect the offline planner and its collection/non-narrowing guards.
Keep spec/project resolution ahead of command grouping without changing the map.
"""

from __future__ import annotations

import json
from pathlib import Path


MANIFEST_PATH = "app/testing/e2e/matrix-reduction.json"


def load_reduction(root: Path) -> dict:
    """Small historical planner fixtures have no reductions; real trees pin bytes."""
    path = root / MANIFEST_PATH
    if not path.exists():
        return {"version": 1, "one_project": {}, "one_card_mode": [], "own_size_allowed": {}}
    manifest = json.loads(path.read_bytes())
    if manifest.get("version") != 1:
        raise ValueError("unsupported E2E matrix reduction version")
    return manifest


def resolve_spec_projects(spec: str, projects, manifest: dict) -> tuple[str, ...]:
    """Return surviving projects, including the card twin of a big-card-only proof.

    One-project proofs always move to their named project. For one-card-mode
    proofs, drop big-card projects; an exclusively big-card selection moves to
    the same widths' card twins. Setup and other specs retain their project set.
    """
    relative = spec.removeprefix("app/testing/e2e/")
    if relative in manifest["one_project"]:
        return (manifest["one_project"][relative],)
    if relative in manifest["one_card_mode"]:
        cards = {project for project in projects if not project.endswith("-bigcard")}
        return tuple(sorted(cards or {project.removesuffix("-bigcard") + "-card" for project in projects}))
    return tuple(sorted(set(projects)))
