"""recovery_content_stream.py: bounded, byte-preserving shell content refusal.

Connects shell recovery writers with the packet scanner's sole representation list.
Checks bytes before forwarding them; filenames and optional gzip decoding use it too.
The shell owns staging/publication so producer failures cannot replace old files.
"""
from __future__ import annotations

import sys
import os
import stat
from pathlib import Path
import shutil
import zipfile
import signal
import re
import select
import json

from database_recovery_packet_io import RecoveryError, prime_diagnostic_key, _diagnostic_key, publish_file
from recovery_key_safety import KEY_NAME, KeySafeReader, KeySafeGzipReader, reject_key_name, private_temporary_path


def _log_metadata(metadata, *, executable=False):
    # Ordinary native starts may have left 0644/0640 logs. Reading those is
    # safe; recovery changes its owned log to 0600 only at the actual start.
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid() or
            metadata.st_nlink != 1 or metadata.st_mode & (0o7022 if executable else 0o7133) or
            metadata.st_mode & 0o600 != 0o600):
        raise RecoveryError("Recovery log destination refused")


def _log_parent(destination):
    """Open each existing parent without links; preflight never creates it."""
    path = Path(destination).absolute()
    descriptor = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for name in path.parts[1:-1]:
            try:
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            except FileNotFoundError:
                metadata = os.fstat(descriptor)
                if metadata.st_uid != os.getuid() or metadata.st_mode & 0o022 or metadata.st_mode & 0o700 != 0o700:
                    raise RecoveryError("Recovery log parent refused")
                os.close(descriptor)
                return None
            os.close(descriptor)
            descriptor = child
        metadata = os.fstat(descriptor)
        if metadata.st_uid != os.getuid() or metadata.st_mode & 0o022 or metadata.st_mode & 0o700 != 0o700:
            raise RecoveryError("Recovery log parent refused")
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _log_identity(metadata):
    return (metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns)


def check_existing_log(destination, scanner, *, executable=False):
    """Scan the size present at open, read-only, retaining state for append joins.

    A growing log cannot keep preflight alive indefinitely. Identity, size and
    timestamps are rechecked; concurrent writes refuse, and startup checks again.
    The caller retains the checked parent descriptor for the actual append open.
    """
    parent = _log_parent(destination)
    if parent is None:
        return None, None
    try:
        try:
            descriptor = os.open(Path(destination).name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        except FileNotFoundError:
            return parent, None
        with os.fdopen(descriptor, "rb") as previous:
            before = os.fstat(previous.fileno())
            _log_metadata(before, executable=executable)
            remaining = before.st_size if scanner is not None else 0
            while remaining:
                chunk = previous.read(min(65536, remaining))
                if not chunk:
                    raise RecoveryError("Recovery log changed during check")
                if scanner is not None:
                    scanner.check(chunk)
                remaining -= len(chunk)
            after = os.fstat(previous.fileno())
            current = os.stat(Path(destination).name, dir_fd=parent, follow_symlinks=False)
            _log_metadata(after, executable=executable)
            if _log_identity(before) != _log_identity(after) or _log_identity(after) != _log_identity(current):
                raise RecoveryError("Recovery log changed during check")
        return parent, _log_identity(after)
    except BaseException:
        os.close(parent)
        raise


def extract_zip(root, source, destination, password):
    """Decode only into an empty, caller-owned staging folder; remove on refusal."""
    prime_diagnostic_key(root)
    key = _diagnostic_key.get()
    source, destination = Path(source), Path(destination)
    for path in (root, source, destination):
        reject_key_name(path, key)
    metadata = destination.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid() or list(destination.iterdir()):
        raise RecoveryError("ZIP staging must be an empty operator-owned directory")
    previous_mask = os.umask(0o077)
    try:
        with zipfile.ZipFile(source) as archive:
            from recovery_key_safety import KeyScanner
            KeyScanner(key).check(archive.comment)
            names = set()
            for entry in archive.infolist():
                reject_key_name(entry.filename, key)
                KeyScanner(key).check(entry.extra + entry.comment)
                path = Path(entry.filename)
                mode = entry.external_attr >> 16
                if path.is_absolute() or ".." in path.parts or "\\" in entry.filename or not path.parts or path in names or \
                        KEY_NAME in path.parts or stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
                    raise RecoveryError("ZIP recovery member refused")
                names.add(path)
                target = destination / path
                for name in (target, target.absolute(), target.resolve()):
                    reject_key_name(name, key)
                if entry.is_dir():
                    target.mkdir(mode=0o700, parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(descriptor, "wb") as output, archive.open(entry, pwd=os.fsencode(password)) as content:
                    reader = KeySafeReader(content, key)
                    for chunk in iter(lambda: reader.read(65536), b""):
                        output.write(chunk)
    except BaseException:
        shutil.rmtree(destination)
        raise
    finally:
        os.umask(previous_mask)


def transfer(root, mode, names=(), *, startup_fds=()):
    prime_diagnostic_key(root)
    key = _diagnostic_key.get()
    for name in (root, *names):
        for path in (Path(name), Path(name).absolute(), Path(name).resolve()):
            reject_key_name(path, key)
            if KEY_NAME in str(path).replace("\\", "/").split("/"):
                raise RecoveryError("Recovery content cannot use the authentication key filename")
    if mode == "names":
        return
    if mode == "destination-preflight":
        for destination in names:
            parent, _ = check_existing_log(destination, None, executable=True)
            if parent is not None:
                os.close(parent)
        return
    if mode in ("source-preflight", "json-preflight"):
        for source in names:
            descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, "rb") as content:
                before = os.fstat(content.fileno())
                if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                    raise RecoveryError("Recovery source must be an unlinked regular file")
                reader = (KeySafeGzipReader if str(source).endswith(".gz") else KeySafeReader)(content, key)
                chunks = []
                size = 0
                for chunk in iter(lambda: reader.read(65536), b""):
                    if mode == "json-preflight":
                        size += len(chunk)
                        if size > 16 * 1024 * 1024:
                            raise RecoveryError("Recovery JSON input too large")
                        chunks.append(chunk)
                if mode == "json-preflight" and not isinstance(json.loads(b"".join(chunks)), dict):
                    raise RecoveryError("Recovery JSON input must be an object")
                if _log_identity(before) != _log_identity(os.fstat(content.fileno())):
                    raise RecoveryError("Recovery source changed during check")
                if _log_identity(before) != _log_identity(os.stat(source, follow_symlinks=False)):
                    raise RecoveryError("Recovery source changed before consumption")
        return
    if mode in ("temporary", "temporary-name"):
        directory = "-d" in names or "--directory" in names
        templates = [name for name in names if name not in ("--", "-d", "--directory")]
        template = Path(templates[0]) if templates else Path(os.environ.get("TMPDIR", "/tmp")) / "tmp.XXXXXXXXXX"
        match = re.fullmatch(r"(.*?)(X{3,})([^X]*)", template.name)
        if len(templates) > 1 or not match:
            raise RecoveryError("Invalid recovery temporary name template")
        value = private_temporary_path(template.parent, key, prefix=match[1], suffix=match[3], directory=directory,
                                       create=mode == "temporary")
        if directory or mode == "temporary-name":
            path = value
        else:
            descriptor, path = value
            os.close(descriptor)
        print(path)
        return
    if mode == "publish":
        publish_file(Path(names[0]), Path(names[1]), key=key)
        return
    if mode in ("live", "live-append", "live-preflight"):
        destination = names[0]
        reader = KeySafeReader(sys.stdin.buffer, key)
        parent, identity = check_existing_log(destination, reader.scanner if mode != "live" else None)
        if mode == "live-preflight":
            if parent is not None:
                os.close(parent)
            return
        if parent is None:
            raise RecoveryError("Recovery log parent missing at startup")
        try:
            descriptor = os.open(Path(destination).name, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK |
                                 (os.O_APPEND if mode == "live-append" else 0) |
                                 (os.O_EXCL if identity is None else 0), 0o600, dir_fd=parent)
        finally:
            os.close(parent)
        with os.fdopen(descriptor, "wb", buffering=0) as output:
            _log_metadata(os.fstat(output.fileno()))
            if identity is not None and identity != _log_identity(os.fstat(output.fileno())):
                raise RecoveryError("Recovery log changed before open")
            if mode == "live":
                os.ftruncate(output.fileno(), 0)
                # Truncation has no append boundary with the previous content.
                reader = KeySafeReader(sys.stdin.buffer, key)
            os.fchmod(output.fileno(), 0o600)
            if startup_fds:
                _live_startup_stream(sys.stdin.buffer, output, reader.scanner, *startup_fds)
            else:
                while chunk := sys.stdin.buffer.read1(65536):
                    reader.scanner.check(chunk)
                    output.write(chunk)
        return
    reader = (KeySafeGzipReader if mode == "gzip" else KeySafeReader)(sys.stdin.buffer, key)
    for chunk in iter(lambda: reader.read(65536), b""):
        sys.stdout.buffer.write(chunk)
    sys.stdout.buffer.flush()


def _live_startup_stream(source, output, scanner, requests, replies):
    """Acknowledge readiness only after draining currently available log bytes.

    The detached native supervisor owns these two private pipes. They close at
    acknowledgement; no operator output descriptor belongs to the live scanner.
    A later refusal stops that supervisor's server and keeps a checked log reason.
    """
    os.write(replies, b"STARTED\n")
    try:
        while True:
            available, _, _ = select.select([source, requests] if requests >= 0 else [source], [], [], 1)
            if source in available:
                chunk = os.read(source.fileno(), 65536)
                if not chunk:
                    if requests < 0:
                        return
                    raise RecoveryError("Recovery server stopped")
                scanner.check(chunk)
                output.write(chunk)
            if requests in available:
                if os.read(requests, 1) != b"R":
                    raise RecoveryError("Recovery startup controller stopped")
                # Bound the checkpoint even for a continuously noisy server;
                # refusing is safer than claiming success before the scan catches up.
                for _ in range(256):
                    if not select.select([source], [], [], 0)[0]:
                        break
                    chunk = os.read(source.fileno(), 65536)
                    if not chunk:
                        raise RecoveryError("Recovery server stopped")
                    scanner.check(chunk)
                    output.write(chunk)
                else:
                    raise RecoveryError("Recovery startup log did not drain")
                os.write(replies, b"READY\n")
                os.close(requests)
                os.close(replies)
                requests = replies = -1
    except BaseException:
        explanation = b"Recovery live log refused or failed; server stopped; safe log prefix retained.\n"
        try:
            scanner.check(explanation)
            output.write(explanation)
        except BaseException:
            pass
        raise


def main(root, mode, names=()):
    def cancel(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, cancel)
    try:
        if mode == "zip":
            extract_zip(root, *names)
        else:
            transfer(root, mode, names)
        return 0
    except BaseException:
        # Content is refused, never redacted into a SQL/settings/archive stream.
        sys.stderr.write("Recovery content refused; no complete file was published.\n")
        return 1
