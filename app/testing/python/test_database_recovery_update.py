"""test_database_recovery_update.py: whole-packet rollback and archive boundaries.

Connects real launchers and README ordering with disposable transport recorders.
Proves refusals before downtime, bounded extraction and signing-key confidentiality.
"""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tarfile

import pytest

from server_tools.lib import database_recovery as recovery
from server_tools.lib import database_recovery_update as update
from server_tools.lib import recovery_archives as archives
from test_database_recovery import packet, run_packet, create_packet, calls
from test_filterest_launcher_install_profile import COPIED_APP_FILES, SOURCE_ROOT
from test_native_lifecycle_roots import build_update_fixture, run_update, update_backups, logged_calls


def run_update_packet(packet, action, *arguments):
    return subprocess.run([sys.executable, '-B', update.__file__, action, '--root', str(packet['root']),
        '--profile', packet['profile'], '--settings', str(packet['settings']), '--backup', str(packet['backup']),
        *arguments], env=packet['environment'], capture_output=True, text=True, cwd=packet['root'])


@pytest.fixture
def whole_packet(packet, request):
    parameter = getattr(request, 'param', 'native')
    profile, relocated = parameter if isinstance(parameter, tuple) else (parameter, ())
    packet['profile'] = profile
    root = packet['root']
    (root / 'config').mkdir()
    (root / 'projects').mkdir()
    for name in ('storage', 'storage_deleted', 'bootstrap'):
        (root / 'data' / name).mkdir()
        (root / 'data' / name / 'saved.txt').write_text('backed-up ' + name)
    for name in relocated:
        logical = root / name
        target = root.parent / ('relocated-' + name.replace('/', '-'))
        logical.rename(target)
        logical.symlink_to(target, target_is_directory=True)
    packet['settings'] = packet['settings'].resolve()
    packet['development'] = packet['development'].resolve()
    if profile == 'docker':
        settings = root / 'keys/docker.env'
        settings.write_text(packet['settings'].read_text() + 'FILTEREST_INSTALL_PROFILE=docker\n')
        settings.chmod(0o600)
        packet['settings'] = settings
        (root / 'data/runtime/filterest-setup-complete').unlink()
        shim = packet['tools'] / 'docker'
        shim.write_text(f'#!{sys.executable}\n' + '''import json, os, pathlib, sys
args = sys.argv[1:]
if 'exec' in args and 'db' in args:
    command = args[args.index('exec') + 3:]
    os.execvpe(command[0], command, os.environ)
elif 'version' in args:
    print('2.40.3')
elif args[:2] == ['volume', 'inspect']:
    sys.exit(1)
elif 'inspect' in args:
    print('[]')
elif 'ps' in args and 'compose' in args:
    print('app\\ndb')
elif 'stop' in args or 'up' in args:
    with open(os.environ['RECOVERY_TEST_LOG'], 'a') as log:
        log.write(json.dumps({'tool':'docker', 'arguments':args}) + '\\n')
''')
        shim.chmod(0o700)
        packet['environment'].update(POSTGRES_USER='site_admin', POSTGRES_PASSWORD='synthetic-login-secret')
        result = subprocess.run([sys.executable, recovery.__file__, 'backup', '--root', str(root),
            '--profile', profile, '--output', str(packet['backup'] / 'database.dump')],
            env=packet['environment'], capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
    else:
        create_packet(packet)
    folder = packet['backup'].with_name('update_round_e')
    packet['backup'].rename(folder)
    packet['backup'] = folder
    key = recovery.packet_key(root, profile, [packet['settings']])
    archives.create_archives(root, folder, key)
    (folder / 'manifest.txt').write_text('profile=' + ('docker' if profile == 'docker' else 'development') + '\nsource_commit=' + 'a' * 40 + '\n')
    (folder / 'manifest.txt').chmod(0o600)
    update.seal_update(folder, root, profile, [packet['settings']])
    for name in COPIED_APP_FILES:
        destination = root / 'app' / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SOURCE_ROOT / name, destination)
    shutil.copy2(SOURCE_ROOT.parent / 'filterest', root / 'filterest')
    shutil.copy2(SOURCE_ROOT.parent / 'compose.yml', root / 'compose.yml')
    (root / 'app/docker').mkdir(exist_ok=True)
    for path in (SOURCE_ROOT / 'docker').glob('docker-compose*.yml'):
        shutil.copy2(path, root / 'app/docker' / path.name)
    packet['environment'] = {name: value for name, value in packet['environment'].items()
                             if not name.startswith(('FILTEREST_', 'EASELECT_'))}
    packet['log'].unlink(missing_ok=True)
    return packet


def snapshot(root):
    return {str(path.relative_to(root)): (stat.S_IMODE(path.lstat().st_mode), path.read_bytes() if path.is_file() and not path.is_symlink() else None)
            for path in root.rglob('*')}


def rollback_block(packet):
    readme = (SOURCE_ROOT.parent / 'README.md').read_text()
    block = next(block for block in readme.split('```bash\n') if 'backup=backups/<update folder>' in block).split('```')[0]
    return block.replace('backups/<update folder>', str(packet['backup'].relative_to(packet['root'])))


def run_rollback(packet):
    return subprocess.run(['bash', '-c', rollback_block(packet)], cwd=packet['root'], env=packet['environment'], capture_output=True, text=True)


def add_member(path, member):
    with tarfile.open(path, 'r:gz') as source:
        originals = [(entry, source.extractfile(entry).read() if entry.isfile() else None) for entry in source.getmembers()]
    with tarfile.open(path, 'w:gz') as target:
        for entry, content in originals:
            target.addfile(entry, io.BytesIO(content) if content is not None else None)
        member.size = 12 if member.isfile() else 0
        target.addfile(member, io.BytesIO(b'evil content') if member.isfile() else None)


def resign_update(packet):
    folder = packet['backup']
    record = json.loads((folder / update.RECORD).read_text())
    for name in record['files']:
        record['files'][name] = recovery.digest(folder / name)
    record['mac'] = update.update_mac(record, recovery.packet_key(packet['root'], packet['profile'], [packet['settings']]))
    (folder / update.RECORD).write_bytes(recovery.canonical(record))


@pytest.mark.parametrize('whole_packet', ['docker'], indirect=True)
@pytest.mark.parametrize('kind', ['launcher', 'parent', 'absolute', 'symlink', 'hardlink', 'device', 'duplicate'])
@pytest.mark.parametrize('signed', [False, True])
def test_unsafe_settings_members_refuse_readme_rollback_before_shutdown(whole_packet, kind, signed):
    packet = whole_packet
    name = {'launcher':'filterest', 'parent':'keys/../filterest', 'absolute':'/tmp/filterest-attack',
            'duplicate':'keys/docker.env'}.get(kind, 'keys/unsafe-member')
    member = tarfile.TarInfo(name)
    if kind in ('symlink', 'hardlink', 'device'):
        member.type = {'symlink':tarfile.SYMTYPE, 'hardlink':tarfile.LNKTYPE, 'device':tarfile.CHRTYPE}[kind]
        member.linkname = '../../filterest'
    add_member(packet['backup'] / 'installation_settings.tar.gz', member)
    if signed:
        resign_update(packet)  # Path rules remain mandatory even with a valid MAC.
    before = snapshot(packet['root'])
    result = run_rollback(packet)
    assert result.returncode, result.stdout + result.stderr
    assert result.stdout == '' and '1/1 Verify the whole update packet' in result.stderr
    assert calls(packet) == []
    assert snapshot(packet['root']) == before
    destination = packet['root'] / 'backups/unsafe-extraction'
    assert run_update_packet(packet, 'extract', '--destination', str(destination)).returncode
    assert not destination.exists() and snapshot(packet['root']) == before


@pytest.mark.parametrize('whole_packet', ['docker'], indirect=True)
@pytest.mark.parametrize('damage', ['dump', 'archive', 'manifest', 'missing-manifest', 'key', 'record', 'extra-archive', 'file-mode', 'folder-mode'])
def test_readme_first_command_refuses_tampering_or_missing_key_with_installation_unchanged(whole_packet, damage):
    packet, folder = whole_packet, whole_packet['backup']
    if damage == 'key':
        (packet['root'] / 'keys' / recovery.KEY).unlink()
    elif damage == 'record':
        (folder / update.RECORD).unlink()
    elif damage == 'missing-manifest':
        (folder / 'manifest.txt').unlink()
    elif damage == 'file-mode':
        (folder / 'storage.tar.gz').chmod(0o644)
    elif damage == 'folder-mode':
        folder.chmod(0o755)
    elif damage == 'extra-archive':
        (folder / 'bootstrap.tar.gz').unlink()
    else:
        name = {'dump':'database.dump', 'archive':'storage.tar.gz', 'manifest':'manifest.txt'}[damage]
        with (folder / name).open('ab') as target:
            target.write(b'tampered')
    before = snapshot(packet['root'])
    result = run_rollback(packet)
    assert result.returncode
    assert calls(packet) == []
    assert snapshot(packet['root']) == before


@pytest.mark.parametrize('whole_packet', ['native', 'docker'], indirect=True)
def test_whole_packet_verifier_is_read_only_and_bounded_staging_restores_saved_files(whole_packet):
    packet = whole_packet
    before = snapshot(packet['root'])
    verified = subprocess.run([str(packet['root'] / 'filterest'), 'verify-update-backup', '--backup',
        str(packet['backup'].relative_to(packet['root']))], env=packet['environment'], capture_output=True, text=True)
    assert verified.returncode == 0, verified.stderr
    assert calls(packet) == [] and snapshot(packet['root']) == before
    destination = packet['root'] / 'backups/staging'
    extracted = run_update_packet(packet, 'extract', '--destination', str(destination))
    assert extracted.returncode == 0, extracted.stderr
    for name in ('storage', 'storage_deleted', 'bootstrap'):
        assert (destination / 'data' / name / 'saved.txt').read_text() == 'backed-up ' + name
    assert not (destination / 'keys' / recovery.KEY).exists()
    assert not (destination / 'filterest').exists()
    assert calls(packet) == []


@pytest.mark.parametrize('whole_packet', ['docker'], indirect=True)
def test_genuine_readme_rollback_reverifies_and_restores_paired_database(whole_packet):
    packet = whole_packet
    git = packet['tools'] / 'git'
    git.write_text('#!/bin/sh\nexit 0\n')  # No checkout is changed by the disposable rehearsal.
    git.chmod(0o700)
    (packet['root'] / 'data/storage/saved.txt').write_text('new version live files')
    key_before = (packet['root'] / 'keys' / recovery.KEY).read_bytes()
    result = run_rollback(packet)
    assert result.returncode == 0, result.stdout + result.stderr
    assert (packet['root'] / 'data/storage/saved.txt').read_text() == 'backed-up storage'
    assert (packet['root'] / 'keys' / recovery.KEY).read_bytes() == key_before
    [aside] = (packet['root'] / 'backups').glob('replaced_*')
    assert (aside / 'data/storage/saved.txt').read_text() == 'new version live files'
    assert not list(aside.rglob(recovery.KEY))
    assert any(call['tool'] == 'pg_restore' and '--list' not in call['arguments'] for call in calls(packet))
    assert 'UNAUTHENTICATED' not in result.stderr


@pytest.mark.parametrize('profile', ['docker', 'admin', 'development'])
@pytest.mark.parametrize('target', ['key', 'outside-data', 'inside-tree', 'hardlink', 'copied-key'])
def test_update_preflight_refuses_aliases_before_shutdown_and_no_archive_leaks_key(tmp_path, profile, target):
    fixture = build_update_fixture(tmp_path, profile)
    root = fixture['checkout']
    key = root / 'keys' / recovery.KEY
    key.write_text('b' * 64 + '\n')
    key.chmod(0o600)
    alias = root / 'data/storage/innocent-alias'
    outside = root / 'config/outside.txt'
    outside.parent.mkdir(exist_ok=True)
    outside.write_text('outside media')
    if target == 'hardlink':
        os.link(key, alias)
    elif target == 'copied-key':
        alias.write_bytes(b'prefix' + key.read_bytes() + b'suffix')
    else:
        alias.symlink_to({'key':key, 'outside-data':outside, 'inside-tree':root / 'data/storage/upload.txt'}[target])
    result = run_update(fixture, '--yes')
    assert result.returncode, result.stdout + result.stderr
    assert not any('stop app' in call or 'ctl --stop' in call or 'run_filterest_admin.sh stop' in call for call in logged_calls(fixture))
    assert update_backups(fixture) == []
    for archive_path in root.rglob('*.tar.gz'):
        with tarfile.open(archive_path) as source:
            assert all(key.read_bytes().strip() not in source.extractfile(member).read() for member in source if member.isfile())


@pytest.mark.parametrize('whole_packet', ['native', 'docker'], indirect=True)
def test_updater_archives_have_no_key_bytes_under_any_name(whole_packet):
    packet = whole_packet
    needles = ((packet['root'] / 'keys' / recovery.KEY).read_bytes().strip(), recovery.packet_key(packet['root'], packet['profile'], []))
    for path in packet['backup'].glob('*.tar.gz'):
        with tarfile.open(path) as source:
            for member in source:
                if member.isfile():
                    content = source.extractfile(member).read()
                    assert all(needle not in content for needle in needles), (path.name, member.name)


def test_legacy_whole_packet_requires_explicit_choice_and_still_enforces_archive_roots(packet):
    packet['profile'] = 'native'
    folder = packet['backup'].with_name('update_old')
    packet['backup'].rename(folder)
    packet['backup'] = folder
    (folder / 'database.dump').write_bytes(b'PGDMP legacy dump')
    (folder / 'database.dump').chmod(0o600)
    (folder / 'manifest.txt').write_text('profile=development\nsource_commit=' + 'a' * 40 + '\n')
    (folder / 'manifest.txt').chmod(0o600)
    with tarfile.open(folder / 'storage.tar.gz', 'w:gz') as target:
        member = tarfile.TarInfo('storage/old.txt')
        member.size = 6
        target.addfile(member, io.BytesIO(b'legacy'))
    (folder / 'storage.tar.gz').chmod(0o600)
    assert run_update_packet(packet, 'verify').returncode
    verified = run_update_packet(packet, 'verify', '--legacy')
    assert verified.returncode == 0, verified.stderr
    assert 'UNAUTHENTICATED' in verified.stderr and calls(packet) == []
    refused = run_update_packet(packet, 'verify', '--legacy', '--print-source-commit')
    assert refused.returncode and refused.stdout == '' and 'legacy manifests are unauthenticated' in refused.stderr
    assert calls(packet) == []
    destination = packet['root'] / 'backups/old-staging'
    assert run_update_packet(packet, 'extract', '--legacy', '--destination', str(destination)).returncode == 0
    assert (destination / 'data/storage/old.txt').read_bytes() == b'legacy'
    add_member(folder / 'storage.tar.gz', tarfile.TarInfo('../filterest'))
    before = snapshot(packet['root'])
    assert run_update_packet(packet, 'verify', '--legacy').returncode
    assert snapshot(packet['root']) == before


def test_dump_only_packets_keep_database_path_and_current_partial_updates_never_become_legacy(whole_packet):
    packet = whole_packet
    (packet['backup'] / update.RECORD).unlink()
    refused = run_update_packet(packet, 'verify', '--legacy')
    assert refused.returncode and 'Partial update packet' in refused.stderr
    assert 'UNAUTHENTICATED' not in refused.stderr and calls(packet) == []
    result = run_packet(packet, 'restore', '--backup', str(packet['backup']), '--yes', '--legacy')
    assert result.returncode == 0, result.stderr
    assert 'UNAUTHENTICATED' not in result.stderr


def test_refused_partial_database_packet_does_not_announce_legacy_restore(packet):
    create_packet(packet)
    (packet['backup'] / recovery.RECORD).unlink()
    packet['log'].unlink()
    result = run_packet(packet, 'restore', '--backup', str(packet['backup']), '--yes', '--legacy')
    assert result.returncode and calls(packet) == []
    assert 'UNAUTHENTICATED RESTORE AUTHORIZED' not in result.stderr


@pytest.mark.parametrize('archive_name,member_name', [
    ('storage.tar.gz', 'data/bootstrap/extra'),
    ('bootstrap.tar.gz', 'data/storage/extra'),
    ('storage.tar.gz', 'storage/extra'),
    ('bootstrap.tar.gz', '/data/bootstrap/extra'),
    ('storage.tar.gz', 'data/storage/../extra'),
])
def test_media_roots_are_checked_even_when_the_archive_is_authenticated(whole_packet, archive_name, member_name):
    packet = whole_packet
    add_member(packet['backup'] / archive_name, tarfile.TarInfo(member_name))
    resign_update(packet)
    destination = packet['root'] / 'backups/unsafe-staging'
    before = snapshot(packet['root'])
    result = run_update_packet(packet, 'extract', '--destination', str(destination))
    assert result.returncode and not destination.exists()
    assert calls(packet) == [] and snapshot(packet['root']) == before


def test_key_scan_checks_bytes_actually_read_after_source_preflight(tmp_path, monkeypatch):
    root, folder = tmp_path / 'root', tmp_path / 'packet'
    (root / 'data/storage').mkdir(parents=True)
    folder.mkdir(mode=0o700)
    key = bytes.fromhex('c' * 64)
    payload = root / 'data/storage/upload'
    payload.write_bytes(b'x' * 80)
    original = tarfile.TarFile.addfile
    def edit_before_copy(archive, member, fileobj=None):
        if member.name == 'data/storage/upload':
            payload.write_bytes(key.hex().encode() + b'x' * 16)
        return original(archive, member, fileobj)
    monkeypatch.setattr(tarfile.TarFile, 'addfile', edit_before_copy)
    with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
        archives.create_archives(root, folder, key)
    assert list(folder.iterdir()) == []


def test_recomputed_update_digests_do_not_authenticate_an_edited_manifest_or_archive(whole_packet):
    packet, folder = whole_packet, whole_packet['backup']
    manifest = folder / 'manifest.txt'
    manifest.write_text(manifest.read_text().replace('a' * 40, 'b' * 40))
    with (folder / 'storage.tar.gz').open('ab') as target:
        target.write(b'edited archive')
    record = json.loads((folder / update.RECORD).read_text())
    record['files'] = {name: recovery.digest(folder / name) for name in record['files']}
    (folder / update.RECORD).write_bytes(recovery.canonical(record))  # Attacker has no signing key.
    before = snapshot(packet['root'])
    result = run_update_packet(packet, 'verify')
    assert result.returncode and 'Whole-update packet authentication failed' in result.stderr
    assert calls(packet) == [] and snapshot(packet['root']) == before


@pytest.mark.parametrize('consumer', ['verify', 'extract', 'seal'])
def test_whole_update_space_refusal_precedes_snapshot_and_installation_writes(whole_packet, monkeypatch, consumer):
    from types import SimpleNamespace
    from server_tools.lib import database_recovery_packet_io as packet_io

    packet = whole_packet
    before = snapshot(packet['root'])
    size = sum(path.stat().st_size for path in packet['backup'].iterdir())
    needed = size + max(packet_io.SNAPSHOT_MARGIN, (size + 9) // 10)
    location = packet['root'] / 'temporary-space'
    def forbidden(*arguments, **options):
        pytest.fail('Insufficient space must precede any diagnostics or snapshot write')
    monkeypatch.setattr(packet_io.tempfile, 'gettempdir', lambda: str(location))
    monkeypatch.setattr(packet_io.shutil, 'disk_usage', lambda path: SimpleNamespace(free=needed - 1))
    monkeypatch.setattr(packet_io.tempfile, 'mkdtemp', forbidden)
    monkeypatch.setattr(packet_io, '_snapshot_file_at', forbidden)
    destination = packet['root'] / 'backups/not-created'
    with pytest.raises(recovery.RecoveryError) as result:
        if consumer == 'verify':
            update.verify_update(packet['backup'], packet['root'], 'native', [packet['settings']])
        elif consumer == 'extract':
            update.extract_update(packet['backup'], packet['root'], 'native', [packet['settings']], destination)
        else:
            update.seal_update(packet['backup'], packet['root'], 'native', [packet['settings']])
    assert str(location) in str(result.value) and 'TMPDIR' in str(result.value)
    assert f'needed {needed} bytes' in str(result.value) and f'free {needed - 1} bytes' in str(result.value)
    assert calls(packet) == [] and snapshot(packet['root']) == before


@pytest.mark.parametrize('consumer', ['verify', 'extract'])
@pytest.mark.parametrize('fail', [False, True])
def test_whole_update_snapshot_cleanup_keeps_only_small_evidence(whole_packet, tmp_path, monkeypatch, consumer, fail, capsys):
    from server_tools.lib import database_recovery_packet_io as packet_io

    packet = whole_packet
    location = tmp_path / 'temporary-space'
    location.mkdir(mode=0o700)
    monkeypatch.setattr(packet_io.tempfile, 'gettempdir', lambda: str(location))
    if fail:
        record = json.loads((packet['backup'] / update.RECORD).read_text())
        record['mac'] = '0' * 64
        (packet['backup'] / update.RECORD).write_bytes(recovery.canonical(record))
    before = {path.name: path.read_bytes() for path in packet['backup'].iterdir()}
    destination = packet['root'] / 'backups/staged-space-proof'
    def operation():
        if consumer == 'verify':
            update.verify_update(packet['backup'], packet['root'], 'native', [packet['settings']])
        else:
            update.extract_update(packet['backup'], packet['root'], 'native', [packet['settings']], destination)
    if fail:
        with pytest.raises(recovery.RecoveryError, match='authentication failed'):
            operation()
        [logs] = location.iterdir()
        evidence = logs / 'update_snapshot'
        assert {path.name for path in evidence.iterdir()} >= {recovery.RECORD, update.RECORD,
            recovery.ROLES, recovery.PROPERTIES, recovery.CHECKSUMS, update.MANIFEST}
        assert not any(path.name.endswith(('.dump', '.tar.gz')) for path in logs.rglob('*'))
        output = capsys.readouterr().out
        assert f'Private {consumer}-update diagnostics (0700): {logs}' in output
        assert f'Original packet unchanged in its folder: {packet["backup"]}' in output
        assert not destination.exists()
    else:
        operation()
        assert list(location.iterdir()) == []
        assert 'diagnostics (0700)' not in capsys.readouterr().out
    assert before == {path.name: path.read_bytes() for path in packet['backup'].iterdir()}


@pytest.mark.parametrize('interrupt', [False, True])
def test_failed_or_cancelled_extraction_removes_large_snapshots_and_partial_stage(whole_packet, tmp_path, monkeypatch, interrupt):
    from server_tools.lib import database_recovery_packet_io as packet_io

    packet = whole_packet
    location = tmp_path / 'temporary-space'
    location.mkdir(mode=0o700)
    monkeypatch.setattr(packet_io.tempfile, 'gettempdir', lambda: str(location))
    destination = packet['root'] / 'backups/failed-stage'
    error_type = InterruptedError if interrupt else recovery.RecoveryError
    def fail(path, destination, *arguments, **options):
        (destination / 'partial-archive-output').write_bytes(b'partial')
        raise error_type('simulated extraction failure')
    monkeypatch.setattr(update, 'extract_archive', fail)
    # The public boundary wraps InterruptedError (an OSError) as RecoveryError.
    with pytest.raises(recovery.RecoveryError):
        update.extract_update(packet['backup'], packet['root'], 'native', [packet['settings']], destination)
    [logs] = location.iterdir()
    assert not destination.exists()
    assert (logs / 'update_snapshot' / update.RECORD).is_file()
    assert not any(path.name.endswith(('.dump', '.tar.gz')) for path in logs.rglob('*'))


def test_external_archive_is_included_in_space_check_before_any_diagnostics(packet, tmp_path, monkeypatch):
    from types import SimpleNamespace
    from server_tools.lib import database_recovery_packet_io as packet_io

    create_packet(packet)
    external = tmp_path / 'external-settings.tar.gz'
    shutil.copyfile(packet['backup'] / recovery.SETTINGS, external)
    external.chmod(0o600)
    packet_size = sum(path.stat().st_size for path in packet['backup'].iterdir())
    total = packet_size + external.stat().st_size
    # Enough for the packet alone, insufficient for the combined capture.
    monkeypatch.setattr(packet_io.shutil, 'disk_usage', lambda path: SimpleNamespace(free=packet_size + packet_io.SNAPSHOT_MARGIN))
    def forbidden(**options):
        pytest.fail('The external archive must be budgeted before creating diagnostics')
    monkeypatch.setattr(packet_io.tempfile, 'mkdtemp', forbidden)
    with pytest.raises(recovery.RecoveryError, match=f'needed {total + packet_io.SNAPSHOT_MARGIN} bytes'):
        recovery.verify_packet(packet['backup'], packet['root'], 'native', [packet['settings']], archive=external)


@pytest.mark.parametrize('consumer', ['packet', 'file'])
def test_direct_snapshot_helpers_check_capacity_before_creating_outputs(packet, tmp_path, monkeypatch, consumer):
    from types import SimpleNamespace
    from server_tools.lib import database_recovery_packet_io as packet_io

    create_packet(packet)
    key = recovery.packet_key(packet['root'], 'native', [packet['settings']])
    target = tmp_path / 'never-created'
    monkeypatch.setattr(packet_io.shutil, 'disk_usage', lambda path: SimpleNamespace(free=0))
    with pytest.raises(recovery.RecoveryError, match='TMPDIR'):
        if consumer == 'packet':
            packet_io.snapshot_packet(packet['backup'], target, key)
        else:
            packet_io.snapshot_file(packet['backup'] / recovery.SETTINGS, target, key)
    assert not target.exists()


def test_retained_evidence_is_bounded_and_named_dump_cannot_masquerade_as_metadata(packet, tmp_path, monkeypatch):
    from server_tools.lib import database_recovery_packet_io as packet_io

    create_packet(packet)
    key = recovery.packet_key(packet['root'], 'native', [packet['settings']])
    location = tmp_path / 'temporary-space'
    location.mkdir(mode=0o700)
    monkeypatch.setattr(packet_io.tempfile, 'gettempdir', lambda: str(location))
    with pytest.raises(RuntimeError):
        with packet_io.private_diagnostics('probe', packet=packet['backup'], key=key) as logs:
            evidence = packet_io.snapshot_packet(packet['backup'], logs / 'packet_snapshot', key)
            # Each synthetic byte below is checked before it reaches the capture.
            (evidence / recovery.RECORD).unlink()
            with recovery.private_file(evidence / recovery.RECORD, key=key) as output:
                output.write(b'{"dump":"manifest.txt"}')
            with recovery.private_file(evidence / 'manifest.txt', key=key) as output:
                output.write(b'large-payload-using-a-metadata-name')
            (evidence / recovery.ROLES).unlink()
            with recovery.private_file(evidence / recovery.ROLES, key=key) as output:
                output.write(b'x' * (packet_io.EVIDENCE_FILE_LIMIT + 1))
            for index in range(9):
                with recovery.private_file(logs / f'database-tool-{index}.log', key=key) as output:
                    output.write(b'x' * packet_io.EVIDENCE_FILE_LIMIT)
            raise RuntimeError('failed operation')
    [logs] = location.iterdir()
    retained = [path for path in logs.rglob('*') if path.is_file()]
    assert sum(path.stat().st_size for path in retained) <= packet_io.EVIDENCE_TOTAL_LIMIT
    assert all(path.stat().st_size <= packet_io.EVIDENCE_FILE_LIMIT for path in retained)
    assert (evidence / recovery.RECORD).is_file() and (evidence / recovery.PROPERTIES).is_file()
    assert not (evidence / 'manifest.txt').exists() and not (evidence / recovery.ROLES).exists()
    assert not any(path.name.endswith(('.dump', '.tar.gz')) for path in retained)


@pytest.mark.parametrize('growth', ['before-open', 'during-read'])
def test_snapshot_growth_cannot_exceed_the_checked_copy_budget(tmp_path, monkeypatch, growth):
    from server_tools.lib import database_recovery_packet_io as packet_io
    from server_tools.lib import recovery_key_safety as safety

    folder = tmp_path / 'packet'
    folder.mkdir(mode=0o700)
    source = folder / 'database.dump'
    source.write_bytes(b'PGDMP small fixture')
    source.chmod(0o600)
    target = tmp_path / 'snapshot'
    original_size = source.stat().st_size
    copied_sizes = []
    capture, read = packet_io._snapshot_file_at, safety.KeySafeReader.read
    def append():
        with source.open('ab') as output:
            output.write(b'x' * 100)
    if growth == 'before-open':
        def grow(descriptor, name, target, key):
            append()
            return capture(descriptor, name, target, key)
        monkeypatch.setattr(packet_io, '_snapshot_file_at', grow)
    else:
        def grow(reader, size=-1):
            if source.stat().st_size == original_size:
                append()
            chunk = read(reader, size)
            copied_sizes.append(size)
            return chunk
        monkeypatch.setattr(safety.KeySafeReader, 'read', grow)
    with pytest.raises(recovery.RecoveryError, match='grew'):
        packet_io.snapshot_packet(folder, target, None)
    assert not (target / source.name).exists()
    assert not copied_sizes or max(copied_sizes) == original_size + 1


@pytest.mark.parametrize('size', [100, 1024 * 1024 * 1024])
def test_snapshot_capacity_accepts_exact_margin_and_refuses_one_byte_less(tmp_path, monkeypatch, size):
    from types import SimpleNamespace
    from server_tools.lib import database_recovery_packet_io as packet_io

    needed = size + max(packet_io.SNAPSHOT_MARGIN, (size + 9) // 10)
    monkeypatch.setattr(packet_io.shutil, 'disk_usage', lambda path: SimpleNamespace(free=needed))
    packet_io.check_snapshot_space(tmp_path, size)
    monkeypatch.setattr(packet_io.shutil, 'disk_usage', lambda path: SimpleNamespace(free=needed - 1))
    with pytest.raises(recovery.RecoveryError, match=f'needed {needed} bytes'):
        packet_io.check_snapshot_space(tmp_path, size)


@pytest.mark.parametrize('whole_packet', ['native', 'docker'], indirect=True)
@pytest.mark.parametrize('commit_length', [40, 64])
def test_verifier_prints_only_authenticated_commit_and_keeps_progress_on_stderr(whole_packet, commit_length):
    packet = whole_packet
    manifest = packet['backup'] / update.MANIFEST
    manifest.write_text('profile=' + ('docker' if packet['profile'] == 'docker' else 'development')
                        + '\nsource_commit=' + 'c' * commit_length + '\n')
    (packet['backup'] / update.RECORD).unlink()
    update.seal_update(packet['backup'], packet['root'], packet['profile'], [packet['settings']])
    before = snapshot(packet['root'])
    result = subprocess.run([str(packet['root'] / 'filterest'), 'verify-update-backup', '--backup',
        str(packet['backup']), '--print-source-commit'], env=packet['environment'], capture_output=True, text=True)
    assert result.returncode == 0 and result.stdout == 'c' * commit_length + '\n', result.stderr
    assert '1/1' in result.stderr and 'Completed:' in result.stderr
    assert calls(packet) == [] and snapshot(packet['root']) == before


@pytest.mark.parametrize('replacement', ['source_commit=' + 'b' * 40 + '\n', 'invalid unsigned metadata\n'])
def test_exported_commit_uses_snapshot_when_original_manifest_changes_after_authentication(whole_packet, monkeypatch, replacement):
    packet = whole_packet
    verified = update._verify_update_snapshot
    def substitute(*args, **kwargs):
        record = verified(*args, **kwargs)
        (packet['backup'] / update.MANIFEST).write_text(replacement)
        return record
    monkeypatch.setattr(update, '_verify_update_snapshot', substitute)
    commit = update.verify_update(packet['backup'], packet['root'], packet['profile'], [packet['settings']], return_source_commit=True)
    assert commit == 'a' * 40
    assert (packet['backup'] / update.MANIFEST).read_text() == replacement


@pytest.mark.parametrize('whole_packet', ['docker'], indirect=True)
def test_readme_rollback_ignores_temporary_unsigned_manifest_substitution(whole_packet):
    packet = whole_packet
    # The real verifier runs before the shim substitutes an unsigned manifest.
    # Restore the signed bytes at stop, so later real captures authenticate too.
    authenticated = packet['tools'] / 'authenticated-manifest'
    authenticated.write_bytes((packet['backup'] / update.MANIFEST).read_bytes())
    launcher = packet['root'] / 'filterest'
    launcher.write_text(f'#!{sys.executable}\n' +
        'import os, pathlib, subprocess, sys\n'
        f'root = pathlib.Path({str(packet["root"])!r})\n'
        'os.environ["FILTEREST_PROJECT_ROOT_OVERRIDE"] = str(root)\n'
        f'manifest = pathlib.Path({str(packet["backup"] / update.MANIFEST)!r})\n'
        f'original = pathlib.Path({str(authenticated)!r})\n'
        'args = sys.argv[1:]\n'
        'if args[:2] == ["docker", "stop"]: manifest.write_bytes(original.read_bytes())\n'
        'result = subprocess.run([str(root / "app/filterest"), *args], capture_output=True)\n'
        'if args[0] == "verify-update-backup" and result.returncode == 0:\n'
        '    manifest.write_text("source_commit=" + "b" * 40 + "\\n")\n'
        'sys.stdout.buffer.write(result.stdout)\nsys.stderr.buffer.write(result.stderr)\n'
        'sys.exit(result.returncode)\n')
    git = packet['tools'] / 'git'
    git.write_text('#!/bin/sh\nif [ "$1 $2" = "reset --hard" ]; then printf "%s\\n" "$3" > selected-commit; fi\n')
    git.chmod(0o700)
    result = run_rollback(packet)
    assert result.returncode == 0, result.stdout + result.stderr
    assert (packet['root'] / 'selected-commit').read_text() == 'a' * 40 + '\n'
    assert (packet['backup'] / update.MANIFEST).read_bytes() == authenticated.read_bytes()


@pytest.mark.parametrize('extra', ['source_commit=unsigned\n', 'source_commit=' + 'b' * 40 + '\n'])
def test_selector_refuses_duplicate_manifest_fields_and_emits_no_commit(whole_packet, extra):
    packet = whole_packet
    manifest = packet['backup'] / update.MANIFEST
    manifest.write_text(manifest.read_text() + extra)
    result = run_update_packet(packet, 'verify', '--print-source-commit')
    assert result.returncode and result.stdout == '' and calls(packet) == []
    with pytest.raises(recovery.RecoveryError, match='one previous source commit'):
        update.verify_manifest(packet['backup'], packet['profile'])


@pytest.mark.parametrize('action', ['preflight', 'archive', 'manifest', 'seal', 'extract'])
def test_source_selector_is_verification_only(whole_packet, action):
    result = run_update_packet(whole_packet, action, '--print-source-commit',
        '--destination', str(whole_packet['root'] / 'backups/unused'))
    assert result.returncode == 2 and result.stdout == '' and result.stderr == 'unrecognized or invalid arguments; see --help\n'
