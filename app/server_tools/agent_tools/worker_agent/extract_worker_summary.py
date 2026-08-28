#!/usr/bin/env python3
"""Recover a concise worker summary from a worker log.

This helper is used when a background worker did useful work but failed to
write the canonical markdown summary file before exiting.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path


def looks_like_noise(line: str) -> bool:
    prefixes = (
        "exec",
        "apply_patch",
        "view",
        "open",
        "/bin/bash",
        "Command:",
        "Chunk ID:",
        "Wall time:",
        "Process exited",
        "Original token count:",
        "Output:",
        "succeeded in ",
        "exited ",
        "Using direct DB fallback",
        "Waiting for [",
        "[20",
    )
    return line.startswith(prefixes)


def unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        key = item.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def build_summary(log_text: str) -> str:
    lines = log_text.splitlines()
    tail = lines[-400:]

    markdown_lines = [line for line in tail[-120:] if re.match(r"^(```md|# |## )", line)]
    if markdown_lines:
        return "\n".join(markdown_lines[:80]).strip()

    assistant_blocks: list[str] = []
    current_block: list[str] = []
    capture_mode = False
    for raw_line in tail:
        line = raw_line.rstrip()
        if line in {"codex", "claude"}:
            if current_block:
                assistant_blocks.append("\n".join(current_block).strip())
                current_block = []
            capture_mode = True
            continue
        if line in {"exec", "apply_patch", "open", "view"}:
            if current_block:
                assistant_blocks.append("\n".join(current_block).strip())
                current_block = []
            capture_mode = False
            continue
        if capture_mode:
            if not line:
                if current_block:
                    assistant_blocks.append("\n".join(current_block).strip())
                    current_block = []
                capture_mode = False
                continue
            if not looks_like_noise(line):
                current_block.append(line)
    if current_block:
        assistant_blocks.append("\n".join(current_block).strip())

    signal_patterns = (
        re.compile(r"^Task #\d+"),
        re.compile(r"^Warning: "),
        re.compile(r"^Dumped task #\d+"),
        re.compile(r"^Task #\d+ restored and verified"),
    )
    signal_lines = [
        clean
        for clean in (line.strip() for line in tail)
        if clean and not looks_like_noise(clean) and any(pattern.search(clean) for pattern in signal_patterns)
    ]

    assistant_blocks = unique(assistant_blocks)[-3:]
    signal_lines = unique(signal_lines)[-8:]
    if not assistant_blocks and not signal_lines:
        return ""

    summary_lines = [
        "# Recovered Worker Summary",
        "",
        "Worker exited without writing the requested summary file.",
        "This summary was reconstructed automatically from the worker log.",
    ]
    if assistant_blocks:
        summary_lines.extend(["", "## Assistant Progress"])
        for block in assistant_blocks:
            single_line = " ".join(part.strip() for part in block.splitlines() if part.strip())
            summary_lines.append(f"- {single_line}")
    if signal_lines:
        summary_lines.extend(["", "## Command Evidence"])
        for line in signal_lines:
            summary_lines.append(f"- {line}")
    return "\n".join(summary_lines).strip()


def main() -> int:
    if len(sys.argv) != 2:
        return 2
    log_path = Path(sys.argv[1])
    if not log_path.exists():
        return 1
    summary = build_summary(log_path.read_text(errors="replace"))
    if not summary:
        return 1
    print(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
