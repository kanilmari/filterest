"""relevant_check_discovery.py
Read local source dependencies and test declarations for relevant-check planning.
Connect Go packages, frontend importers and migration references without running code.
Keep discovery offline, deterministic and independent of installed build tools.
"""

from __future__ import annotations

import ast
from collections import defaultdict
from pathlib import Path
import re


IGNORED_DIRECTORIES = {"dist", "node_modules", "__pycache__", ".git"}
GO_TOKEN = re.compile(r'//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|`[^`]*`|\'(?:\\.|[^\'\\])*\'')
GO_TEST = re.compile(r"\bfunc\s+(Test[A-Z0-9_][A-Za-z0-9_]*)\s*\(\s*\w+\s+\*\s*testing\.T\s*\)")
GO_IMPORT = re.compile(r'\bimport\s+(?:\(([\s\S]*?)\)|(?:[\w.]+\s+)?("[^"\n]+"))')
FRONTEND_IMPORT = re.compile(
    r'''\b(?:import|export)\s+(?:[^;'"`]*?\s+from\s*)?['"]([^'"]+)['"]'''
    r'''|\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)'''
    r'''|@import\s+(?:url\(\s*)?['"]([^'"]+)['"]''', re.MULTILINE,
)


def source_files(root: Path, directory: str, suffixes: set[str]) -> list[Path]:
    return sorted(path for path in (root / directory).rglob("*")
                  if path.is_file() and path.suffix in suffixes
                  and not IGNORED_DIRECTORIES.intersection(path.relative_to(root).parts))


def go_text(source: str, *, mask_strings: bool = False) -> str:
    """Keep positions while excluding comments and optionally string literals."""
    def replace(match):
        token = match.group()
        if token.startswith(("//", "/*")) or mask_strings:
            return re.sub(r"[^\n]", " ", token)
        return token
    return GO_TOKEN.sub(replace, source)


def importers(seeds: set[str], dependencies: dict[str, set[str]]) -> set[str]:
    reverse: dict[str, set[str]] = defaultdict(set)
    for owner, imports in dependencies.items():
        for dependency in imports:
            reverse[dependency].add(owner)
    found, pending = set(seeds), list(seeds)
    while pending:
        for owner in reverse[pending.pop()] - found:
            found.add(owner)
            pending.append(owner)
    return found


def go_inventory(root: Path) -> tuple[dict[str, set[str]], dict[str, set[str]], dict[str, str]]:
    """Discover tests (including new Postgres names) and local package importers."""
    module = re.search(r"^module\s+(\S+)", (root / "app/go.mod").read_text(), re.MULTILINE)[1]
    tests: dict[str, set[str]] = defaultdict(set)
    dependencies: dict[str, set[str]] = defaultdict(set)
    sources = {}
    for file in source_files(root, "app/backend", {".go"}):
        path, package = file.relative_to(root).as_posix(), file.parent.relative_to(root).as_posix()
        raw = file.read_text()
        source = sources[path] = go_text(raw)
        if file.name.endswith("_test.go"):
            tests[package].update(GO_TEST.findall(go_text(raw, mask_strings=True)))
        for block, single in GO_IMPORT.findall(source):
            for name in re.findall(r'"([^"\n]+)"', block or single):
                if name.startswith(module + "/"):
                    dependencies[package].add("app/" + name[len(module) + 1:])
    return dict(tests), dict(dependencies), sources


def frontend_tests(root: Path, changed: set[str]) -> list[str]:
    """Follow literal static/re-export/dynamic JS imports and CSS imports backwards.

    Computed imports cannot be resolved statically; browser area coverage supplies
    their additional proof. Deleted targets still participate as dependency names.
    """
    files = source_files(root, "app/frontend", {".js", ".mjs", ".css", ".json"})
    paths = {file.relative_to(root).as_posix() for file in files}
    dependencies = {}
    for file in files:
        owner = file.relative_to(root).as_posix()
        source = file.read_text()
        # Preserve strings (URLs included) while dropping source comments.
        source = go_text(source)
        imports = set()
        for match in FRONTEND_IMPORT.findall(source):
            name = next(value for value in match if value).split("?")[0].split("#")[0]
            if name.startswith("/frontend/"):
                target = root / "app" / name.lstrip("/")
            elif name.startswith("."):
                target = file.parent / name
            else:
                continue
            target = target.resolve().relative_to(root.resolve()).as_posix()
            candidates = [target, target + ".js", target + ".mjs", target + "/index.js"]
            imports.add(next((value for value in candidates if value in paths), target))
        dependencies[owner] = imports
    affected = importers(changed, dependencies)
    # Paired tests also cover source modules/CSS whose test mocks their imports.
    paired = {str(Path(path).with_suffix(".test.js")) for path in affected}
    return sorted(path for path in paths if path.endswith(".test.js")
                  and (path in affected or path in paired))


def reads_postgres_opt_in(tree: ast.AST) -> bool:
    """Recognize executable opt-in reads, excluding comments and quoted examples."""
    for node in ast.walk(tree):
        key = None
        if isinstance(node, ast.Call) and node.args:
            name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
            if name in {"get", "getenv"}:
                key = node.args[0]
        elif isinstance(node, ast.Subscript) and isinstance(node.value, ast.Attribute) and node.value.attr == "environ":
            key = node.slice
        if isinstance(key, ast.Constant) and key.value == "FILTEREST_TEST_DISPOSABLE_POSTGRES":
            return True
    return False


def python_sources(root: Path) -> tuple[dict[str, str], dict[str, set[str]], set[str]]:
    """Read literal references, fixture/helper imports and PostgreSQL opt-in code."""
    files = source_files(root, "app/testing/python", {".py"})
    files += source_files(root, "app/server_tools", {".py"})
    modules: dict[str, set[str]] = defaultdict(set)
    for file in files:
        path = file.relative_to(root).as_posix()
        modules[file.stem].add(path)
        modules[".".join(file.relative_to(root / "app").with_suffix("").parts)].add(path)
    references, dependencies, postgres = {}, {}, set()
    for file in files:
        path = file.relative_to(root).as_posix()
        tree = ast.parse(file.read_text(), filename=path)
        strings, imports = [], set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                strings.append(node.value)
            if isinstance(node, ast.ImportFrom) and node.module:
                imports.update(modules.get(node.module, modules.get(node.module.split(".")[-1], set())))
            if isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    module = ".".join(filter(None, [node.module, alias.name]))
                    imports.update(modules.get(module, modules.get(alias.name, set())))
            if isinstance(node, ast.Import):
                for alias in node.names:
                    imports.update(modules.get(alias.name, modules.get(alias.name.split(".")[-1], set())))
        references[path] = "\n".join(strings)
        dependencies[path] = imports
        if reads_postgres_opt_in(tree):
            postgres.add(path)
    return references, dependencies, postgres


def python_postgres_tests(root: Path, changed: set[str]) -> set[str]:
    """Select changed PostgreSQL proofs and consumers of changed fixtures/helpers.

    Follow imports in both directions: PostgreSQL requirements travel from the
    harness to its tests, while changed helpers select only affected consumers.
    File-tier classification stays with python_test_tiers, independently of DB use.
    """
    _, dependencies, postgres = python_sources(root)
    seeds = changed | {path for path in dependencies if any(path.startswith(prefix + "/") for prefix in changed)}
    affected = importers(seeds, dependencies)
    requires_postgres = importers(postgres, dependencies)
    return {path for path in affected & requires_postgres
            if path.startswith("app/testing/python/") and Path(path).name.startswith("test_")}


def migration_consumers(root: Path, changed: set[str], go_sources: dict[str, str]) -> tuple[set[str], set[str]]:
    """Find proofs by migration basenames, including imported Python fixtures.

    Bootstrap generation affects every migration proof, so inspect all migration
    names then. Package selection includes Go helper references in ordinary files.
    No migration-to-test table needs maintaining.
    """
    bootstrap = any(path.startswith("app/server_tools/public_bootstrap/")
                    or path.startswith("app/server_tools/public_slice_export/") for path in changed)
    names = {Path(path).name for path in changed if path.startswith("app/server_tools/migrations/")}
    if bootstrap:
        names.update(file.name for file in (root / "app/server_tools/migrations").glob("*.sql"))
    if not names:
        return set(), set()
    packages = {str(Path(path).parent) for path, source in go_sources.items()
                if any(name in source for name in names)}
    references, dependencies, _ = python_sources(root)
    direct = {path for path, source in references.items() if any(name in source for name in names)}
    python_tests = {path for path in importers(direct, dependencies)
                    if path.startswith("app/testing/python/test_")}
    return packages, python_tests
