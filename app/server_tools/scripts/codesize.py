#!/usr/bin/env python3
# codesize.py
# Reports how much source code lives under one or more paths, split by language
# and separating tests from the code they test.
# Bridges an ordinary question — how big is this part of the project — with the
# repository's own idea of what belongs to it.
# Exists because the previous measurement walked the filesystem and counted
# dependency caches, build output and other repositories' checkouts, reporting
# roughly seventy times more Go than the project contains. It now counts what
# Git tracks, so the answer matches what a reviewer would actually read.

from __future__ import annotations

import argparse
import fnmatch
import os
import subprocess
import sys
from collections import defaultdict

# Languages worth counting as code, keyed by file extension. Anything not
# listed is reported under "other" so nothing disappears silently.
LANGUAGE_BY_EXTENSION = {
    ".go": "Go",
    ".js": "JavaScript",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".py": "Python",
    ".sql": "SQL",
    ".css": "CSS",
    ".html": "HTML",
    ".sh": "Shell",
    ".bash": "Shell",
}

# Prose and configuration are counted and shown, but kept out of the code total
# so that a large document set cannot quietly inflate "how much code is this".
NON_CODE_LANGUAGES = {"Markdown", "Config"}
LANGUAGE_BY_EXTENSION_NON_CODE = {
    ".md": "Markdown",
    ".json": "Config",
    ".yml": "Config",
    ".yaml": "Config",
    ".toml": "Config",
}

# A file is a test when its name says so. These are the project's own
# conventions; --test-glob adds more without editing this list.
DEFAULT_TEST_GLOBS = (
    "*_test.go",
    "*.test.js",
    "*.test.mjs",
    "*.test.cjs",
    "*.test.ts",
    "*.test.tsx",
    "*.spec.js",
    "*.spec.mjs",
    "*.spec.ts",
    "*.spec.tsx",
    "test_*.py",
    "*_test.py",
    "conftest.py",
)

# A file is also a test when it sits in a directory named for testing. Keeping
# this separate from the name patterns lets --test-glob stay about names.
TEST_DIRECTORY_NAMES = {"test", "tests", "testing", "__tests__", "e2e"}

# Tracked, but nobody wrote it: schema snapshots, packaged bootstraps, build
# output and release ledgers. They are committed on purpose and they are real,
# but counting them as source is how one repository came to report 1.4 million
# lines of SQL. Shown in their own section, never in the authored total.
GENERATED_PATH_GLOBS = (
    "*/schema_snapshots/*",
    "*/bootstrap_seeds/*",
    "*/generated/*",
    "*/dist/*",
    "*/build/*",
    "*/_artifacts/*",
    "*/THIRD_PARTY_LICENSES/*",
    "*/public_bootstrap/schema.sql",
    "*/public_bootstrap/seed_data.sql",
    "*/public_bootstrap/manifest.json",
    "*.lock",
    "*-lock.json",
    "*.jsonl",
)

# Walked only when Git cannot answer, so the fallback does not wander into
# dependency trees.
EXCLUDE_DIRS = {
    ".git",
    ".gitnexus",
    ".pytest_cache",
    ".venv",
    "__pycache__",
    "node_modules",
    "vendor",
}


def is_minified(name: str) -> bool:
    return name.endswith(".min.js") or name.endswith(".min.css")


def classify_language(name: str) -> tuple[str, bool]:
    """Return the language of a file and whether it counts toward code."""
    if is_minified(name):
        return "minified", False
    _, extension = os.path.splitext(name)
    extension = extension.lower()
    if extension in LANGUAGE_BY_EXTENSION:
        return LANGUAGE_BY_EXTENSION[extension], True
    if extension in LANGUAGE_BY_EXTENSION_NON_CODE:
        return LANGUAGE_BY_EXTENSION_NON_CODE[extension], False
    return "other", False


def is_test_file(relative_path: str, test_globs: tuple[str, ...]) -> bool:
    name = os.path.basename(relative_path)
    if any(fnmatch.fnmatch(name, pattern) for pattern in test_globs):
        return True
    parts = relative_path.replace(os.sep, "/").split("/")[:-1]
    return any(part in TEST_DIRECTORY_NAMES for part in parts)


def is_generated_file(relative_path: str, generated_globs: tuple[str, ...]) -> bool:
    candidate = "/" + relative_path.replace(os.sep, "/").lstrip("./")
    return any(fnmatch.fnmatch(candidate, pattern) for pattern in generated_globs)


def is_binary_file(path: str) -> bool:
    """A file with a null byte in its first block is not text.

    Without this check an archive committed for release packaging is opened as
    UTF-8 with replacement characters and its accidental newlines are counted
    as lines of source.
    """
    try:
        with open(path, "rb") as handle:
            return b"\0" in handle.read(8192)
    except OSError:
        return True


def git_tracked_files(path: str) -> list[str] | None:
    """List the files Git tracks under path, or None when Git cannot answer.

    Counting tracked files is what makes the total honest: a dependency cache,
    a build output directory and a neighbouring repository's checkout are all
    untracked here, and all of them used to be counted.
    """
    try:
        listing = subprocess.run(
            ["git", "ls-files", "-z", "--", "."],
            cwd=path if os.path.isdir(path) else os.path.dirname(path) or ".",
            capture_output=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    base = path if os.path.isdir(path) else os.path.dirname(path) or "."
    names = [entry for entry in listing.stdout.decode("utf-8", "replace").split("\0") if entry]
    return [os.path.join(base, name) for name in names]


def walked_files(path: str) -> list[str]:
    if os.path.isfile(path):
        return [path]
    found = []
    for dirpath, dirnames, filenames in os.walk(path):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        found.extend(os.path.join(dirpath, name) for name in filenames)
    return found


def measure(paths, use_git, test_globs, generated_globs, tests_mode):
    """Total lines and bytes per language, kept apart by what the file is."""
    totals = {
        "source": defaultdict(lambda: [0, 0, 0]),
        "tests": defaultdict(lambda: [0, 0, 0]),
        "generated": defaultdict(lambda: [0, 0, 0]),
    }
    sources_used = []
    seen = set()
    binary_skipped = 0

    for path in paths:
        absolute = os.path.abspath(path)
        if not os.path.exists(absolute):
            print(f"codesize: no such path: {path}", file=sys.stderr)
            return None, None

        files = git_tracked_files(absolute) if use_git else None
        sources_used.append((absolute, "tracked by Git" if files is not None else "on disk"))
        if files is None:
            files = walked_files(absolute)

        for file_path in files:
            real = os.path.realpath(file_path)
            if real in seen:
                continue
            seen.add(real)

            relative = os.path.relpath(file_path, absolute)
            if is_generated_file(relative, generated_globs):
                group = "generated"
            elif is_test_file(relative, test_globs):
                group = "tests"
            else:
                group = "source"
            if tests_mode == "exclude" and group == "tests":
                continue
            if tests_mode == "only" and group != "tests":
                continue

            if is_binary_file(file_path):
                binary_skipped += 1
                continue

            language, _ = classify_language(os.path.basename(file_path))
            try:
                size = os.path.getsize(file_path)
                with open(file_path, "r", encoding="utf-8", errors="replace") as handle:
                    line_count = sum(1 for _ in handle)
            except OSError:
                continue

            bucket = totals[group][language]
            bucket[0] += 1
            bucket[1] += line_count
            bucket[2] += size

    return totals, sources_used, binary_skipped


def print_section(title, per_language):
    if not per_language:
        return 0, 0
    print(f"\n{title}")
    print(f"{'Language':<16}  {'Files':>6}   {'Lines':>9}   {'Size':>9}")
    print("-" * 48)

    code_lines = 0
    code_files = 0
    for language in sorted(per_language, key=lambda name: -per_language[name][1]):
        files, lines, size = per_language[language]
        print(f"{language:<16}  {files:>6}   {lines:>9,}   {size / 1024:>8.1f} KB")
        if language not in NON_CODE_LANGUAGES and language not in {"minified", "other"}:
            code_lines += lines
            code_files += files

    print("-" * 48)
    print(f"{'code':<16}  {code_files:>6}   {code_lines:>9,}")
    return code_files, code_lines


def main():
    parser = argparse.ArgumentParser(
        description="How much source code lives under a path, by language, tests kept separate.",
    )
    parser.add_argument(
        "paths",
        nargs="*",
        help="Paths to measure (default: this repository's root).",
    )
    parser.add_argument(
        "--root",
        help="Deprecated spelling of a single path; prefer a positional path.",
    )
    parser.add_argument(
        "--all-files",
        action="store_true",
        help="Count every file on disk instead of only the ones Git tracks. "
        "Includes build output and dependency caches, so totals grow sharply.",
    )
    parser.add_argument(
        "--no-tests",
        dest="tests_mode",
        action="store_const",
        const="exclude",
        help="Leave test files out entirely.",
    )
    parser.add_argument(
        "--only-tests",
        dest="tests_mode",
        action="store_const",
        const="only",
        help="Count only test files.",
    )
    parser.add_argument(
        "--test-glob",
        action="append",
        default=[],
        metavar="PATTERN",
        help="Treat filenames matching PATTERN as tests, in addition to the "
        "built-in patterns. Repeatable, for example --test-glob '*.bench.js'.",
    )
    parser.add_argument(
        "--generated-glob",
        action="append",
        default=[],
        metavar="PATTERN",
        help="Treat paths matching PATTERN as generated artifacts rather than "
        "authored source. Repeatable, matched against the path from the "
        "measured root, for example --generated-glob '*/fixtures/*'.",
    )
    parser.add_argument(
        "--list-test-patterns",
        action="store_true",
        help="Print the patterns and directory names that mark a file as a test.",
    )
    args = parser.parse_args()

    if args.list_test_patterns:
        print("Filename patterns:")
        for pattern in DEFAULT_TEST_GLOBS:
            print(f"  {pattern}")
        print("Directory names:")
        for name in sorted(TEST_DIRECTORY_NAMES):
            print(f"  {name}/")
        print("Generated-artifact paths (not counted as authored):")
        for pattern in GENERATED_PATH_GLOBS:
            print(f"  {pattern}")
        return 0

    paths = list(args.paths)
    if args.root:
        paths.append(args.root)
    if not paths:
        paths = [os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))]

    test_globs = DEFAULT_TEST_GLOBS + tuple(args.test_glob)
    tests_mode = args.tests_mode or "split"

    generated_globs = GENERATED_PATH_GLOBS + tuple(args.generated_glob)

    totals, sources_used, binary_skipped = measure(
        paths, not args.all_files, test_globs, generated_globs, tests_mode
    )
    if totals is None:
        return 1

    for absolute, how in sources_used:
        print(f"\n{absolute}  ({how})")

    source_files, source_lines = print_section("Source", totals["source"])
    test_files, test_lines = print_section("Tests", totals["tests"])
    generated_files, generated_lines = print_section(
        "Generated — not counted as authored", totals["generated"]
    )

    authored_files = source_files + test_files
    authored_lines = source_lines + test_lines
    if authored_lines:
        share = 100 * test_lines / authored_lines
        print(f"\nauthored: {authored_files:,} files, {authored_lines:,} lines "
              f"— {share:.0f}% of it tests")
    if generated_lines:
        print(f"generated: {generated_files:,} files, {generated_lines:,} lines")
    if binary_skipped:
        print(f"skipped {binary_skipped:,} binary files")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
