"""test_recovery_archives_relocated_roots.py: retain external disks during recovery.

Connects descriptor traversal with genuine README rollback and native transports.
Proves that only canonical archive roots may link, and failures precede shutdown.
"""
from __future__ import annotations

import base64
import hashlib
import gzip
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
from types import SimpleNamespace

import pytest

from server_tools.lib import database_recovery as recovery
from server_tools.lib import database_recovery_update as update
from server_tools.lib import recovery_archives as archives
from server_tools.lib import recovery_key_safety as key_safety
from test_database_recovery import run_packet, calls, create_packet
from test_database_recovery_update import (whole_packet, run_update_packet,
                                          snapshot, packet)
from test_native_lifecycle_roots import (build_update_fixture, run_update,
                                        update_backups, logged_calls)

ALL_ROOTS = tuple(name for roots in archives.ARCHIVE_ROOTS.values() for name in roots)
NATIVE_LINK_ROOTS = tuple(name for name in ALL_ROOTS if name != 'data/bootstrap')
MEDIA_ROOTS = ('data/storage', 'data/storage_deleted')


@pytest.mark.parametrize('whole_packet', [('native', NATIVE_LINK_ROOTS)], indirect=True)
def test_relocated_roots_archive_logical_paths_and_genuine_rollback_keeps_targets(whole_packet):
    fixture, root = whole_packet, whole_packet['root']
    targets = {name: (root / name).resolve() for name in NATIVE_LINK_ROOTS}
    key = recovery.packet_key(root, fixture['profile'], [fixture['settings']])
    archives.preflight_archives(root, key)
    assert set(archives.preflight_archives(root, key)) == set(ALL_ROOTS)
    for archive_name, names in archives.ARCHIVE_ROOTS.items():
        with tarfile.open(fixture['backup'] / archive_name) as source:
            assert all(name in source.getnames() for name in names)
            assert all(not member.issym() and not member.islnk() for member in source)
            assert not any(Path(name).name == recovery.KEY for name in source.getnames())
    for name in MEDIA_ROOTS:
        (root / name / 'saved.txt').write_text('new live files: ' + name)
    aside = root / 'backups/replaced-native'
    aside.mkdir(mode=0o700)
    result = run_update_packet(fixture, 'extract', '--destination', str(aside / 'restored'), '--restore-roots')
    assert result.returncode == 0, result.stdout + result.stderr
    result = run_packet(fixture, 'restore', '--backup', str(fixture['backup']), '--yes')
    assert result.returncode == 0, result.stdout + result.stderr
    assert not (root / 'data/bootstrap').is_symlink()
    for name in NATIVE_LINK_ROOTS:
        assert (root / name).is_symlink() and (root / name).resolve() == targets[name]
    for name in MEDIA_ROOTS:
        assert (targets[name] / 'saved.txt').read_text() == 'backed-up ' + Path(name).name
        assert (aside / name / 'saved.txt').read_text() == 'new live files: ' + name
    assert recovery.packet_key(root, fixture['profile'], [fixture['settings']]) == key
    assert not list(aside.rglob(recovery.KEY))
    for path in aside.rglob('*'):
        if path.is_file():
            key_safety.KeyScanner(key).check(path.read_bytes())
    assert any(call['tool'] == 'pg_restore' and '--list' not in call['arguments'] for call in calls(fixture))


@pytest.mark.parametrize('profile', ['admin', 'development'])
@pytest.mark.parametrize('name', MEDIA_ROOTS)
def test_updater_accepts_relocated_roots_before_shutdown(tmp_path, profile, name):
    fixture = build_update_fixture(tmp_path, profile)
    root = fixture['checkout']
    logical = root / name
    logical.mkdir(parents=True, exist_ok=True)
    target = tmp_path / 'external-disk'
    logical.rename(target)
    logical.symlink_to(target, target_is_directory=True)
    result = run_update(fixture, '--yes')
    if profile == 'development':
        assert result.returncode != 0 and 'Recovery native source build refused' in result.stderr
        assert update_backups(fixture) == []
        assert not any(' --stop' in call or ' merge ' in call for call in logged_calls(fixture))
        # Prove relocated media through the supported archive interface while
        # the updater refuses before opaque compiler and runtime file writers.
        backup = root / 'backups/update_relocated_roots'
        backup.mkdir(parents=True, mode=0o700)
        result = subprocess.run([sys.executable, str(root / 'app/server_tools/lib/database_recovery_update.py'),
            'archive', '--root', str(root), '--profile', 'native', '--backup', str(backup),
            '--settings', str(root / 'keys/filterest_runtime/development_environment.env'),
            '--settings', str(root / 'keys/filterest_runtime/runtime_environment.env')],
            env=fixture['environment'], text=True, capture_output=True)
    assert result.returncode == 0, result.stdout + result.stderr
    [folder] = update_backups(fixture)
    with tarfile.open(folder / 'storage.tar.gz') as source:
        assert name in source.getnames()
    assert logical.is_symlink() and logical.resolve() == target


@pytest.mark.parametrize('profile,name', [('docker', name) for name in ALL_ROOTS] +
                         [(profile, 'data/bootstrap') for profile in ('admin', 'development')])
def test_lifecycle_root_links_refuse_updater_before_shutdown(tmp_path, profile, name):
    fixture = build_update_fixture(tmp_path, profile)
    root = fixture['checkout']
    logical, target = root / name, tmp_path / 'external-disk'
    logical.mkdir(parents=True, exist_ok=True)
    logical.rename(target)
    logical.symlink_to(target, target_is_directory=True)
    reason = ('bootstrap state directory must not be a symbolic link' if name == 'data/bootstrap'
              else 'Docker installations keep these as real directories')
    # The direct library and both CLI preflights must refuse before tool/shutdown calls.
    recovery_profile = 'docker' if profile == 'docker' else 'native'
    with pytest.raises(recovery.RecoveryError, match=reason) as error:
        archives.preflight_archives(root, b'x' * 32, recovery_profile)
    assert str(logical) in str(error.value)
    if profile == 'docker':
        assert 'Docker installations keep these as real directories' in str(error.value)
    result = run_update(fixture, '--yes')
    assert result.returncode and 'Traceback' not in result.stderr
    assert str(logical) in result.stderr and reason in result.stderr
    assert not any('stop app' in call or 'ctl --stop' in call or 'run_filterest_admin.sh stop' in call
                   for call in logged_calls(fixture))
    assert update_backups(fixture) == []
    assert logical.is_symlink() and logical.resolve() == target


@pytest.mark.parametrize('whole_packet', ['native', 'docker'], indirect=True)
def test_bootstrap_link_refuses_rollback_before_shutdown(whole_packet):
    fixture, root = whole_packet, whole_packet['root']
    logical, target = root / 'data/bootstrap', root.parent / 'external-bootstrap'
    logical.rename(target)
    logical.symlink_to(target, target_is_directory=True)
    before = snapshot(root)
    with pytest.raises(recovery.RecoveryError, match='bootstrap state directory must not be a symbolic link') as error:
        update.verify_update(fixture['backup'], root, fixture['profile'], [fixture['settings']])
    assert str(logical) in str(error.value)
    result = run_update_packet(fixture, 'verify')
    assert result.returncode and str(logical) in result.stderr and 'Traceback' not in result.stderr
    assert calls(fixture) == [] and snapshot(root) == before


@pytest.mark.parametrize('profile', ['admin', 'development'])
@pytest.mark.parametrize('damage', ['missing', 'file', 'keys', 'key-file', 'in-tree-link'])
def test_bad_relocated_roots_refuse_updater_before_shutdown(tmp_path, profile, damage):
    fixture = build_update_fixture(tmp_path, profile)
    root, name = fixture['checkout'], 'data/storage'
    logical = root / name
    target = tmp_path / 'external-disk'
    logical.rename(target)
    if damage == 'missing':
        logical.symlink_to(tmp_path / 'missing-target')
    elif damage == 'file':
        file_target = tmp_path / 'not-a-directory'
        file_target.write_text('regular file')
        logical.symlink_to(file_target)
    elif damage == 'keys':
        logical.symlink_to(root / 'keys')
    else:
        logical.symlink_to(target)
        if damage == 'key-file':
            (target / recovery.KEY).write_text('not even the current key')
        else:
            (target / 'in-tree-link').symlink_to(target / 'upload.txt')
    result = run_update(fixture, '--yes')
    assert result.returncode and 'Traceback' not in result.stderr
    assert 'storage' in result.stdout + result.stderr
    assert not any('stop app' in call or 'ctl --stop' in call or 'run_filterest_admin.sh stop' in call for call in logged_calls(fixture))
    assert update_backups(fixture) == []
    key = recovery.packet_key(root, 'native', [])
    with pytest.raises(recovery.RecoveryError) as error:
        archives.preflight_archives(root, key)
    assert 'storage' in str(error.value) or str(logical.resolve()) in str(error.value)


@pytest.mark.parametrize('name', NATIVE_LINK_ROOTS)
@pytest.mark.parametrize('damage', ['missing', 'file'])
def test_each_root_target_failure_is_a_recovery_error(tmp_path, name, damage):
    root = tmp_path / 'installation'
    logical = root / name
    logical.parent.mkdir(parents=True, exist_ok=True)
    target = tmp_path / 'target'
    if damage == 'file':
        target.write_text('regular file')
    logical.symlink_to(target)
    with pytest.raises(recovery.RecoveryError) as error:
        archives.preflight_archives(root, b'x' * 32)
    assert str(target) in str(error.value)
    assert ('No such file' if damage == 'missing' else 'Not a directory') in str(error.value)


@pytest.mark.parametrize('kind', ['symlink', 'hardlink', 'fifo', 'key-copy', 'decoded-key-copy'])
def test_unsafe_entries_below_relocated_root_are_refused(tmp_path, kind):
    root, target = tmp_path / 'installation', tmp_path / 'disk'
    (root / 'data').mkdir(parents=True)
    target.mkdir()
    (root / 'data/storage').symlink_to(target)
    key = b'a' * 32
    original, alias = target / 'original', target / 'alias'
    original.write_text('media')
    if kind == 'symlink':
        alias.symlink_to(original)
    elif kind == 'hardlink':
        os.link(original, alias)
    elif kind == 'fifo':
        os.mkfifo(alias)
    else:
        alias.write_bytes(key.hex().encode() if kind == 'key-copy' else key)
    folder = tmp_path / 'packet'
    folder.mkdir(mode=0o700)
    with pytest.raises(recovery.RecoveryError, match='data/storage'):
        archives.create_archives(root, folder, key)
    assert list(folder.iterdir()) == []


@pytest.mark.parametrize('bad_parent', [False, True])
def test_extraction_writes_through_root_link_and_refuses_descendant_links(tmp_path, bad_parent):
    root, target = tmp_path / 'installation', tmp_path / 'disk'
    (root / 'data').mkdir(parents=True)
    target.mkdir()
    (root / 'data/storage').symlink_to(target)
    if bad_parent:
        (target / 'nested').symlink_to(target, target_is_directory=True)
    archive = tmp_path / 'storage.tar.gz'
    with tarfile.open(archive, 'w:gz') as output:
        member = tarfile.TarInfo('data/storage/nested/file')
        member.size = 5
        output.addfile(member, io.BytesIO(b'media'))
    archive.chmod(0o600)
    if bad_parent:
        with pytest.raises(recovery.RecoveryError, match='nested'):
            archives.extract_archive(archive, root, ('data/storage',))
        assert not (target / 'file').exists()
    else:
        archives.extract_archive(archive, root, ('data/storage',))
        assert (target / 'nested/file').read_bytes() == b'media'
    assert (root / 'data/storage').is_symlink()


@pytest.mark.parametrize('operation', ['verify', 'extract'])
def test_corrupt_archives_raise_path_specific_recovery_error(tmp_path, operation):
    path = tmp_path / 'broken.tar.gz'
    path.write_bytes(b'broken tar')
    path.chmod(0o600)
    with pytest.raises(recovery.RecoveryError, match='broken.tar.gz'):
        if operation == 'verify':
            archives.verify_archive(path, ('data/storage',))
        else:
            archives.extract_archive(path, tmp_path, ('data/storage',))


@pytest.mark.parametrize('whole_packet', ['native'], indirect=True)
@pytest.mark.parametrize('damage', ['missing', 'file', 'descendant-link'])
def test_rollback_root_refusal_precedes_shutdown(whole_packet, damage):
    fixture, root = whole_packet, whole_packet['root']
    logical, target = root / 'data/storage', root.parent / 'disk'
    logical.rename(target)
    if damage == 'missing':
        logical.symlink_to(root.parent / 'missing-disk')
    elif damage == 'file':
        file_target = root.parent / 'file'
        file_target.write_text('file')
        logical.symlink_to(file_target)
    else:
        logical.symlink_to(target)
        (target / 'nested-link').symlink_to(target)
    before = snapshot(root)
    result = run_update_packet(fixture, 'verify')
    assert result.returncode and 'Traceback' not in result.stderr
    assert calls(fixture) == [] and snapshot(root) == before
    with pytest.raises(recovery.RecoveryError):
        update.verify_update(fixture['backup'], root, fixture['profile'], [fixture['settings']])


@pytest.mark.parametrize('name', NATIVE_LINK_ROOTS)
def test_root_target_must_be_owned_by_operator(tmp_path, monkeypatch, name):
    root, target = tmp_path / 'installation', tmp_path / 'disk'
    (root / name).parent.mkdir(parents=True, exist_ok=True)
    target.mkdir()
    (root / name).symlink_to(target)
    operator_uid = os.getuid()
    monkeypatch.setattr(archives.os, 'getuid', lambda: operator_uid + 1)
    with pytest.raises(recovery.RecoveryError, match='owned by the operator'):
        archives.preflight_archives(root, b'x' * 32)


@pytest.mark.parametrize('name', MEDIA_ROOTS)
@pytest.mark.parametrize('target_kind', ['keys', 'keys-subdirectory', 'key-file'])
def test_media_roots_cannot_resolve_into_keys_or_contain_key_file(tmp_path, name, target_kind):
    root, target = tmp_path / 'installation', tmp_path / 'disk'
    (root / 'keys/nested').mkdir(parents=True)
    (root / name).parent.mkdir(parents=True, exist_ok=True)
    if target_kind == 'key-file':
        target.mkdir()
        (target / recovery.KEY).write_text('unrelated contents')
    else:
        target = root / ('keys' if target_kind == 'keys' else 'keys/nested')
    (root / name).symlink_to(target)
    with pytest.raises(recovery.RecoveryError, match='keys/|contains the recovery authentication key file'):
        archives.preflight_archives(root, b'x' * 32)


def test_archive_keeps_resolved_root_when_root_link_changes_after_preflight(tmp_path, monkeypatch):
    root, target, substitute = tmp_path / 'installation', tmp_path / 'disk', tmp_path / 'substitute'
    (root / 'data').mkdir(parents=True)
    target.mkdir()
    substitute.mkdir()
    (target / 'saved').write_text('original root')
    (substitute / 'saved').write_text('substituted root')
    logical = root / 'data/storage'
    logical.symlink_to(target)
    folder = tmp_path / 'packet'
    folder.mkdir(mode=0o700)
    original_preflight = archives.preflight_archives
    def retarget_after_preflight(*arguments, **options):
        resolved = original_preflight(*arguments, **options)
        logical.unlink()
        logical.symlink_to(substitute)
        return resolved
    monkeypatch.setattr(archives, 'preflight_archives', retarget_after_preflight)
    archives.create_archives(root, folder, b'x' * 32)
    with tarfile.open(folder / 'storage.tar.gz') as source:
        assert source.extractfile('data/storage/saved').read() == b'original root'


def test_overlapping_root_targets_are_refused_before_restore(tmp_path):
    root, target = tmp_path / 'installation', tmp_path / 'disk'
    root.mkdir()
    target.mkdir()
    (root / 'config').symlink_to(target)
    (root / 'projects').symlink_to(target)
    with pytest.raises(recovery.RecoveryError, match='overlaps archive root'):
        archives.preflight_archives(root, b'x' * 32)


@pytest.mark.parametrize('folder', ['absent', 'link'])
def test_docker_settings_without_runtime_folder_record_an_absent_file(tmp_path, folder):
    root = tmp_path / 'installation'
    (root / 'keys').mkdir(parents=True, mode=0o700)
    settings = root / 'keys/docker.env'
    settings.write_text('DB_NAME=filterest\n')
    settings.chmod(0o600)
    if folder == 'link':
        elsewhere = tmp_path / 'elsewhere'
        elsewhere.mkdir()
        (root / 'keys/filterest_runtime').symlink_to(elsewhere, target_is_directory=True)
    paths = recovery.setting_paths(root, 'docker', [])
    if folder == 'absent':
        record = recovery.settings_record(root, paths)
        assert record['keys/filterest_runtime/runtime_environment.env'] is None
        assert record['keys/docker.env']
    else:
        with pytest.raises(recovery.RecoveryError, match='filterest_runtime'):
            recovery.settings_record(root, paths)


def test_native_settings_below_a_relocated_root_may_be_absent(tmp_path):
    root, target = tmp_path / 'installation', tmp_path / 'disk'
    root.mkdir()
    target.mkdir(mode=0o700)
    (root / 'keys').symlink_to(target)
    logical = root / 'keys/filterest_runtime/runtime_environment.env'
    assert archives.logical_settings_path(root, logical) == logical
    assert archives.logical_settings_path(root, target / 'filterest_runtime/runtime_environment.env') == logical


# Independent test encoders deliberately do not reuse the scanner's pattern list.
TEST_KEY = bytes(range(224, 256))


def representation_cases():
    cases = [('raw', TEST_KEY)]
    hexadecimal = TEST_KEY.hex()
    mixed = ''.join(letter.upper() if index % 2 else letter for index, letter in enumerate(hexadecimal))
    for label, text in [('lower', hexadecimal), ('upper', hexadecimal.upper()), ('mixed', mixed)]:
        cases.append(('hex-' + label, text.encode()))
        for encoding in ('utf-16le', 'utf-16be'):
            cases.append((encoding + '-' + label, text.encode(encoding)))
    for label, encoder in [('standard', base64.b64encode), ('urlsafe', base64.urlsafe_b64encode)]:
        for alignment in range(3):
            encoded = encoder(b'\x97' * alignment + TEST_KEY + b'\xae')
            for padding in (True, False):
                cases.append((f'base64-{label}-{alignment}-{padding}', encoded if padding else encoded.rstrip(b'=')))
    return cases


REPRESENTATIONS = representation_cases()
TEXT_REPRESENTATIONS = [(name, value.decode()) for name, value in REPRESENTATIONS if name.startswith(('hex-', 'base64-'))]


@pytest.mark.parametrize('label,payload', REPRESENTATIONS, ids=[name for name, _ in REPRESENTATIONS])
@pytest.mark.parametrize('chunk_size', [1, 7, 63, 128])
def test_all_key_representations_are_refused_across_chunk_boundaries(label, payload, chunk_size):
    content = io.BytesIO(b'prefix' + payload + b'suffix')
    reader = archives.KeySafeReader(content, TEST_KEY)
    with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
        while reader.read(chunk_size):
            pass


@pytest.mark.parametrize('label,payload', REPRESENTATIONS, ids=[name for name, _ in REPRESENTATIONS])
@pytest.mark.parametrize('kind', ['media', 'settings'])
def test_creation_and_verification_refuse_every_key_representation(tmp_path, label, payload, kind):
    root, folder = tmp_path / 'installation', tmp_path / 'packet'
    folder.mkdir(mode=0o700)
    member_name = 'data/storage/upload' if kind == 'media' else 'keys/runtime.env'
    path = root / member_name
    path.parent.mkdir(parents=True)
    path.write_bytes(b'prefix' + payload + b'suffix')
    path.chmod(0o600)
    archive_path = folder / 'unsafe.tar.gz'
    with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
        if kind == 'media':
            archives.create_archives(root, folder, TEST_KEY)
        else:
            archives.create_settings_archive(root, [path], archive_path, TEST_KEY)
    assert not (folder / 'storage.tar.gz').exists()
    archive_path.unlink(missing_ok=True)
    with tarfile.open(archive_path, 'w:gz') as output:
        member = tarfile.TarInfo(member_name)
        member.size = len(path.read_bytes())
        output.addfile(member, io.BytesIO(path.read_bytes()))
    archive_path.chmod(0o600)
    with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
        if kind == 'media':
            archives.verify_archive(archive_path, ('data/storage',), key=TEST_KEY)
        else:
            archives.verify_settings_archive(archive_path, {member_name: hashlib.sha256(path.read_bytes()).hexdigest()}, key=TEST_KEY)


@pytest.mark.parametrize('label,text', TEXT_REPRESENTATIONS, ids=[name for name, _ in TEXT_REPRESENTATIONS])
@pytest.mark.parametrize('kind', ['file', 'directory'])
def test_key_bearing_member_names_and_components_refuse_creation_and_verification(tmp_path, label, text, kind):
    root, folder = tmp_path / 'installation', tmp_path / 'packet'
    (root / 'data/storage').mkdir(parents=True)
    folder.mkdir(mode=0o700)
    member_name = 'data/storage/prefix-' + text + '-suffix' + ('/innocent' if kind == 'directory' else '')
    path = root / member_name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'innocent media')
    with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
        archives.create_archives(root, folder, TEST_KEY)
    assert list(folder.iterdir()) == []
    archive_path = folder / 'unsafe.tar.gz'
    with tarfile.open(archive_path, 'w:gz') as output:
        member = tarfile.TarInfo(member_name)
        member.size = 5
        output.addfile(member, io.BytesIO(b'media'))
    archive_path.chmod(0o600)
    with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
        archives.verify_archive(archive_path, ('data/storage',), key=TEST_KEY)
    destination = tmp_path / 'staging'
    destination.mkdir()
    with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
        archives.extract_archive(archive_path, destination, ('data/storage',), key=TEST_KEY)
    assert list(destination.iterdir()) == []


@pytest.mark.parametrize('timing', ['after-preflight', 'during-copy'])
def test_settings_changed_after_preflight_never_publish_authenticated_packet(packet, monkeypatch, timing):
    for name, value in packet['environment'].items():
        monkeypatch.setenv(name, value)
    root, settings, folder = packet['root'], packet['settings'], packet['backup']
    def inject_key():
        key = recovery.packet_key(root, 'native', [settings])
        original = settings.read_bytes()
        settings.write_bytes(original + b'\n# ' + key.hex().encode() + b'\n')
    if timing == 'after-preflight':
        original_preflight = recovery.backup_preflight
        def changed_preflight(*args, **kwargs):
            original_preflight(*args, **kwargs)
            inject_key()
        monkeypatch.setattr(recovery, 'backup_preflight', changed_preflight)
    else:
        original_addfile = tarfile.TarFile.addfile
        def changed_copy(archive, member, fileobj=None):
            if member.name == str(settings.relative_to(root)):
                # Keep the source size unchanged; the archive must scan its read.
                key = recovery.packet_key(root, 'native', [settings])
                settings.write_bytes(key.hex().encode() + b'x' * (member.size - 64))
            return original_addfile(archive, member, fileobj)
        monkeypatch.setattr(tarfile.TarFile, 'addfile', changed_copy)
    args = SimpleNamespace(output=str(folder / 'database.dump'), profile='native', dump_options=['--format=custom'])
    with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
        recovery.create_backup(args, root, [settings], recovery.Outcome(['Dump', 'Roles', 'Seal']))
    assert not (folder / recovery.RECORD).exists()
    assert all(path.name.startswith('database-tool-') for path in folder.iterdir())
    key = recovery.packet_key(root, 'native', [settings])
    for path in folder.iterdir():
        key_safety.KeyScanner(key).check(path.read_bytes())


@pytest.mark.parametrize('copy', ['retained', 'staged'])
def test_retention_and_staging_copy_refuse_post_preflight_key_bytes_and_names(tmp_path, copy):
    source, destination = tmp_path / 'source', tmp_path / 'destination'
    source.mkdir(); destination.mkdir()
    (source / 'innocent').write_bytes(TEST_KEY.hex().encode())
    source_fd, destination_fd = archives.directory_descriptor(source), archives.directory_descriptor(destination)
    try:
        with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
            archives.copy_tree(str(source), source_fd, destination_fd, key=TEST_KEY, omit_key=copy == 'retained')
        assert list(destination.iterdir()) == []
        (source / 'innocent').unlink()
        (source / TEST_KEY.hex()).write_bytes(b'innocent')
        with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
            archives.copy_tree(str(source), source_fd, destination_fd, key=TEST_KEY, omit_key=copy == 'retained')
        assert list(destination.iterdir()) == []
    finally:
        os.close(source_fd); os.close(destination_fd)


def test_settings_digests_describe_archived_bytes_after_a_safe_copy_time_edit(tmp_path, monkeypatch):
    root = tmp_path / 'installation'
    (root / 'keys').mkdir(parents=True)
    settings, archive_path = root / 'keys/runtime.env', tmp_path / 'settings.tar.gz'
    settings.write_bytes(b'original'); settings.chmod(0o600)
    original = tarfile.TarFile.addfile
    def edit(archive, member, fileobj=None):
        settings.write_bytes(b'archived')
        return original(archive, member, fileobj)
    monkeypatch.setattr(tarfile.TarFile, 'addfile', edit)
    record = archives.create_settings_archive(root, [settings], archive_path, TEST_KEY)
    assert record == {'keys/runtime.env': hashlib.sha256(b'archived').hexdigest()}
    archives.verify_settings_archive(archive_path, record, key=TEST_KEY)


@pytest.mark.parametrize('stream', ['stdout', 'stderr'])
@pytest.mark.parametrize('label,payload', REPRESENTATIONS, ids=[name for name, _ in REPRESENTATIONS])
def test_tool_streams_and_failure_diagnostics_never_retain_key(packet, stream, label, payload):
    key_path = packet['root'] / 'keys' / recovery.KEY
    key_path.write_text(TEST_KEY.hex() + '\n'); key_path.chmod(0o600)
    database = recovery.Database(packet['root'], 'native', [packet['settings']], packet['backup'])
    import sys
    database.environment['RECOVERY_KEY_STREAM'] = payload.hex()
    command = [sys.executable, '-c', 'import os; os.write(' + ('1' if stream == 'stdout' else '2') +
               ',bytes.fromhex(os.environ["RECOVERY_KEY_STREAM"]))']
    with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
        database.run(command)
    for path in packet['backup'].iterdir():
        key_safety.KeyScanner(TEST_KEY).check(path.read_bytes())


def test_manifest_refuses_key_before_writing_and_packet_filename_is_checked(packet):
    root, folder = packet['root'], packet['backup']
    key = recovery.packet_key(root, 'native', [packet['settings']], create=True)
    with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
        update.write_manifest(folder, root, 'native', [packet['settings']], b'profile=development\nimage=' + key.hex().encode())
    assert list(folder.iterdir()) == []
    result = run_packet(packet, 'backup', '--output', str(folder / (key.hex() + '.dump')))
    assert result.returncode and not (folder / recovery.RECORD).exists()


def test_signed_settings_packet_with_key_contents_is_refused(packet):
    create_packet(packet)
    root, folder = packet['root'], packet['backup']
    key = recovery.packet_key(root, 'native', [packet['settings']])
    record = json.loads((folder / recovery.RECORD).read_text())
    name = str(packet['settings'].relative_to(root))
    content = packet['settings'].read_bytes() + b'\n# ' + key.hex().upper().encode()
    with tarfile.open(folder / recovery.SETTINGS, 'w:gz') as archive:
        member = tarfile.TarInfo(name); member.size = len(content)
        archive.addfile(member, io.BytesIO(content))
    record['settings'][name] = hashlib.sha256(content).hexdigest()
    record['files'][recovery.SETTINGS] = recovery.digest(folder / recovery.SETTINGS)
    record['mac'] = recovery.packet_mac(record, key)
    (folder / recovery.RECORD).write_bytes(recovery.canonical(record))
    (folder / recovery.CHECKSUMS).write_text(''.join(f'{record["files"][name]}  {name}\n' for name in sorted(record['files'])))
    with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
        recovery.verify_packet(folder, root, 'native', [packet['settings']])


@pytest.mark.parametrize('label,text', TEXT_REPRESENTATIONS, ids=[name for name, _ in TEXT_REPRESENTATIONS])
def test_database_settings_member_names_use_the_same_representation_boundary(tmp_path, label, text):
    root = tmp_path / 'installation'
    path = root / ('keys/prefix-' + text + '-suffix.env')
    path.parent.mkdir(parents=True)
    path.write_bytes(b'ordinary protected settings'); path.chmod(0o600)
    archive_path = tmp_path / 'settings.tar.gz'
    with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
        archives.create_settings_archive(root, [path], archive_path, TEST_KEY)
    archive_path.unlink(missing_ok=True)
    name = path.relative_to(root).as_posix()
    with tarfile.open(archive_path, 'w:gz') as archive:
        member = tarfile.TarInfo(name); member.size = 8
        archive.addfile(member, io.BytesIO(b'settings'))
    archive_path.chmod(0o600)
    with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
        archives.verify_settings_archive(archive_path, {name: hashlib.sha256(b'settings').hexdigest()}, key=TEST_KEY)


@pytest.mark.parametrize('header', ['owner', 'pax'])
def test_key_in_archive_metadata_is_refused(tmp_path, header):
    path = tmp_path / 'archive.tar.gz'
    with tarfile.open(path, 'w:gz') as archive:
        member = tarfile.TarInfo('data/storage/safe')
        member.size = 5
        if header == 'owner':
            member.uname = TEST_KEY.hex().upper()
        else:
            member.pax_headers = {'comment': TEST_KEY.hex()}
        archive.addfile(member, io.BytesIO(b'media'))
    path.chmod(0o600)
    with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
        archives.verify_archive(path, ('data/storage',), key=TEST_KEY)


def test_rollback_refuses_a_staged_key_file_before_retaining_any_live_contents(tmp_path):
    root = tmp_path / 'installation'
    (root / 'keys').mkdir(parents=True)
    key_file = root / 'keys' / recovery.KEY
    key_file.write_text(TEST_KEY.hex() + '\n'); key_file.chmod(0o600)
    aside = root / 'backups/replaced'
    staging = aside / 'restored'
    (staging / 'keys').mkdir(parents=True)
    (staging / 'keys' / recovery.KEY).write_bytes(b'not even the active key')
    with pytest.raises(recovery.RecoveryError, match='Staging must not contain'):
        archives.restore_staged_roots(root, staging, TEST_KEY)
    assert key_file.read_text().strip() == TEST_KEY.hex()
    assert not (aside / 'keys').exists()


def test_extraction_destination_names_cannot_retain_key_text(tmp_path):
    archive = tmp_path / 'storage.tar.gz'
    with tarfile.open(archive, 'w:gz') as output:
        member = tarfile.TarInfo('data/storage/safe'); member.size = 5
        output.addfile(member, io.BytesIO(b'media'))
    archive.chmod(0o600)
    destination = tmp_path / TEST_KEY.hex()
    destination.mkdir()
    with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
        archives.extract_archive(archive, destination, ('data/storage',), key=TEST_KEY)
    assert list(destination.iterdir()) == []


@pytest.mark.parametrize('whole_packet', ['native', 'docker'], indirect=True)
def test_update_extraction_refuses_key_in_destination_component(whole_packet):
    fixture, root = whole_packet, whole_packet['root']
    key = recovery.packet_key(root, fixture['profile'], [fixture['settings']])
    destination = root / 'backups' / key.hex()
    with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
        update.extract_update(fixture['backup'], root, fixture['profile'], [fixture['settings']], destination)
    assert not destination.exists() and calls(fixture) == []


@pytest.mark.parametrize('extra', ['key-file', 'copied-key', 'key-name'])
def test_existing_packet_siblings_cannot_smuggle_the_key(packet, extra):
    create_packet(packet)
    key = recovery.packet_key(packet['root'], 'native', [packet['settings']])
    name = recovery.KEY if extra == 'key-file' else key.hex() if extra == 'key-name' else 'extra-diagnostic.log'
    path = packet['backup'] / name
    path.write_bytes(key.hex().encode() if extra == 'copied-key' else b'ordinary bytes')
    path.chmod(0o600)
    with pytest.raises(recovery.RecoveryError, match='authentication key'):
        recovery.verify_packet(packet['backup'], packet['root'], 'native', [packet['settings']])


def test_runner_only_cancellation_waits_for_helper_staging_cleanup(monkeypatch):
    import test_filterest_docker_runner as runner_fakes
    fixture = runner_fakes.FilterestDockerRunnerTests('test_dump_database_removes_its_partial_file_when_interrupted')
    fixture.setUp()
    try:
        # Reuse the existing cancellation proof, signalling only the shell PID.
        monkeypatch.setattr(runner_fakes.os, 'killpg', os.kill)
        fixture.test_dump_database_removes_its_partial_file_when_interrupted()
    finally:
        fixture.doCleanups()


@pytest.mark.parametrize('label,payload', REPRESENTATIONS, ids=[name for name, _ in REPRESENTATIONS])
@pytest.mark.parametrize('chunk_size', [1, 65536])
def test_temporary_archive_snapshot_refuses_decoded_key_before_copy(label, payload, chunk_size):
    # Split a representation across concatenated gzip members too.
    split = len(payload) // 2
    compressed = gzip.compress(b'prefix' + payload[:split]) + gzip.compress(payload[split:] + b'suffix')
    reader = key_safety.KeySafeGzipReader(io.BytesIO(compressed), TEST_KEY)
    copied = io.BytesIO()
    with pytest.raises(recovery.RecoveryError, match="authentication key's bytes"):
        while chunk := reader.read(chunk_size):
            copied.write(chunk)
    # The chunk completing a detected decoded representation was never copied.
    assert len(copied.getvalue()) < len(compressed)
