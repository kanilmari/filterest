"""recovery_key_safety.py: one signing-key representation and copying boundary.

Connects packet artifacts, archive names/contents, diagnostics and retained trees.
Refuses known reversible representations before copied bytes reach a file.
"""
from __future__ import annotations

import base64
import hashlib
import re
import zlib
import os
from pathlib import Path
import secrets

if __package__:
    from .database_recovery_packet_io import RecoveryError, diagnostic_key
else:
    from database_recovery_packet_io import RecoveryError, diagnostic_key


KEY_NAME = "database_recovery.hmac.key"


def key_representations(key: bytes | None) -> tuple[tuple[bytes, int], ...]:
    """Return the sole list of patterns and widths used for contents and names.

    For Base64, discard boundary characters influenced by surrounding bytes:
    ceil(prefix bits / 6) through floor((prefix + key) bits / 6). The remaining
    characters depend only on the key, at all three possible byte alignments;
    they also match standalone encodings with padding present or removed.
    Scoped case folding applies only to hexadecimal, never raw bytes/Base64.
    """
    if key is None:
        return ()
    hexadecimal = key.hex()
    forms = [(re.escape(key), len(key))]
    for encoding in ("ascii", "utf-16le", "utf-16be"):
        text = hexadecimal.encode(encoding)
        forms.append((b"(?i:" + re.escape(text) + b")", len(text)))
    for alignment in range(3):
        start = (alignment * 8 + 5) // 6
        end = ((alignment + len(key)) * 8) // 6
        for encoder in (base64.b64encode, base64.urlsafe_b64encode):
            text = encoder(b"\0" * alignment + key)[start:end]
            forms.append((re.escape(text), len(text)))
    return tuple(forms)


class KeyScanner:
    """Keep enough previous bytes for every pattern across arbitrary chunks."""
    def __init__(self, key):
        diagnostic_key(key)
        forms = key_representations(key)
        self.pattern = re.compile(b"|".join(pattern for pattern, _ in forms)) if forms else None
        self.overlap = max((width for _, width in forms), default=1) - 1
        self.tail = b""

    def check(self, chunk: bytes) -> None:
        data = self.tail + chunk
        if self.pattern is not None and self.pattern.search(data):
            # Never repeat a key-bearing filename or tool output in diagnostics.
            raise RecoveryError("Recovery output contains the recovery authentication key's bytes or a detected representation")
        self.tail = data[-self.overlap:] if self.overlap else b""


def reject_key_name(name, key) -> None:
    """Check the entire name and each component with the content pattern list."""
    name = str(name)
    for text in (name, *name.replace("\\", "/").split("/")):
        KeyScanner(key).check(text.encode("utf-8", errors="surrogateescape"))


def private_temporary_path(folder, key, *, prefix="tmp.", suffix="", directory=False, create=True):
    """Check the complete generated name before its exclusive creation."""
    folder = Path(folder)
    for _ in range(100):
        path = folder / (prefix + secrets.token_hex(8) + suffix)
        for name in (path, path.absolute(), path.resolve()):
            reject_key_name(name, key)
            if KEY_NAME in name.parts:
                raise RecoveryError("Recovery temporary names must exclude the authentication key filename")
        if not create:
            return path
        try:
            if directory:
                path.mkdir(mode=0o700)
                return path
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            return descriptor, str(path)
        except FileExistsError:
            continue
    raise RecoveryError("Could not allocate a private recovery temporary path")


class KeySafeReader:
    """Scan and digest exactly the bytes delivered to an archive or copied file."""
    def __init__(self, source, key, path="archive source"):
        self.source, self.scanner = source, KeyScanner(key)
        self.key, self.path = key, path
        self.checksum = hashlib.sha256()

    def read(self, size=-1):
        chunk = self.source.read(size)
        try:
            self.scanner.check(chunk)
        except RecoveryError as error:
            raise RecoveryError(f"{self.path}: {error}") from None
        self.checksum.update(chunk)
        return chunk


def reject_key_bytes(source, key, path="archive source") -> None:
    reader = KeySafeReader(source, key, path)
    while reader.read(1024 * 1024):
        pass


class KeySafeWriter:
    """Check each write before forwarding it; delegate descriptor/file methods."""
    def __init__(self, destination, key):
        self.destination, self.scanner = destination, KeyScanner(key)

    def write(self, content):
        self.scanner.check(content)
        return self.destination.write(content)

    def __getattr__(self, name):
        return getattr(self.destination, name)

    def __enter__(self):
        return self

    def __exit__(self, *error):
        return self.destination.__exit__(*error)


class KeySafeGzipReader(KeySafeReader):
    """Check compressed and decoded bytes before a snapshot chunk reaches disk.

    A packet edit after verification must not put a key-bearing compressed tar
    into even a private temporary snapshot. Support concatenated gzip streams;
    preserve the decoded scanner's overlap across stream/chunk boundaries.
    """
    def __init__(self, source, key):
        super().__init__(source, key)
        self.decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
        self.decoded_scanner = KeyScanner(key)

    def read(self, size=-1):
        chunk = super().read(size)
        if not chunk:
            if not self.decoder.eof:
                raise RecoveryError("Recovery snapshot contains an incomplete gzip stream")
            return chunk
        pending = chunk
        while pending:
            if self.decoder.eof:
                self.decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
            self.decoded_scanner.check(self.decoder.decompress(pending, 65536))
            pending = self.decoder.unused_data if self.decoder.eof else self.decoder.unconsumed_tail
        return chunk
