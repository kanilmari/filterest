"""relevant_check_coverage.py
Resolve production files to reviewed proofs using directory inheritance.
Connect the planner, repository inventory and expiring exact-file exceptions.
Keep generic scans and tier membership from hiding missing behavioural checks.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path
import re
import subprocess


def matches(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(prefix + "/")


def exemption(path: str) -> str | None:
    """Exempt only non-production names; generated assets and root files count."""
    if not any(matches(path, prefix) for prefix in ("app/frontend", "app/backend")):
        return "outside frontend/backend production trees"
    file = Path(path)
    name = file.name
    if file.suffix.lower() in {".md", ".rst"} or name.lower() in {"readme", "changelog"}:
        return "documentation"
    # Go reserves the exact _test.go suffix; the frontend Vitest configs collect
    # only .test.js, outside dist. Other test/spec-like extensions can be shipped
    # code (for example .spec.go or .test.css), so they still require a proof.
    # Fixture markers must be whole parent directories, never a leaf filename.
    frontend_test = (matches(path, "app/frontend") and name.endswith(".test.js")
                     and "dist" not in file.parts)
    if (name.endswith("_test.go") or frontend_test
            or {"testdata", "__tests__", "__snapshots__"}.intersection(file.parts[:-1])):
        return "test or test fixture"
    return None


def tracked_production_paths(root: Path) -> list[str]:
    result = subprocess.run(["git", "ls-files", "-z", "--", "app/frontend", "app/backend"],
                            cwd=root, capture_output=True, check=True)
    return sorted(path for path in result.stdout.decode(errors="surrogateescape").split("\0")
                  if path and exemption(path) is None and (root / path).is_file())


def validate_coverage_metadata(root: Path, policy: dict, normalize) -> None:
    """Exceptions are exact current files, never directories, globs or stale waivers."""
    scopes = set()
    exceptions = policy.get("exceptions", [])
    if not isinstance(exceptions, list):
        raise ValueError("exceptions must be a list of exact-file entries")
    for entry in exceptions:
        if (not isinstance(entry, dict) or set(entry) != {"scope", "reason", "owner", "expires"}
                or not all(isinstance(value, str) and value.strip() for value in entry.values())):
            raise ValueError("malformed exception: require exact scope, reason, owner and expires YYYY-MM-DD")
        scope = entry["scope"]
        if (normalize(scope) != scope or any(c in scope for c in "*?[]")
                or not (root / scope).is_file() or exemption(scope) is not None):
            raise ValueError(f"exception scope must be an exact existing production file, not a prefix: {scope}")
        if scope in scopes:
            raise ValueError(f"duplicate exception scope: {scope}")
        scopes.add(scope)
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", entry["expires"]):
                raise ValueError
            expires = date.fromisoformat(entry["expires"])
        except ValueError as error:
            raise ValueError(f"malformed exception expiry for {scope}: expected YYYY-MM-DD") from error
        if expires < date.today():
            raise ValueError(f"expired exception for {scope}: {entry['expires']}")
    for entry in policy.get("nightly_only", []):
        if not entry.get("paths") or not isinstance(entry.get("reason"), str) or not entry["reason"].strip():
            raise ValueError("nightly_only entries need nonempty paths and a written reason")
        for path in entry["paths"]:
            if normalize(path) != path or not (root / path).exists():
                raise ValueError(f"curated path or spec disappeared: {path}")
    for guard in [*policy["source_guards"], *policy.get("python_guards", [])]:
        for path in guard.get("coverage_paths", []):
            if (normalize(path) != path or not (root / path).exists()
                    or not any(matches(path, prefix) for prefix in guard["paths"])):
                raise ValueError(f"invalid or missing guard coverage path: {path}")
    prefixes = policy.get("nightly_cross_cutting_prefixes", [])
    if (not isinstance(prefixes, list) or len(prefixes) != len(set(prefixes))
            or any(not isinstance(prefix, str) or not prefix.startswith("app/frontend/")
                   or normalize(prefix) != prefix.rstrip("/") for prefix in prefixes)):
        raise ValueError("nightly_cross_cutting_prefixes must be unique literal frontend prefixes")


def matrix_specs(root: Path) -> set[str]:
    """Inventory the six-project matrix, including its opt-in setup specs.

    Visual Guardian, manual custom-root and cookie-isolation configs are separate
    suites, not this matrix. Never execute Playwright just to inspect its testDir.
    Small source-discovery fixtures predate the explicit testDir declaration.
    """
    config = root / "app/playwright.config.ts"
    source = config.read_text()
    directories = re.findall(r"\btestDir:\s*['\"]([^'\"]+)['\"]", source)
    if not directories and re.search(r"\btestDir\s*:", source):
        raise ValueError("matrix testDir must be a literal path for offline coverage validation")
    if not directories:
        directories = ["./testing/e2e"]
    for directory in directories:
        target = (config.parent / directory).resolve()
        if not target.is_relative_to(root.resolve()) or not target.is_dir():
            raise ValueError(f"matrix testDir is missing or outside the repository: {directory}")
    return {path.relative_to(root).as_posix() for directory in directories
            for path in (config.parent / directory).rglob("*")
            if path.is_file() and re.search(r"\.(spec|test)\.[cm]?[jt]sx?$", path.name)
            and not path.name.endswith(".test.ts")  # matrix-test-selection.cjs
            and "manual_specs" not in path.parts}


def coverage_index(root: Path, policy: dict, tests: dict) -> list[dict]:
    """Build named records; longest matching prefix wins, ties retain all proofs.

    coverage_paths narrows only what a broad scanner certifies, never its existing
    selection triggers. A package without _test.go declarations certifies nothing.
    """
    records = []

    def add(kind, identifier, paths, **details):
        records.extend({"class": kind, "id": identifier, "prefix": path, **details} for path in paths)

    for area in policy["browser_areas"]:
        if area["specs"]:
            add("browser", "browser:" + area["area"], area["paths"],
                targets=area["specs"], projects=area["projects"])
    for package, names in sorted(tests.items()):
        if names:
            add("go", "go:" + package, [package], tests=sorted(names), targets=[package])
    for guard in policy["source_guards"]:
        add("source_guard", "source:" + guard["anchor"], guard.get("coverage_paths", guard["paths"]),
            targets=[guard["package"]], anchor=guard["anchor"])
    for guard in policy.get("python_guards", []):
        for test in guard["tests"]:
            add("python_guard", "python:" + test, guard.get("coverage_paths", guard["paths"]), targets=[test])
    for entry in policy.get("nightly_only", []):
        add("nightly_only", "nightly:" + entry["paths"][0], entry["paths"], reason=entry["reason"])
    for entry in policy.get("exceptions", []):
        add("exception", "exception:" + entry["scope"], [entry["scope"]], **entry)
    return records


def resolve_coverage(path: str, index: list[dict]) -> list[dict]:
    candidates = [entry for entry in index if (path == entry["prefix"] if entry["class"] == "exception"
                                              else matches(path, entry["prefix"]))
                  and not (entry["class"] == "go" and path.endswith(".go")
                           and str(Path(path).parent) != entry["prefix"])]
    longest = max((len(entry["prefix"]) for entry in candidates), default=-1)
    return [entry for entry in candidates if len(entry["prefix"]) == longest]


def require_coverage(root: Path, paths: set[str], index: list[dict]) -> None:
    # Existing explicit/untracked additions are checked too, so a worker can fix
    # the map before staging. Missing/deleted names still select surviving proofs.
    missing = sorted(path for path in paths if exemption(path) is None and (root / path).is_file()
                     and not resolve_coverage(path, index))
    if missing:
        raise ValueError("unmapped production paths: " + ", ".join(missing)
                         + ". Add an existing browser-area/source/Python guard mapping, a tested Go package, "
                         "or nightly_only with a reason in app/testing/python/relevant_check_map.json; "
                         "a temporary exception must name the exact file, reason, owner and expiry.")


def nightly_cross_cutting_paths(paths: list[str], policy: dict) -> list[str]:
    """Preserve the nightly regex's raw startswith semantics and input order."""
    return [path for path in paths if any(path.startswith(prefix)
                                         for prefix in policy.get("nightly_cross_cutting_prefixes", []))]
