#!/usr/bin/env python3
"""Create or rotate Filterest's protected system-manager token safely.

This public module is deliberately independent of Easelect's private release
and credential-rotation machinery. It updates one explicit environment file,
never prints the token, and makes the replacement durable before reporting
success.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
import fcntl
import os
import re
import secrets
import stat
import sys
import tempfile
from pathlib import Path
from typing import Iterator, Optional


STRICT_PERMISSION_MODE = 0o600
SYSTEM_MANAGER_TOKEN_KEY = "EASELECT_SYSTEM_MANAGER_TOKEN"
SYSTEM_MANAGER_TOKEN_MINIMUM_LENGTH = 32
DOTENV_ASSIGNMENT_LINE = re.compile(
    r"^[ \t]*(?:export[ \t]+)?(?P<key>[A-Za-z_][A-Za-z0-9_.-]*)"
    r"[ \t]*(?:=|:)[ \t]*(?P<value>.*)$",
)


class ManagerTokenFileError(ValueError):
    """Reject an ambiguous or unsafe protected-environment update."""


@dataclass(frozen=True)
class _DotenvAssignment:
    """One top-level dotenv assignment and its replaceable source span."""

    start: int
    end: int
    value: str


@contextmanager
def _locked_parent_directory(path: Path) -> Iterator[None]:
    """Serialize manager-token updates without creating another secret file."""

    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        directory_descriptor = os.open(path.parent, flags)
    except OSError as error:
        raise ManagerTokenFileError(
            f"cannot safely lock protected runtime directory: {path.parent}: {error}"
        ) from error

    try:
        fcntl.flock(directory_descriptor, fcntl.LOCK_EX)
        yield
    finally:
        try:
            fcntl.flock(directory_descriptor, fcntl.LOCK_UN)
        finally:
            os.close(directory_descriptor)


def _read_regular_file_without_following_symlinks(path: Path) -> str:
    """Read an existing regular file without following its final component."""

    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except FileNotFoundError as error:
        raise ManagerTokenFileError(
            f"protected runtime environment file does not exist: {path}; run setup first"
        ) from error
    except OSError as error:
        raise ManagerTokenFileError(
            f"cannot safely open protected runtime environment file: {path}: {error}"
        ) from error

    try:
        file_status = os.fstat(descriptor)
        if not stat.S_ISREG(file_status.st_mode):
            raise ManagerTokenFileError(
                f"protected runtime environment path is not a regular file: {path}"
            )
        with os.fdopen(descriptor, "r", encoding="utf-8", newline="") as env_stream:
            descriptor = -1
            return env_stream.read()
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def _write_owner_only_atomic_file(
    path: Path,
    content: str,
    *,
    expected_content: str,
) -> None:
    """Compare, replace atomically, and sync file plus directory entries."""

    parent = path.parent
    temp_descriptor = -1
    temp_path: Path | None = None
    try:
        temp_descriptor, raw_temp_path = tempfile.mkstemp(
            prefix=f".{path.name}.manager-key-",
            dir=parent,
        )
        temp_path = Path(raw_temp_path)
        os.fchmod(temp_descriptor, STRICT_PERMISSION_MODE)
        with os.fdopen(
            temp_descriptor,
            "w",
            encoding="utf-8",
            newline="",
        ) as temp_stream:
            temp_descriptor = -1
            temp_stream.write(content)
            temp_stream.flush()
            os.fsync(temp_stream.fileno())

        # Keep the optimistic comparison directly beside the atomic swap. The
        # parent-directory lock serializes this tool and the comparison fails
        # closed if another writer that does not honor the lock changed the file
        # while the replacement was being prepared.
        current_content = _read_regular_file_without_following_symlinks(path)
        if current_content != expected_content:
            raise ManagerTokenFileError(
                "protected runtime environment changed during manager-key update; retry"
            )
        os.replace(temp_path, path)
        temp_path = None

        directory_flags = os.O_RDONLY
        if hasattr(os, "O_DIRECTORY"):
            directory_flags |= os.O_DIRECTORY
        directory_descriptor = os.open(parent, directory_flags)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        if temp_descriptor >= 0:
            os.close(temp_descriptor)
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def _system_manager_token_is_usable(value: str) -> bool:
    """Match the server's minimum length and header-safe token alphabet."""

    return (
        len(value) >= SYSTEM_MANAGER_TOKEN_MINIMUM_LENGTH
        and re.fullmatch(r"[A-Za-z0-9_-]+", value) is not None
    )


def _decoded_assignment_value(raw_value: str) -> str:
    """Read the simple quoted forms accepted for a header-safe manager token."""

    value = raw_value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _closing_quote_index(value: str, quote: str, *, start: int = 0) -> int:
    """Find one unescaped closing quote in a dotenv value fragment."""

    escaped = False
    for index in range(start, len(value)):
        character = value[index]
        if character == quote and not escaped:
            return index
        if character == "\\" and not escaped:
            escaped = True
        else:
            escaped = False
    return -1


def _find_system_manager_token_assignments(content: str) -> list[_DotenvAssignment]:
    """Find top-level token assignments while ignoring multiline quoted values."""

    assignments: list[_DotenvAssignment] = []
    lines = content.splitlines(keepends=True)
    offsets: list[int] = []
    offset = 0
    for line in lines:
        offsets.append(offset)
        offset += len(line)

    line_index = 0
    while line_index < len(lines):
        physical_line = lines[line_index]
        line_body = physical_line.rstrip("\r\n")
        match = DOTENV_ASSIGNMENT_LINE.match(line_body)
        if match is None:
            line_index += 1
            continue

        raw_value = match.group("value")
        stripped_value = raw_value.lstrip()
        quote = stripped_value[0] if stripped_value[:1] in {"'", '"'} else ""
        closing_index = (
            _closing_quote_index(stripped_value, quote, start=1) if quote else 0
        )
        assignment_end_line = line_index
        if quote and closing_index < 0:
            assignment_end_line += 1
            while assignment_end_line < len(lines):
                continuation = lines[assignment_end_line].rstrip("\r\n")
                if _closing_quote_index(continuation, quote) >= 0:
                    break
                assignment_end_line += 1
            if assignment_end_line >= len(lines):
                raise ManagerTokenFileError(
                    "unterminated quoted value in protected runtime environment; "
                    "repair the file before creating a maintenance control key"
                )

        if match.group("key") == SYSTEM_MANAGER_TOKEN_KEY:
            end_body = lines[assignment_end_line].rstrip("\r\n")
            end_offset = offsets[assignment_end_line] + len(end_body)
            assignments.append(
                _DotenvAssignment(
                    start=offsets[line_index],
                    end=end_offset,
                    value=raw_value if assignment_end_line == line_index else "",
                )
            )

        line_index = assignment_end_line + 1

    return assignments


def create_system_manager_token(env_file: Path, *, rotate: bool = False) -> str:
    """Create or explicitly rotate the runtime's private maintenance token."""

    env_file = Path(env_file)
    with _locked_parent_directory(env_file):
        content = _read_regular_file_without_following_symlinks(env_file)
        assignments = _find_system_manager_token_assignments(content)
        if len(assignments) > 1:
            raise ManagerTokenFileError(
                f"multiple active {SYSTEM_MANAGER_TOKEN_KEY} entries found in {env_file}"
            )

        current_value = (
            _decoded_assignment_value(assignments[0].value) if assignments else ""
        )
        if _system_manager_token_is_usable(current_value) and not rotate:
            current_mode = stat.S_IMODE(env_file.stat(follow_symlinks=False).st_mode)
            if current_mode != STRICT_PERMISSION_MODE:
                _write_owner_only_atomic_file(
                    env_file,
                    content,
                    expected_content=content,
                )
                return "secured"
            return "unchanged"

        generated_value = secrets.token_urlsafe(48)
        replacement = f"{SYSTEM_MANAGER_TOKEN_KEY}={generated_value}"
        if assignments:
            assignment = assignments[0]
            updated_content = (
                content[: assignment.start]
                + replacement
                + content[assignment.end :]
            )
            result = "rotated" if current_value else "created"
        else:
            line_ending = "\r\n" if "\r\n" in content else "\n"
            separator = "" if not content or content.endswith(("\n", "\r")) else line_ending
            updated_content = f"{content}{separator}{replacement}{line_ending}"
            result = "created"

        _write_owner_only_atomic_file(
            env_file,
            updated_content,
            expected_content=content,
        )
        return result


def run_system_manager_token_command(arguments: list[str]) -> int:
    """Run the secret-safe command used by the public Filterest dispatcher."""

    parser = argparse.ArgumentParser(prog="filterest manager-key")
    parser.add_argument("action", choices=("generate",))
    parser.add_argument("--env-file", required=True, type=Path, help=argparse.SUPPRESS)
    parser.add_argument(
        "--rotate",
        action="store_true",
        help="replace an existing usable key",
    )
    parsed = parser.parse_args(arguments)
    try:
        result = create_system_manager_token(parsed.env_file, rotate=parsed.rotate)
    except (ManagerTokenFileError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    if result == "unchanged":
        print("Maintenance control key is already configured; nothing changed.")
    elif result == "secured":
        print("Maintenance control key was kept and its file permissions were secured.")
    elif result == "rotated":
        print("Maintenance control key was replaced in the protected runtime settings.")
        print("Restart Filterest before using the new key.")
    else:
        print("Maintenance control key was created in the protected runtime settings.")
        print("Restart Filterest before using the new key.")
    return 0


def main(arguments: Optional[list[str]] = None) -> int:
    """Parse the public command-line contract without loading private modules."""

    return run_system_manager_token_command(
        list(sys.argv[1:] if arguments is None else arguments)
    )


if __name__ == "__main__":
    raise SystemExit(main())
