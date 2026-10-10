"""Real recovery packets against the opt-in disposable Unix-socket PostgreSQL fixture.

Every SQL mutation belongs to this throwaway cluster. No installed DB is opened.
Proves retained originals, role grammar/MAC barriers, database properties and scope.
"""
import hashlib
import inspect
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile

import pytest

from server_tools.lib import database_recovery as recovery
from server_tools.lib import database_recovery_update as update
from server_tools.lib import recovery_archives as archives
from test_row_actor_support import cluster as disposable_cluster


@pytest.fixture
def cluster():
    generator = disposable_cluster.__wrapped__()
    try:
        try:
            runner = next(generator)
        except (pytest.fail.Exception, subprocess.CalledProcessError) as error:
            if any(reason in str(error) + str(getattr(error, 'stderr', '')) for reason in ('Operation not permitted', 'Permission denied')):
                pytest.skip('sandbox forbids disposable PostgreSQL Unix socket (real restore verification blocked)')
            raise
        yield runner
    finally:
        generator.close()


@pytest.fixture
def site(cluster, tmp_path, request):
    captured = inspect.getclosurevars(cluster).nonlocals
    root = tmp_path / 'site'
    profile = getattr(request, 'param', 'native')
    keys = root / ('keys' if profile == 'docker' else 'keys/filterest_runtime')
    keys.mkdir(parents=True, mode=0o700)
    settings = keys / ('docker.env' if profile == 'docker' else 'runtime_environment.env')
    settings.write_text(f'DB_HOST={captured["socket"]}\nDB_PORT=15483\nDB_NAME=site\n'
                        'DB_ADMIN_USER=site_admin\nDB_ADMIN_PASSWORD=test-admin-password\n'
                        'DB_READONLY_USER=site_reader\nDB_BASIC_USER=site_writer\n')
    settings.chmod(0o600)
    (root / 'app').mkdir()
    (root / 'data/runtime').mkdir(parents=True)
    (root / 'data/runtime/filterest-setup-complete').write_text('profile=development\n')
    (root / 'ctl').write_text('#!/bin/sh\nprintf stopped >> "' + str(root / 'stop.log') + '"\n')
    (root / 'ctl').chmod(0o700)
    folder = root / 'backups/packet'
    folder.mkdir(parents=True, mode=0o700)
    cluster("""CREATE ROLE site_admin LOGIN SUPERUSER PASSWORD 'test-admin-password';
      CREATE ROLE site_owner; CREATE ROLE site_reader LOGIN PASSWORD 'reader-password';
      CREATE ROLE site_writer; CREATE ROLE unrelated_app LOGIN PASSWORD 'other-verifier';
      GRANT site_reader TO site_writer;
      CREATE DATABASE site OWNER site_owner TEMPLATE template0;
      REVOKE CONNECT ON DATABASE site FROM PUBLIC;
      GRANT CONNECT ON DATABASE site TO site_reader WITH GRANT OPTION;
      ALTER DATABASE site CONNECTION LIMIT 35;
      ALTER DATABASE site SET search_path=public,pg_catalog;
      ALTER ROLE site_reader IN DATABASE site SET statement_timeout='17s';""")
    cluster("""SET ROLE site_owner;
      CREATE TABLE system_db_tables(id int); CREATE TABLE system_db_version(id int);
      CREATE TABLE system_functions(id int); CREATE TABLE system_group_table_func_rights(id int);
      CREATE TABLE payload(id int PRIMARY KEY, value text); INSERT INTO payload VALUES (1,'backup');
      GRANT SELECT ON payload TO site_reader; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO site_reader;""", 'site')
    environment = dict(os.environ, PATH=str(captured['pg_bin']) + ':' + os.environ['PATH'])
    if profile == 'docker':
        # Only the container transport is simulated: every dump/import/query uses real PG tools.
        tools = root / 'docker-transport'
        tools.mkdir()
        shim = tools / 'docker'
        shim.write_text(f'#!{sys.executable}\n' + '''import os, pathlib, sys
args = sys.argv[1:]
if 'stop' in args:
    pathlib.Path(os.environ['RECOVERY_STOP_LOG']).write_text('stopped')
else:
    command = args[args.index('exec') + 3:]
    os.execvpe(command[0], command, os.environ)
''')
        shim.chmod(0o700)
        environment.update(PATH=str(tools) + ':' + environment['PATH'], PGHOST=str(captured['socket']),
                           PGPORT='15483', POSTGRES_USER='site_admin', POSTGRES_PASSWORD='test-admin-password',
                           RECOVERY_STOP_LOG=str(root / 'stop.log'))
    def run(action, *arguments):
        return subprocess.run([sys.executable, recovery.__file__, action, '--root', str(root), '--profile', profile,
            '--settings', str(settings), *arguments], env=environment, text=True, capture_output=True)
    def backup():
        result = run('backup', '--output', str(folder / 'database.dump'))
        assert result.returncode == 0, result.stdout + result.stderr
    def reader_connection(database):
        return subprocess.run([str(captured['pg_bin'] / 'psql'), '-X', '-h', str(captured['socket']),
            '-p', '15483', '-U', 'site_reader', '-d', database, '-c', 'SELECT 1'], text=True, capture_output=True)
    return dict(root=root, folder=folder, settings=settings, cluster=cluster, run=run, backup=backup,
                profile=profile, reader_connection=reader_connection)


def restore(site, *arguments):
    return site['run']('restore', '--backup', str(site['folder']), '--yes', *arguments)


@pytest.mark.parametrize('site', ['native', 'docker'], indirect=True)
def test_replacement_preserves_original_data_and_backup_database_properties_and_role_scope(site):
    sql = site['cluster']
    before = sql((recovery.LIBRARY / 'instance_restore_properties.sql').read_text() + "SELECT pg_temp.database_snapshot('site');").stdout.strip()
    unrelated = sql("SELECT rolpassword FROM pg_authid WHERE rolname='unrelated_app'").stdout
    bootstrap = sql("SELECT to_jsonb(r) FROM pg_authid r WHERE oid=10").stdout
    site['backup']()
    roles = (site['folder'] / recovery.ROLES).read_text()
    assert 'unrelated_app' not in roles
    assert not any(line.startswith(('CREATE ROLE ', 'ALTER ROLE ')) and names == ['test_owner']
                   for line, names in recovery.role_lines(roles))
    assert 'site_owner' in roles and 'site_reader TO site_writer' in roles
    sql("UPDATE payload SET value='live-after-backup'", 'site')
    sql("ALTER DATABASE site OWNER TO site_admin; GRANT CONNECT ON DATABASE site TO PUBLIC; "
        "ALTER DATABASE site CONNECTION LIMIT 7; ALTER DATABASE site RESET ALL; ALTER ROLE site_reader IN DATABASE site RESET ALL")
    result = restore(site)
    assert result.returncode == 0, result.stdout + result.stderr
    assert sql('SELECT value FROM payload', 'site').stdout.strip() == 'backup'
    after = sql((recovery.LIBRARY / 'instance_restore_properties.sql').read_text() + "SELECT pg_temp.database_snapshot('site');").stdout.strip()
    assert json.loads(after) == json.loads(before)
    kept = sql("SELECT datname FROM pg_database WHERE datname LIKE 'site_before_restore_%'").stdout.strip()
    assert kept and kept in result.stdout and 'dropdb --force' in result.stdout
    # Retained databases disable new connections; re-enable only in this test fixture.
    sql(f'ALTER DATABASE "{kept}" ALLOW_CONNECTIONS true')
    assert sql('SELECT value FROM payload', kept).stdout.strip() == 'live-after-backup'
    assert sql("SELECT rolpassword FROM pg_authid WHERE rolname='unrelated_app'").stdout == unrelated
    assert sql("SELECT to_jsonb(r) FROM pg_authid r WHERE oid=10").stdout == bootstrap
    assert sql("SELECT has_table_privilege('site_reader','payload','SELECT')", 'site').stdout.strip() == 't'
    assert site['reader_connection']('site').returncode == 0


def test_real_data_restore_failure_after_create_keeps_original(site, tmp_path):
    sql = site['cluster']
    tablespace = tmp_path / 'tablespace'
    tablespace.mkdir()
    sql(f"CREATE TABLESPACE missing_on_restore LOCATION '{tablespace}'")
    sql('ALTER TABLE payload SET TABLESPACE missing_on_restore', 'site')
    site['backup']()
    # A genuine authenticated archive passes --list, but its tablespace cannot be replayed.
    sql('ALTER TABLE payload SET TABLESPACE pg_default', 'site')
    sql('DROP TABLESPACE missing_on_restore')
    sql("UPDATE payload SET value='must-survive'", 'site')
    packet_bytes = {path.name: path.read_bytes() for path in site['folder'].iterdir()}
    result = restore(site)
    assert result.returncode != 0
    assert 'Restore into replacement' in result.stderr and 'private diagnostic log' in result.stderr
    assert sql('SELECT value FROM payload', 'site').stdout.strip() == 'must-survive'
    assert sql("SELECT count(*) FROM pg_database WHERE datname LIKE 'site_restore_%'").stdout.strip() == '1'
    assert sql("SELECT count(*) FROM pg_database WHERE datname LIKE 'site_before_restore_%'").stdout.strip() == '0'
    replacement = sql("SELECT datname FROM pg_database WHERE datname LIKE 'site_restore_%' AND datconnlimit=0").stdout.strip()
    assert replacement and site['reader_connection'](replacement).returncode != 0
    assert site['root'].joinpath('stop.log').exists()
    logs = Path(re.search(r'Private restore diagnostics \(0700\): (.+)', result.stdout)[1])
    assert logs.stat().st_mode & 0o777 == 0o700
    assert any('missing_on_restore' in p.read_text() for p in logs.glob('database-tool-*.log'))
    evidence = logs / 'packet_snapshot'
    assert not any(path.name.endswith(('.dump', '.tar.gz')) for path in logs.rglob('*'))
    for name in (recovery.RECORD, recovery.CHECKSUMS, recovery.ROLES, recovery.PROPERTIES):
        assert (evidence / name).read_bytes() == packet_bytes[name]
        assert (evidence / name).stat().st_mode & 0o777 == 0o600
    assert f'Original packet unchanged in its folder: {site["folder"]}' in result.stdout
    assert packet_bytes == {path.name: path.read_bytes() for path in site['folder'].iterdir()}


def rewrite_record(site, *, sign=False):
    folder = site['folder']
    record = json.loads((folder / recovery.RECORD).read_text())
    record['files'][recovery.ROLES] = hashlib.sha256((folder / recovery.ROLES).read_bytes()).hexdigest()
    (folder / recovery.CHECKSUMS).write_text(''.join(f'{record["files"][name]}  {name}\n' for name in sorted(record['files'])))
    if sign:
        record['mac'] = recovery.packet_mac(record, recovery.packet_key(site['root'], site['profile'], [site['settings']]))
    (folder / recovery.RECORD).write_bytes(recovery.canonical(record) + b'\n')


@pytest.mark.parametrize('attack', ["\\! touch /tmp/filterest-role-attack", "COPY (SELECT 1) TO PROGRAM 'true';",
    'CREATE ROLE sneaky; SELECT 1;', 'ALTER ROLE test_owner SUPERUSER;', 'SET session_authorization = test_owner;'])
@pytest.mark.parametrize('sign', [False, True])
def test_roles_sql_or_recomputed_checksums_cannot_execute_before_shutdown(site, attack, sign):
    site['backup']()
    path = site['folder'] / recovery.ROLES
    source = path.read_text()
    source = source.replace('-- PostgreSQL database cluster dump complete', attack + '\n-- PostgreSQL database cluster dump complete')
    path.write_text(source)
    rewrite_record(site, sign=sign)
    result = restore(site)
    assert result.returncode != 0
    if not sign:
        assert 'authentication failed' in result.stderr
    else:
        assert 'roles SQL' in result.stderr or 'cluster role' in result.stderr
    assert not site['root'].joinpath('stop.log').exists()
    assert site['cluster']('SELECT value FROM payload', 'site').stdout.strip() == 'backup'


@pytest.mark.parametrize('site', ['native', 'docker'], indirect=True)
@pytest.mark.parametrize('kind', ['format1', 'dump-only'])
def test_legacy_restore_requires_flag_and_profile_manifest(site, kind):
    site['backup']()
    folder = site['folder']
    record = json.loads((folder / recovery.RECORD).read_text())
    if kind == 'format1':
        record['format_version'] = 1
        record.pop('mac'); record['files'].pop(recovery.PROPERTIES)
        (folder / recovery.RECORD).write_text(json.dumps(record))
        (folder / recovery.CHECKSUMS).write_text(''.join(f'{record["files"][name]}  {name}\n' for name in sorted(record['files'])))
    else:
        for name in (recovery.RECORD, recovery.ROLES, recovery.PROPERTIES, recovery.SETTINGS, recovery.CHECKSUMS):
            (folder / name).unlink()
        renamed = folder.with_name('update_legacy')
        folder.rename(renamed)
        site['folder'] = folder = renamed
        (folder / 'manifest.txt').write_text('profile=' + ('docker' if site['profile'] == 'docker' else 'development') + '\n')
        (folder / 'manifest.txt').chmod(0o600)
    refused = restore(site)
    assert refused.returncode and '--legacy' in refused.stderr
    assert not site['root'].joinpath('stop.log').exists()
    site['cluster']("UPDATE payload SET value='live-after-backup'", 'site')
    site['cluster']('ALTER DATABASE site CONNECTION LIMIT 7')
    result = restore(site, '--legacy')
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'WARNING: UNAUTHENTICATED RESTORE' in result.stderr
    assert site['cluster']('SELECT value FROM payload', 'site').stdout.strip() == 'backup'
    assert site['cluster']("SELECT datconnlimit FROM pg_database WHERE datname='site'").stdout.strip() == '7'
    assert site['cluster']("SELECT count(*) FROM pg_database WHERE datname LIKE 'site_before_restore_%'").stdout.strip() == '1'


def test_old_native_manifest_without_profile_restores_successfully(site):
    site['backup']()
    folder = site['folder']
    for name in (recovery.RECORD, recovery.ROLES, recovery.PROPERTIES, recovery.SETTINGS, recovery.CHECKSUMS):
        (folder / name).unlink()
    renamed = folder.with_name('update_old_native')
    folder.rename(renamed)
    site['folder'] = folder = renamed
    (folder / 'manifest.txt').write_text('from_version=9.3.0\nto_version=9.3.1\nrelease_tag=v9.3.1\n'
                                        'release_commit=' + 'a' * 40 + '\ncreated_at=20261007T120000Z\n')
    (folder / 'manifest.txt').chmod(0o600)
    result = restore(site, '--legacy')
    assert result.returncode == 0, result.stdout + result.stderr
    assert site['cluster']('SELECT value FROM payload', 'site').stdout.strip() == 'backup'


@pytest.mark.parametrize('site', ['native', 'docker'], indirect=True)
def test_extension_default_version_difference_does_not_block_restore(site):
    sql = site['cluster']
    default = sql("SELECT default_version FROM pg_available_extensions WHERE name='pg_trgm'", 'site').stdout.strip()
    versions = sql("SELECT version FROM pg_available_extension_versions WHERE name='pg_trgm'", 'site').stdout.splitlines()
    if not default or '1.3' not in versions or default == '1.3':
        pytest.skip('pg_trgm 1.3 and a newer default are required to prove version drift')
    before = json.loads(sql(recovery.COUNTS_SQL, 'site').stdout)
    sql("CREATE EXTENSION pg_trgm VERSION '1.3'; CREATE TABLE extension_relation_probe(id int); "
        'ALTER EXTENSION pg_trgm ADD TABLE extension_relation_probe;', 'site')
    assert json.loads(sql(recovery.COUNTS_SQL, 'site').stdout) == before
    site['backup']()
    result = restore(site)
    assert result.returncode == 0, result.stdout + result.stderr
    assert sql("SELECT extversion FROM pg_extension WHERE extname='pg_trgm'", 'site').stdout.strip() == default
    assert json.loads(sql(recovery.COUNTS_SQL, 'site').stdout) == before


def test_database_acl_replay_accepts_a_raw_name_requiring_quotes(site):
    sql = site['cluster']
    def names(source):
        return source.replace(":'target'", "'site'").replace(":'replacement'", "'Site Restore'")
    sql(names((recovery.LIBRARY / 'instance_restore_create.sql').read_text()))
    sql('BEGIN;\n' + (recovery.LIBRARY / 'instance_restore_properties.sql').read_text()
        + (recovery.LIBRARY / 'instance_restore_acl.sql').read_text()
        + names((recovery.LIBRARY / 'instance_restore_settings.sql').read_text()) + '\nCOMMIT;')
    assert sql("SELECT has_database_privilege('site_reader','Site Restore','CONNECT')").stdout.strip() == 't'
    assert sql("SELECT datconnlimit FROM pg_database WHERE datname='Site Restore'").stdout.strip() == '0'


@pytest.mark.parametrize('shape', ['parameter-grant', 'backslash-name'])
@pytest.mark.parametrize('installation_role', [False, True])
def test_shared_cluster_role_shapes_are_omitted_or_refused_before_shutdown(site, shape, installation_role):
    sql = site['cluster']
    if shape == 'parameter-grant':
        name = 'site_reader' if installation_role else 'monitoring_tool'
        if not installation_role:
            sql('CREATE ROLE monitoring_tool;')
        sql(f'GRANT SET ON PARAMETER log_statement TO {name};')
    else:
        name = 'monitoring\\tool'
        sql('CREATE ROLE "monitoring\\tool";')
        if installation_role:
            sql('GRANT SELECT ON payload TO "monitoring\\tool";', 'site')
    before = sql("SELECT to_jsonb(r) FROM pg_authid r WHERE rolname='" + name + "'").stdout
    preflight = site['run']('preflight')
    assert not (site['root'] / 'stop.log').exists()
    if installation_role:
        assert preflight.returncode and 'roles SQL' in preflight.stderr
        refused = site['run']('backup', '--output', str(site['folder'] / 'database.dump'))
        assert refused.returncode and not (site['folder'] / recovery.RECORD).exists()
        assert not (site['root'] / 'stop.log').exists()
        assert sql('SELECT value FROM payload', 'site').stdout.strip() == 'backup'
    else:
        assert preflight.returncode == 0, preflight.stdout + preflight.stderr
        site['backup']()
        roles = (site['folder'] / recovery.ROLES).read_text()
        assert name not in roles and 'ON PARAMETER' not in roles
        sql("UPDATE payload SET value='after-backup'", 'site')
        result = restore(site)
        assert result.returncode == 0, result.stdout + result.stderr
        assert sql('SELECT value FROM payload', 'site').stdout.strip() == 'backup'
        assert name not in preflight.stdout + preflight.stderr + result.stdout + result.stderr
    assert sql("SELECT to_jsonb(r) FROM pg_authid r WHERE rolname='" + name + "'").stdout == before


def complete_update_packet(site, *, relocated=False):
    """Seal real database artifacts with settings/media and the rollback manifest."""
    assert not relocated or site['profile'] == 'native'
    site['backup']()
    root, folder = site['root'], site['folder']
    for name in ('storage', 'storage_deleted'):
        logical = root / 'data' / name
        if relocated:
            target = root.parent / ('external-' + name)
            target.mkdir()
            logical.symlink_to(target, target_is_directory=True)
        else:
            logical.mkdir()
        (logical / 'saved.txt').write_text('backed-up media')
    key = recovery.packet_key(root, site['profile'], [site['settings']])
    archives.create_archives(root, folder, key, site['profile'])
    (folder / 'manifest.txt').write_text('profile=' + ('docker' if site['profile'] == 'docker' else 'development') + '\nsource_commit=' + 'a' * 40 + '\n')
    (folder / 'manifest.txt').chmod(0o600)
    update.seal_update(folder, root, site['profile'], [site['settings']])


@pytest.mark.parametrize('site', ['native', 'docker'], indirect=True)
@pytest.mark.parametrize('damage', ['dump', 'archive', 'key'])
def test_whole_update_packet_refuses_before_shutdown_with_real_database_unchanged(site, damage):
    complete_update_packet(site)
    sql, root, folder = site['cluster'], site['root'], site['folder']
    sql("UPDATE payload SET value='must-survive'", 'site')
    if damage == 'key':
        (root / 'keys' / recovery.KEY).unlink()
    else:
        name = 'database.dump' if damage == 'dump' else 'storage.tar.gz'
        with (folder / name).open('ab') as target:
            target.write(b'edited packet')
    with pytest.raises(recovery.RecoveryError):
        update.verify_update(folder, root, site['profile'], [site['settings']])
    assert not (root / 'stop.log').exists()
    assert sql('SELECT value FROM payload', 'site').stdout.strip() == 'must-survive'
    assert sql("SELECT count(*) FROM pg_database WHERE datname LIKE 'site_restore_%'").stdout.strip() == '0'


@pytest.mark.parametrize('site,relocated', [('native', False), ('native', True), ('docker', False)], indirect=['site'])
def test_genuine_whole_update_verifies_stages_and_rolls_back_real_database(site, relocated):
    complete_update_packet(site, relocated=relocated)
    sql, root, folder = site['cluster'], site['root'], site['folder']
    record = update.verify_update(folder, root, site['profile'], [site['settings']])
    assert 'manifest.txt' in record['files'] and 'storage.tar.gz' in record['files']
    aside = root / 'backups/replaced'
    aside.mkdir(mode=0o700)
    destination = aside / 'restored'
    for name in ('storage', 'storage_deleted'):
        (root / 'data' / name / 'saved.txt').write_text('live-after-backup')
    update.extract_update(folder, root, site['profile'], [site['settings']], destination, restore_roots=True)
    for name in ('storage', 'storage_deleted'):
        assert (root / 'data' / name / 'saved.txt').read_text() == 'backed-up media'
        assert (aside / 'data' / name / 'saved.txt').read_text() == 'live-after-backup'
        assert (root / 'data' / name).is_symlink() == relocated
    for path in folder.glob('*.tar.gz'):
        with tarfile.open(path) as source:
            key = (root / 'keys' / recovery.KEY).read_bytes().strip()
            assert all(key not in source.extractfile(member).read() for member in source if member.isfile())
    sql("UPDATE payload SET value='live-after-backup'", 'site')
    result = restore(site)
    assert result.returncode == 0, result.stdout + result.stderr
    assert sql('SELECT value FROM payload', 'site').stdout.strip() == 'backup'
    assert (root / 'stop.log').exists()


@pytest.mark.parametrize('site,name', [('docker', name) for names in archives.ARCHIVE_ROOTS.values() for name in names] +
                         [('native', 'data/bootstrap')], indirect=['site'])
def test_lifecycle_root_links_refuse_before_shutdown_with_real_database_unchanged(site, name):
    complete_update_packet(site)
    sql, root, folder = site['cluster'], site['root'], site['folder']
    key = recovery.packet_key(root, site['profile'], [site['settings']])
    logical, target = root / name, root.parent / 'external-root'
    logical.mkdir(parents=True, exist_ok=True)
    logical.rename(target)
    logical.symlink_to(target, target_is_directory=True)
    reason = ('bootstrap state directory must not be a symbolic link' if name == 'data/bootstrap'
              else 'Docker installations keep these as real directories')
    sql("UPDATE payload SET value='must-survive'", 'site')
    with pytest.raises(recovery.RecoveryError, match=reason) as error:
        archives.preflight_archives(root, key, site['profile'])
    assert str(logical) in str(error.value)
    if site['profile'] == 'docker':
        assert 'Docker installations keep these as real directories' in str(error.value)
    with pytest.raises(recovery.RecoveryError, match=reason):
        update.verify_update(folder, root, site['profile'], [site['settings']])
    result = restore(site)
    assert result.returncode and reason in result.stderr and str(logical) in result.stderr
    assert 'Traceback' not in result.stderr and not (root / 'stop.log').exists()
    assert sql('SELECT value FROM payload', 'site').stdout.strip() == 'must-survive'
    assert sql("SELECT count(*) FROM pg_database WHERE datname LIKE 'site_restore_%'").stdout.strip() == '0'
