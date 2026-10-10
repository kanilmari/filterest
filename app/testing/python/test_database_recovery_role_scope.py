"""test_database_recovery_role_scope.py: shared-cluster and round D regressions.

Connects recovery and the documented rollback with disposable fake installations.
Proves pre-shutdown refusal, omission of unrelated SQL, and diagnostic cleanup.
"""
from __future__ import annotations

import os
from pathlib import Path
import shlex
import stat
import subprocess
import sys
import tarfile
import zlib

import pytest

from server_tools.lib import database_recovery as recovery
from test_database_recovery import ROLE_SQL, calls, create_packet, packet, run_packet
from test_native_lifecycle_roots import build_update_fixture, git_output, run_update, update_backups
from test_database_recovery_update import whole_packet, documented_rollback_block


UNRELATED_SQL = {
    'parameter-grant': 'CREATE ROLE monitoring_tool;\nGRANT SET ON PARAMETER log_statement TO monitoring_tool;\n',
    'backslash-name': 'CREATE ROLE "monitoring\\tool";\nALTER ROLE "monitoring\\tool" WITH NOLOGIN;\n',
}


@pytest.mark.parametrize('shape', UNRELATED_SQL)
def test_unrelated_unsupported_roles_are_omitted_before_validation_and_never_echoed(packet, shape):
    raw = ROLE_SQL.replace('-- PostgreSQL database cluster dump complete',
                           UNRELATED_SQL[shape] + '-- PostgreSQL database cluster dump complete')
    changes = {'RECOVERY_TEST_ROLES': raw}
    preflight = run_packet(packet, 'preflight', changes=changes)
    assert preflight.returncode == 0, preflight.stderr
    assert not any(call['tool'] in ('ctl', 'pg_dump') for call in calls(packet))
    backup = run_packet(packet, 'backup', '--output', str(packet['backup'] / 'database.dump'), changes=changes)
    assert backup.returncode == 0, backup.stderr
    source = (packet['backup'] / recovery.ROLES).read_text()
    assert 'monitoring' not in source and 'ON PARAMETER' not in source
    recovery.validate_roles(packet['backup'] / recovery.ROLES,
                            allowed=['site_admin', 'readeronly', 'limited_user', 'basic_user', 'guest_user'])
    diagnostics = '\n'.join(path.read_text() for path in packet['backup'].glob('database-tool-*.log'))
    assert 'monitoring' not in preflight.stdout + preflight.stderr + backup.stdout + backup.stderr + diagnostics


@pytest.mark.parametrize('shape', ['parameter-grant', 'backslash-name'])
def test_unsupported_installation_role_sql_refuses_before_shutdown_and_export(packet, shape):
    unsupported = ('GRANT SET ON PARAMETER log_statement TO site_admin;\n' if shape == 'parameter-grant'
                   else 'CREATE ROLE "site\\role";\nALTER ROLE "site\\role" WITH NOLOGIN;\n')
    if shape == 'backslash-name':
        tool = packet['tools'] / 'psql'
        tool.write_text(tool.read_text().replace("'roles':[", "'roles':[" + repr('site\\role') + ','))
    raw = ROLE_SQL.replace('-- PostgreSQL database cluster dump complete',
                           unsupported + '-- PostgreSQL database cluster dump complete')
    refused = run_packet(packet, 'preflight', changes={'RECOVERY_TEST_ROLES': raw})
    assert refused.returncode and 'roles SQL' in refused.stderr
    assert [call['tool'] for call in calls(packet)] == ['psql', 'pg_dumpall']
    assert not (packet['backup'] / recovery.RECORD).exists()


@pytest.mark.parametrize('shape', ['parameter-grant', 'backslash-name'])
@pytest.mark.parametrize('profile', ['admin', 'development'])
def test_update_role_grammar_preflight_refuses_before_native_shutdown(tmp_path, shape, profile):
    fixture = build_update_fixture(tmp_path, profile)
    tool = tmp_path / 'bin/pg_dumpall'
    unsupported = ('GRANT SET ON PARAMETER log_statement TO native_admin;' if shape == 'parameter-grant'
                   else 'CREATE ROLE "native\\role";')
    if shape == 'backslash-name':
        query = tmp_path / 'bin/psql'
        query.write_text(query.read_text().replace("'roles':[", "'roles':[" + repr('native\\role') + ','))
    source = tool.read_text().replace('exit "${FILTEREST_TEST_ROLES_STATUS:-0}"',
                                     'printf \'%s\\n\' ' + shlex.quote(unsupported) + '\nexit "${FILTEREST_TEST_ROLES_STATUS:-0}"')
    tool.write_text(source)
    refused = run_update(fixture, '--yes')
    assert refused.returncode and 'roles SQL' in refused.stderr
    log = fixture['log'].read_text()
    assert 'ctl --stop' not in log and 'run_filterest_admin.sh stop' not in log and 'pg_dump ' not in log
    assert update_backups(fixture) == []
    assert git_output(fixture['checkout'], 'rev-parse', 'HEAD') == fixture['old_commit']


@pytest.mark.parametrize('action', ['verify', 'restore'])
@pytest.mark.parametrize('fail', [False, True])
def test_temporary_diagnostics_are_removed_on_success_and_announced_only_on_failure(packet, action, fail):
    create_packet(packet)
    temporary = packet['backup'].parent / 'diagnostics'
    temporary.mkdir(mode=0o700)
    changes = {'TMPDIR': str(temporary)}
    if fail:
        changes['RECOVERY_TEST_FAIL'] = 'pg_restore'
    result = run_packet(packet, action, '--backup', str(packet['backup']),
                        *(['--yes'] if action == 'restore' else []), changes=changes)
    folders = list(temporary.glob('filterest-database-*'))
    if fail:
        assert result.returncode and len(folders) == 1
        folder = folders[0]
        assert f'Private {action} diagnostics (0700): {folder}' in result.stdout
        assert stat.S_IMODE(folder.stat().st_mode) == 0o700
        assert any(folder.glob('database-tool-*.log'))
    else:
        assert result.returncode == 0, result.stderr
        assert folders == [] and 'diagnostics (0700):' not in result.stdout


def rollback_block():
    return documented_rollback_block()


@pytest.mark.parametrize('record,manifest', [(False, True), (True, False), (False, False)])
def test_documented_rollback_refuses_missing_records_before_stopping(tmp_path, record, manifest):
    folder = tmp_path / 'backups/update_fixture'
    folder.mkdir(parents=True, mode=0o700)
    if record:
        (folder / recovery.RECORD).write_text('{}')
    if manifest:
        (folder / 'manifest.txt').write_text('source_commit=' + 'a' * 40 + '\n')
    tool = tmp_path / 'filterest'
    helper = Path(recovery.__file__).with_name('database_recovery_update.py')
    tool.write_text('#!/bin/bash\n'
        'if [[ "$1" == verify-update-backup ]]; then\nshift\n'
        + 'exec ' + shlex.quote(sys.executable) + ' -B ' + shlex.quote(str(helper))
        + ' verify --root "$PWD" --profile native --settings "$PWD/keys/runtime.env" "$@"\nfi\n'
        'touch runtime-was-called\n')
    tool.chmod(0o700)
    script = rollback_block().replace('backups/<update folder>', 'backups/update_fixture')
    result = subprocess.run(['bash', '-c', script], cwd=tmp_path, text=True, capture_output=True)
    assert result.returncode and 'NOT completed:' in result.stderr
    assert not (tmp_path / 'runtime-was-called').exists()


@pytest.mark.parametrize('legacy', [False, True])
def test_documented_rollback_preserves_explicit_choice_and_reinstalls_separate_key(tmp_path, legacy):
    folder = tmp_path / 'backups/update_fixture'
    folder.mkdir(parents=True)
    (folder / 'manifest.txt').write_text('source_commit=' + 'a' * 40 + '\n')
    if not legacy:
        (folder / recovery.RECORD).write_text('{}')
    for name in ('keys', 'config', 'projects', 'data'):
        (tmp_path / name).mkdir()
    (tmp_path / 'keys' / recovery.KEY).write_text('separate-key')
    (tmp_path / 'keys' / recovery.KEY).chmod(0o600)
    tool = tmp_path / 'filterest'
    tool.write_text('#!/bin/bash\nprintf \'%s\\n\' "$*" >> calls.log\n'
        'if [[ "$1" == verify-update-backup ]]; then printf \'%s\\n\' ' + 'a' * 40 + '; fi\n'
        'if [[ "$1" == extract-update-backup ]]; then\n'
        '  while [[ $# -gt 0 ]]; do\n'
        '    if [[ "$1" == --destination ]]; then mkdir -p "$2/keys" "$2/config" "$2/projects"; break; fi\n'
        '    shift\n'
        '  done\nfi\n')
    tool.chmod(0o700)
    tools = tmp_path / 'bin'
    tools.mkdir()
    for name in ('docker', 'git'):
        executable = tools / name
        executable.write_text('#!/bin/bash\nexit 0\n')
        executable.chmod(0o700)
    script = rollback_block().replace('backups/<update folder>', 'backups/update_fixture')
    if legacy:
        script = script.replace('restore_options=()', 'restore_options=(--legacy)')
    # Use the documented old-Bash-safe array expansion in the actual rollback.
    assert '${restore_options[@]+"${restore_options[@]}"}' in script
    result = subprocess.run(['bash', '-c', script], cwd=tmp_path,
        env=dict(os.environ, PATH=str(tools) + ':' + os.environ['PATH']), text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    commands = (tmp_path / 'calls.log').read_text().splitlines()
    assert commands[0].startswith('verify-update-backup')
    assert commands[1] == 'docker stop'
    assert ('--legacy' in commands[0]) == legacy
    assert '--restore-roots' in next(line for line in commands if line.startswith('extract-update-backup'))
    restore = next(line for line in commands if line.startswith('restore-database'))
    assert ('--legacy' in restore) == legacy
    assert (tmp_path / 'keys' / recovery.KEY).read_text() == 'separate-key'
    assert stat.S_IMODE((tmp_path / 'keys' / recovery.KEY).stat().st_mode) == 0o600

# E5 probes use real authentication/role validators with an in-memory database.
# They reproduce the gate's read/validate and verify/reopen races without a key.
@pytest.mark.parametrize('race', ['roles-after-validation', 'dump-after-verification'])
def test_restore_consumes_authenticated_snapshot_at_both_gate_races(packet, monkeypatch, race, capsys):
    from types import SimpleNamespace
    import json

    create_packet(packet)
    folder = packet['backup']
    signed_roles = (folder / recovery.ROLES).read_text()
    signed_dump = (folder / 'database.dump').read_bytes()
    captured = {'sql': [], 'dump': None, 'snapshot': None}
    unsafe = "DO $$ BEGIN RAISE NOTICE 'unsigned-role-canary'; END $$;\n"
    validate = recovery.validate_roles
    validations = 0

    def validate_then_restore_path(path, **options):
        nonlocal validations
        validations += 1
        if race == 'roles-after-validation' and validations == 2:
            # Old code already captured unsafe SQL; its separate validator sees
            # the signed text, and its final recheck also sees the signed text.
            (folder / recovery.ROLES).write_text(signed_roles)
        return validate(path, **options)

    def scope(database):
        if race == 'roles-after-validation':
            (folder / recovery.ROLES).write_text(signed_roles + unsafe)
        return {'roles': ['site_admin', 'readeronly', 'limited_user', 'basic_user', 'guest_user'],
                'bootstrap': 'cluster_bootstrap'}

    class MemoryDatabase:
        def __init__(self, root, profile, paths, logs):
            self.key = recovery.packet_key(root, profile, paths)
            self.name, self.folder = 'site_database', logs

        def list_dump(self, path):
            captured['snapshot'] = path.parent
            captured['snapshot_modes'] = (stat.S_IMODE(path.parent.stat().st_mode),
                [stat.S_IMODE(p.stat().st_mode) for p in path.parent.iterdir()])
            assert path.read_bytes() == signed_dump

        def stop_application(self):
            pass

        def sql(self, sql, **options):
            captured['sql'].append(sql)
            if 'CREATE DATABASE' in sql and race == 'dump-after-verification':
                (folder / 'database.dump').write_bytes(b'PGDMP unsigned-dump-canary')
            return json.dumps({'relations': 9, 'functions': 2}) if sql == recovery.COUNTS_SQL else ''

        def command(self, *arguments, **options):
            return arguments

        def run(self, command, *, source):
            captured['dump'] = source.read()

        def removal_command(self, name):
            return 'inspect retained database'

    monkeypatch.setattr(recovery, 'Database', MemoryDatabase)
    monkeypatch.setattr(recovery, 'scoped_roles', scope)
    monkeypatch.setattr(recovery, 'validate_roles', validate_then_restore_path)
    args = SimpleNamespace(yes=True, backup=str(folder), profile='native', legacy=False,
                           allow_unauthenticated_restore=False)
    recovery.restore_backup(args, packet['root'], [packet['settings']], recovery.Outcome(['test'] * 7))
    assert captured['dump'] == signed_dump
    role_import = next(sql for sql in captured['sql'] if 'filterest_role_restore' in sql)
    assert 'unsigned-role-canary' not in role_import
    assert 'ALTER ROLE site_admin' in role_import
    assert captured['snapshot'] != folder
    assert captured['snapshot_modes'][0] == 0o700
    assert all(mode == 0o600 for mode in captured['snapshot_modes'][1])
    assert not captured['snapshot'].exists()
    assert 'Private restore diagnostics' not in capsys.readouterr().out


@pytest.mark.parametrize('consumer', ['restore', 'verify', 'verify-update', 'extract-update'])
def test_authenticated_consumers_never_reopen_original_packet(whole_packet, monkeypatch, consumer):
    from types import SimpleNamespace
    from server_tools.lib import database_recovery_update as update

    packet, folder = whole_packet, whole_packet['backup']
    for name, value in packet['environment'].items():
        monkeypatch.setenv(name, value)
    checked = recovery._verify_packet_snapshot
    check_update = update.authenticated_update_record
    original_open, original_os_open = Path.open, os.open
    authenticated = False

    def authenticate(*arguments, **options):
        nonlocal authenticated
        result = checked(*arguments, **options)
        authenticated = True
        return result

    def authenticate_update(*arguments, **options):
        nonlocal authenticated
        result = check_update(*arguments, **options)
        authenticated = True
        return result

    def guarded_open(path, *arguments, **options):
        if authenticated and (path == folder or folder in path.parents):
            pytest.fail('authenticated consumer reopened mutable packet path')
        return original_open(path, *arguments, **options)

    def guarded_descriptor(path, *arguments, **options):
        if authenticated and not isinstance(path, int):
            value = Path(path)
            if value == folder or folder in value.parents:
                pytest.fail('authenticated consumer reopened mutable packet descriptor')
        return original_os_open(path, *arguments, **options)

    monkeypatch.setattr(recovery, '_verify_packet_snapshot', authenticate)
    monkeypatch.setattr(update, 'authenticated_update_record', authenticate_update)
    monkeypatch.setattr(Path, 'open', guarded_open)
    monkeypatch.setattr(os, 'open', guarded_descriptor)
    if consumer == 'restore':
        args = SimpleNamespace(yes=True, backup=str(folder), profile='native', legacy=False,
                               allow_unauthenticated_restore=False)
        recovery.restore_backup(args, packet['root'], [packet['settings']], recovery.Outcome(['test'] * 7))
    elif consumer == 'verify':
        monkeypatch.setattr(sys, 'argv', [recovery.__file__, 'verify', '--root', str(packet['root']),
            '--profile', 'native', '--settings', str(packet['settings']), '--backup', str(folder)])
        assert recovery.main() == 0
    elif consumer == 'verify-update':
        update.verify_update(folder, packet['root'], 'native', [packet['settings']])
    else:
        update.extract_update(folder, packet['root'], 'native', [packet['settings']],
                              packet['root'] / 'backups/e5-stage')
    assert authenticated


@pytest.mark.parametrize('failure', [recovery.RecoveryError, OSError, ValueError, KeyError,
                                    TypeError, EOFError, tarfile.TarError, zlib.error])
def test_every_decorator_error_branch_redacts_reintroduced_key_paths(tmp_path, failure):
    from server_tools.lib import database_recovery_packet_io as packet_io

    key = bytes(range(32))
    path = tmp_path / ('prefix-' + key.hex().upper() + '-suffix')

    @packet_io.recovery_operation
    def refuse(path, key):
        if failure is OSError:
            raise OSError(13, 'permission denied', str(path / 'child'))
        raise failure(str(path))

    with pytest.raises(recovery.RecoveryError) as result:
        refuse(path, key)
    assert key.hex().upper() not in str(result.value)
    assert '<redacted: contains the recovery key>' in str(result.value)


@pytest.mark.parametrize('wrapper', ['regular-file', 'reader', 'root-oserror', 'root-error',
    'root-runtime', 'directory', 'descendant', 'archive', 'tool-missing', 'tool-failed', 'outcome', 'diagnostics'])
def test_all_path_diagnostic_wrappers_scan_final_text(tmp_path, monkeypatch, capsys, wrapper):
    import io
    from types import SimpleNamespace
    from server_tools.lib import database_recovery_packet_io as packet_io
    from server_tools.lib import recovery_archives as archives
    from server_tools.lib import recovery_key_safety as safety
    from server_tools.lib import database_recovery_tools as tools

    key = bytes(range(32))
    packet_io.diagnostic_key(key)
    path = tmp_path / ('secret-' + key.hex() + '-name')
    path.mkdir(mode=0o700)
    if wrapper == 'outcome':
        outcome = recovery.Outcome([str(path)])
        outcome.step(lambda: None)
        outcome.finish(str(path))
        outcome.fail(str(path))
        result = capsys.readouterr()
        text = result.out + result.err
    elif wrapper == 'diagnostics':
        monkeypatch.setattr(safety, 'private_temporary_path', lambda *arguments, **options: path)
        with pytest.raises(RuntimeError):
            with packet_io.private_diagnostics('probe'):
                raise RuntimeError('probe')
        text = capsys.readouterr().out
    else:
        with pytest.raises(recovery.RecoveryError) as result:
            if wrapper == 'regular-file':
                recovery.regular_file(path / (key.hex() + '.dump'))
            elif wrapper == 'reader':
                safety.KeySafeReader(io.BytesIO(key), key, path).read()
            elif wrapper.startswith('root-'):
                (path / 'keys').mkdir()
                def refuse(*arguments, **options):
                    error = {'root-oserror': OSError(13, 'denied', str(path)),
                             'root-error': recovery.RecoveryError(str(path)),
                             'root-runtime': RuntimeError(str(path))}[wrapper]
                    raise error
                monkeypatch.setattr(Path, 'resolve', refuse)
                archives.resolve_archive_root(path, 'keys')
            elif wrapper == 'directory':
                archives.directory_descriptor(path, key.hex())
            elif wrapper == 'descendant':
                descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    archives.descendant_descriptor(descriptor, key.hex())
                finally:
                    os.close(descriptor)
            elif wrapper == 'archive':
                archive = path / 'storage.tar.gz'
                with tarfile.open(archive, 'w:gz') as target:
                    member = tarfile.TarInfo('../outside')
                    member.size = 0
                    target.addfile(member)
                archive.chmod(0o600)
                archives.extract_archive(archive, tmp_path / 'destination', ('data/storage',), key=key)
            else:
                logs = tmp_path / 'logs'
                logs.mkdir(mode=0o700)
                descriptor = os.open(logs / 'safe.log', os.O_WRONLY | os.O_CREAT, 0o600)
                monkeypatch.setattr(tools, 'private_temporary_path', lambda *arguments, **options: (descriptor, str(path / 'tool.log')))
                def run(*arguments):
                    if wrapper == 'tool-missing':
                        raise FileNotFoundError(str(path))
                    return 1, b'', b''
                monkeypatch.setattr(tools, 'checked_tool_streams', run)
                tools.run_database_tool(SimpleNamespace(folder=logs, key=key, environment={}, hidden=[]), ['probe'])
        text = str(result.value)
    assert key.hex() not in text
    assert '<redacted: contains the recovery key>' in text


@pytest.mark.parametrize('case', range(22))
def test_all_representations_are_redacted_after_nested_path_wrappers(tmp_path, case, capsys):
    from test_recovery_archives_relocated_roots import REPRESENTATIONS, TEST_KEY
    from server_tools.lib import database_recovery_packet_io as packet_io
    from server_tools.lib.recovery_key_safety import KeyScanner

    label, payload = REPRESENTATIONS[case]
    path = 'safe/prefix-' + payload.decode('utf-8', errors='surrogateescape') + '-suffix/child'

    @packet_io.recovery_operation
    def inner(path, key):
        raise OSError(13, 'permission denied', path)

    @packet_io.recovery_operation
    def outer(path, key):
        return inner(path, key)

    with pytest.raises(recovery.RecoveryError) as result:
        outer(path, TEST_KEY)
    text = str(result.value)
    assert '<redacted: contains the recovery key>' in text, label
    assert 'safe/' in text and '/child' in text
    KeyScanner(TEST_KEY).check(text.encode('utf-8', errors='surrogateescape'))
    outcome = recovery.Outcome([path])
    outcome.step(lambda: None)
    outcome.finish(path)
    outcome.fail(str(result.value))
    output = capsys.readouterr()
    KeyScanner(TEST_KEY).check((output.out + output.err).encode('utf-8', errors='surrogateescape'))


@pytest.mark.parametrize('consumer', ['manifest', 'verify', 'verify-update', 'extract'])
def test_direct_packet_operations_refuse_key_folder_without_echo(packet, monkeypatch, consumer):
    from server_tools.lib import database_recovery_update as update
    from server_tools.lib import database_recovery_packet_io as packet_io

    create_packet(packet)
    key = recovery.packet_key(packet['root'], 'native', [packet['settings']])
    folder = packet['backup'].with_name(key.hex())
    packet['backup'].rename(folder)
    packet_io._diagnostic_key.set(None)  # Prove entry points load the key before refusal.
    with pytest.raises(recovery.RecoveryError) as result:
        if consumer == 'manifest':
            update.write_manifest(folder, packet['root'], 'native', [packet['settings']], b'profile=development\n')
        elif consumer == 'verify':
            recovery.verify_packet(folder, packet['root'], 'native', [packet['settings']])
        elif consumer == 'verify-update':
            update.verify_update(folder, packet['root'], 'native', [packet['settings']])
        else:
            update.extract_update(folder, packet['root'], 'native', [packet['settings']],
                                  packet['root'] / 'backups/staged')
    assert key.hex() not in str(result.value)
    assert '<redacted: contains the recovery key>' in str(result.value)


def test_restore_failure_keeps_and_announces_small_checked_snapshot_evidence(packet):
    create_packet(packet)
    result = run_packet(packet, 'restore', '--backup', str(packet['backup']), '--yes',
                        changes={'RECOVERY_TEST_FAIL_DATA': '1'})
    assert result.returncode
    logs = Path(result.stdout.split('Private restore diagnostics (0700): ', 1)[1].splitlines()[0])
    snapshot = logs / 'packet_snapshot'
    assert stat.S_IMODE(snapshot.stat().st_mode) == 0o700
    assert not (snapshot / 'database.dump').exists()
    assert not (snapshot / recovery.SETTINGS).exists()
    assert f'Original packet unchanged in its folder: {packet["backup"]}' in result.stdout
    assert any(logs.glob('database-tool-*.log'))
    for name in (recovery.ROLES, recovery.PROPERTIES, recovery.RECORD, recovery.CHECKSUMS):
        copied = snapshot / name
        assert copied.read_bytes() == (packet['backup'] / name).read_bytes()
        assert stat.S_IMODE(copied.stat().st_mode) == 0o600


@pytest.mark.parametrize('space', ['less-than-packet', 'less-than-margin', 'key-location'])
def test_restore_snapshot_space_refuses_before_any_write_or_shutdown(packet, monkeypatch, space):
    from types import SimpleNamespace
    from server_tools.lib import database_recovery_packet_io as packet_io

    create_packet(packet)
    packet['log'].unlink()
    original = {path.name: path.read_bytes() for path in packet['backup'].iterdir()}
    size = sum(map(len, original.values()))
    needed = size + max(packet_io.SNAPSHOT_MARGIN, (size + 9) // 10)
    key = recovery.packet_key(packet['root'], 'native', [packet['settings']])
    location = packet['root'] / (key.hex() if space == 'key-location' else 'chosen-temporary-folder')
    location.mkdir(mode=0o700)
    free = size - 1 if space == 'less-than-packet' else needed - 1
    checked = []
    def usage(path):
        checked.append(path)
        return SimpleNamespace(free=free)
    def forbidden(*arguments, **options):
        pytest.fail('Space refusal must precede private folder creation, copying and database tools')
    monkeypatch.setattr(packet_io.tempfile, 'gettempdir', lambda: str(location))
    monkeypatch.setattr(packet_io.shutil, 'disk_usage', usage)
    monkeypatch.setattr('server_tools.lib.recovery_key_safety.private_temporary_path', forbidden)
    monkeypatch.setattr(packet_io, '_snapshot_file_at', forbidden)
    monkeypatch.setattr(recovery, 'Database', forbidden)
    args = SimpleNamespace(yes=True, backup=str(packet['backup']), profile='native', legacy=False,
                           allow_unauthenticated_restore=False)
    with pytest.raises(recovery.RecoveryError) as result:
        recovery.restore_backup(args, packet['root'], [packet['settings']], recovery.Outcome(['test'] * 7))
    message = str(result.value)
    if space == 'key-location':
        assert 'authentication key' in message and key.hex() not in message
        assert checked == []  # Name refusal precedes even the space inspection.
    else:
        assert f'needed {needed} bytes' in message and f'free {free} bytes' in message
        assert 'TMPDIR' in message and 'no services stopped' in message and str(location) in message
        assert checked == [location]
    assert list(location.iterdir()) == []
    assert calls(packet) == []
    assert original == {path.name: path.read_bytes() for path in packet['backup'].iterdir()}


@pytest.mark.parametrize('failure', ['refusal', 'after-shutdown'])
def test_restore_drops_arbitrary_named_dump_and_archives_on_failure(packet, failure):
    import json

    create_packet(packet)
    folder = packet['backup']
    (folder / 'database.dump').rename(folder / 'payload-without-extension')
    record = json.loads((folder / recovery.RECORD).read_text())
    record['dump'] = 'payload-without-extension'
    record['files']['payload-without-extension'] = record['files'].pop('database.dump')
    key = recovery.packet_key(packet['root'], 'native', [packet['settings']])
    record['mac'] = recovery.packet_mac(record, key)
    (folder / recovery.RECORD).write_bytes(recovery.canonical(record))
    (folder / recovery.CHECKSUMS).write_text(''.join(f'{record["files"][name]}  {name}\n' for name in sorted(record['files'])))
    if failure == 'refusal':
        record['mac'] = '0' * 64
        (folder / recovery.RECORD).write_bytes(recovery.canonical(record))
    packet['log'].unlink()
    before = {path.name: path.read_bytes() for path in folder.iterdir()}
    result = run_packet(packet, 'restore', '--backup', str(folder), '--yes',
                        changes={'RECOVERY_TEST_FAIL_DATA': '1'} if failure == 'after-shutdown' else {})
    assert result.returncode
    logs = Path(result.stdout.split('Private restore diagnostics (0700): ', 1)[1].splitlines()[0])
    retained = {path.name for path in (logs / 'packet_snapshot').iterdir()}
    assert retained >= {recovery.RECORD, recovery.CHECKSUMS, recovery.ROLES, recovery.PROPERTIES}
    assert 'payload-without-extension' not in retained and recovery.SETTINGS not in retained
    assert before == {path.name: path.read_bytes() for path in folder.iterdir()}
    assert ('ctl' in [call['tool'] for call in calls(packet)]) == (failure == 'after-shutdown')


@pytest.mark.parametrize('artifact', ['database.dump', recovery.ROLES, recovery.PROPERTIES,
                                    recovery.SETTINGS, recovery.RECORD, recovery.CHECKSUMS])
def test_snapshot_capture_tampering_is_refused_before_shutdown(packet, monkeypatch, artifact):
    from types import SimpleNamespace
    from server_tools.lib import database_recovery_packet_io as packet_io

    create_packet(packet)
    packet['log'].unlink()
    for name, value in packet['environment'].items():
        monkeypatch.setenv(name, value)
    capture = packet_io._snapshot_file_at

    def swap_before_copy(descriptor, name, target, key):
        if name == artifact:
            (packet['backup'] / name).write_bytes(b'unsigned capture-canary')
        return capture(descriptor, name, target, key)

    monkeypatch.setattr(packet_io, '_snapshot_file_at', swap_before_copy)
    args = SimpleNamespace(yes=True, backup=str(packet['backup']), profile='native', legacy=False,
                           allow_unauthenticated_restore=False)
    with pytest.raises(recovery.RecoveryError):
        recovery.restore_backup(args, packet['root'], [packet['settings']], recovery.Outcome(['test'] * 7))
    assert calls(packet) == []


@pytest.mark.parametrize('consumer', ['verify', 'extract'])
def test_whole_update_uses_captured_archive_when_original_changes_after_authentication(whole_packet, monkeypatch, consumer):
    from server_tools.lib import database_recovery_update as update

    packet = whole_packet
    authenticate = update.authenticated_update_record
    def swap_original(*arguments, **options):
        result = authenticate(*arguments, **options)
        (packet['backup'] / 'storage.tar.gz').write_bytes(b'unsigned archive-canary')
        return result
    monkeypatch.setattr(update, 'authenticated_update_record', swap_original)
    if consumer == 'verify':
        assert update.verify_update(packet['backup'], packet['root'], 'native', [packet['settings']])
    else:
        destination = packet['root'] / 'backups/authenticated-stage'
        update.extract_update(packet['backup'], packet['root'], 'native', [packet['settings']], destination)
        assert (destination / 'data/storage/saved.txt').read_text() == 'backed-up storage'
