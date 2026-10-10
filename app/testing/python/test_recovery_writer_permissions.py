"""test_recovery_writer_permissions.py: privacy at allocation and during writing.

Block real shell producers after bytes enter their shared recovery stages.
Exercise permissive caller masks and accessible parents, including bulk backup.
Python ZIP/member allocation and private packet writers use the same proof.
"""
from __future__ import annotations

import os
from pathlib import Path
import signal
import stat
import subprocess
import time
import zipfile

import pytest

from test_recovery_content_sinks import BACKUP_PROBE, KEY, LIBRARY, SOURCE, installation


def wait_for(predicate, seconds=8):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate(): return
        time.sleep(.01)
    assert predicate()


BLOCK = '''
printf '%s' "$BLOCK_CONTENT"
touch producer-blocked
while [[ ! -e producer-release ]]; do /bin/sleep .01; done
'''


@pytest.mark.parametrize("route", ("single", "all", "plain", "append", "gzip", "diagnostic", "tls"))
def test_shell_stage_is_private_while_producer_is_blocked(tmp_path, route):
    root = installation(tmp_path, b"safe dump bytes\n" * 12000)
    root.chmod(0o755)
    parent = root / "instances/proof/backups"
    parent.chmod(0o755)
    (root / "row.bin").chmod(0o644)
    script = '''umask 022
source "$1"
shift
BLOCK_CONTENT="$(cat row.bin)"
producer() { ''' + BLOCK + '''}
'''
    if route in ("single", "all"):
        probe = BACKUP_PROBE.replace("cat row.bin; return", "producer; return")
        script += probe
        arguments = [SOURCE, route]
    elif route == "tls":
        script += '''openssl() {
    local out= keyout=
    while [[ $# -gt 0 ]]; do
        case "$1" in -out) out="$2"; shift ;; -keyout) keyout="$2"; shift ;; esac
        shift
    done
    printf '%s' "$BLOCK_CONTENT" > "$out"
    printf '%s' "$BLOCK_CONTENT" > "$keyout"
    touch producer-blocked
    while [[ ! -e producer-release ]]; do /bin/sleep .01; done
}
filterest_recovery_tls_identity "$PROJECT_ROOT" instances/proof/backups/cert.pem instances/proof/backups/key.pem
'''
        arguments = []
    elif route == "diagnostic":
        script += 'filterest_recovery_to_file "$PROJECT_ROOT" instances/proof/backups/diagnostic.log producer\n'
        arguments = []
    else:
        target = "instances/proof/backups/result"
        if route == "append": (root / target).write_bytes(b"old safe bytes\n")
        option = "--append" if route == "append" else "--gzip" if route == "gzip" else ""
        script += f'filterest_recovery_content_to_file "$PROJECT_ROOT" {target} {option} producer\n'
        arguments = []
    environment = dict(os.environ, PROJECT_ROOT=str(root), FILTEREST_RECOVERY_OUTPUT="1",
                       FILTEREST_SOURCE_ROOT=str(SOURCE), PYTHONDONTWRITEBYTECODE="1")
    process = subprocess.Popen(["/bin/bash", "-c", script, "probe", str(LIBRARY), *map(str, arguments)],
                               cwd=root, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               start_new_session=True)
    try:
        wait_for(lambda: (root / "producer-blocked").exists())
        stages = list(parent.glob("*.partial.*")) if route != "diagnostic" else [parent / "diagnostic.log"]
        assert len(stages) == (2 if route == "tls" else 1)
        for path in stages:
            assert stat.S_IMODE(path.stat().st_mode) == 0o600, (route, path)
        # Shared scanners may buffer gzip/short chunks, but the producer is
        # actively blocked while the file already exists with private permissions.
        # Diagnostic redaction deliberately withholds all bytes until EOF.
        if route in ("plain", "append", "tls"):
            wait_for(lambda: all(path.stat().st_size > 0 for path in stages))
        if route != "single": assert stat.S_IMODE(parent.stat().st_mode) == 0o755
        (root / "producer-release").touch()
        output, errors = process.communicate(timeout=20)
        assert process.returncode == 0, output + errors
        assert not list(parent.glob("*.partial.*"))
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=5)


@pytest.mark.parametrize("directory", (False, True))
def test_temporary_allocation_is_owner_only_with_permissive_caller(tmp_path, directory):
    root = installation(tmp_path)
    parent = root / "instances/proof/backups"
    parent.chmod(0o755)
    script = 'umask 022; source "$1"; filterest_recovery_mktemp "$2" '
    script += '-d ' if directory else ''
    script += '-- "$3/proof.XXXXXX"; printf "mask=%s\\n" "$(umask)"'
    result = subprocess.run(["/bin/bash", "-c", script, "probe", str(LIBRARY), str(root), str(parent)],
                            capture_output=True, timeout=15)
    assert result.returncode == 0, result.stderr
    name, mask = result.stdout.decode().splitlines()
    assert stat.S_IMODE(Path(name).stat().st_mode) == (0o700 if directory else 0o600)
    assert mask == "mask=0022"


def test_python_zip_member_and_intermediate_directories_are_private_at_creation(tmp_path, monkeypatch):
    import sys
    sys.path.insert(0, str(SOURCE / "server_tools/lib"))
    import recovery_content_stream as content
    root = installation(tmp_path)
    stage = root / "public-stage"
    stage.mkdir(mode=0o755)
    archive = root / "safe.zip"
    with zipfile.ZipFile(archive, "w") as source:
        source.writestr("deep/nested/file.txt", b"ordinary ZIP bytes")
    real_open = os.open
    observations = []

    def observe(path, flags, mode=0o777, **options):
        descriptor = real_open(path, flags, mode, **options)
        if flags & os.O_CREAT:
            observations.append((Path(path), stat.S_IMODE(os.fstat(descriptor).st_mode)))
            assert observations[-1][1] == 0o600
            assert stat.S_IMODE((stage / "deep").stat().st_mode) == 0o700
            assert stat.S_IMODE((stage / "deep/nested").stat().st_mode) == 0o700
        return descriptor

    monkeypatch.setattr(content.os, "open", observe)
    mask = os.umask(0o022)
    try:
        content.extract_zip(root, archive, stage, "")
        assert os.umask(0o022) == 0o022
    finally:
        os.umask(mask)
    assert observations == [(stage / "deep/nested/file.txt", 0o600)]


def test_python_private_writers_are_private_before_first_byte(tmp_path):
    import sys
    sys.path.insert(0, str(SOURCE / "server_tools/lib"))
    from database_recovery_packet_io import private_file
    from recovery_key_safety import private_temporary_path
    root = installation(tmp_path)
    parent = root / "instances/proof/backups"
    parent.chmod(0o755)
    mask = os.umask(0o022)
    try:
        with private_file(parent / "packet.partial", key=KEY) as output:
            assert stat.S_IMODE((parent / "packet.partial").stat().st_mode) == 0o600
            output.write(b"safe packet bytes")
        descriptor, name = private_temporary_path(parent, KEY)
        try: assert stat.S_IMODE(os.fstat(descriptor).st_mode) == 0o600
        finally: os.close(descriptor)
        directory = private_temporary_path(parent, KEY, directory=True)
        assert stat.S_IMODE(directory.stat().st_mode) == 0o700
    finally:
        os.umask(mask)
