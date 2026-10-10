"""test_recovery_spelling_closure.py: close diagnostic spelling alphabets.

Connect randomized inert text, GNU filename errors and chunked shell input.
Prove complete text representations survive every non-alphabet insertion.
"""
from __future__ import annotations

import base64
import os
from pathlib import Path
import random
import subprocess
import sys

import pytest

from test_recovery_quoted_routes import LOCALES, TOOLS, quoted, utility_arguments
from recovery_operator_input_probes import signing_root

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'app/server_tools/lib'))
from database_recovery_packet_io import safe_diagnostic, _alphabet_diagnostic_spans
import re

HEX = b'0123456789abcdefABCDEF'
STANDARD = b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
URLSAFE = STANDARD[:-2] + b'-_'
FORMS = ('hex', 'utf16le', 'utf16be', *('base64-%d' % n for n in range(3)),
         *('urlsafe-%d' % n for n in range(3)))


def representation(key, form):
    if form == 'hex':
        value = key.hex().encode()
        return value, HEX
    if form.startswith('utf16'):
        return key.hex().encode('utf-16le' if form == 'utf16le' else 'utf-16be'), HEX + b'\0'
    encoder = base64.urlsafe_b64encode if form.startswith('urlsafe') else base64.b64encode
    return encoder(b'Q' * int(form[-1]) + key + b'end'), URLSAFE if form.startswith('urlsafe') else STANDARD


def intersperse(value, alphabet, generator):
    excluded = bytes(byte for byte in range(256) if byte not in alphabet)
    mandatory = [b'"', b'\\', b'\\\\\\', b"'", b"$'", b'$"', b"'\\''", b' \t\r\n', b'`$({})']
    # GNU/Bash delimiter and backslash runs, plus all other nonalphabet bytes.
    assert all(not any(byte in alphabet for byte in item) for item in mandatory)
    chunks = []
    for byte in value:
        chunks.append(generator.choice(mandatory))
        chunks.append(bytes(generator.choice(excluded) for _ in range(generator.randrange(8))))
        chunks.append(bytes([byte]))
    return b''.join(chunks)


@pytest.mark.parametrize('form', FORMS)
@pytest.mark.parametrize('shadow', ('raw', 'gnu', 'bash-octal', 'bash-hex'))
def test_random_nonalphabet_insertions_never_hide_complete_representation(form, shadow):
    generator = random.Random(9913)
    for _ in range(40):
        key = generator.randbytes(32)
        value, alphabet = representation(key, form)
        # Mixed hexadecimal case must be accepted, including UTF-16 text.
        if form in ('hex', 'utf16le', 'utf16be'):
            value = bytes(byte - 32 if 97 <= byte <= 102 and generator.randrange(2) else byte for byte in value)
        noisy = intersperse(value, alphabet, generator)
        if shadow == 'gnu':
            # Filenames cannot contain NUL; represent every original byte with
            # inert ANSI-C spelling, then let GNU add its outer quoting layer.
            path = b'/missing/prefix-"' + quoted(noisy, 'ansi-hex') + b'/VERSION_APP'
            original = subprocess.run([b'/usr/bin/cat', b'--', path], capture_output=True,
                                      env=dict(os.environ, LC_ALL='C'))
            message = original.stderr
        elif shadow.startswith('bash-'):
            message = quoted(noisy, 'ansi-octal' if shadow == 'bash-octal' else 'ansi-hex')
        else:
            message = noisy
        scanned = safe_diagnostic(message.decode('utf-8', errors='surrogateescape'), key)
        assert '<redacted:' in scanned, (form, shadow, key.hex(), message)
        assert shadow != 'gnu' or any(cause in scanned for cause in ('No such file or directory', 'File name too long'))


def test_alphabet_match_maps_exact_first_and_last_contributing_characters():
    value = bytes(range(32)).hex().encode()
    content = b'!!!' + b'\\" '.join(bytes([byte]) for byte in value) + b'!!!'
    spans = _alphabet_diagnostic_spans(content, [(frozenset(HEX), re.compile(re.escape(value), re.I))])
    assert spans == [(3, len(content) - 3)]


@pytest.mark.parametrize('form', FORMS)
def test_incomplete_representation_is_not_redacted(form):
    key = random.Random(17).randbytes(32)
    value, alphabet = representation(key, form)
    # Retain strictly fewer than all canonical key-determined characters.
    if form.startswith(('base64', 'urlsafe')):
        start = (int(form[-1]) * 8 + 5) // 6
        end = ((int(form[-1]) + len(key)) * 8) // 6
        value = value[start:end]
    value = value[1:-1]
    noisy = intersperse(value, alphabet, random.Random(8))
    text = noisy.decode('utf-8', errors='surrogateescape')
    # Disable escape decoding here: random bytes may themselves spell extra
    # alphabet characters through escapes. This verifies only full-form matching.
    forms = [(frozenset(alphabet), re.compile(re.escape(representation(key, form)[0]), re.I))]
    assert not _alphabet_diagnostic_spans(noisy, forms)
    assert '<redacted:' not in safe_diagnostic(text, key)


@pytest.mark.parametrize('locale', LOCALES)
@pytest.mark.parametrize('tool', TOOLS)
def test_real_gnu_errors_with_quote_before_backslash_hex(tmp_path, locale, tool):
    generator = random.Random(991338)
    for index in range(11):
        key = b'\xab' * 32 if index == 0 else generator.randbytes(32)
        value = b''.join(b'\\' + bytes([byte]) for byte in key.hex().encode())
        path = os.fsdecode(os.fsencode(tmp_path) + b'/missing/prefix-"' + value + b'/VERSION_APP')
        arguments = utility_arguments(tool, path, tmp_path)
        if tool == 'tar':
            # GNU tar otherwise transforms argv backslash escapes before lookup;
            # diagnose the literal key-bearing filename, as the other tools do.
            arguments.insert(1, '--no-unquote')
        original = subprocess.run(arguments, capture_output=True,
                                  env=dict(os.environ, LC_ALL=locale), timeout=30)
        assert original.returncode and original.stderr
        scanned = safe_diagnostic(os.fsdecode(original.stderr), key).encode('utf-8', errors='surrogateescape')
        assert b'<redacted:' in scanned, (tool, locale, original.stderr)
        assert b'No such file or directory' in scanned or b'File name too long' in scanned
        assert scanned != original.stderr


@pytest.mark.parametrize('chunk_size', (1, 7, 63, 65536))
@pytest.mark.parametrize('form', FORMS)
def test_inserted_spelling_crosses_shell_input_chunks(tmp_path, chunk_size, form):
    root = signing_root(tmp_path / 'installation')
    key = bytes.fromhex((root / 'keys/database_recovery.hmac.key').read_text().strip())
    value, alphabet = representation(key, form)
    message = b'cat: /' + intersperse(value, alphabet, random.Random(6)) + b'/VERSION_APP: denied\n'
    process = subprocess.Popen(['/bin/bash', '-c', 'source "$1"; filterest_redact_recovery_diagnostics "$2"',
        'probe', ROOT / 'app/server_tools/lib/installation_records.sh', root],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    for start in range(0, len(message), chunk_size):
        process.stdin.write(message[start:start + chunk_size])
        process.stdin.flush()
    process.stdin.close()
    process.stdin = None
    stdout, stderr = process.communicate(timeout=30)
    assert process.returncode == 0 and not stderr
    assert b'<redacted:' in stdout and stdout.endswith(b'/VERSION_APP: denied\n')


@pytest.mark.parametrize('locale', LOCALES)
@pytest.mark.parametrize('tool', TOOLS)
def test_ordinary_gnu_diagnostics_are_byte_identical(tmp_path, locale, tool):
    generator = random.Random(17)
    key = generator.randbytes(32)
    for suffix in (b'ordinary', b'quotes-"-and-\\', b"$'inert'", b'\xff\xfe', b'no-key-1234567890'):
        path = os.fsdecode(os.fsencode(tmp_path) + b'/missing/' + suffix + b'/VERSION_APP')
        arguments = utility_arguments(tool, path, tmp_path)
        if tool == 'tar':
            # GNU tar otherwise transforms argv backslash escapes before lookup;
            # diagnose the literal key-bearing filename, as the other tools do.
            arguments.insert(1, '--no-unquote')
        original = subprocess.run(arguments, capture_output=True,
                                  env=dict(os.environ, LC_ALL=locale), timeout=30)
        assert original.returncode and original.stderr
        assert safe_diagnostic(os.fsdecode(original.stderr), key).encode('utf-8', errors='surrogateescape') == original.stderr
