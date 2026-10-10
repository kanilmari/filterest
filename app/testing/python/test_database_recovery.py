"""Prove recovery ordering, credential binding and failure isolation with fakes.

No PostgreSQL or Docker service is contacted. The fake tools record arguments,
stream modes and synthetic role SQL in disposable installation directories.
"""

from __future__ import annotations

import errno
import hashlib
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
from installation_fixture_files import LIFECYCLE_LIBRARY_FILES
import test_filterest_docker_runner as docker_fakes
from test_native_lifecycle_roots import build_update_fixture, run_update, update_backups


HELPER = Path(recovery.__file__)
VERIFIER = "SCRAM-SHA-256$synthetic-verifier-never-log"
ROLE_SQL = (
    "-- PostgreSQL database cluster dump\nSET default_transaction_read_only = off;\nSET client_encoding = 'UTF8';\nSET standard_conforming_strings = on;\n"
    + "".join(f"CREATE ROLE {name};\nALTER ROLE {name} WITH LOGIN PASSWORD '{VERIFIER}';\n"
              for name in ("site_admin", "readeronly", "limited_user", "basic_user", "guest_user"))
    + "GRANT readeronly TO basic_user;\n-- PostgreSQL database cluster dump complete\n"
)


@pytest.fixture
def packet(tmp_path):
    root = tmp_path / "installation"
    keys = root / "keys/filterest_runtime"
    keys.mkdir(parents=True)
    settings = keys / "runtime_environment.env"
    settings.write_text("DB_ADMIN_USER=site_admin\nDB_ADMIN_PASSWORD=synthetic-login-secret\nDB_NAME=site_database\n")
    settings.chmod(0o600)
    development = keys / "development_environment.env"
    runtime = root / "data/runtime"
    runtime.mkdir(parents=True)
    (runtime / "filterest-setup-complete").write_text("profile=development\n")
    (root / "app").mkdir()
    backup = root / "backups/recovery"
    backup.mkdir(parents=True, mode=0o700)
    tools = tmp_path / "fake-bin"
    tools.mkdir()
    log = tmp_path / "tools.jsonl"
    imports = tmp_path / "roles-import.sql"
    script = f"#!{sys.executable}\n" + r'''
import json, os, pathlib, stat, sys
tool = pathlib.Path(sys.argv[0]).name
mode = stat.S_IMODE(os.fstat(1).st_mode) if tool in ('pg_dump', 'pg_dumpall') else None
source = sys.stdin.buffer.read() if tool in ('psql', 'pg_restore') else b''
phase = next((phase for marker, phase in [('filterest_role_restore','roles'),('CREATE DATABASE','create'),
    ('backup has no complete Filterest catalogue','catalogue'),('database settings verification differs','settings'),
    ('RENAME TO','swap')] if marker in source.decode()), 'read')
with open(os.environ['RECOVERY_TEST_LOG'], 'a') as log:
    log.write(json.dumps({'tool':tool, 'arguments':sys.argv[1:], 'mode':mode, 'phase':phase}) + '\n')
if os.environ.get('RECOVERY_TEST_FAIL') == tool or (os.environ.get('RECOVERY_TEST_FAIL_DATA') and tool == 'pg_restore' and '--list' not in sys.argv):
    print(os.environ['RECOVERY_TEST_VERIFIER'], file=sys.stderr)
    print(os.environ['RECOVERY_TEST_VERIFIER'])
    sys.exit(1)
if tool == 'pg_dump':
    sys.stdout.write('PGDMP synthetic archive with owners, ACL and default ACL')
elif tool == 'pg_dumpall':
    sys.stdout.write(os.environ['RECOVERY_TEST_ROLES'])
elif tool == 'psql':
    sql = source.decode()
    if 'WITH RECURSIVE roots' in sql:
        print(json.dumps({'roles':['site_admin','readeronly','limited_user','basic_user','guest_user'], 'bootstrap':'cluster_bootstrap'}))
    elif phase == 'settings':
        pathlib.Path(os.environ['RECOVERY_TEST_SETTINGS_IMPORT']).write_bytes(source)
    elif "SELECT pg_temp.database_snapshot(:'target')" in sql:
        print(json.dumps({'properties':{'datconnlimit':-1,'datallowconn':True}, 'owner':'site_admin', 'tablespace':'pg_default', 'acl':[],
            'settings':[{'role':None,'values':['filterest.restore_probe=private-setting-value']}]}))
    elif "SELECT jsonb_build_object('relations'" in sql:
        print(json.dumps({'relations':9, 'functions':2}))
    elif "SELECT format('ALTER ROLE %I PASSWORD" in sql:
        pass
    elif 'filterest_role_restore' in sql:
        pathlib.Path(os.environ['RECOVERY_TEST_IMPORT']).write_bytes(source)

'''
    for name in ("pg_dump", "pg_dumpall", "pg_restore", "psql", "dropdb", "createdb"):
        (tools / name).write_text(script)
        (tools / name).chmod(0o755)
    (root / "ctl").write_text(script)
    (root / "ctl").chmod(0o755)
    environment = dict(os.environ, PATH=f"{tools}:{os.environ['PATH']}",
                       RECOVERY_TEST_LOG=str(log), RECOVERY_TEST_IMPORT=str(imports),
                       RECOVERY_TEST_SETTINGS_IMPORT=str(tmp_path / 'settings-import.sql'),
                       RECOVERY_TEST_ROLES=ROLE_SQL, RECOVERY_TEST_VERIFIER=VERIFIER)
    return dict(root=root, settings=settings, development=development, backup=backup,
                tools=tools, log=log, imports=imports, environment=environment)


def run_packet(packet, action, *arguments, changes=None):
    environment = dict(packet["environment"], **(changes or {}))
    return subprocess.run(
        [sys.executable, str(HELPER), action, "--root", str(packet["root"]), "--profile", "native",
         "--settings", str(packet["development"]), "--settings", str(packet["settings"]), *arguments],
        env=environment, capture_output=True, text=True,
    )


def create_packet(packet):
    result = run_packet(packet, "backup", "--output", str(packet["backup"] / "database.dump"))
    assert result.returncode == 0, result.stderr
    return result


def calls(packet):
    return [json.loads(line) for line in packet["log"].read_text().splitlines()] if packet["log"].exists() else []


def test_backup_preserves_owners_roles_memberships_and_private_creation(packet):
    result = create_packet(packet)
    folder = packet["backup"]
    assert ROLE_SQL.split("-- PostgreSQL database cluster dump\n", 1)[1] in (folder / recovery.ROLES).read_text()
    record = json.loads((folder / recovery.RECORD).read_text())
    for name, expected in record["files"].items():
        assert hashlib.sha256((folder / name).read_bytes()).hexdigest() == expected
    assert all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in folder.iterdir())
    [dump] = [call for call in calls(packet) if call["tool"] == "pg_dump"]
    roles = [call for call in calls(packet) if call["tool"] == "pg_dumpall"]
    assert dump["arguments"] == ["--format=custom", "--dbname=site_database"]
    assert len(roles) == 2  # Preflight and the actual snapshot both check role SQL.
    assert all(call["arguments"] == ["--roles-only", "--no-role-passwords"] for call in roles)
    assert dump["mode"] == 0o600
    assert VERIFIER not in result.stdout + result.stderr + packet["log"].read_text()
    assert "synthetic-login-secret" not in result.stdout + result.stderr + packet["log"].read_text()
    with tarfile.open(folder / recovery.SETTINGS) as archive:
        assert archive.getmember("keys/filterest_runtime/runtime_environment.env").isfile()
        assert not any(Path(name).name == recovery.KEY for name in archive.getnames())
    assert not any(Path(name).name == recovery.KEY for name in record['settings'])
    assert recovery.key_path(packet['root'], 'native', [packet['settings']]) == packet['root'] / 'keys' / recovery.KEY


@pytest.mark.parametrize("failure", ["pg_dump", "pg_dumpall", "pg_restore"])
def test_failed_or_unreadable_export_never_publishes_a_packet(packet, failure):
    result = run_packet(packet, "backup", "--output", str(packet["backup"] / "database.dump"),
                        changes={"RECOVERY_TEST_FAIL": failure})
    assert result.returncode != 0
    assert "Completed:" not in result.stdout
    assert 'Traceback' not in result.stderr
    assert not (packet["backup"] / recovery.RECORD).exists()
    assert all(p.name.startswith("database-tool-") and stat.S_IMODE(p.stat().st_mode) == 0o600 for p in packet["backup"].iterdir())
    assert VERIFIER not in result.stdout + result.stderr


@pytest.mark.parametrize("roles", ["", "CREATE ROLE site_admin;\n"])
def test_empty_or_truncated_roles_export_never_publishes_a_packet(packet, roles):
    result = run_packet(packet, "backup", "--output", str(packet["backup"] / "database.dump"),
                        changes={"RECOVERY_TEST_ROLES": roles})
    assert result.returncode != 0
    assert not (packet["backup"] / recovery.RECORD).exists()
    assert all(p.name.startswith("database-tool-") and stat.S_IMODE(p.stat().st_mode) == 0o600 for p in packet["backup"].iterdir())


def test_restore_imports_roles_before_owner_and_privilege_preserving_data(packet):
    create_packet(packet)
    packet["log"].unlink()
    result = run_packet(packet, "restore", "--backup", str(packet["backup"]), "--yes")
    assert result.returncode == 0, result.stderr
    tools = [call["tool"] for call in calls(packet)]
    assert tools == ["pg_restore", "psql", "psql", "ctl", "psql", "psql", "pg_restore", "psql", "psql", "psql", "psql"]
    assert "dropdb" not in tools and "createdb" not in tools
    assert [c["phase"] for c in calls(packet) if c["phase"] != "read"] == ["roles","create","catalogue","settings","swap"]
    sql = packet["imports"].read_text()
    assert "IF NOT EXISTS" in sql and "CREATE ROLE site_admin" in sql
    assert f"ALTER ROLE site_admin WITH LOGIN PASSWORD '{VERIFIER}';" in sql
    assert "GRANT readeronly TO basic_user;" in sql
    data_arguments = next(call["arguments"] for call in calls(packet) if call["tool"] == "pg_restore" and "--list" not in call["arguments"])
    assert "--no-owner" not in data_arguments
    assert "--no-privileges" not in data_arguments
    assert "--exit-on-error" in data_arguments
    restored = next(call for call in calls(packet) if call["tool"] == "pg_restore" and "--list" not in call["arguments"])
    assert any(arg.startswith("--dbname=site_database_restore_") for arg in restored["arguments"])
    assert "--file=-" in next(call for call in calls(packet) if call["phase"] == "roles")["arguments"]
    assert VERIFIER not in result.stdout + result.stderr + packet["log"].read_text()


def test_old_backup_requires_explicit_legacy_and_matching_update_manifest(packet):
    folder = packet["backup"].with_name("update_legacy")
    packet["backup"].rename(folder)
    packet["backup"] = folder
    (folder / "database.dump").write_bytes(b"PGDMP legacy no-owner archive")
    (folder / "database.dump").chmod(0o600)
    (folder / "manifest.txt").write_text("profile=development\n")
    (folder / "manifest.txt").chmod(0o600)
    refused = run_packet(packet, "restore", "--backup", str(folder), "--yes")
    assert refused.returncode and "--legacy" in refused.stderr
    assert calls(packet) == []
    result = run_packet(packet, "restore", "--backup", str(folder), "--yes", "--legacy")
    assert result.returncode == 0, result.stderr
    assert "Legacy backup" in result.stdout
    data = next(call for call in calls(packet) if call["tool"] == "pg_restore" and "--list" not in call["arguments"])
    assert "--no-owner" in data["arguments"]
    assert not packet["imports"].exists()


@pytest.mark.parametrize("change", ["different-password", "additional-dev-settings", "missing-settings"])
def test_settings_mismatch_refuses_before_stopping_or_importing_then_matching_settings_restore(packet, change):
    create_packet(packet)
    packet["log"].unlink()
    if change == "different-password":
        packet["settings"].write_text(packet["settings"].read_text().replace("synthetic-login-secret", "different-secret"))
    elif change == "additional-dev-settings":
        packet["development"].write_text("DB_ADMIN_USER=another_admin\nDB_ADMIN_PASSWORD=another-secret\n")
    else:
        packet["settings"].unlink()
    result = run_packet(packet, "restore", "--backup", str(packet["backup"]), "--yes")
    assert result.returncode != 0
    assert calls(packet) == []
    assert not packet["imports"].exists()
    # Restore the installation's protected settings from the same packet.
    packet["development"].unlink(missing_ok=True)
    with tarfile.open(packet["backup"] / recovery.SETTINGS) as archive:
        with archive.extractfile("keys/filterest_runtime/runtime_environment.env") as content:
            packet["settings"].write_bytes(content.read())
    packet["settings"].chmod(0o600)
    restored = run_packet(packet, "restore", "--backup", str(packet["backup"]), "--yes")
    assert restored.returncode == 0, restored.stderr


@pytest.mark.parametrize("damage", ["dump", "roles", "checksum", "record", "snapshot", "partial", "manifest", "mode"])
def test_partial_tampered_or_unprotected_backup_never_restores_as_legacy(packet, damage):
    create_packet(packet)
    folder = packet["backup"]
    packet["log"].unlink()
    if damage == "dump":
        (folder / "database.dump").write_bytes(b"corrupt")
    elif damage == "roles":
        (folder / recovery.ROLES).unlink()
    elif damage == "checksum":
        (folder / recovery.CHECKSUMS).write_text("corrupt\n")
    elif damage == "record":
        (folder / recovery.RECORD).unlink()
    elif damage == "snapshot":
        (folder / recovery.SETTINGS).unlink()
    elif damage == "partial":
        (folder / (recovery.PARTIAL + "interrupted")).mkdir()
    elif damage == "mode":
        (folder / recovery.ROLES).chmod(0o644)
    else:
        new_folder = folder.with_name("update_incomplete")
        folder.rename(new_folder)
        folder = new_folder
    result = run_packet(packet, "restore", "--backup", str(folder), "--yes")
    assert result.returncode != 0
    assert calls(packet) == []
    assert "Completed:" not in result.stdout


@pytest.mark.parametrize("failure", ["ctl", "psql", "pg_restore"])
def test_restore_stops_at_first_failure_and_never_logs_secrets(packet, failure):
    create_packet(packet)
    packet["log"].unlink()
    result = run_packet(packet, "restore", "--backup", str(packet["backup"]), "--yes",
                        changes={"RECOVERY_TEST_FAIL": failure})
    assert result.returncode != 0
    assert calls(packet)[-1]["tool"] == failure
    assert VERIFIER not in result.stdout + result.stderr
    assert "Completed:" not in result.stdout
    assert 'Traceback' not in result.stderr


def test_role_creation_is_conditional_without_altering_verifiers_or_restrict_guards():
    source = '\\restrict fixture\nCREATE ROLE "owner\'s ""role""";\n' + ROLE_SQL + '\\unrestrict fixture\n'
    transformed = recovery.roles_for_import(source)
    assert "rolname = 'owner''s \"role\"'" in transformed
    assert VERIFIER in transformed
    assert "\\gexec" not in transformed
    assert transformed.startswith("\\restrict fixture\n")
    assert transformed.endswith("\\unrestrict fixture\n")


def test_exclusive_creation_refuses_existing_roles_or_a_symlink(packet):
    destination = packet["backup"] / recovery.ROLES
    destination.symlink_to(packet["settings"])
    original = packet["settings"].read_bytes()
    result = run_packet(packet, "backup", "--output", str(packet["backup"] / "database.dump"))
    assert result.returncode != 0
    assert "already exists" in result.stderr
    assert packet["settings"].read_bytes() == original
    assert calls(packet) == []


def test_settings_changes_during_export_cannot_mark_backup_complete(packet):
    tool = packet["tools"] / "pg_dumpall"
    with tool.open("a") as script:
        script.write("\nif any(json.loads(line)['tool'] == 'pg_dump' for line in pathlib.Path(os.environ['RECOVERY_TEST_LOG']).read_text().splitlines()):\n"
                     "    pathlib.Path(" + repr(str(packet["settings"])) + ").write_text('DB_ADMIN_PASSWORD=changed-during-export\\n')\n")
    result = run_packet(packet, "backup", "--output", str(packet["backup"] / "database.dump"))
    assert result.returncode != 0
    assert "Protected settings differ" in result.stderr
    assert not (packet["backup"] / recovery.RECORD).exists()
    assert all(p.name.startswith("database-tool-") and stat.S_IMODE(p.stat().st_mode) == 0o600 for p in packet["backup"].iterdir())


def test_settings_changed_during_stop_are_refused_before_role_passwords_change(packet):
    create_packet(packet)
    packet["log"].unlink()
    with (packet["root"] / "ctl").open("a") as script:
        script.write("\npathlib.Path(" + repr(str(packet["settings"])) + ").write_text('DB_ADMIN_PASSWORD=changed-during-stop\\n')\n")
    result = run_packet(packet, "restore", "--backup", str(packet["backup"]), "--yes")
    assert result.returncode != 0
    assert "Protected settings differ" in result.stderr
    assert [call["tool"] for call in calls(packet)] == ["pg_restore", "psql", "psql", "ctl"]
    assert not packet["imports"].exists()


def test_public_launcher_native_restores_the_packet(packet):
    create_packet(packet)
    source_root = HELPER.parents[2]
    app = packet["root"] / "app"
    for name in ("filterest", "go.mod", "VERSION_APP", "VERSION_DB",
                 "server_tools/run_filterest_docker.sh", "server_tools/lib/python_bytecode_cache.sh",
                 "server_tools/lib/project_python_venv.sh", *LIFECYCLE_LIBRARY_FILES):
        destination = app / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_root / name, destination)
    shutil.copy2(source_root.parent / "filterest", packet["root"] / "filterest")
    packet["log"].unlink()
    environment = {name: value for name, value in packet["environment"].items()
                   if not name.startswith(("FILTEREST_", "EASELECT_"))}
    result = subprocess.run([str(packet["root"] / "filterest"), "restore-database", "--backup",
                             str(packet["backup"]), "--yes"], env=environment, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    tools = [call["tool"] for call in calls(packet)]
    assert tools == ["pg_restore", "psql", "psql", "ctl", "psql", "psql", "pg_restore", "psql", "psql", "psql", "psql"]
    assert "dropdb" not in tools and "createdb" not in tools
    assert [c["phase"] for c in calls(packet) if c["phase"] != "read"] == ["roles","create","catalogue","settings","swap"]


@pytest.mark.parametrize("profile", ["docker", "admin", "development"])
def test_update_roles_failure_keeps_source_and_never_marks_backup_complete(tmp_path, profile):
    fixture = build_update_fixture(tmp_path, profile)
    result = run_update(fixture, "--yes", extra_environment={"FILTEREST_TEST_ROLES_STATUS": "1"})
    assert result.returncode != 0
    assert update_backups(fixture) == []
    assert not any('ctl --stop' in line or 'stop app' in line or 'run_filterest_admin.sh stop' in line
                   for line in fixture['log'].read_text().splitlines())
    assert "Backup created:" not in result.stdout
    assert "fake-role-verifier" not in result.stdout + result.stderr


def test_docker_restore_uses_one_ordered_log_and_allows_provider_changes(tmp_path):
    fixture = docker_fakes.FilterestDockerRunnerTests()
    fixture.setUp()
    try:
        fixture.run_runner("setup")
        container = fixture.root / "container-bin"
        container.mkdir()
        source = tmp_path / "fake-native"
        source.mkdir()
        # Reuse the same query-aware fake transport for native and Docker.
        script = f"#!{sys.executable}\n" + r'''
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
sql = sys.stdin.read() if name in ('psql', 'pg_restore') else ''
with open(os.environ['RECOVERY_ORDERED_LOG'], 'a') as log: log.write(('roles' if 'filterest_role_restore' in sql else name) + '\n')
if name == 'pg_dump': print('PGDMP fixture')
elif name == 'pg_dumpall': print('CREATE ROLE container_owner;\n-- PostgreSQL database cluster dump complete')
elif name == 'psql':
    if 'WITH RECURSIVE roots' in sql: print(json.dumps({'roles':['container_owner'], 'bootstrap':'cluster_bootstrap'}))
    elif "SELECT pg_temp.database_snapshot(:'target')" in sql: print('{"properties":{"datconnlimit":-1,"datallowconn":true},"owner":"docker_owner","tablespace":"pg_default","settings":[],"acl":[]}')
    elif "SELECT jsonb_build_object('relations'" in sql: print('{"relations":5,"functions":0}')
'''
        for name in ("pg_dump", "pg_dumpall", "psql", "pg_restore"):
            (container / name).write_text(script)
            (container / name).chmod(0o755)
        docker = fixture.root / "fake-bin/docker"
        # The fake Docker transport records stop in the SAME log as role/data tools.
        docker = next(path for path in fixture.root.rglob('docker') if path.is_file() and os.access(path, os.X_OK))
        content = docker.read_text().replace('    case "$*" in', '    if [ "$*" = "stop app" ]; then printf "stop\\n" >> "$RECOVERY_ORDERED_LOG"; fi\n    case "$*" in')
        docker.write_text(content)
        log = fixture.root / "ordered-log"
        environment = {"FILTEREST_DOCKER_TEST_CONTAINER_BIN": str(container), "RECOVERY_ORDERED_LOG": str(log)}
        backup = fixture.root / "backups/private"
        backup.mkdir(mode=0o700)
        fixture.run_update_action("dump-database", "--output", str(backup / "database.dump"), extra_environment=environment)
        log.unlink()
        runtime = fixture.root / 'keys/filterest_runtime/runtime_environment.env'
        runtime.write_text(runtime.read_text() + '\nOPENAI_API_KEY=changed-provider-key\n')
        result = fixture.run_update_action("restore-database", "--backup", str(backup), "--yes", extra_environment=environment)
        assert result.returncode == 0
        entries = log.read_text().splitlines()
        assert entries.index('stop') < entries.index('roles') < entries.index('pg_restore')
        assert 'changed-provider-key' not in result.stdout + result.stderr
        (fixture.root / 'keys' / recovery.KEY).unlink()
        restored_without_key = fixture.run_update_action('restore-database', '--backup', str(backup), '--yes',
            '--allow-unauthenticated-restore', extra_environment=environment)
        assert restored_without_key.returncode == 0, restored_without_key.stderr
        assert 'WARNING: UNAUTHENTICATED RESTORE' in restored_without_key.stderr
        invalid = fixture.run_update_action('status', '--allow-unauthenticated-restore', extra_environment=environment, check=False)
        assert invalid.returncode and 'applies only to restore-database' in invalid.stderr
    finally:
        fixture.doCleanups()


def test_data_restore_failure_occurs_after_replacement_creation(packet):
    create_packet(packet)
    packet['log'].unlink()
    result = run_packet(packet, 'restore', '--backup', str(packet['backup']), '--yes', changes={'RECOVERY_TEST_FAIL_DATA':'1'})
    assert result.returncode and 'original database retained' in result.stderr
    tools = [c['tool'] for c in calls(packet)]
    assert tools == ['pg_restore','psql','psql','ctl','psql','psql','pg_restore']
    assert 'private diagnostic log:' in result.stderr
    assert [c['phase'] for c in calls(packet) if c['phase'] != 'read'] == ['roles','create']
    logs = Path(result.stdout.split('Private restore diagnostics (0700): ', 1)[1].splitlines()[0])
    assert stat.S_IMODE(logs.stat().st_mode) == 0o700
    for path in logs.glob('database-tool-*.log'):
        assert VERIFIER not in path.read_text()
        assert stat.S_IMODE(path.stat().st_mode) == 0o600


@pytest.mark.parametrize('attack', ['\\! touch /tmp/canary', "COPY (SELECT 1) TO PROGRAM 'true';", 'CREATE ROLE evil; SELECT 1;', 'SET session_authorization = postgres;'])
def test_strict_role_grammar_refuses_commands_even_with_valid_mac(packet, attack):
    create_packet(packet)
    folder = packet['backup']
    record = json.loads((folder / recovery.RECORD).read_text())
    path = folder / recovery.ROLES
    path.write_text(path.read_text().replace('-- PostgreSQL database cluster dump complete', attack + '\n-- PostgreSQL database cluster dump complete'))
    record['files'][recovery.ROLES] = recovery.digest(path)
    record['mac'] = recovery.packet_mac(record, recovery.packet_key(packet['root'], 'native', [packet['development'], packet['settings']]))
    (folder / recovery.RECORD).write_bytes(recovery.canonical(record))
    (folder / recovery.CHECKSUMS).write_text(''.join(f'{record["files"][name]}  {name}\n' for name in sorted(record['files'])))
    packet['log'].unlink()
    result = run_packet(packet, 'restore', '--backup', str(folder), '--yes')
    assert result.returncode and 'roles SQL' in result.stderr
    assert calls(packet) == []


def test_recomputed_checksums_do_not_authenticate_a_tampered_packet(packet):
    create_packet(packet)
    folder = packet['backup']
    record = json.loads((folder / recovery.RECORD).read_text())
    (folder / recovery.ROLES).write_text((folder / recovery.ROLES).read_text().replace('WITH LOGIN', 'WITH NOLOGIN'))
    record['files'][recovery.ROLES] = recovery.digest(folder / recovery.ROLES)
    (folder / recovery.RECORD).write_bytes(recovery.canonical(record))
    (folder / recovery.CHECKSUMS).write_text(''.join(f'{record["files"][name]}  {name}\n' for name in sorted(record['files'])))
    packet['log'].unlink()
    result = run_packet(packet, 'restore', '--backup', str(folder), '--yes')
    assert result.returncode and 'authentication failed' in result.stderr
    assert calls(packet) == []


@pytest.mark.parametrize('error', [errno.EPERM, errno.EOPNOTSUPP, errno.EXDEV])
def test_exclusive_publication_falls_back_without_overwriting(tmp_path, monkeypatch, error):
    source, target = tmp_path / 'source', tmp_path / 'target'
    source.write_bytes(b'packet')
    def unsupported(*args): raise OSError(error, 'unsupported')
    monkeypatch.setattr(recovery.os, 'link', unsupported)
    recovery.publish_file(source, target)
    assert target.read_bytes() == b'packet' and stat.S_IMODE(target.stat().st_mode) == 0o600
    with pytest.raises(FileExistsError): recovery.publish_file(source, target)
    assert target.read_bytes() == b'packet'


def test_dump_refuses_public_destination_before_export(packet):
    packet['backup'].chmod(0o755)
    result = run_packet(packet, 'backup', '--output', str(packet['backup'] / 'database.dump'))
    assert result.returncode and '0700' in result.stderr
    assert calls(packet) == []


def test_scoped_role_export_excludes_bootstrap_and_unrelated_role_definitions(packet):
    unrelated = "CREATE ROLE unrelated;\nALTER ROLE unrelated WITH LOGIN PASSWORD 'other-app-verifier';\n"
    bootstrap = "CREATE ROLE cluster_bootstrap;\nALTER ROLE cluster_bootstrap WITH SUPERUSER PASSWORD 'bootstrap-verifier';\n"
    raw = ROLE_SQL.replace('-- PostgreSQL database cluster dump complete', unrelated + bootstrap +
        'GRANT pg_monitor TO site_admin;\n-- PostgreSQL database cluster dump complete')
    result = run_packet(packet, 'backup', '--output', str(packet['backup'] / 'database.dump'), changes={'RECOVERY_TEST_ROLES':raw})
    assert result.returncode == 0, result.stderr
    exported = (packet['backup'] / recovery.ROLES).read_text()
    assert 'unrelated' not in exported and 'cluster_bootstrap' not in exported
    assert 'other-app-verifier' not in exported and 'bootstrap-verifier' not in exported
    assert 'GRANT pg_monitor TO site_admin;' in exported
    assert '--no-role-passwords' in next(c['arguments'] for c in calls(packet) if c['tool'] == 'pg_dumpall')


@pytest.mark.parametrize('guards', ['missing', 'different', 'repeated', 'internal'])
def test_roles_require_exact_matching_outer_guards(packet, guards):
    source = '\\restrict key\n' + ROLE_SQL + '\\unrestrict key\n'
    if guards == 'missing': source = ROLE_SQL
    elif guards == 'different': source = source.replace('unrestrict key', 'unrestrict different')
    elif guards == 'repeated': source = source.replace('unrestrict key', 'restrict key\n\\unrestrict key')
    else: source = source.replace('\\restrict key\n', '').replace('GRANT readeronly', '\\restrict key\nGRANT readeronly')
    path = packet['backup'] / recovery.ROLES
    path.write_text(source); path.chmod(0o600)
    with pytest.raises(recovery.RecoveryError, match='guard'): recovery.validate_roles(path)


def test_unauthenticated_paired_packet_requires_explicit_legacy(packet):
    create_packet(packet)
    folder = packet['backup']
    record = json.loads((folder / recovery.RECORD).read_text())
    record['format_version'] = 1; record.pop('mac'); record['files'].pop(recovery.PROPERTIES)
    record['settings'] = recovery.settings_record(packet['root'], [packet['development'], packet['settings']])
    (folder / recovery.CHECKSUMS).write_text(''.join(f'{record["files"][name]}  {name}\n' for name in sorted(record['files'])))
    (folder / recovery.RECORD).write_bytes(recovery.canonical(record))
    packet['log'].unlink()
    refused = run_packet(packet, 'restore', '--backup', str(folder), '--yes')
    assert refused.returncode and '--legacy' in refused.stderr and calls(packet) == []
    restored = run_packet(packet, 'restore', '--backup', str(folder), '--yes', '--legacy')
    assert restored.returncode == 0, restored.stderr


@pytest.mark.parametrize('manifest', ['missing','wrong-profile','not-update-folder'])
def test_dump_only_legacy_cannot_restore_without_profile_manifest(packet, manifest):
    folder = packet['backup'].with_name('update_old' if manifest != 'not-update-folder' else 'arbitrary')
    packet['backup'].rename(folder)
    (folder / 'database.dump').write_bytes(b'PGDMP old dump'); (folder / 'database.dump').chmod(0o600)
    if manifest != 'missing':
        (folder / 'manifest.txt').write_text('profile=' + ('docker' if manifest == 'wrong-profile' else 'development') + '\n')
        (folder / 'manifest.txt').chmod(0o600)
    refused = run_packet(packet, 'restore', '--backup', str(folder), '--yes', '--legacy')
    assert refused.returncode and calls(packet) == []


def test_portability_refusal_happens_before_native_update_shutdown(tmp_path):
    fixture = build_update_fixture(tmp_path, 'development')
    root = fixture['checkout']
    outside = tmp_path / 'external-keys'
    outside.mkdir()
    shutil.move(root / 'keys/filterest_runtime', outside / 'filterest_runtime')
    (root / 'config').mkdir(exist_ok=True)
    (root / 'filterest.paths.local').write_text(f'schema_version=1\nkeys_home={outside}\n')
    refused = run_update(fixture, '--yes')
    assert refused.returncode and 'inside the installation folder' in refused.stderr
    assert not any('ctl --stop' in line for line in fixture['log'].read_text().splitlines())
    assert update_backups(fixture) == []


def test_restore_reads_a_readonly_packet_and_transmits_settings_only_in_stdin(packet):
    create_packet(packet)
    packet['log'].unlink()
    before = {path.name: path.read_bytes() for path in packet['backup'].iterdir()}
    packet['backup'].chmod(0o500)
    try:
        result = run_packet(packet, 'restore', '--backup', str(packet['backup']), '--yes')
        assert result.returncode == 0, result.stderr
        assert {path.name: path.read_bytes() for path in packet['backup'].iterdir()} == before
        assert 'private-setting-value' not in packet['log'].read_text() + result.stdout + result.stderr
        sql = Path(packet['environment']['RECOVERY_TEST_SETTINGS_IMPORT']).read_text()
        assert 'private-setting-value' in sql and 'CREATE TEMP TABLE restore_database_source' in sql
        data = next(c for c in calls(packet) if c['tool'] == 'pg_restore' and '--list' not in c['arguments'])
        name = next(a.split('=', 1)[1] for a in data['arguments'] if a.startswith('--dbname='))
        assert name == name.lower()
    finally:
        packet['backup'].chmod(0o700)


def test_missing_separate_key_requires_loud_unauthenticated_flag(packet):
    create_packet(packet)
    recovery.key_path(packet['root'], 'native', [packet['settings']]).unlink()
    packet['log'].unlink()
    refused = run_packet(packet, 'restore', '--backup', str(packet['backup']), '--yes')
    assert refused.returncode and calls(packet) == []
    refused_legacy = run_packet(packet, 'restore', '--backup', str(packet['backup']), '--yes', '--legacy')
    assert refused_legacy.returncode and calls(packet) == []
    restored = run_packet(packet, 'restore', '--backup', str(packet['backup']), '--yes', '--allow-unauthenticated-restore')
    assert restored.returncode == 0, restored.stderr
    assert 'WARNING: UNAUTHENTICATED RESTORE' in restored.stderr


@pytest.mark.parametrize('profile', ['docker', 'admin', 'development'])
def test_update_archives_never_include_the_authentication_key(tmp_path, profile):
    fixture = build_update_fixture(tmp_path, profile)
    root = fixture['checkout']
    for directory in ('keys/filterest_runtime', 'projects'):
        folder = root / directory
        folder.mkdir(parents=True, exist_ok=True)
        (folder / recovery.KEY).write_text('a' * 64 + '\n')
    result = run_update(fixture, '--yes')
    if profile == 'development':
        assert result.returncode != 0 and 'Recovery native source build refused' in result.stderr
        assert update_backups(fixture) == []
        # Native archive creation remains a supported direct recovery interface;
        # test that writer separately from the refused compiler/runner restart.
        backup = root / 'backups/update_content_proof'
        backup.mkdir(parents=True, mode=0o700)
        result = subprocess.run([sys.executable, str(root / 'app/server_tools/lib/database_recovery_update.py'),
            'archive', '--root', str(root), '--profile', 'native', '--backup', str(backup),
            '--settings', str(root / 'keys/filterest_runtime/development_environment.env'),
            '--settings', str(root / 'keys/filterest_runtime/runtime_environment.env')],
            env=fixture['environment'], text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    [backup] = update_backups(fixture)
    assert (root / 'keys' / recovery.KEY).is_file()
    for path in backup.glob('*.tar.gz'):
        with tarfile.open(path) as archive:
            assert not any(Path(name).name == recovery.KEY for name in archive.getnames()), path.name
            key = recovery.packet_key(root, 'docker' if profile == 'docker' else 'native', [])
            for member in archive:
                if member.isfile():
                    content = archive.extractfile(member).read()
                    assert key not in content and key.hex().encode() not in content, path.name


@pytest.mark.parametrize('profile', ['native', 'docker'])
def test_binding_tracks_database_access_but_ignores_docker_published_endpoint(packet, profile):
    settings = packet['settings']
    original = settings.read_text()
    before = recovery.settings_binding([settings], profile)
    settings.write_text(original + 'DB_POOL_MAX_OPEN_CONNS=123\nSESSION_LOG=1\nDB_BIND_HOST=127.0.0.2\n')
    assert recovery.settings_binding([settings], profile) == before
    settings.write_text(original + 'DB_PORT=6543\nDB_BIND_HOST=127.0.0.2\n')
    after = recovery.settings_binding([settings], profile)
    assert (after == before) == (profile == 'docker')
    settings.write_text(original.replace('synthetic-login-secret', 'changed-secret'))
    assert recovery.settings_binding([settings], profile) != before


def test_settings_archive_with_authentication_key_is_refused(packet):
    create_packet(packet)
    archive_path = packet['backup'] / 'unsafe.tar.gz'
    with tarfile.open(archive_path, 'w:gz') as archive:
        archive.add(packet['root'] / 'keys' / recovery.KEY, arcname='keys/' + recovery.KEY)
    archive_path.chmod(0o600)
    with pytest.raises(recovery.RecoveryError, match='authentication key'):
        recovery.verify_settings_archive(archive_path, {})


@pytest.mark.parametrize('layout', ['native', 'docker', 'incomplete'])
def test_old_native_manifest_without_profile_requires_native_update_layout(packet, layout):
    folder = packet['backup'].with_name('update_old_native')
    packet['backup'].rename(folder)
    (folder / 'database.dump').write_bytes(b'PGDMP old native dump')
    (folder / 'database.dump').chmod(0o600)
    manifest = 'from_version=9.3.0\nto_version=9.3.1\nrelease_tag=v9.3.1\nrelease_commit=' + 'a' * 40 + '\ncreated_at=20261007T120000Z\n'
    if layout == 'incomplete':
        manifest = manifest.replace('from_version=9.3.0\n', '')
    elif layout == 'docker':
        (folder / 'installation_settings.tar.gz').write_bytes(b'Docker update settings')
    (folder / 'manifest.txt').write_text(manifest)
    (folder / 'manifest.txt').chmod(0o600)
    result = run_packet(packet, 'restore', '--backup', str(folder), '--yes', '--legacy')
    if layout == 'native':
        assert result.returncode == 0, result.stderr
    else:
        assert result.returncode and calls(packet) == []


@pytest.mark.parametrize('entrypoint', ['database', 'update'])
@pytest.mark.parametrize('representation', ['raw', 'hex', 'base64', 'urlsafe', 'embedded-base64', 'utf16le-hex', 'utf16be-hex'])
@pytest.mark.parametrize('invalid', ['unknown-option', 'unknown-value', 'action', 'profile', 'missing-value', 'missing-required', 'help'])
def test_recovery_parsers_never_echo_values_before_loading_a_key(monkeypatch, capsys, entrypoint, representation, invalid):
    from recovery_operator_input_probes import KEY, form_value
    from server_tools.lib import database_recovery_update as update
    module = recovery if entrypoint == 'database' else update
    value = form_value(representation)
    action = 'verify'
    prefix = [value + '/program', action, '--root', '/installation', '--profile', 'native', '--backup', '/packet']
    arguments = {'unknown-option': prefix + ['--' + value], 'unknown-value': prefix + [value],
        'action': [value + '/program', value], 'profile': prefix[:5] + [value],
        'missing-value': prefix + ['--destination' if entrypoint == 'update' else '--output'],
        'missing-required': [value + '/program', action], 'help': [value + '/program', '--help', value]}[invalid]
    monkeypatch.setattr(sys, 'argv', arguments)
    def forbidden_key_load(*args):
        pytest.fail('Parsing must finish without loading a key')
    monkeypatch.setattr(recovery, 'prime_diagnostic_key', forbidden_key_load)
    with pytest.raises(SystemExit) as stopped:
        module.main()
    captured = capsys.readouterr()
    assert stopped.value.code == (0 if invalid == 'help' else 2)
    output = (captured.out + captured.err).encode('utf-8', errors='surrogateescape')
    assert KEY not in output and value.encode('utf-8', errors='surrogateescape') not in output
    if invalid != 'help':
        assert captured.out == '' and captured.err == 'unrecognized or invalid arguments; see --help\n'
    else:
        assert 'usage: Filterest recovery' in captured.out and captured.err == ''


def test_recovery_parser_usage_ignores_an_operator_program_name(capsys):
    parser = recovery.RecoveryArgumentParser(prog='operator-secret-value')
    parser.print_usage()
    assert capsys.readouterr().out == 'usage: Filterest recovery [-h]\n'


@pytest.mark.parametrize('representation', ['raw', 'hex', 'base64', 'urlsafe', 'embedded-base64', 'utf16le-hex', 'utf16be-hex'])
def test_recovery_subprocess_refuses_key_bearing_arguments_before_launch(monkeypatch, representation):
    from recovery_operator_input_probes import KEY, form_value
    from server_tools.lib import database_recovery_tools as transports
    def forbidden_launch(*args, **kwargs):
        pytest.fail('A key-bearing utility argument must never reach a child')
    monkeypatch.setattr(transports.subprocess, 'Popen', forbidden_launch)
    with pytest.raises(recovery.RecoveryError, match='authentication key'):
        transports.checked_tool_streams(['stat', '--', '--' + form_value(representation)], {}, None, None, KEY)
