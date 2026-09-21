#!/usr/bin/env python3
"""Check that a Filterest checkout's tracked source stays inside its own boundary.

The audit reads the Git index, never the worktree, and never follows symlinks.
It always checks the parts every installation shares: operator-owned homes
(config, keys, projects, data and backups) are neither tracked nor left
unignored, and tracked symlinks stay inside the checkout.

It also rejects tracked source that addresses a named private owner, such as a
sibling repository an embedding workspace keeps beside this one. Filterest
cannot know those names and must not list them, so the caller supplies them
with --forbidden-name; without names that scan has nothing to look for.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from typing import Iterable, Sequence


DEFAULT_TARGET = Path(__file__).resolve().parents[3]
OPERATOR_HOMES = ("config", "keys", "projects", "data", "backups")

DEPENDENCY_SOURCE_SUFFIXES = frozenset(
    {".go", ".js", ".json", ".mjs", ".py", ".sh", ".toml", ".ts", ".tsx", ".yaml", ".yml"}
)
DEPENDENCY_SOURCE_NAMES = frozenset({"Dockerfile", "go.mod", "go.work", "package.json"})
# Documentation, tests, fixtures and built bundles may mention other owners in
# prose or examples; the text scan covers only maintained executable source.
TEXT_SCAN_IGNORED_PARTS = frozenset(
    {"dist", "docs", "fixtures", "node_modules", "testdata", "testing"}
)
RUNTIME_SOURCE_PREFIXES = ("app/backend/", "app/frontend/")
RUNTIME_CONTRACTS = frozenset({"app/go.mod", "app/package.json"})


@dataclass(frozen=True)
class TrackedPath:
    """Represent one stage-zero path from the Git index without opening it."""

    path: str
    mode: str
    object_id: str


@dataclass(frozen=True, order=True)
class Finding:
    """Represent one deterministic source-boundary failure."""

    path: str
    code: str
    message: str


def read_tracked_paths(repository_root: Path) -> tuple[TrackedPath, ...]:
    """Read stage-zero index records without following or opening worktree paths."""

    completed = subprocess.run(
        ["git", "-C", str(repository_root), "ls-files", "--stage", "-z"],
        check=True,
        capture_output=True,
    )
    records: list[TrackedPath] = []
    for raw_record in completed.stdout.split(b"\0"):
        if not raw_record:
            continue
        try:
            raw_metadata, raw_path = raw_record.split(b"\t", 1)
            mode, object_id, stage = raw_metadata.decode("ascii").split()
        except ValueError as error:
            raise RuntimeError("git ls-files returned an unsupported stage record") from error
        path = raw_path.decode("utf-8", errors="surrogateescape")
        if stage != "0":
            raise RuntimeError(f"unmerged Git index path cannot be audited: {path}")
        records.append(TrackedPath(path=path, mode=mode, object_id=object_id))
    return tuple(sorted(records, key=lambda record: record.path))


def is_dependency_source(path: str) -> bool:
    """Say whether a path is source that a build or runtime can execute or load."""

    pure_path = PurePosixPath(path)
    if pure_path.name in DEPENDENCY_SOURCE_NAMES:
        return True
    return pure_path.suffix in DEPENDENCY_SOURCE_SUFFIXES


def _is_test_file(path: str) -> bool:
    name = PurePosixPath(path).name
    return name.endswith("_test.go") or ".test." in name or ".spec." in name


def _is_text_scanned_source(path: str) -> bool:
    if not is_dependency_source(path) or _is_test_file(path):
        return False
    return not any(part in TEXT_SCAN_IGNORED_PARTS for part in PurePosixPath(path).parts)


def _is_application_runtime_source(path: str) -> bool:
    """Select compiled application sources, including built bundles, not tests."""

    if path in RUNTIME_CONTRACTS:
        return True
    if not path.startswith(RUNTIME_SOURCE_PREFIXES) or not is_dependency_source(path):
        return False
    return not _is_test_file(path) and "testdata" not in PurePosixPath(path).parts


def forbidden_import_pattern(name: str) -> re.Pattern[str]:
    """Match Python, Go, JavaScript and shell-style imports that load `name`."""

    owner = re.escape(name)
    return re.compile(
        r"(?:"
        rf"^\s*(?:from|import)\s+{owner}(?:\.|\s|$)"
        rf"|(?:from\s+|import\s*\(|require\s*\()\s*['\"][^'\"]*{owner}"
        rf"|^\s*import\s+(?:[._A-Za-z][A-Za-z0-9_]*\s+)?['\"][^'\"]*{owner}"
        rf"|^\s*(?:[._A-Za-z][A-Za-z0-9_]*\s+)?['\"][^'\"]*{owner}[^'\"]*['\"]"
        r")",
        re.MULTILINE,
    )


def normalized_symlink_target(link_path: str, target: str) -> str | None:
    """Normalize a relative target lexically, returning None if it escapes the root."""

    if not target or target.startswith("/") or "\\" in target:
        return None
    parts = list(PurePosixPath(link_path).parent.parts)
    for part in PurePosixPath(target).parts:
        if part in {"", "."}:
            continue
        if part == "..":
            if not parts:
                return None
            parts.pop()
            continue
        parts.append(part)
    return "/".join(parts)


def _read_blob(repository_root: Path, object_id: str) -> bytes:
    return subprocess.run(
        ["git", "-C", str(repository_root), "cat-file", "blob", object_id],
        check=True,
        capture_output=True,
    ).stdout


def inspect_symlinks(repository_root: Path, tracked: Sequence[TrackedPath]) -> tuple[Finding, ...]:
    """Validate Git symlink blobs lexically without resolving their destinations."""

    findings: list[Finding] = []
    for record in tracked:
        if record.mode != "120000":
            continue
        target = _read_blob(repository_root, record.object_id).decode("utf-8", errors="surrogateescape")
        if any(ord(character) < 32 or ord(character) == 127 for character in target):
            findings.append(Finding(record.path, "unsafe-symlink-target",
                                    "tracked symlink target contains a control character"))
        elif normalized_symlink_target(record.path, target) is None:
            findings.append(Finding(record.path, "escaping-symlink",
                                    f"tracked symlink target is absolute, ambiguous, or leaves the checkout: {target!r}"))
    return tuple(sorted(findings))


def inspect_operator_homes(
    repository_root: Path,
    tracked: Sequence[TrackedPath],
    forbidden_names: Iterable[str] = (),
) -> tuple[Finding, ...]:
    """Keep operator homes and named private owners out of the tracked tree."""

    blocked_roots = set(OPERATOR_HOMES) | set(forbidden_names)
    findings = [
        Finding(record.path, "tracked-operator-or-private-path",
                "operator-owned or private path is tracked by this repository")
        for record in tracked
        if PurePosixPath(record.path).parts[0] in blocked_roots
    ]
    for home in OPERATOR_HOMES:
        ignored = subprocess.run(
            ["git", "-C", str(repository_root), "check-ignore", "--no-index", "--quiet", "--", home + "/"],
            check=False,
            capture_output=True,
        )
        if ignored.returncode != 0:
            findings.append(Finding(home + "/", "operator-home-not-ignored",
                                    "operator-owned home must be ignored by Git"))
    return tuple(sorted(findings))


def inspect_source_boundaries(
    repository_root: Path,
    tracked: Sequence[TrackedPath],
    forbidden_names: Iterable[str] = (),
) -> tuple[Finding, ...]:
    """Reject tracked source that addresses or imports a named private owner."""

    names = tuple(dict.fromkeys(name for name in forbidden_names if name))
    if not names:
        return ()
    import_patterns = [forbidden_import_pattern(name) for name in names]
    findings: list[Finding] = []
    for record in tracked:
        if record.mode == "120000":
            continue
        scan_text = _is_text_scanned_source(record.path)
        scan_imports = _is_application_runtime_source(record.path)
        if not scan_text and not scan_imports:
            continue
        source = _read_blob(repository_root, record.object_id).decode("utf-8", errors="surrogateescape")
        if scan_text:
            owner = next((name for name in names if name in source), None)
            if owner is not None:
                findings.append(Finding(record.path, "public-sibling-source-dependency",
                                        f"source addresses private owner {owner!r}"))
                continue
        if scan_imports and any(pattern.search(source) for pattern in import_patterns):
            findings.append(Finding(record.path, "runtime-forbidden-import",
                                    "application runtime imports a private owner"))
    return tuple(sorted(findings))


def audit(repository_root: Path, forbidden_names: Iterable[str] = ()) -> tuple[Finding, ...]:
    """Run every boundary check against one checkout's Git index."""

    names = tuple(forbidden_names)
    tracked = read_tracked_paths(repository_root)
    return tuple(sorted((
        *inspect_operator_homes(repository_root, tracked, names),
        *inspect_symlinks(repository_root, tracked),
        *inspect_source_boundaries(repository_root, tracked, names),
    )))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    parser.add_argument("--forbidden-name", action="append", default=[],
                        help="A private owner name tracked source must not address; repeatable")
    args = parser.parse_args(argv)

    target = args.target.resolve()
    if not target.is_dir():
        parser.error(f"target directory does not exist: {target}")
    try:
        findings = audit(target, args.forbidden_name)
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Source boundary audit could not read the checkout: {error}")
        return 2
    if findings:
        print("Source boundary audit failed:")
        for finding in findings:
            print(f"- [{finding.code}] {finding.path}: {finding.message}")
        return 1
    print(
        "Source boundary audit OK: operator homes untracked and ignored, symlinks "
        f"inside the checkout, {len(args.forbidden_name)} private owner name(s) checked."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
