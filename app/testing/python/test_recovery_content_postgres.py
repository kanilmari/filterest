"""test_recovery_content_postgres.py: opt-in real database backup-content proof.

Connects the disposable PostgreSQL fixture with the actual control invocations.
Docker is only a transport shim; pg_dump, rows and large objects are real.
Binary-only representations use uncompressed custom large-object dump streams.
"""
import gzip
import inspect
import os
from pathlib import Path
import subprocess
import sys

import pytest

from test_database_recovery_postgres import cluster, site  # noqa: F401
from test_recovery_content_sinks import FORMS, KEY, SOURCE, baseline_writer, shell


@pytest.fixture
def legacy_site(site):
    root = site["root"]
    captured = inspect.getclosurevars(site["cluster"]).nonlocals
    directory = root / "instances/proof/backups"
    directory.mkdir(parents=True)
    (directory.parent / ".env").write_text("DB_ADMIN_USER=site_admin\nDB_NAME=site\n")
    key = root / "keys/database_recovery.hmac.key"
    key.write_text(KEY.hex() + "\n")
    key.chmod(0o600)
    tools = root / "transport"
    tools.mkdir()
    shim = tools / "docker"
    shim.write_text(f"#!{sys.executable}\n" + '''import os, pathlib, sys
args = sys.argv[1:]
if args[0] == 'ps':
    print('easelect-proof-db')
elif args[0] == 'exec':
    command = args[2:]
    if command[0] == 'pg_dump':
        if os.environ.get('E15_CAPTURE'):
            sys.stdout.buffer.write(pathlib.Path(os.environ['E15_CAPTURE']).read_bytes())
            sys.exit(int(os.environ.get('E15_STATUS', '0')))
        if os.environ.get('E15_BINARY_FORMAT') == '1':
            command = command[:-1] + ['--format=custom', '--compress=0', command[-1]]
    os.execvpe(command[0], command, os.environ)
else:
    sys.exit(1)
''')
    shim.chmod(0o700)
    environment = dict(os.environ, PATH=f'{tools}:{captured["pg_bin"]}:{os.environ["PATH"]}',
                       PGHOST=str(captured["socket"]), PGPORT="15483", PGPASSWORD="test-admin-password",
                       FILTEREST_PROJECT_ROOT_OVERRIDE=str(root), PYTHONDONTWRITEBYTECODE="1")
    def run(route, **extra):
        arguments = ["--instance", "proof", "--backup"] if route == "single" else ["--instance", "backup-all"]
        return subprocess.run(["/bin/bash", str(SOURCE / "server_tools/ctl/ctl_main.sh"), *arguments],
                              cwd=root, env=dict(environment, **extra), capture_output=True, timeout=60)
    return site, directory, environment, run


@pytest.mark.parametrize("route", ("single", "all"))
@pytest.mark.parametrize("form", FORMS)
def test_real_database_rows_and_large_objects_are_refused_across_dump_chunks(legacy_site, route, form):
    site, directory, environment, run = legacy_site
    value = FORMS[form]
    binary = form == "raw" or form.startswith("utf-16")
    if binary:
        # pg_dump emits bytea COPY data as hexadecimal. Large-object data is the
        # real row source that custom, uncompressed dumps can carry as raw bytes.
        # Custom dumps can frame large-object blocks. Measure the actual raw
        # byte offset and adjust the real object's prefix until the complete
        # representation crosses a scanner chunk without crossing dump framing.
        prefix = 131200
        for attempt in range(16):
            site["cluster"]("SELECT lo_unlink(70001) WHERE EXISTS (SELECT 1 FROM pg_largeobject_metadata WHERE oid=70001);"
                            "SELECT lo_from_bytea(70001,decode('" + (b"." * prefix + value).hex() + "','hex'));", "site")
            dumped = subprocess.run(["pg_dump", "-U", "site_admin", "--no-owner", "--no-privileges",
                                     "--format=custom", "--compress=0", "site"],
                                    env=environment, capture_output=True, check=True).stdout
            offset = dumped.index(value)
            midpoint = offset + len(value) // 2
            if midpoint % 65536 == 0:
                break
            # Correct to the closest boundary; crossing framing can add a few
            # bytes, which the next measured pass then corrects locally.
            prefix += (32768 - midpoint) % 65536 - 32768
        else:
            pytest.fail("Could not align the real binary dump representation across a scanner chunk")
        assert offset < midpoint < offset + len(value) and midpoint % 65536 == 0
        result = run(route, E15_BINARY_FORMAT="1")
    else:
        # Find the actual COPY value offset, then place the key across 64 KiB.
        dump = subprocess.run(["pg_dump", "-U", "site_admin", "--no-owner", "--no-privileges", "site"],
                              env=environment, capture_output=True, check=True).stdout
        offset = dump.index(b"1\tbackup\n") + 2
        prefix = 65536 - offset % 65536 - len(value) // 2
        site["cluster"]("UPDATE payload SET value='" + "." * prefix + value.decode() + "';", "site")
        result = run(route)
    assert result.returncode != 0, result.stdout + result.stderr
    assert not list(directory.iterdir())


@pytest.mark.parametrize("route", ("single", "all"))
def test_real_safe_database_backup_matches_original_writer_bytes(legacy_site, route):
    site, directory, environment, run = legacy_site
    dumped = subprocess.run(["pg_dump", "-U", "site_admin", "--no-owner", "--no-privileges", "site"],
                            env=environment, capture_output=True, check=True).stdout
    capture = site["root"] / "safe-real-dump.sql"
    capture.write_bytes(dumped)
    result = run(route, E15_CAPTURE=str(capture))
    assert result.returncode == 0, result.stdout + result.stderr
    backup = next(directory.glob("*.gz"))
    changed = backup.read_bytes()
    assert gzip.decompress(changed) == dumped
    reference = directory / "reference.gz"
    # Replay the baseline's actual function on this same real pg_dump stream;
    # newer PG patch releases may randomize psql restrict guards on each dump.
    script = baseline_writer() + '''
project_default_db_name() { printf site; }
load_instance_backup_policy_flags() { eval "$4=()"; }
append_default_instance_backup_exclusions() { :; }
docker() { cat "$2"; }
write_instance_database_backup proof "$1" site_admin site
'''
    script = script.replace('docker() { cat "$2"; }', 'docker() { cat ' + "'" + str(capture) + "'" + '; }')
    result = shell(site["root"], script, reference)
    assert result.returncode == 0, result.stdout + result.stderr
    assert reference.read_bytes() == changed


@pytest.mark.parametrize("route", ("single", "all"))
def test_real_dump_failure_leaves_no_complete_backup(legacy_site, route):
    site, directory, environment, run = legacy_site
    capture = site["root"] / "truncated.sql"
    capture.write_text("SELECT 42;\n")
    result = run(route, E15_CAPTURE=str(capture), E15_STATUS="23")
    assert result.returncode != 0 and not list(directory.iterdir())
