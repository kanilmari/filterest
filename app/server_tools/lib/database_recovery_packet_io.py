"""database_recovery_packet_io.py: private packet files, diagnostics and publication.

Connects recovery operations with owner-only files and directories.
Preserves exclusive publication and truthful step outcomes across transports.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
import errno
from functools import wraps
import hashlib
import inspect
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tarfile
import tempfile
import zlib


_diagnostic_key = ContextVar("recovery_diagnostic_key", default=None)
_snapshot_sizes = ContextVar("recovery_snapshot_sizes", default=None)
SNAPSHOT_MARGIN = 64 * 1024 * 1024
EVIDENCE_FILE_LIMIT = 1024 * 1024
EVIDENCE_TOTAL_LIMIT = 8 * EVIDENCE_FILE_LIMIT
EVIDENCE_NAMES = {"database.backup.json", "update.backup.json", "database.sha256",
                  "database.roles.sql", "database.properties.json", "manifest.txt"}


def diagnostic_key(key) -> None:
    """Carry the available installation key through nested refusal wrappers."""
    if key is not None:
        _diagnostic_key.set(key)


def prime_diagnostic_key(root) -> None:
    """Learn a protected key for refusals before normal authentication preflight.

    This never authorizes a packet: packet_key still enforces the installation's
    root policy. A relocated keys root is only read here for diagnostic redaction.
    """
    import re
    try:
        path = Path(root) / "keys/database_recovery.hmac.key"
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as source:
            metadata = os.fstat(source.fileno())
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077 or metadata.st_size > 66:
                return
            value = source.read(67).strip()
        if re.fullmatch(rb"[0-9a-f]{64}", value):
            diagnostic_key(bytes.fromhex(value.decode()))
    except OSError:
        pass  # Missing/unsafe keys remain normal authentication refusals.


def _alphabet_diagnostic_spans(content, forms):
    """Match complete forms after removing only bytes outside their alphabet.

    Positions retain the first and last contributing printed byte. This shadow
    is independent of quoting state: literal quotes, backslashes and separators
    in a filename cannot hide a representation. Raw key bytes retain exact
    matching; their alphabet is not one of the documented text encodings.
    """
    matches = []
    for alphabet, pattern in forms:
        positions = [index for index, byte in enumerate(content) if byte in alphabet]
        filtered = bytes(content[index] for index in positions)
        matches.extend((positions[match.start()], positions[match.end() - 1] + 1)
                       for match in pattern.finditer(filtered))
    return matches


def _escaped_diagnostic_spans(content, pattern, alphabet_forms=()):
    """Match nonexecuting escape/quote shadows and map back to printed bytes.

    GNU/Bash can split one filename across adjacent plain, single, ANSI-C,
    double and locale-quoted segments. Delimiters are syntax in the joined
    shadow only. Also retain the loose escape shadow for Python repr and old
    utility formats. Neither shadow evaluates substitutions or shell code.
    """
    from bisect import bisect_right
    import re
    if not any(token in content for token in (b"\\", b"'", b'"')):
        return []
    tokens = re.compile(rb"\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|.)|\$['\"]|['\"]", re.DOTALL)
    controls = {b"a": b"\a", b"b": b"\b", b"e": b"\x1b", b"E": b"\x1b",
                b"f": b"\f", b"n": b"\n", b"r": b"\r", b"t": b"\t", b"v": b"\v"}
    def shadow(source, join_quotes):
        chunks, positions, spans = [], [], []
        cursor = length = 0
        quote = None
        for token in tokens.finditer(source):
            plain = source[cursor:token.start()]
            chunks.append(plain)
            length += len(plain)
            printed = decoded = token[0]
            if token[1] is not None:
                escape = token[1]
                if join_quotes is True and quote == b"'" and escape == b"'":
                    # In a plain single-quoted segment, a final backslash is
                    # literal and the following quote closes the segment.
                    # GNU emits this when a random filename byte is backslash.
                    decoded, quote = b"\\", None
                elif join_quotes is True and quote != b"$'":
                    # Outside ANSI-C quotes, Bash removes only the shell's
                    # backslash syntax; a bare \4 is the character 4, not octal.
                    if quote is None:
                        decoded = b"" if escape == b"\n" else escape
                    elif quote in (b'"', b'$"') and escape in (b'"', b"$", b"`", b"\\", b"\n"):
                        decoded = b"" if escape == b"\n" else escape
                elif escape[:1] in b"01234567":
                    decoded = bytes([int(escape, 8) % 256])
                elif len(escape) > 1 and escape[:1] == b"x":
                    decoded = bytes([int(escape[1:], 16)])
                elif len(escape) > 1 and escape[:1] in (b"u", b"U"):
                    try:
                        decoded = chr(int(escape[1:], 16)).encode("utf-8", errors="surrogateescape")
                    except (ValueError, UnicodeError):
                        pass
                else:
                    decoded = b"" if join_quotes and escape == b"\n" else controls.get(escape, escape)
            elif join_quotes:
                delimiter = printed[-1:]
                if join_quotes == "outer":
                    decoded = b""
                elif quote is None:
                    quote, decoded = printed, b""
                elif printed.startswith(b"$") and delimiter == quote[-1:]:
                    # A literal dollar at the end of a quoted segment is not
                    # an ANSI-C/locale opener; its following quote closes it.
                    quote, decoded = None, b"$"
                elif printed == quote[-1:]:
                    quote, decoded = None, b""
            positions.append(length)
            spans.append((length + len(decoded), token.start(), token.end()))
            chunks.append(decoded)
            length += len(decoded)
            cursor = token.end()
        chunks.append(source[cursor:])

        def original_position(position, end=False):
            index = bisect_right(positions, position) - 1
            if index < 0:
                return position + int(end)
            decoded_end, original_start, original_end = spans[index]
            if position < decoded_end:
                return original_end if end else original_start
            return position + original_end - decoded_end + int(end)

        def original_span(start, end):
            return original_position(start), original_position(end - 1, True)
        return b"".join(chunks), original_span

    matches, pending = [], [(content, lambda start, end: (start, end))]
    seen = {content}
    # GNU can quote a filename that itself contains backslash/quote spelling.
    # Two layers cover that outer utility quoting and the represented value.
    for _ in range(2):
        following = []
        for source, parent in pending:
            for mode in (False, True, "outer"):
                decoded, mapper = shadow(source, mode)
                if decoded in seen:
                    continue
                seen.add(decoded)
                def original_span(start, end, mapper=mapper, parent=parent):
                    return parent(*mapper(start, end))
                matches.extend(original_span(*match.span()) for match in pattern.finditer(decoded))
                matches.extend(original_span(start, end) for start, end in
                               _alphabet_diagnostic_spans(decoded, alphabet_forms))
                following.append((decoded, original_span))
        pending = following
    return matches


def safe_diagnostic(message, key=None, *, utility_escapes=True) -> str:
    """Scan final diagnostic text, redacting whole key-bearing path components."""
    if __package__:
        from .recovery_key_safety import KeyScanner, key_representations
    else:
        from recovery_key_safety import KeyScanner, key_representations
    import re
    key = key if key is not None else _diagnostic_key.get()
    scanner = KeyScanner(key)
    content = str(message).encode("utf-8", errors="surrogateescape")
    if scanner.pattern is None:
        return str(message)
    matches = [match.span() for match in scanner.pattern.finditer(content)]
    if utility_escapes:
        # The canonical representation list supplies all patterns, including the
        # key-determined Base64 characters at every byte alignment. UTF-16 hex
        # retains NUL as part of its alphabet and therefore its full byte form.
        hexadecimal = b"0123456789abcdefABCDEF"
        standard = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        urlsafe = standard[:-2] + b"-_"
        alphabets = (hexadecimal, hexadecimal + b"\0", hexadecimal + b"\0",
                     *((standard, urlsafe) * 3))
        grouped = {}
        for (pattern, _), alphabet in zip(key_representations(key)[1:], alphabets):
            grouped.setdefault(alphabet, []).append(pattern)
        alphabet_forms = [(frozenset(alphabet), re.compile(b"|".join(patterns)))
                          for alphabet, patterns in grouped.items()]
        matches.extend(_alphabet_diagnostic_spans(content, alphabet_forms))
        matches.extend(_escaped_diagnostic_spans(content, scanner.pattern, alphabet_forms))
    spans = []
    for start, end in sorted(matches):
        while start and content[start - 1] not in b"/\\ \t\r\n":
            start -= 1
        while end < len(content) and content[end] not in b"/\\ \t\r\n":
            end += 1
        if spans and start <= spans[-1][1]:
            spans[-1] = (spans[-1][0], max(end, spans[-1][1]))
        else:
            spans.append((start, end))
    for start, end in reversed(spans):
        content = content[:start] + b"<redacted: contains the recovery key>" + content[end:]
    scanner.check(content)
    return content.decode("utf-8", errors="surrogateescape")


_diagnostic_stderr = None


def set_diagnostic_stderr(stream) -> None:
    """Bind the launcher's original stderr for text scanned by this module only.

    The bootstrap supplies an open descriptor, never an environment pathname.
    Raw Python errors retain sys.stderr and the synchronous shell scanner.
    """
    global _diagnostic_stderr
    _diagnostic_stderr = stream


def print_diagnostic(message, *, file=None, flush=False) -> None:
    if file is sys.stderr and _diagnostic_stderr is not None:
        file, flush = _diagnostic_stderr, True
    print(safe_diagnostic(message), file=file, flush=flush)


class RecoveryError(Exception):
    """A content-free error suitable for the operator's terminal."""
    def __init__(self, message):
        super().__init__(safe_diagnostic(message))


def recovery_operation(operation):
    """Keep filesystem/archive refusals path-specific at callable boundaries too."""
    @wraps(operation)
    def checked(path, *arguments, **options):
        bound = inspect.signature(operation).bind_partial(path, *arguments, **options)
        diagnostic_key(bound.arguments.get("key"))
        if "key" not in bound.arguments and "root" in bound.arguments:
            prime_diagnostic_key(bound.arguments["root"])
        try:
            return operation(path, *arguments, **options)
        except RecoveryError as error:
            raise RecoveryError(f"{path}: {error}") from None
        except OSError as error:
            failed_path = error.filename or path
            raise RecoveryError(f"{path}: {failed_path}: {error.strerror or 'filesystem operation failed'}") from None
        except (tarfile.TarError, EOFError, ValueError, KeyError, TypeError, zlib.error):
            raise RecoveryError(f"{path}: invalid or unreadable recovery archive/record") from None
    return checked


class Outcome:
    """Use the script outcome reference's numbered steps and earned success."""
    def __init__(self, steps: list[str]) -> None:
        self.steps, self.completed = steps, 0

    def step(self, operation, *args, **kwargs):
        print_diagnostic(f"{self.completed + 1}/{len(self.steps)} {self.steps[self.completed]}", flush=True)
        result = operation(*args, **kwargs)
        self.completed += 1
        return result

    def finish(self, message: str) -> None:
        print_diagnostic(f"Completed: {self.completed}/{len(self.steps)} steps succeeded. {message}")

    def fail(self, message: str) -> None:
        step = self.steps[min(self.completed, len(self.steps) - 1)]
        print_diagnostic(f"NOT completed: {self.completed}/{len(self.steps)} steps succeeded; failed: {step}. {message}", file=sys.stderr)


def verify_packet_files(folder: Path, key) -> None:
    """Check every sibling, including logs or operator-supplied extra packet files."""
    if __package__:
        from .recovery_key_safety import KEY_NAME, reject_key_bytes, reject_key_name
    else:
        from recovery_key_safety import KEY_NAME, reject_key_bytes, reject_key_name
    reject_key_name(folder, key)
    for path in folder.iterdir():
        reject_key_name(path.name, key)
        if path.name == KEY_NAME:
            raise RecoveryError("Packet folders must not contain the recovery authentication key file")
        regular_file(path, protected=True)
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as source:
            if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                raise RecoveryError("Packet files must be regular files")
            reject_key_bytes(source, key)


@recovery_operation
def snapshot_packet(folder: Path, destination: Path, key, *, record_check=None) -> Path:
    """Capture descriptor-opened packet bytes before authenticating or consuming them.

    The caller owns destination inside its private diagnostics directory. Failure
    retains small checked evidence there; success removes it with diagnostics.
    """
    if __package__:
        from .recovery_key_safety import KEY_NAME, reject_key_name
    else:
        from recovery_key_safety import KEY_NAME, reject_key_name
    private_folder(folder, writable=False)
    reject_key_name(folder, key)
    reject_key_name(destination, key)
    descriptor = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    failure = None
    copied_record = None
    sizes_token = None
    try:
        metadata = os.fstat(descriptor)
        if metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) not in (0o500, 0o700):
            raise RecoveryError("Packet snapshot source must remain private and owned by the operator")
        sizes = _packet_sizes_at(descriptor, key)
        check_snapshot_space(destination.parent, sum(sizes.values()))
        sizes_token = _snapshot_sizes.set(sizes)
        destination.mkdir(mode=0o700)
        names = sorted(sizes, key=lambda name: (name not in EVIDENCE_NAMES, name))
        if record_check is not None and record_check[0] in names:
            # Capture metadata first so a failed decode can still report a
            # forged record. Never authenticate until all packet reads close.
            name = record_check[0]
            _snapshot_file_at(descriptor, name, destination / name, key)
            copied_record = destination / name
            names.remove(name)
        for name in names:
            reject_key_name(name, key)
            if name == KEY_NAME:
                raise RecoveryError("Packet folders must not contain the recovery authentication key file")
            if name.startswith(".database-backup.partial.") or name.endswith(".partial"):
                raise RecoveryError("Backup folder is incomplete")
            _snapshot_file_at(descriptor, name, destination / name, key)
    except (RecoveryError, OSError, EOFError, ValueError, zlib.error) as error:
        failure = error
    finally:
        os.close(descriptor)
        if sizes_token is not None:
            _snapshot_sizes.reset(sizes_token)
    if copied_record is not None:
        record_check[1](copied_record)
    if failure is not None:
        raise failure
    return destination


def _snapshot_file_at(descriptor, name, target, key) -> None:
    if __package__:
        from .recovery_key_safety import KeySafeReader, KeySafeGzipReader
    else:
        from recovery_key_safety import KeySafeReader, KeySafeGzipReader
    child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor)
    with os.fdopen(child, "rb") as source:
        metadata = os.fstat(source.fileno())
        _check_snapshot_metadata(metadata, name)
        sizes = _snapshot_sizes.get()
        if sizes is not None and metadata.st_size > sizes[name]:
            raise RecoveryError(f"{name}: packet file grew after the space check; retry with a stable packet")
        # Extra/legacy SQL gzip files need the same decoded check as tar gzip.
        reader = KeySafeGzipReader(source, key) if source.peek(2)[:2] == b"\x1f\x8b" else KeySafeReader(source, key)
        with private_file(target, key=key) as output:
            try:
                # A concurrent append cannot spend more than the checked budget.
                remaining = metadata.st_size
                while chunk := reader.read(min(65536, remaining + 1)):
                    if len(chunk) > remaining:
                        raise RecoveryError(f"{name}: packet file grew during snapshot capture")
                    output.write(chunk)
                    remaining -= len(chunk)
            except BaseException:
                target.unlink()
                raise


@recovery_operation
def snapshot_file(path: Path, target: Path, key) -> Path:
    """Capture an optional external settings archive with the same descriptor rules."""
    if __package__:
        from .recovery_key_safety import reject_key_name
    else:
        from recovery_key_safety import reject_key_name
    reject_key_name(path, key)
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        metadata = os.stat(path.name, dir_fd=descriptor, follow_symlinks=False)
        _check_snapshot_metadata(metadata, path.name)
        check_snapshot_space(target.parent, metadata.st_size)
        token = _snapshot_sizes.set({path.name: metadata.st_size})
        try:
            _snapshot_file_at(descriptor, path.name, target, key)
        finally:
            _snapshot_sizes.reset(token)
    finally:
        os.close(descriptor)
    return target


def _check_snapshot_metadata(metadata, name) -> None:
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_size == 0 or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
        raise RecoveryError(f"{name}: packet snapshot requires nonempty owner-only regular files without links")


def _packet_sizes_at(descriptor, key) -> dict[str, int]:
    """Read only metadata; every source file is still opened/read once for capture."""
    if __package__:
        from .recovery_key_safety import KEY_NAME, reject_key_name
    else:
        from recovery_key_safety import KEY_NAME, reject_key_name
    sizes = {}
    for name in os.listdir(descriptor):
        reject_key_name(name, key)
        if name == KEY_NAME:
            raise RecoveryError("Packet folders must not contain the recovery authentication key file")
        metadata = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
        _check_snapshot_metadata(metadata, name)
        sizes[name] = metadata.st_size
    return sizes


@recovery_operation
def snapshot_size(folder: Path, key, archive=None) -> int:
    """Size the complete packet and optional external archive without copying bytes."""
    if __package__:
        from .recovery_key_safety import reject_key_name
    else:
        from recovery_key_safety import reject_key_name
    reject_key_name(folder, key)
    private_folder(folder, writable=False)
    descriptor = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        size = sum(_packet_sizes_at(descriptor, key).values())
    finally:
        os.close(descriptor)
    if archive is not None:
        reject_key_name(archive, key)
        metadata = archive.lstat()
        _check_snapshot_metadata(metadata, archive.name)
        size += metadata.st_size
    return size


def check_snapshot_space(location: Path, size: int) -> None:
    """Reserve headroom for diagnostics and allocation before any snapshot write."""
    needed = size + max(SNAPSHOT_MARGIN, (size + 9) // 10)
    free = shutil.disk_usage(location).free
    if free < needed:
        raise RecoveryError(f"Insufficient space for private recovery snapshot in {location}: "
            f"needed {needed} bytes ({size} packet bytes plus margin), free {free} bytes. "
            "Choose another temporary location with TMPDIR; no services stopped or packet files changed")


def private_file(path: Path, *, key=None):
    if __package__:
        from .recovery_key_safety import KEY_NAME, KeySafeWriter, reject_key_name
    else:
        from recovery_key_safety import KEY_NAME, KeySafeWriter, reject_key_name
    reject_key_name(path, key)
    if path.name == KEY_NAME:
        raise RecoveryError("Recovery outputs must not use the authentication key filename")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.fchmod(descriptor, 0o600)
    output = os.fdopen(descriptor, "wb")
    return KeySafeWriter(output, key) if key is not None else output


def regular_file(path: Path, protected: bool = False) -> None:
    if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
        raise RecoveryError(f"Missing, empty or unsafe backup file: {path.name}")
    if protected and (stat.S_IMODE(path.stat().st_mode) & 0o077 or path.stat().st_uid != os.getuid()):
        raise RecoveryError(f"Backup file must be owner-only and owned by the operator: {path.name}")


def private_folder(folder: Path, *, writable=True) -> None:
    modes = {0o700} if writable else {0o500, 0o700}
    if folder.is_symlink() or not folder.is_dir() or stat.S_IMODE(folder.stat().st_mode) not in modes or folder.stat().st_uid != os.getuid():
        raise RecoveryError("Backup folder must be a real private directory (0700; 0500 for reading), owned by the operator")


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return stream_digest(source)


def stream_digest(source) -> str:
    checksum = hashlib.sha256()
    for chunk in iter(lambda: source.read(1024 * 1024), b""):
        checksum.update(chunk)
    return checksum.hexdigest()


def publish_file(source: Path, target: Path, *, key=None) -> None:
    if __package__:
        from .recovery_key_safety import KeySafeReader, reject_key_bytes, reject_key_name
    else:
        from recovery_key_safety import KeySafeReader, reject_key_bytes, reject_key_name
    reject_key_name(target, key)
    if key is not None:
        with source.open("rb") as content:
            reject_key_bytes(content, key)
    try:
        os.link(source, target)
    except OSError as error:
        if error.errno not in {errno.EPERM, errno.EOPNOTSUPP, errno.ENOTSUP, errno.EXDEV}:
            raise
        # CIFS/FUSE may refuse hard links. Exclusive create never replaces a file.
        with private_file(target, key=key) as destination:
            try:
                with source.open("rb") as content:
                    shutil.copyfileobj(KeySafeReader(content, key), destination)
                destination.flush(); os.fsync(destination.fileno())
            except BaseException:
                target.unlink()
                raise


@contextmanager
def private_diagnostics(operation: str, *, packet=None, archive=None, key=None, packet_unchanged=True):
    """Check capacity before creating anything; retain only small failure evidence."""
    diagnostic_key(key)
    location = Path(tempfile.gettempdir())
    if __package__:
        from .recovery_key_safety import reject_key_name
    else:
        from recovery_key_safety import reject_key_name
    reject_key_name(location, key)
    if packet is not None:
        check_snapshot_space(location, snapshot_size(packet, key, archive))
    if __package__:
        from .recovery_key_safety import private_temporary_path
    else:
        from recovery_key_safety import private_temporary_path
    logs = private_temporary_path(location, key, prefix=f"filterest-database-{operation}-", directory=True)
    try:
        yield logs
        shutil.rmtree(logs)
    except BaseException:
        prune_diagnostics(logs)
        print_diagnostic(f"Private {operation} diagnostics (0700): {logs}", flush=True)
        if packet is not None:
            original = "Original packet unchanged in its folder" if packet_unchanged else "Packet remains in its folder; sealing may have published its completion record"
            print_diagnostic(f"Only small checked evidence retained (1 MiB/file, 8 MiB/run; oversized evidence omitted); "
                f"dump and archive copies removed. {original}: {packet}", flush=True)
        raise


def prune_diagnostics(logs: Path) -> None:
    """Keep checked metadata/logs, never arbitrary dump names or archive copies.

    Oversized evidence is omitted too: at most 1 MiB per file / 8 MiB per run.
    Cleanup reads only private captures, never any original packet path.
    """
    remaining = EVIDENCE_TOTAL_LIMIT
    folders = [logs]
    candidates = []
    for path in logs.iterdir():
        if path.is_dir() and not path.is_symlink():
            folders.append(path)
    for folder in folders:
        dump = None
        record = folder / "database.backup.json"
        if record.is_file() and not record.is_symlink() and record.stat().st_size <= EVIDENCE_FILE_LIMIT:
            try:
                value = json.loads(record.read_bytes())
                dump = value.get("dump") if isinstance(value, dict) else None
            except (ValueError, OSError):
                pass  # Invalid records are still useful checked refusal evidence.
        for path in folder.iterdir():
            if path in folders[1:]:
                continue
            candidates.append((path, dump))
    # Completion records, roles and properties take precedence over verbose logs.
    for path, dump in sorted(candidates, key=lambda item: (item[0].name not in EVIDENCE_NAMES, item[0].name)):
        metadata = path.lstat()
        keep = path.name != dump and (path.name in EVIDENCE_NAMES or
            path.name.startswith("database-tool-") and path.name.endswith(".log"))
        if keep and stat.S_ISREG(metadata.st_mode) and metadata.st_size <= min(EVIDENCE_FILE_LIMIT, remaining):
            remaining -= metadata.st_size
        elif stat.S_ISDIR(metadata.st_mode):
            shutil.rmtree(path)
        else:
            path.unlink()
