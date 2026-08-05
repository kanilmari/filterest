#!/usr/bin/env python3
"""
migrate_http_error.py

Migrates http.Error(w, msg, status) calls in Go backend files to
httpresponse.RespondWithError(w, status, msg) and adds the httpresponse import.

Uses parenthesis-aware argument splitting to correctly handle calls like:
    http.Error(w, fmt.Sprintf("failed: %v", err), http.StatusInternalServerError)

Run from the project root:
    python3 server_tools/agent_tools/migrate_http_error.py [--dry-run]
"""

import os
import re
import sys

BACKEND_DIR = "backend"
HTTPRESPONSE_IMPORT_PATH = "easelect/backend/core_components/httpresponse"
HTTPRESPONSE_IMPORT = f'"{HTTPRESPONSE_IMPORT_PATH}"'


def split_go_arguments(args_str):
    """
    Split a Go argument list string by top-level commas only,
    respecting parentheses, brackets, braces, and string literals.
    Returns a list of argument strings (stripped of whitespace).

    Example:
        'w, fmt.Sprintf("a, b", x), http.StatusOK'
    →   ['w', 'fmt.Sprintf("a, b", x)', 'http.StatusOK']
    """
    args = []
    depth = 0
    in_string = False
    string_char = ''
    current = []

    i = 0
    while i < len(args_str):
        ch = args_str[i]

        # Handle escape sequences inside strings
        if in_string:
            if ch == '\\' and i + 1 < len(args_str):
                current.append(ch)
                current.append(args_str[i + 1])
                i += 2
                continue
            if ch == string_char:
                in_string = False
            current.append(ch)
            i += 1
            continue

        # String start
        if ch in ('"', "'", '`'):
            in_string = True
            string_char = ch
            current.append(ch)
            i += 1
            continue

        # Depth tracking
        if ch in ('(', '[', '{'):
            depth += 1
        elif ch in (')', ']', '}'):
            depth -= 1

        # Split on top-level comma
        if ch == ',' and depth == 0:
            args.append(''.join(current).strip())
            current = []
            i += 1
            continue

        current.append(ch)
        i += 1

    if current:
        args.append(''.join(current).strip())

    return args


def find_http_error_call(line, start=0):
    """
    Find an `http.Error(` call in the line starting from 'start'.
    Returns (call_start, call_end, [arg1, arg2, arg3]) or None if not found.
    call_start: index of 'h' in 'http'
    call_end: index AFTER the closing ')'
    """
    idx = line.find('http.Error(', start)
    if idx == -1:
        return None

    # Make sure it's not commented out
    stripped = line[:idx].lstrip()
    if stripped.startswith('//'):
        return None

    # Find the matching closing paren
    paren_start = idx + len('http.Error(')
    depth = 1
    in_string = False
    string_char = ''
    i = paren_start

    while i < len(line) and depth > 0:
        ch = line[i]
        if in_string:
            if ch == '\\' and i + 1 < len(line):
                i += 2
                continue
            if ch == string_char:
                in_string = False
        elif ch in ('"', "'", '`'):
            in_string = True
            string_char = ch
        elif ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        i += 1

    if depth != 0:
        return None  # Unmatched parens (multi-line call — skip)

    call_end = i
    args_str = line[paren_start:i - 1]  # Everything inside the outer parens
    args = split_go_arguments(args_str)

    if len(args) != 3:
        return None  # Unexpected arg count

    return (idx, call_end, args)


def transform_line(line):
    """
    Transform all http.Error( calls in a single line.
    Returns (new_line, was_changed).
    """
    result = line
    changed = False
    search_from = 0

    while True:
        match = find_http_error_call(result, search_from)
        if match is None:
            break

        call_start, call_end, args = match
        w, msg, status = args

        replacement = f'httpresponse.RespondWithError({w}, {status}, {msg})'
        result = result[:call_start] + replacement + result[call_end:]
        changed = True
        search_from = call_start + len(replacement)

    return result, changed


def add_httpresponse_import(content):
    """Add httpresponse import to file if not already present."""
    if HTTPRESPONSE_IMPORT_PATH in content:
        return content

    # Strategy 1: Add inside existing grouped import block that contains "net/http"
    grouped_with_net_http = re.search(
        r'(import\s*\([^)]*"net/http"[^)]*)\)',
        content,
        re.DOTALL
    )
    if grouped_with_net_http:
        old_block = grouped_with_net_http.group(0)
        new_block = old_block.replace(
            '"net/http"',
            f'"net/http"\n\t{HTTPRESPONSE_IMPORT}'
        )
        return content.replace(old_block, new_block, 1)

    # Strategy 2: Any grouped import block — add at top
    grouped_import = re.search(r'(import\s*\()\s*\n', content)
    if grouped_import:
        insert_pos = grouped_import.end()
        return (
            content[:insert_pos]
            + f'\t{HTTPRESPONSE_IMPORT}\n'
            + content[insert_pos:]
        )

    # Strategy 3: Single-line import of "net/http"
    single_http = re.search(r'import "net/http"\n', content)
    if single_http:
        insert_pos = single_http.end()
        return (
            content[:insert_pos]
            + f'import {HTTPRESPONSE_IMPORT}\n'
            + content[insert_pos:]
        )

    print('  WARNING: Could not find import block to add httpresponse import')
    return content


def process_file(filepath, dry_run=False):
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    new_lines = []
    any_changed = False
    for line in lines:
        new_line, changed = transform_line(line)
        new_lines.append(new_line)
        if changed:
            any_changed = True

    if not any_changed:
        return False

    content = ''.join(new_lines)
    if 'httpresponse.RespondWithError' in content:
        content = add_httpresponse_import(content)

    if dry_run:
        print(f'  [DRY RUN] Would modify: {filepath}')
        return True

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    return True


def main():
    dry_run = '--dry-run' in sys.argv

    if dry_run:
        print('=== DRY RUN MODE ===\n')

    modified_count = 0
    for root, dirs, files in os.walk(BACKEND_DIR):
        dirs[:] = [d for d in dirs if d not in ('vendor', 'generated')]
        for fname in files:
            if not fname.endswith('.go'):
                continue
            fpath = os.path.join(root, fname)
            if process_file(fpath, dry_run=dry_run):
                modified_count += 1
                if not dry_run:
                    print(f'  Modified: {fpath}')

    print(f'\nTotal files modified: {modified_count}')


if __name__ == '__main__':
    main()
