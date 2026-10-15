#!/usr/bin/env python3
# check_md_links.py
# Checks relative links and anchors in tracked Markdown without writing files or using the network.
# Connects the checkout's documentation to QA and the ordinary Python test tier.
# Exists so broken documentation destinations fail local verification.
"""Usage: check_md_links.py [checkout] (defaults to the checkout above app/)."""
import argparse
import os
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path

HEADING = re.compile(r"^ {0,3}(#{1,6}) (.*?)\s*#*\s*$")
SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
FENCE = re.compile(r"^(`{3,}|~{3,})(.*)$")
LIST_ITEM = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")
COMMENT = re.compile(r"<!--.*?-->", re.S)
EXPLICIT_ANCHOR = re.compile(r"""<a\s+[^>]*?\b(?:name|id)\s*=\s*(["'])(.*?)\1""")
HREF = re.compile(r"""\bhref\s*=\s*(["'])(.*?)\1""")


def without_inline_code(line):
    """Drop inline code spans: a run of N backticks closes only at the next run of exactly N; an unmatched run is
    literal text."""
    out, i = [], 0
    while i < len(line):
        if line[i] != "`":
            out.append(line[i])
            i += 1
            continue
        j = i
        while j < len(line) and line[j] == "`":
            j += 1
        k, close = j, None
        while k < len(line):
            if line[k] != "`":
                k += 1
                continue
            m = k
            while m < len(line) and line[m] == "`":
                m += 1
            if m - k == j - i:
                close = m
                break
            k = m
        if close is None:
            out.append(line[i:j])
            i = j
        else:
            i = close
    return "".join(out)


def rendered_lines(lines):
    """Each line as GitHub would render it, or None for code. An approximation, not a full CommonMark parser:
    HTML comments are blanked first (line count kept); then one pass decides indented code and fences with one indent
    rule. A line at least 4 columns in (4 beyond a list item's content indent inside a list) after a blank line is
    indented code and never opens a fence; a fence opens only below that indent and closes only with the same
    character, at least as many, and nothing else on the line. Headings, explicit anchors and link destinations all
    read these lines."""
    visible = COMMENT.sub(lambda m: "\n" * m.group(0).count("\n"), "\n".join(lines)).split("\n")
    result, list_indent, previous_blank, in_code, fence = [], None, True, False, None
    for line in visible:
        expanded = line.expandtabs(4)
        stripped = expanded.lstrip()
        indent = len(expanded) - len(stripped)
        match = FENCE.match(stripped)
        if fence is not None:
            result.append(None)
            if match and match.group(1)[0] == fence[0] and len(match.group(1)) >= fence[1] and not match.group(2).strip():
                fence = None
            previous_blank, in_code = False, False
            continue
        if not stripped:
            result.append(line)
            previous_blank = True
            continue
        code_from = 4 if list_indent is None else list_indent + 4
        if indent >= code_from and (previous_blank or in_code):
            result.append(None)
            in_code, previous_blank = True, False
            continue
        if indent < code_from and match and not (match.group(1)[0] == "`" and "`" in match.group(2)):
            fence = (match.group(1)[0], len(match.group(1)))
            result.append(None)
            in_code, previous_blank = False, False
            continue
        item = LIST_ITEM.match(expanded)
        if item:
            list_indent = len(item.group(0))
        elif indent == 0:
            list_indent = None
        result.append(line)
        in_code, previous_blank = False, False
    return result


def heading_text_for_slug(text):
    """Approximate GitHub's rendered heading text: drop link URLs, images, emphasis markers and HTML."""
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"(\*\*|__|\*)", "", text)
    return text


def slug(text):
    text = heading_text_for_slug(text).strip().lower()
    text = re.sub(r"[^\w\- ]", "", text)
    return text.replace(" ", "-")


_anchor_cache = {}


def anchors(path):
    if path in _anchor_cache:
        return _anchor_cache[path]
    lines = path.read_text(encoding="utf-8", errors="replace").split("\n")
    seen, result = {}, set()
    # Only rendered text creates an anchor: not code (fenced, indented or inline) and not HTML comments.
    for line in rendered_lines(lines):
        if line is None:
            continue
        match = HEADING.match(line)
        if match:
            base = slug(match.group(2))
            count = seen.get(base, 0)
            seen[base] = count + 1
            result.add(base if count == 0 else f"{base}-{count}")
        result.update(value for _quote, value in EXPLICIT_ANCHOR.findall(without_inline_code(line)))
    _anchor_cache[path] = result
    return result


def destinations(line):
    without_code = without_inline_code(line)
    for match in re.finditer(r"\]\(\s*(<[^>]*>|[^)\s]*)", without_code):
        yield match.group(1)
    match = re.match(r"^\s{0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)", without_code)
    if match:
        yield match.group(1)
    for match in HREF.finditer(without_code):
        yield match.group(2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("checkout", nargs="?", default=Path(__file__).resolve().parents[3])
    args = parser.parse_args()
    root = Path(args.checkout).resolve()
    try:
        listed = subprocess.run(["git", "-C", str(root), "ls-files", "-z", "--", "*.md"],
                                capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        print("Cannot list tracked Markdown files: Git must be available and the checkout valid.",
              file=sys.stderr)
        return 1
    files = [f for f in listed.split("\0") if f]
    broken, total = [], 0
    for relative in files:
        path = root / relative
        if not path.is_file():
            continue
        lines = path.read_text(encoding="utf-8", errors="replace").split("\n")
        for line_no, line in enumerate(rendered_lines(lines), 1):
            if line is None:
                continue
            for dest in destinations(line):
                dest = dest.strip("<>")
                if not dest or SCHEME.match(dest) or "{{" in dest or dest.startswith("//"):
                    continue
                total += 1
                target_part, _, fragment = dest.partition("#")
                target_part = urllib.parse.unquote(target_part.split("?")[0])
                if not target_part:
                    target = path
                elif target_part.startswith("/"):
                    target = root / target_part.lstrip("/")
                else:
                    target = path.parent / target_part
                target = Path(os.path.normpath(target))
                try:
                    target.relative_to(root)
                except ValueError:
                    broken.append(f"{relative}:{line_no}: {dest} (outside the checkout)")
                    continue
                if not target.exists():
                    broken.append(f"{relative}:{line_no}: {dest} (missing target)")
                    continue
                if fragment and target.is_file() and target.suffix == ".md":
                    fragment = urllib.parse.unquote(fragment)
                    if fragment not in anchors(target):
                        reason = "missing anchor"
                        if fragment.lower() in anchors(target):
                            reason = "anchor case differs"
                        broken.append(f"{relative}:{line_no}: {dest} ({reason})")
    for finding in broken:
        print(finding)
    print(f"checked {total} relative links in {len(files)} tracked Markdown files; {len(broken)} broken")
    return 1 if broken else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except OSError:
        print("Cannot read Markdown files; link check did not complete.", file=sys.stderr)
        sys.exit(1)
