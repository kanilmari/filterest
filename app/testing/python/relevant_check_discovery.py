"""relevant_check_discovery.py
Read local source dependencies and test declarations for relevant-check planning.
Connect Go packages, frontend importers and migration references without running code.
Keep discovery offline and deterministic; JS/TS requires Node and es-module-lexer.
"""

from __future__ import annotations

import ast
from collections import defaultdict
import json
from pathlib import Path
import posixpath
import re
import subprocess
from urllib.parse import unquote


IGNORED_DIRECTORIES = {"dist", "node_modules", "__pycache__", ".git"}
GO_TOKEN = re.compile(r'//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|`[^`]*`|\'(?:\\.|[^\'\\])*\'')
GO_TEST = re.compile(r"\bfunc\s+(Test[A-Z0-9_][A-Za-z0-9_]*)\s*\(\s*\w+\s+\*\s*testing\.T\s*\)")
GO_IMPORT = re.compile(r'\bimport\s+(?:\(([\s\S]*?)\)|(?:[\w.]+\s+)?("(?:\\.|[^"\n])+"|`[^`\n]+`))')
GO_ROOTS = ("app/backend", "app/components")
FRONTEND_ROOTS = ("app/frontend", "app/components")
COMPUTED_IMPORT_REGISTRY = "app/testing/python/component_import_registry.json"
FRONTEND_SOURCE_SUFFIXES = {".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts"}
IMPORT_LEXER = Path(__file__).resolve().parents[2] / "server_tools/scripts/frontend_import_lexer.mjs"
# CSS Syntax Level 3: input is newline-normalized before these token rules.
CSS_ESCAPE = r'\\(?:[0-9a-fA-F]{1,6}[ \t\n]?|[^\n0-9a-fA-F])'
CSS_NAME = rf'(?:[-_a-zA-Z0-9\u0080-\U0010ffff]|{CSS_ESCAPE})+'
CSS_STRING = (rf'"(?:{CSS_ESCAPE}|\\\n|[^"\\\n])*"'
              rf"|'(?:{CSS_ESCAPE}|\\\n|[^'\\\n])*'")
CSS_TOKEN = re.compile(rf'(?P<trivia>/\*[\s\S]*?(?:\*/|$)|[ \t\n]+)'
                       rf'|(?P<string>{CSS_STRING})|(?P<at>@{CSS_NAME})'
                       rf'|(?P<name>{CSS_NAME})|(?P<other>[\s\S])')
CSS_URL = re.compile(rf'''[ \t\n]*(?P<value>(?:{CSS_ESCAPE}|[^\x00-\x20\x7f"'()\\])*)[ \t\n]*\)''')
CSS_VALUE_ESCAPE = re.compile(r'\\(?:([0-9a-fA-F]{1,6})[ \t\n]?|([^\n]))|\\\n')
CSS_ASCII_FOLD = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")


def javascript_imports(sources: dict[str, str]) -> dict[str, list[tuple[int, str | None]]]:
    """Lex one source batch in one Node process, or refuse incomplete discovery."""
    try:
        result = subprocess.run(["node", str(IMPORT_LEXER)], input=json.dumps(sources),
                                capture_output=True, text=True, check=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as error:
        detail = error.stderr.strip() if isinstance(error, subprocess.CalledProcessError) else str(error)
        raise ValueError(f"JavaScript import discovery failed: Node and es-module-lexer are required. {detail}") from error
    try:
        inventory = json.loads(result.stdout)
        if not isinstance(inventory, dict) or inventory.keys() != sources.keys():
            raise ValueError("incomplete file inventory")
        for entries in inventory.values():
            if not isinstance(entries, list) or any(
                not isinstance(entry, dict) or type(entry.get("line")) is not int or entry["line"] < 1
                or type(entry.get("computed")) is not bool
                or entry.get("kind") not in {"static", "dynamic"}
                or (entry.get("specifier") is None) != entry["computed"]
                or not (entry["specifier"] is None or isinstance(entry["specifier"], str))
                for entry in entries
            ):
                raise ValueError("invalid import records")
    except (ValueError, KeyError, TypeError) as error:
        raise ValueError(f"JavaScript import discovery failed: invalid lexer response: {error}") from error
    return {owner: [(entry["line"], entry["specifier"]) for entry in entries]
            for owner, entries in inventory.items()}


def css_value(value: str) -> str:
    """Decode CSS escapes once, including replacement code points and continuations."""
    def replace(match):
        if match[1] is None:
            return match[2] or ""
        codepoint = int(match[1], 16)
        return chr(codepoint) if 0 < codepoint <= 0x10ffff and not 0xd800 <= codepoint <= 0xdfff else "\ufffd"
    return CSS_VALUE_ESCAPE.sub(replace, value)


def css_tokens(source: str):
    """Keep comments/strings opaque; consume unquoted URLs with CSS, not JS, rules.

    Whole names prevent escaped @ signs and longer identifiers from becoming
    at-keywords. URL contents retain // and /*...*/ as ordinary path characters.
    This is import discovery, not stylesheet validation.
    """
    position = 0
    while position < len(source):
        match = CSS_TOKEN.match(source, position)
        kind, value, start = match.lastgroup, match[0], position
        position = match.end()
        if kind == "trivia":
            continue
        if kind == "string":
            value = css_value(value[1:-1])
        elif kind in {"at", "name"}:
            value = css_value(value[1:] if kind == "at" else value).translate(CSS_ASCII_FOLD)
            if kind == "name" and source[position:position + 1] == "(":
                kind, position = "function", position + 1
                if value == "url" and (url := CSS_URL.match(source, position)):
                    kind, value, position = "url", css_value(url["value"]), url.end()
        yield kind, value, start


def css_imports(source: str) -> list[tuple[int, str]]:
    """Discover CSS @import strings/URLs after escape decoding and ASCII folding.

    Trailing layer/supports/media tokens do not change the dependency. Shared
    discovery feeds both strict boundary findings and reverse test selection.
    """
    source = source.replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n").replace("\0", "\ufffd")
    tokens, found = iter(css_tokens(source)), []
    for kind, keyword, start in tokens:
        if kind != "at" or keyword != "import":
            continue
        kind, value, _ = next(tokens, (None, None, None))
        if kind == "function" and value == "url":
            kind, value, _ = next(tokens, (None, None, None))
            if kind != "string":
                continue
        if kind in {"string", "url"}:
            found.append((source.count("\n", 0, start) + 1, value))
    return found


def frontend_imports(source: str, *, css: bool = False) -> list[tuple[int, str | None]]:
    """Single-source convenience API; check runs use the batched inventory below."""
    return css_imports(source) if css else javascript_imports({"<source>": source})["<source>"]


def frontend_import_inventory(root: Path, files: list[Path]) -> dict[str, list[tuple[int, str | None]]]:
    """Share one lexer invocation across all JS/TS files in a guard/planner run."""
    inventory = javascript_imports({file.relative_to(root).as_posix(): file.read_text()
                                    for file in files if file.suffix in FRONTEND_SOURCE_SUFFIXES})
    inventory.update({file.relative_to(root).as_posix(): css_imports(file.read_text())
                      for file in files if file.suffix == ".css"})
    return inventory


def resolve_frontend_import(root: Path, owner: str, name: str) -> str | None:
    """Resolve browser URLs, relative spelling and extensionless local entries."""
    name = unquote(name.split("?")[0].split("#")[0])
    if name.startswith(("/frontend/", "/components/")):
        target = "app" + name
    elif name.startswith("."):
        target = posixpath.join(posixpath.dirname(owner), name)
    else:
        return None
    target = posixpath.normpath(target)
    candidates = [target, target + ".js", target + ".mjs", target + "/index.js"]
    selected = next((path for path in candidates if (root / path).is_file()), target)
    # Keep physical aliases visible to both the guard and reverse-import graph.
    # resolve(strict=False) also preserves deleted targets through existing parents.
    return posixpath.relpath((root / selected).resolve().as_posix(), root.resolve().as_posix())


def go_imports(source: str) -> list[tuple[int, str]]:
    """Read Go imports once for planning and boundary enforcement."""
    clean, masked = go_text(source), go_text(source, mask_strings=True)
    result = []
    for match in GO_IMPORT.finditer(clean):
        if not masked[match.start():match.start() + 1].strip():
            continue
        for name in re.finditer(r'"(?:\\.|[^"\n])+"|`[^`\n]+`', match[1] or match[2]):
            value = name[0][1:-1] if name[0].startswith("`") else ast.literal_eval(name[0])
            result.append((source.count("\n", 0, match.start()) + 1, value))
    return result


def resolve_go_import(module: str, name: str) -> str | None:
    return "app/" + posixpath.normpath(name[len(module) + 1:]) if name.startswith(module + "/") else None


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
    for file in [file for directory in GO_ROOTS for file in source_files(root, directory, {".go"})]:
        path, package = file.relative_to(root).as_posix(), file.parent.relative_to(root).as_posix()
        raw = file.read_text()
        source = sources[path] = go_text(raw)
        if file.name.endswith("_test.go"):
            tests[package].update(GO_TEST.findall(go_text(raw, mask_strings=True)))
        for _, name in go_imports(raw):
            if target := resolve_go_import(module, name):
                dependencies[package].add(target)
    return dict(tests), dict(dependencies), sources


def frontend_tests(root: Path, changed: set[str]) -> list[str]:
    """Follow literal static/re-export/dynamic JS imports and CSS imports backwards.

    Registered computed imports use their reviewed target sets; other computed
    imports still need browser proof. Deleted targets remain dependency names.
    """
    files = [file for directory in FRONTEND_ROOTS
             for file in source_files(root, directory, FRONTEND_SOURCE_SUFFIXES | {".css", ".json"})]
    paths = {file.relative_to(root).as_posix() for file in files}
    dependencies = {}
    registry_path = root / COMPUTED_IMPORT_REGISTRY
    registry = json.loads(registry_path.read_text()) if registry_path.exists() else {}
    if COMPUTED_IMPORT_REGISTRY in changed:
        changed = changed | {key.rsplit(":", 1)[0] for key in registry}
    inventory = frontend_import_inventory(root, files)
    for file in files:
        owner = file.relative_to(root).as_posix()
        imports = set()
        for line, name in inventory.get(owner, []):
            names = [name] if name is not None else registry.get(f"{owner}:{line}", {}).get("targets", [])
            for specifier in names:
                if target := resolve_frontend_import(root, owner, specifier):
                    imports.add(target)
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
