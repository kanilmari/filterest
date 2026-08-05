#!/usr/bin/env python3
"""
codesize — project source code size summary

Usage:
    ./codesize [--root PATH]

Reports line counts and sizes (KB) for:
  - Go source files
  - JS source files (non-minified)
  - JS minified files
  - CSS source files (non-minified)
  - CSS minified files
"""

from __future__ import annotations  # allow `bool | None` annotations on Python 3.9

import os
import sys
import argparse

EXCLUDE_DIRS = {"node_modules", ".git", ".gitnexus", "vendor"}


def is_minified(path: str) -> bool:
    return path.endswith(".min.js") or path.endswith(".min.css")


def collect(root: str, extensions: tuple, minified_only: bool | None = None):
    """
    Walk root, collect files matching extensions.
    minified_only=True  → only *.min.js / *.min.css
    minified_only=False → exclude *.min.js / *.min.css
    minified_only=None  → all files
    """
    lines_total = 0
    bytes_total = 0
    file_count = 0

    for dirpath, dirnames, filenames in os.walk(root):
        # Prune excluded directories in-place
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]

        for fname in filenames:
            if not fname.endswith(extensions):
                continue
            path = os.path.join(dirpath, fname)
            minified = is_minified(path)
            if minified_only is True and not minified:
                continue
            if minified_only is False and minified:
                continue

            try:
                size = os.path.getsize(path)
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    line_count = sum(1 for _ in f)
            except OSError:
                continue

            lines_total += line_count
            bytes_total += size
            file_count += 1

    return file_count, lines_total, bytes_total


def fmt(files: int, lines: int, size_bytes: int) -> str:
    kb = size_bytes / 1024
    return f"{files:>4} files   {lines:>7,} lines   {kb:>8.1f} KB"


def main():
    parser = argparse.ArgumentParser(description="Project source code size summary")
    parser.add_argument(
        "--root",
        default=os.path.dirname(os.path.abspath(__file__)),
        help="Project root directory (default: script location)",
    )
    args = parser.parse_args()
    root = args.root

    categories = [
        ("Go source",             (".go",),  None),
        ("JS  source (non-min)",  (".js",),  False),
        ("JS  minified",          (".js",),  True),
        ("CSS source (non-min)",  (".css",), False),
        ("CSS minified",          (".css",), True),
    ]

    print(f"\nSource code size — {root}\n")
    print(f"{'Category':<26}  {'Files':>4}   {'Lines':>7}   {'Size':>8}")
    print("-" * 60)

    for label, exts, minified_only in categories:
        files, lines, size = collect(root, exts, minified_only)
        print(f"{label:<26}  {fmt(files, lines, size)}")

    print()


if __name__ == "__main__":
    main()
