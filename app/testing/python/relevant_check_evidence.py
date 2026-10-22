"""relevant_check_evidence.py
Pin offline check selection to its source tree, map bytes and interpreter.
Connect saved plans to reproducible checks after edits or rebases.
Keep evidence additive to the established fast/heavy command interface.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import subprocess


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def file_evidence(path: Path):
    """Pin mode and symlink spelling without following an untracked link off-tree."""
    return [path.lstat().st_mode, str(path.readlink()) if path.is_symlink() else digest(path.read_bytes())]


def tree_evidence(root: Path) -> str:
    """Use HEAD's tree when clean; hash tracked diffs and untracked source when dirty.

    Ignored runtime artifacts do not alter selection. Staged and unstaged deltas
    are both retained, even if their net worktree changes cancel each other.
    Non-Git fixture/public source trees use a deterministic app-content digest.
    """
    def git(*args):
        return subprocess.run(["git", *args], cwd=root, capture_output=True, check=True).stdout

    try:
        # A nested non-Git fixture must not accidentally fingerprint its parent.
        if Path(git("rev-parse", "--show-toplevel").decode().strip()).resolve() != root.resolve():
            raise ValueError("not a repository root")
        tree = git("rev-parse", "HEAD^{tree}").strip()
        staged = git("diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv", "HEAD", "--")
        unstaged = git("diff", "--binary", "--no-ext-diff", "--no-textconv", "--")
        untracked = git("ls-files", "--others", "--exclude-standard", "-z").decode(errors="surrogateescape")
        files = sorted(path for path in untracked.split("\0") if path)
        if not staged and not unstaged and not files:
            return tree.decode()
        content = [(path, file_evidence(root / path)) for path in files
                   if (root / path).is_file() or (root / path).is_symlink()]
        return "diff-sha256:" + digest(canonical([tree.decode(), digest(staged), digest(unstaged), content]))
    except (subprocess.CalledProcessError, ValueError):
        content = [(path.relative_to(root).as_posix(), file_evidence(path))
                   for path in sorted((root / "app").rglob("*")) if (path.is_file() or path.is_symlink())
                   and not {"__pycache__", ".git", "node_modules"}.intersection(path.parts)]
        return "snapshot-sha256:" + digest(canonical(content))


def attach_evidence(root: Path, plan: dict, policy: dict, map_bytes: bytes, python: str) -> dict:
    checks = []
    for group in ("fast", "heavy"):
        for check in plan[group]:
            identity = {key: check[key] for key in ("kind", "targets", "tests", "projects", "config") if key in check}
            projects = check.get("projects", [])
            if "config" in check:
                projects = sorted(re.findall(r"\bname:\s*['\"]([^'\"]*)['\"]", (root / check["config"]).read_text())) or [""]
                identity["projects"] = projects  # Playwright's implicit project has an empty name.
            identifier = check["kind"] + ":" + digest(canonical(identity))
            checks.append({"id": identifier, **identity, "projects": projects})
    plan["evidence"] = {"tree": tree_evidence(root), "map_sha256": digest(map_bytes),
                        "map_version": policy["version"], "checks": checks,
                        "projects": sorted({project for check in checks for project in check["projects"]}),
                        "inputs": {"python": python}}
    return plan


def compare_plan(saved: dict, current: dict) -> None:
    """Compare the complete selection, including evidence, with a useful refusal."""
    if saved != current:
        before, after = saved.get("evidence", {}), current["evidence"]
        changed = [key for key in ("tree", "map_sha256", "inputs", "checks", "projects")
                   if before.get(key) != after.get(key)]
        raise ValueError("saved plan mismatch: " + ", ".join(changed or ["selection/changed paths"])
                         + "; recompute and review the plan for the current tree and map")
