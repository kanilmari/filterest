"""test_recovery_log_before_update.py: full updater refusals before downtime.

Connect the actual updater/scanner to disposable Git and transport fixtures.
An original application answers over pipes before and after the refused update.
No sockets, network, database, Docker daemon or worktree Git writes are needed.
"""
from __future__ import annotations

import os
from pathlib import Path
import select
import stat
import subprocess
import sys
from types import SimpleNamespace

import pytest

from test_native_lifecycle_roots import build_update_fixture, run_update
from test_update_prerequisites_before_downtime import installation_snapshot, assert_untouched, package_probe
from test_recovery_content_sinks import KEY, FORMS

LIBRARY = Path(__file__).resolve().parents[2] / "server_tools/lib"
sys.path.insert(0, str(LIBRARY))
from recovery_content_stream import check_existing_log, _log_metadata
from recovery_key_safety import KeyScanner
from database_recovery_packet_io import RecoveryError


def existing_log(fixture, content=b"ordinary existing log\n"):
    root = fixture["checkout"]
    key = root / "keys/database_recovery.hmac.key"
    key.write_text(KEY.hex() + "\n")
    key.chmod(0o600)
    log = root / "data/runtime/logs/filterest-admin.log"
    log.parent.mkdir(mode=0o755)
    log.write_bytes(content)
    log.chmod(0o600)
    package_probe(fixture)
    return log


def ask_application(application):
    assert application.poll() is None
    application.stdin.write(b"request\n")
    application.stdin.flush()
    assert select.select([application.stdout], [], [], 2)[0], "original application stopped serving"
    assert application.stdout.readline() == b"original application response\n"


@pytest.mark.parametrize("form", FORMS)
def test_actual_updater_refuses_existing_key_log_while_original_keeps_serving(tmp_path, form, monkeypatch):
    application = subprocess.Popen([sys.executable, "-u", "-c",
                                   'import sys\nfor request in sys.stdin.buffer:\n'
                                   ' sys.stdout.buffer.write(b"original application response\\n");sys.stdout.buffer.flush()'],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    try:
        import test_native_lifecycle_roots as lifecycle
        # Reaching the updater's real stop step would terminate this application.
        # This makes continuing to serve an observable lifecycle property.
        stop = '\nif [[ "$(basename "$0") $1" == "run_filterest_admin.sh stop" ]]; then kill -TERM "$FILTEREST_TEST_ORIGINAL_PID"; fi\n'
        monkeypatch.setattr(lifecycle, "RECORD_CALL", lifecycle.RECORD_CALL + stop)
        fixture = build_update_fixture(tmp_path, "admin")
        fixture["environment"]["FILTEREST_TEST_ORIGINAL_PID"] = str(application.pid)
        log = existing_log(fixture, b"ordinary prefix\n" + FORMS[form] + b"\n")
        ask_application(application)
        before = installation_snapshot(fixture["checkout"])
        result = run_update(fixture, "--yes")
        assert result.returncode != 0
        assert "Recovery content refused; no complete file was published." in result.stderr
        assert "Filterest update completed" not in result.stdout
        assert FORMS[form] not in (result.stdout + result.stderr).encode()
        ask_application(application)
        assert_untouched(fixture, before)
        assert log.read_bytes() == b"ordinary prefix\n" + FORMS[form] + b"\n"
    finally:
        application.terminate()
        application.communicate(timeout=3)


@pytest.mark.parametrize("kind", ("directory", "fifo", "symlink", "dangling", "hardlink",
                                 "parent-link", "parent-mode", "readonly", "group-write",
                                 "world-write", "executable", "special-mode"))
def test_actual_updater_refuses_unsafe_existing_log_destination_before_shutdown(tmp_path, kind):
    fixture = build_update_fixture(tmp_path, "admin")
    log = existing_log(fixture)
    if kind in ("directory", "fifo", "symlink", "dangling"):
        log.unlink()
        if kind == "directory": log.mkdir()
        if kind == "fifo": os.mkfifo(log, mode=0o600)
        if kind == "symlink": log.symlink_to(fixture["checkout"] / "data/storage/upload.txt")
        if kind == "dangling": log.symlink_to(log.parent / "absent")
    elif kind == "hardlink":
        os.link(log, log.parent / "other.log")
    elif kind == "parent-link":
        parent = log.parent
        parent.rename(parent.with_name("original-logs"))
        parent.symlink_to(parent.with_name("original-logs"), target_is_directory=True)
    elif kind == "parent-mode":
        log.parent.chmod(0o777)
    else:
        log.chmod({"readonly": 0o400, "group-write": 0o620, "world-write": 0o602,
                   "executable": 0o700, "special-mode": 0o4600}[kind])
    # Do not read FIFO data or follow links while capturing the installation.
    before = destination_snapshot(fixture["checkout"])
    result = run_update(fixture, "--yes")
    assert result.returncode != 0 and "Recovery content refused" in result.stderr
    assert destination_snapshot(fixture["checkout"]) == before
    assert_no_shutdown(fixture)


def destination_snapshot(root):
    result = {}
    for path in sorted(root.rglob("*")):
        if path.relative_to(root).parts[0] == ".git": continue
        metadata = path.lstat()
        result[str(path.relative_to(root))] = (metadata.st_mode, metadata.st_uid, metadata.st_nlink,
            os.readlink(path) if stat.S_ISLNK(metadata.st_mode) else
            path.read_bytes() if stat.S_ISREG(metadata.st_mode) else None)
    result["HEAD"] = (root / ".git/HEAD").read_bytes()
    result["index"] = (root / ".git/index").read_bytes()
    return result


def assert_no_shutdown(fixture):
    from test_native_lifecycle_roots import logged_calls, update_backups, git_output
    assert update_backups(fixture) == []
    assert git_output(fixture["checkout"], "rev-parse", "HEAD") == fixture["old_commit"]
    assert not (fixture["checkout"] / "data/runtime/filterest-update.lock").exists()
    assert not [call for call in logged_calls(fixture) if call.startswith(
        ("run_filterest_admin.sh", "pg_dump", "pg_restore", "install_filterest.sh --profile", "docker stop"))]


@pytest.mark.parametrize("mode", (0o600, 0o640, 0o644))
def test_existing_safe_log_preflight_preserves_bytes_and_mode_and_allows_update(tmp_path, mode):
    fixture = build_update_fixture(tmp_path, "admin")
    log = existing_log(fixture)
    log.chmod(mode)
    before = log.read_bytes(), log.stat().st_mode, log.stat().st_mtime_ns
    result = subprocess.run(["bash", "-c", 'source "$1"; filterest_recovery_content_stream "$2" live-preflight "$3"',
                             "check", str(LIBRARY / "installation_records.sh"), str(fixture["checkout"]), str(log)],
                            env=fixture["environment"], capture_output=True)
    assert (result.returncode, result.stdout, result.stderr) == (0, b"", b"")
    assert (log.read_bytes(), log.stat().st_mode, log.stat().st_mtime_ns) == before
    assert run_update(fixture, "--yes").returncode == 0


def test_missing_log_preflight_creates_nothing(tmp_path):
    fixture = build_update_fixture(tmp_path, "admin")
    package_probe(fixture)
    root = fixture["checkout"]
    before = destination_snapshot(root)
    result = subprocess.run(["bash", "-c", 'source "$1"; filterest_recovery_content_stream "$2" live-preflight "$3"',
                             "check", str(LIBRARY / "installation_records.sh"), str(root),
                             str(root / "data/runtime/logs/filterest-admin.log")],
                            env=fixture["environment"], capture_output=True)
    assert (result.returncode, result.stdout, result.stderr) == (0, b"", b"")
    assert destination_snapshot(root) == before


def test_log_owner_is_validated_without_privileged_fixture_changes():
    with pytest.raises(RecoveryError):
        _log_metadata(SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=os.getuid() + 1, st_nlink=1))


@pytest.mark.parametrize("change", ("append", "replace", "truncate"))
def test_preflight_refuses_concurrent_existing_log_changes(tmp_path, change):
    log = tmp_path / "log"
    log.write_bytes(b"ordinary content")
    log.chmod(0o600)
    class ChangingScanner:
        def check(self, chunk):
            if change == "append":
                with log.open("ab") as output: output.write(b"new")
            elif change == "replace":
                replacement = log.with_suffix(".new")
                replacement.write_bytes(b"new"); replacement.chmod(0o600)
                replacement.replace(log)
            else:
                log.write_bytes(b"")
    with pytest.raises(RecoveryError):
        check_existing_log(log, ChangingScanner())


def test_existing_log_scanner_keeps_cross_chunk_and_append_boundary_protection(tmp_path):
    log = tmp_path / "log"
    log.write_bytes(b"a" * (65536 - 10) + KEY.hex().encode())
    log.chmod(0o600)
    with pytest.raises(RecoveryError): check_existing_log(log, KeyScanner(KEY))
    log.write_bytes(b"ordinary\n" + KEY.hex().encode()[:30])
    scanner = KeyScanner(KEY)
    parent, _ = check_existing_log(log, scanner)
    os.close(parent)
    with pytest.raises(RecoveryError): scanner.check(KEY.hex().encode()[30:])
