"""custom_root_fixture_operator.py
Manage the native K378 fixture with exclusive creation and explicit ownership.
Connect the shell coordinator helper to a local site_root; never call an API.
Preserve operator files, replacements, unrelated files and existing directories.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys


SOURCE = Path(__file__).resolve().parents[2] / "fixtures/custom_root"
FILES = ("index.html", "custom_root.css", "custom_root.js", "custom_root.svg", "k378-secret.json")
MANIFEST = ".filterest-k378-fixture.json"
HIDDEN = "index.k378-hidden.html"


def fingerprint(directory: int, name: str) -> dict:
    """Read regular files through a held directory, refusing symlinks."""
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise ValueError(f"Refusing non-regular fixture file: {name}")
        return {"device": info.st_dev, "inode": info.st_ino,
                "sha256": hashlib.sha256(stream.read()).hexdigest()}


def exists(directory: int, name: str) -> bool:
    try:
        os.stat(name, dir_fd=directory, follow_symlinks=False)
        return True
    except FileNotFoundError:
        return False


def exclusive_write(directory: int, name: str, data: bytes, mode=0o644) -> None:
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode, dir_fd=directory)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)


def read_manifest(directory: int) -> dict:
    fd = os.open(MANIFEST, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
    with os.fdopen(fd) as stream:
        saved = json.load(stream)
    if saved.get("version") != 1 or set(saved.get("files", {})) != set(FILES):
        raise ValueError("Unrecognized fixture ownership manifest")
    return saved


def owned_files(directory: int, saved: dict, require_all=False) -> list[str]:
    """Check all identities before any cleanup; modified files are never deleted."""
    found = []
    for original in FILES:
        names = (original, HIDDEN) if original == "index.html" else (original,)
        present = [name for name in names if exists(directory, name)]
        if require_all and (present != [original]):
            raise ValueError(f"Required fixture file absent: {original}")
        for name in present:
            if fingerprint(directory, name) != saved["files"][original]:
                raise ValueError(f"Operator file changed; refusing to touch: {name}")
        found.extend(present)
    return found


def place(directory: int, created: bool) -> None:
    for name in (*FILES, HIDDEN, MANIFEST):
        if exists(directory, name):
            raise ValueError(f"Refusing to overwrite existing operator file: {name}")
    # Reserve ownership before writing anything; a second coordinator cannot race us.
    exclusive_write(directory, MANIFEST, b"{}\n", 0o600)
    placed = []
    try:
        for name in FILES:
            data = b'{"marker":"K378_REFUSED_BYTES"}\n' if name == "k378-secret.json" else (SOURCE / name).read_bytes()
            exclusive_write(directory, name, data)
            placed.append(name)
        saved = {"version": 1, "created_directory": created,
                 "files": {name: fingerprint(directory, name) for name in FILES}}
        fd = os.open(MANIFEST, os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW, dir_fd=directory)
        with os.fdopen(fd, "w") as stream:
            json.dump(saved, stream)
            stream.write("\n")
    except BaseException:
        for name in placed:
            os.unlink(name, dir_fd=directory)
        os.unlink(MANIFEST, dir_fd=directory)
        raise


def operate(action: str, destination: str) -> None:
    target = Path(destination)
    if not target.is_absolute() or target.name != "site_root" or target.resolve() != target:
        raise ValueError("Use the absolute, non-symlink site_root directory reported by the administrator API")
    if action == "remove" and not target.exists():
        return
    created = False
    if action == "place" and not target.exists():
        target.mkdir()  # Only this directory; never construct an assumed storage root.
        created = True
    directory = os.open(target, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    remove_directory = False
    try:
        if action == "place":
            place(directory, created)
        else:
            if action == "remove" and not exists(directory, MANIFEST):
                return  # Idempotent cleanup never guesses ownership from filenames.
            saved = read_manifest(directory)
            found = owned_files(directory, saved, require_all=action == "verify")
            if action in ("hide", "show"):
                source, destination_name = ("index.html", HIDDEN) if action == "hide" else (HIDDEN, "index.html")
                if source not in found:
                    raise ValueError(f"Missing owned file: {source}")
                # link+unlink is a move with exclusive destination creation, unlike rename's overwrite.
                os.link(source, destination_name, src_dir_fd=directory, dst_dir_fd=directory, follow_symlinks=False)
                os.unlink(source, dir_fd=directory)
            elif action == "remove":
                for name in found:
                    os.unlink(name, dir_fd=directory)
                os.unlink(MANIFEST, dir_fd=directory)
                remove_directory = saved["created_directory"]
    finally:
        os.close(directory)
    if remove_directory:
        try:
            target.rmdir()
        except OSError:
            if not any(target.iterdir()):
                raise
            # An operator added something unrelated: leave it and its directory alone.


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("action", choices=("place", "verify", "hide", "show", "remove"))
    parser.add_argument("site_root", help="Absolute directory containing the administrator-reported index.html")
    args = parser.parse_args()
    print(f"1/1 {args.action} owned K378 fixture", flush=True)
    try:
        operate(args.action, args.site_root)
    except (OSError, ValueError, KeyError) as error:
        print(f"NOT completed: {args.action}: {error}", file=sys.stderr)
        return 1
    print(f"Completed: {args.action} (1/1)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
