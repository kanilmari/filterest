"""relevant_checks.py
Print fast and heavy checks for changed paths or a Git range; never execute them.
Connect automatic source discovery to the small reviewed browser-area policy.
Make local worker verification repeatable before review, without a test instance.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shlex
import subprocess

from python_test_tiers import needs_heavy_installation, tier_for_path
from relevant_check_discovery import frontend_tests, go_inventory, migration_consumers, python_postgres_tests


ROOT = Path(__file__).resolve().parents[3]
MAP_PATH = "app/testing/python/relevant_check_map.json"
PYTHON = "data/runtime/python/venv/bin/python"
CONTAINERS = {"core_components", "reusable_components", "pipeline", "shared"}


def normalize_path(value: str) -> str:
    # The prior selector owns the accepted lexical path contract, even for deletions.
    needs_heavy_installation([value])
    parts = []
    for part in value.replace("\\", "/").split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            parts.pop()
        else:
            parts.append(part)
    return "/".join(parts)


def matches(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(prefix + "/")


def component_areas(root: Path) -> set[str]:
    """Require an explicit choice for each current top-level component directory."""
    areas = set()
    for side in ("frontend", "backend"):
        for directory in (root / "app" / side).iterdir():
            if not directory.is_dir() or directory.name == "__pycache__":
                continue
            children = directory.iterdir() if directory.name in CONTAINERS else [directory]
            areas.update(path.relative_to(root).as_posix() for path in children
                         if path.is_dir() and path.name != "__pycache__")
    return areas


def validate_map(root: Path, policy: dict) -> None:
    """Refuse stale paths/specs/projects and uncovered areas before printing commands."""
    if policy.get("version") != 1:
        raise ValueError("unsupported relevant-check map version")
    projects = set(re.findall(r"\bname:\s*['\"]([^'\"]+)['\"]", (root / "app/playwright.config.ts").read_text()))
    covered, labels = set(), set()
    references = [policy["file_length_guard"], *policy["bootstrap_proofs"]]
    for entry in policy["browser_areas"]:
        if entry["area"] in labels or not entry["paths"]:
            raise ValueError("browser areas need unique names and nonempty paths")
        labels.add(entry["area"])
        if bool(entry["specs"]) == bool(entry.get("none", "").strip()):
            raise ValueError(f"{entry['area']} needs specs or explicit none with a reason")
        if entry["specs"] and (not entry.get("projects") or set(entry["projects"]) - projects):
            raise ValueError(f"{entry['area']} has missing or unknown browser projects")
        for path in entry["paths"]:
            if path in covered:
                raise ValueError(f"duplicate curated path: {path}")
            covered.add(path)
        references.extend(entry["paths"] + entry["specs"])
        for spec in entry["specs"]:
            if not spec.startswith("app/testing/e2e/") or not spec.endswith(".spec.ts"):
                raise ValueError(f"not a matrix browser spec: {spec}")
    for guard in policy["source_guards"]:
        references.extend([*guard["paths"], guard["package"], guard["anchor"]])
    for guard in policy.get("python_guards", []):
        if not guard["paths"] or not guard["tests"]:
            raise ValueError("Python guards need nonempty paths and tests")
        for test in guard["tests"]:
            if not test.startswith("app/testing/python/test_") or not test.endswith(".py"):
                raise ValueError(f"not a Python guard test: {test}")
            if tier_for_path(Path(test)) != "ordinary":
                raise ValueError(f"Python source guards must belong to the ordinary tier: {test}")
        references.extend([*guard["paths"], *guard["tests"]])
    for path in references:
        if normalize_path(path) != path or not (root / path).exists():
            raise ValueError(f"curated path or spec disappeared: {path}")
    missing = component_areas(root) - covered
    if missing:
        raise ValueError("component areas need specs or explicit none: " + ", ".join(sorted(missing)))


def git_changed_paths(root: Path, git_range: str) -> list[str]:
    """Read both names of renames/copies and deleted paths from Git's NUL output."""
    if git_range.startswith("-"):
        raise ValueError("Git range must be a revision or range, not an option")
    result = subprocess.run(["git", "diff", "--name-status", "-z", "--find-renames", git_range, "--"],
                            cwd=root, capture_output=True, check=True)
    fields = result.stdout.decode("utf-8", errors="surrogateescape").rstrip("\0").split("\0")
    paths, index = [], 0
    while fields != [""] and index < len(fields):
        status = fields[index]
        count = 2 if status.startswith(("R", "C")) else 1
        paths.extend(fields[index + 1:index + 1 + count])
        index += count + 1
    return paths


def make_plan(root: Path, paths: list[str], *, python: str = PYTHON, policy: dict | None = None) -> dict:
    """Build a sorted, deduplicated plan; Python tier membership has one owner."""
    if not python.strip() or python.lstrip().startswith("-"):
        raise ValueError("Python interpreter must be nonempty and must not start with an option")
    changed = set(map(normalize_path, paths))
    policy = policy if policy is not None else json.loads((root / MAP_PATH).read_text())
    validate_map(root, policy)
    plan = {"version": 1, "changed_paths": sorted(changed), "fast": [], "heavy": [], "notes": []}
    if not changed:
        return plan

    def add(group, kind, targets, command, **details):
        plan[group].append({"kind": kind, "targets": sorted(targets), "command": command, **details})

    python_command = shlex.quote(python) + " -m pytest"
    add("fast", "map-guards", ["app/testing/python/test_relevant_checks.py"],
        f"{python_command} app/testing/python/test_relevant_checks.py")
    add("fast", "file-length", [policy["file_length_guard"]],
        f"(cd app && bash {shlex.quote(policy['file_length_guard'].removeprefix('app/'))})")
    # The tier selector promises file tiers, not a finer Python dependency map.
    # Keep its full ordinary set rather than inventing an unsafe smaller subset.
    python_files = sorted((root / "app/testing/python").glob("test_*.py"))
    ordinary = [file.relative_to(root).as_posix() for file in python_files if tier_for_path(file) == "ordinary"]
    add("fast", "python-ordinary", ordinary,
        f"env -u FILTEREST_TEST_DISPOSABLE_POSTGRES -- {python_command} --category ordinary app/testing/python")
    # Explicit guards expose focused proofs for reviewed source contracts while
    # keeping the conservative whole ordinary tier in the same plan.
    for guard in policy.get("python_guards", []):
        if any(matches(path, prefix) for path in changed for prefix in guard["paths"]):
            add("fast", "python-guard", guard["tests"],
                f"env -u FILTEREST_TEST_DISPOSABLE_POSTGRES -- {python_command} " + shlex.join(guard["tests"]))

    tests, dependencies, sources = go_inventory(root)
    seeds = {str(Path(path).parent) for path in changed if path.startswith("app/backend/") and path.endswith(".go")}
    # Non-Go package assets belong to their nearest package, not every parent
    # package; selecting the backend root here would expand any edit to a tier.
    packages = {str(Path(path).parent) for path in sources}
    for path in changed:
        owners = [package for package in packages if matches(path, package)]
        if owners:
            seeds.add(max(owners, key=len))
    migration_packages, migration_python = migration_consumers(root, changed, sources)
    seeds |= migration_packages
    # Direct consumers supply API/fixture proofs for packages such as kinds;
    # transitive Go consumers would pull routing/startup into nearly every edit.
    affected = seeds | {package for package, imports in dependencies.items() if imports & seeds}
    browser_paths = changed | affected
    for guard in policy["source_guards"]:
        if any(matches(path, prefix) for path in changed for prefix in guard["paths"]):
            affected.add(guard["package"])
    for package in sorted(affected & (packages | tests.keys())):
        names = sorted(tests.get(package, set()))
        unit, postgres = [name for name in names if "Postgres" not in name], [name for name in names if "Postgres" in name]
        target = "./" + package.removeprefix("app/")
        unit_pattern = "^(" + "|".join(unit) + ")$" if unit else "^$"
        add("fast", "go-unit", [package],
            f"(cd app && env -u FILTEREST_TEST_DISPOSABLE_POSTGRES go test {shlex.quote(target)} -count=1 -run {shlex.quote(unit_pattern)})",
            tests=unit)
        if postgres:
            pattern = "^(" + "|".join(postgres) + ")$"
            add("heavy", "go-postgres", [package],
                f"(cd app && FILTEREST_TEST_DISPOSABLE_POSTGRES=1 flock /tmp/filterest_pg_suites.lock go test {shlex.quote(target)} -count=1 -run {shlex.quote(pattern)})",
                tests=postgres)

    # Shared browser/server examples live outside frontend, but their browser
    # importers still require Vitest when the common contract changes.
    frontend = {path for path in changed if path.startswith(("app/frontend/", "app/testing/shared_contracts/"))}
    vitest = frontend_tests(root, frontend) if frontend else []
    if vitest:
        add("fast", "vitest", vitest, "./filterest test-unit " + shlex.join(vitest))
    lint = {path for path in frontend if (root / path).is_file() and Path(path).suffix in {".js", ".mjs"}
            and not matches(path, "app/frontend/dist")}
    if lint:
        node_root = '${FILTEREST_NODE_MODULES_ROOT:-$PWD/data/runtime/node/node_modules}'
        add("fast", "eslint", lint, f'FILTEREST_NODE_MODULES_ROOT="{node_root}" node "{node_root}/eslint/bin/eslint.js" '
            + "--config app/eslint.config.mjs " + shlex.join(sorted(lint)))

    installation = needs_heavy_installation(changed)
    if installation:
        heavy = [file.relative_to(root).as_posix() for file in python_files if tier_for_path(file) == "heavy-installation"]
        add("heavy", "python-heavy-installation", heavy,
            f"FILTEREST_TEST_DISPOSABLE_POSTGRES=1 flock /tmp/filterest_pg_suites.lock {python_command} --category heavy-installation app/testing/python")
    bootstrap = installation and any(matches(path, prefix) for path in changed for prefix in
                                    ("app/server_tools/migrations", "app/server_tools/public_bootstrap", "app/server_tools/public_slice_export"))
    proofs = (python_postgres_tests(root, changed) | migration_python
              | (set(policy["bootstrap_proofs"]) if bootstrap else set()))
    # Heavy-tier proofs already appear in the opt-in heavy-tier command.
    proofs = {path for path in proofs if not installation or tier_for_path(Path(path)) == "ordinary"}
    if proofs:
        add("heavy", "python-postgres", proofs,
            f"FILTEREST_TEST_DISPOSABLE_POSTGRES=1 flock /tmp/filterest_pg_suites.lock {python_command} " + shlex.join(sorted(proofs)))

    browser: dict[tuple[str, ...], set[str]] = {}
    for entry in policy["browser_areas"]:
        if not any(matches(path, prefix) for path in browser_paths for prefix in entry["paths"]):
            continue
        if entry["specs"]:
            browser.setdefault(tuple(sorted(entry["projects"])), set()).update(entry["specs"])
        else:
            plan["notes"].append(f"Browser none — {entry['area']}: {entry['none']}")
    # A changed browser spec is itself a proof even when no product path changed.
    direct_specs = {path for path in changed if path.startswith("app/testing/e2e/")
                    and path.endswith(".spec.ts") and (root / path).is_file()}
    if direct_specs:
        browser.setdefault(("desktop-card", "mobile-card", "tablet-card"), set()).update(direct_specs)
    for projects, specs in sorted(browser.items()):
        command = "PLAYWRIGHT_HTML_OPEN=never ./filterest test " + shlex.join(path.removeprefix("app/") for path in sorted(specs))
        command += " " + shlex.join("--project=" + project for project in projects) + " --workers=1"
        add("heavy", "browser", specs, command, projects=list(projects))
    plan["notes"].append("Run commands from the repository root. Heavy checks need a capable supervisor and this worktree's test target; skipped proofs are not passes.")
    return plan


def render_plan(plan: dict) -> str:
    lines = []
    for group in ("fast", "heavy"):
        lines.append(group.upper())
        if not plan[group]:
            lines.append("  (none)")
        for check in plan[group]:
            label = ", ".join(check["targets"]) if len(check["targets"]) <= 6 else f"{len(check['targets'])} files (use --json for names)"
            lines.extend([f"  {check['kind']}: {label}", "    " + check["command"]])
    lines.extend(plan["notes"])
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("changed_paths", nargs="*", help="Repository-relative files, deletions and both rename paths.")
    parser.add_argument("--range", dest="git_range", help="Git diff range, e.g. HEAD~1..HEAD (includes both rename paths).")
    parser.add_argument("--json", action="store_true", help="Include every target and discovered Go test name.")
    parser.add_argument("--python", default=PYTHON, help="Interpreter for printed pytest commands.")
    args = parser.parse_args()
    try:
        paths = args.changed_paths + (git_changed_paths(ROOT, args.git_range) if args.git_range else [])
        plan = make_plan(ROOT, paths, python=args.python)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.error(str(error))
    print(json.dumps(plan, indent=2) if args.json else render_plan(plan), end="\n" if args.json else "")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
