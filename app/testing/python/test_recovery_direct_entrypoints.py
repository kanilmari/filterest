"""test_recovery_direct_entrypoints.py: protect entrypoints without an ancestor.

Connect each real recovery launcher to missing and unreadable startup paths.
Keep command statuses and scan/fix diagnostics before real output files close.
"""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import select
import time

import pytest

from test_recovery_synchronous_diagnostics import copy_launchers

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
LIB = 'app/server_tools/lib/'
CTL = 'app/server_tools/ctl/'
ROUTES = [
    ('app/filterest', ('docker', 'restore-database'), 'app/server_tools/run_filterest_docker.sh', 'child'),
    ('app/filterest', ('update',), 'app/server_tools/update_filterest.sh', 'child'),
    ('app/filterest', ('ctl', '--backup'), 'app/ctl', 'child'),
    ('app/ctl', ('--backup',), CTL + 'ctl_main.sh', 'child'),
    ('filterest', ('docker', 'restore-database'), 'app/server_tools/run_filterest_docker.sh', 'child'),
    ('filterest', ('update',), 'app/server_tools/update_filterest.sh', 'child'),
    ('ctl', ('--backup',), CTL + 'ctl_main.sh', 'child'),
]
for entry, arguments, helpers in (
    ('app/filterest', ('update',), ('installation_records.sh', 'python_bytecode_cache.sh', 'project_python_venv.sh')),
    ('app/ctl', ('--backup',), ('installation_records.sh', 'filterest_port_preflight.sh', 'python_bytecode_cache.sh')),
    ('app/server_tools/run_filterest_docker.sh', ('restore-database',),
     ('installation_records.sh', 'database_dump_options.sh', 'docker_deployment_settings.sh')),
    ('app/server_tools/update_filterest.sh', ('--yes',),
     ('installation_records.sh', 'database_dump_options.sh', 'filterest_port_preflight.sh')),
    (CTL + 'ctl_main.sh', ('--backup',), ('installation_records.sh',)),
):
    ROUTES.extend((entry, arguments, LIB + helper, 'helper') for helper in helpers)
ROUTES += [(entry, ('--backup',), CTL + 'lib/resolve_env.sh', 'helper') for entry in ('app/ctl', CTL + 'ctl_main.sh')]
ROUTES += [(CTL + 'ctl_main.sh', ('--backup',), CTL + 'lib/' + helper, 'helper')
           for helper in ('env_permissions.sh', 'common.sh', 'local.sh', 'instance.sh')]


@pytest.mark.parametrize('entry,arguments,target,kind', ROUTES)
@pytest.mark.parametrize('damage', ('missing', 'unreadable'))
@pytest.mark.parametrize('overrides', (False, True))
def test_direct_and_root_startup_failures_keep_status_without_key_path(tmp_path, entry, arguments, target, kind, damage, overrides):
    root = tmp_path / ('installation-' + KEY.hex())
    root.mkdir()
    copy_launchers(root)
    keys = root / 'keys'
    keys.mkdir(mode=0o700)
    keyfile = keys / 'database_recovery.hmac.key'
    keyfile.write_text(KEY.hex() + '\n')
    keyfile.chmod(0o600)
    damaged = root / target
    if damage == 'missing':
        damaged.unlink()
    else:
        damaged.chmod(0)
        assert not os.access(damaged, os.R_OK), 'This proof requires an unprivileged test user'
    environment = dict(os.environ, FILTEREST_RECOVERY_OUTPUT='0', PYTHONDONTWRITEBYTECODE='1')
    for name in ('FILTEREST_ROOT', 'FILTEREST_PROJECT_ROOT_OVERRIDE'):
        environment.pop(name, None)
    if overrides:
        environment.update(FILTEREST_ROOT=str(root), FILTEREST_PROJECT_ROOT_OVERRIDE=str(root))
    stdout, stderr = root / 'stdout.log', root / 'stderr.log'
    with stdout.open('wb') as output, stderr.open('wb') as errors:
        result = subprocess.run(['/bin/bash', root / entry, *arguments], cwd='/tmp', env=environment,
            stdin=subprocess.DEVNULL, stdout=output, stderr=errors, timeout=30)
        content = stdout.read_bytes() + stderr.read_bytes()
    expected = (127 if damage == 'missing' else 126) if kind == 'child' else 1
    assert result.returncode == expected, (entry, target, content)
    assert content and KEY.hex().encode() not in content
    assert b'<redacted:' in content or b'sensitive details withheld' in content, content
    assert b'No such file or directory' in content or b'Permission denied' in content or b'diagnostic library unavailable' in content


@pytest.mark.parametrize('entry', ('filterest', 'app/filterest', 'ctl', 'app/ctl', CTL + 'ctl_main.sh'))
def test_every_legacy_restore_entrypoint_presents_prompt_before_answer(tmp_path, entry):
    root = tmp_path / 'installation'
    root.mkdir()
    copy_launchers(root)
    instance = root / 'instances/proof'
    instance.mkdir(parents=True)
    (instance / '.env').write_text('DB_NAME=fixture\nDB_ADMIN_USER=fixture\n')
    dump = root / 'fixture.sql'
    dump.write_text('SELECT 42;\n')
    arguments = ['ctl'] if entry.endswith('filterest') else []
    arguments += ['--instance', 'proof', '--restore', str(dump)]
    environment = dict(os.environ)
    for name in ('FILTEREST_ROOT', 'FILTEREST_PROJECT_ROOT_OVERRIDE', 'FILTEREST_RECOVERY_PROMPT_FD', 'EASELECT_RESTORE_CONFIRM'):
        environment.pop(name, None)
    master, slave = os.openpty()
    process = subprocess.Popen([str(root / entry), *arguments], stdin=slave,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=root, env=environment)
    os.close(slave)
    try:
        prompt = b''
        deadline = time.monotonic() + 15
        while b'Continue? (yes/no):' not in prompt and time.monotonic() < deadline:
            readable, _, _ = select.select([process.stderr], [], [], 0.2)
            if readable:
                chunk = os.read(process.stderr.fileno(), 4096)
                if not chunk:
                    break
                prompt += chunk
        assert b'Continue? (yes/no):' in prompt and process.poll() is None, prompt
        os.write(master, b'no\n')
        stdout, stderr = process.communicate(timeout=15)
        assert process.returncode == 0 and b'Cancelled.' in stdout
        assert b'Continue?' not in stdout and not stderr
    finally:
        os.close(master)
        if process.poll() is None:
            process.kill()
            process.communicate()
