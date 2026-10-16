"""Enforce component and library boundaries through the check planner's resolvers.
Connect the stable shell guard to offline Go, JS and CSS source discovery.
Keep the accepted tree debt pinned while refusing new imports and hidden tests.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

from relevant_check_discovery import (
    COMPUTED_IMPORT_REGISTRY, FRONTEND_ROOTS, FRONTEND_SOURCE_SUFFIXES, frontend_import_inventory,
    go_imports, go_text, resolve_frontend_import,
    resolve_go_import, source_files,
)

# K412/K417 R4: exact existing edges, not a file-wide exemption. B3 removes
# these entries when vanilla_tree moves. The regression test freezes all eight.
R4_PINNED = {
    "app/backend/reusable_components/vanilla_tree/vanilla_tree.go": frozenset({
        "easelect/backend/core_components", "easelect/backend/core_components/httpresponse",
        "easelect/backend/core_components/sessions", "easelect/backend/pipeline/access_control",
    }),
    "app/backend/reusable_components/vanilla_tree/get_view_data.go": frozenset({
        "easelect/backend/core_components", "easelect/backend/core_components/httpresponse",
    }),
    "app/backend/reusable_components/vanilla_tree/tree_response_fixture_test.go": frozenset({
        "easelect/backend/core_components", "easelect/backend/core_components/sessions",
    }),
}
REGISTRY = COMPUTED_IMPORT_REGISTRY


def component(path: str) -> str | None:
    parts = path.split("/")
    return parts[2] if parts[:2] == ["app", "components"] and len(parts) > 2 else None


def library(path: str) -> bool:
    return path.startswith(("app/frontend/reusable_components/", "app/frontend/shared/",
                            "app/backend/reusable_components/"))


def core(path: str) -> bool:
    return path in {"app/backend/core_components", "app/backend/pipeline", "app/frontend/core_components"} or path.startswith((
        "app/backend/core_components/", "app/backend/pipeline/", "app/frontend/core_components/"))


def declared_dependencies(readme: str) -> set[str]:
    """README's Dependencies section lists explicit `components/<name>` bullets."""
    section = re.search(r"(?im)^## (?:Component )?Dependencies\s*\n([\s\S]*?)(?=^## |\Z)", readme)
    return set(re.findall(r"(?m)^\s*-\s+`?components/([a-z][a-z0-9_]*)`?\s*$", section[1])) if section else set()


def check(root: Path, *, registry: dict | None = None) -> list[str]:
    root = root.resolve()
    module = re.search(r"(?m)^module\s+(\S+)", (root / "app/go.mod").read_text())[1]
    if registry is None:
        registry = json.loads((root / REGISTRY).read_text()) if (root / REGISTRY).exists() else {}
    findings, declarations, graph = [], {}, {}
    used_registry = set()

    def fail(path, rule, detail):
        findings.append(f"{path}: {rule}: {detail}")

    components = root / "app/components"
    if components.is_symlink():
        fail("app/components", "private", "component symlinks are forbidden")
    for directory in sorted(components.glob("*")):
        if directory.is_symlink():
            fail(directory.relative_to(root).as_posix(), "private", "component symlinks are forbidden")
            continue
        if not directory.is_dir():
            continue
        owner = directory.relative_to(root).as_posix()
        name = directory.name
        if not re.fullmatch(r"[a-z][a-z0-9_]*", name):
            fail(owner, "R6", "invalid component name")
        readme = directory / "README.md"
        if not readme.is_file():
            fail(owner, "R6", "missing README.md")
        declarations[name] = declared_dependencies(readme.read_text()) if readme.is_file() else set()
        graph[name] = set()
        for file in directory.rglob("*"):
            path = file.relative_to(root).as_posix()
            if file.is_symlink():
                fail(path, "private", "component symlinks are forbidden")
            if file.name in {"go.mod", "go.work"}:
                fail(path, "private", "component module/replacement files are forbidden")
            if file.name.startswith("test_") and file.suffix == ".py" or file.name.endswith(".spec.ts"):
                fail(path, "R6", "Python and browser tests stay in central testing directories")
            relative = file.relative_to(directory).parts
            if ".test." in file.name and (relative[0] != "frontend" or not file.name.endswith(".test.js")
                                         or {"dist", "dist-public", "node_modules"}.intersection(relative)):
                fail(path, "R6", "component Vitest test would be skipped by **/frontend/**/*.test.js")
            if file.suffix == ".go" and file.is_file():
                if relative[0] != "backend":
                    fail(path, "R6", "Go source and tests belong in backend")
                if file.name.endswith("_test.go") and any(part == "testdata" or part.startswith((".", "_")) for part in relative):
                    fail(path, "R6", "Go test would be skipped by the package runner")
                # Internal subpackages retain Go's normal package naming. Only
                # the exported root package must match the component directory.
                package = re.search(r"(?m)^package\s+(\w+)", go_text(file.read_text()))
                expected = {name, name + "_test"} if file.name.endswith("_test.go") else {name}
                if file.parent == directory / "backend" and (not package or package[1] not in expected):
                    fail(path, "R6", "root Go package must match component name")

    def edge(owner, target, *, go=False):
        source_component, target_component = component(owner), component(target)
        if library(owner) and (core(target) or target_component):
            fail(owner, "R4" if go else "R1", f"library imports {target}")
        if source_component and target_component and source_component != target_component:
            graph[source_component].add(target_component)
            if target_component not in declarations[source_component]:
                fail(owner, "R3", f"undeclared dependency components/{target_component}")
        if target_component and source_component != target_component:
            public = (target == f"app/components/{target_component}/backend" if go else
                      target in {f"app/components/{target_component}/frontend/index.js",
                                 f"app/components/{target_component}/frontend/lib/index.js"})
            # D5's single CSS entry is wired centrally, never imported as JS.
            if (not go and owner == "app/frontend/styles/imports.css" and target.endswith(".css")
                    and target.startswith(f"app/components/{target_component}/frontend/")):
                public = True
            if not public:
                fail(owner, "R2", f"component internals imported: {target}")
            if go and not source_component and owner != "app/backend/core_components/router/components.go":
                fail(owner, "R2", "only router/components.go may import a component from core Go")
        if source_component and "/frontend/lib/" in owner and not owner.endswith(".test.js"):
            if core(target) or target_component and not target.startswith(f"app/components/{source_component}/frontend/lib/"):
                fail(owner, "R1", "portable lib entry may import only libraries")
        if source_component and (target.startswith(("../", "/")) or not target.startswith("app/")):
            fail(owner, "private", f"import escapes application source: {target}")
        if source_component and any(part in {"projects", "filterest_private"} for part in target.split("/")):
            fail(owner, "private", f"private source import: {target}")

    for directory in ("app/backend", "app/components", "app/server_tools"):
        for file in source_files(root, directory, {".go"}):
            owner = file.relative_to(root).as_posix()
            for _, name in go_imports(file.read_text()):
                target = resolve_go_import(module, name)
                if name in R4_PINNED.get(owner, ()):
                    continue
                if target:
                    edge(owner, target, go=True)
                elif component(owner) and re.search(r"(?:^|/)(?:projects|filterest_private)(?:/|$)", name):
                    fail(owner, "private", f"private Go import: {name}")

    css_entries = {}
    files = [file for directory in FRONTEND_ROOTS
             for file in source_files(root, directory, FRONTEND_SOURCE_SUFFIXES | {".css"})]
    inventory = frontend_import_inventory(root, files)
    for file in files:
        owner = file.relative_to(root).as_posix()
        for line, name in inventory[owner]:
            names = [name]
            if name is None:
                if not component(owner):
                    continue
                key = f"{owner}:{line}"
                entry = registry.get(key, {})
                if not entry.get("reason", "").strip() or not entry.get("targets"):
                    fail(key, "R5", "computed import needs explicit registry targets and reason")
                    continue
                used_registry.add(key)
                names = entry["targets"]
            for specifier in names:
                # Vitest itself is a runner dependency, not a runtime import.
                if component(owner) and specifier == "vitest" and file.name.endswith(".test.js"):
                    continue
                if component(owner) and not specifier.startswith("."):
                    fail(f"{owner}:{line}", "R5", "component imports must be relative")
                target = resolve_frontend_import(root, owner, specifier)
                if target:
                    edge(owner, target)
                    if owner == "app/frontend/styles/imports.css" and component(target) and target.endswith(".css"):
                        css_entries.setdefault(component(target), set()).add(target)
                if file.suffix != ".css" and specifier.split("?")[0].split("#")[0].lower().endswith(".css"):
                    fail(f"{owner}:{line}", "D5", "JS cannot import CSS; use styles/imports.css")
    for key in registry.keys() - used_registry:
        fail(key, "R5", "stale computed-import registry entry")
    for name, entries in css_entries.items():
        if len(entries) > 1:
            fail(f"app/components/{name}", "D5", "only one central CSS entry per component")

    def cycles(name, pending, done):
        if name in pending:
            fail(f"app/components/{name}", "R3", "component dependency cycle")
        elif name not in done:
            done.add(name)
            for dependency in sorted(graph.get(name, ())):
                cycles(dependency, pending | {name}, done)
    done = set()
    for name in sorted(graph):
        cycles(name, set(), done)
    return sorted(set(findings))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--strict", action="store_true", help="Retained interface; accepted R4 pins are not backlog.")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[3])
    args = parser.parse_args()
    try:
        findings = check(args.root)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2
    for finding in findings:
        print(finding)
    print(f"Import boundaries: {len(findings)} violation(s).")
    return int(bool(findings))


if __name__ == "__main__":
    raise SystemExit(main())
