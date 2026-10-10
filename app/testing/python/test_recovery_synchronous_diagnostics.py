"""Recovery explanations must be in real files when public commands return.

Connect real launchers and stateful shell helpers to deliberately slow scanners.
Use synthetic transports and disposable installations, never a daemon or DB.
"""
from __future__ import annotations

import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys

import pytest

from installation_fixture_files import LIFECYCLE_LIBRARY_FILES
import test_database_recovery as packets
import test_filterest_docker_runner as docker_fakes

ROOT = Path(__file__).resolve().parents[3]
LIBRARY = ROOT / 'app/server_tools/lib/installation_records.sh'


def copy_launchers(root):
    for name in ('filterest', 'ctl', 'app/filterest', 'app/ctl', 'app/go.mod',
                 'app/VERSION_APP', 'app/VERSION_DB',
                 'app/server_tools/run_filterest_docker.sh',
                 'app/server_tools/update_filterest.sh',
                 'app/server_tools/lib/python_bytecode_cache.sh',
                 'app/server_tools/lib/project_python_venv.sh'):
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)
    for name in LIFECYCLE_LIBRARY_FILES:
        target = root / 'app' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / 'app' / name, target)
    shutil.copytree(ROOT / 'app/server_tools/lib', root / 'app/server_tools/lib',
                    dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copytree(ROOT / 'app/server_tools/ctl', root / 'app/server_tools/ctl',
                    dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__'))


def slow_scanner(root, environment):
    """Delay real scans after EOF so a file reader cannot accidentally hide a race."""
    commands = root / 'slow-scanner-bin'
    commands.mkdir()
    events = root / 'scanner-events.log'
    scanner = commands / 'python3'
    scanner.write_text('#!/bin/bash\n'
        'if [[ "$1 $2 $3" == "-I -B -c" ]]; then\n'
        f"    printf 'start\\n' >> {shlex.quote(str(events))}\n"
        '    /bin/sleep 0.15\n'
        f'    {shlex.quote(sys.executable)} "$@"\n'
        '    status=$?\n'
        f"    printf 'finished\\n' >> {shlex.quote(str(events))}\n"
        '    exit "$status"\nfi\n'
        f'exec {shlex.quote(sys.executable)} "$@"\n')
    scanner.chmod(0o700)
    return dict(environment, PATH=f'{commands}:{environment["PATH"]}'), events


def file_command(root, environment, arguments, name='command.log'):
    log = root / name
    # There are no subprocess output pipes. Read immediately after wait returns;
    # the file context remains open and cannot itself wait for stray writers.
    with log.open('wb') as output:
        result = subprocess.run(list(map(str, arguments)), cwd=root, env=environment,
                                stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                                timeout=45)
        content = log.read_bytes()
    return result.returncode, content


def assert_drained(events):
    lines = events.read_text().splitlines()
    assert lines.count('start') > 0
    assert lines.count('start') == lines.count('finished'), lines


@pytest.fixture
def docker_installation():
    fixture = docker_fakes.FilterestDockerRunnerTests()
    fixture.setUp()
    try:
        copy_launchers(fixture.root)
        environment = fixture.environment()
        status, output = file_command(fixture.root, environment,
            [fixture.root / 'filterest', 'docker', 'setup'])
        assert status == 0, output
        yield fixture
    finally:
        fixture.doCleanups()


@pytest.mark.parametrize('entry', ('filterest', 'app/filterest'))
@pytest.mark.parametrize('damage', ('checksum', 'modes'))
def test_real_docker_restore_reason_is_present_at_return(docker_installation, entry, damage):
    fixture = docker_installation
    root = fixture.root
    backup = root / 'backups/recovery'
    backup.mkdir(mode=0o700)
    environment, events = slow_scanner(root, fixture.environment())
    status, output = file_command(root, environment,
        [root / entry, 'docker', 'dump-database', '--output', backup / 'database.dump'])
    assert status == 0, output
    if damage == 'checksum':
        with (backup / 'database.dump').open('ab') as dump:
            dump.write(b'edited')
        expected = b'Backup checksum failed: database.dump'
    else:
        (backup / 'database.dump').chmod(0o644)
        expected = b'owner-only regular files'
    events.unlink()
    status, output = file_command(root, environment,
        [root / entry, 'docker', 'restore-database', '--backup', backup, '--yes'])
    assert status == 1, output
    assert expected in output and b'NOT completed:' in output, output
    assert_drained(events)


@pytest.mark.parametrize('directory', ('storage_deleted', 'bootstrap'))
@pytest.mark.parametrize('entry', ('filterest', 'app/filterest'))
def test_real_docker_dump_link_refusal_is_present_at_return(docker_installation, directory, entry):
    fixture = docker_installation
    root = fixture.root
    linked = root / 'data' / directory
    if linked.exists():
        shutil.rmtree(linked)
    linked.symlink_to(root / 'data/storage', target_is_directory=True)
    (root / 'backups/refused').mkdir(mode=0o700)
    environment, events = slow_scanner(root, fixture.environment())
    status, output = file_command(root, environment,
        [root / entry, 'docker', 'dump-database', '--output', root / 'backups/refused/database.dump'])
    assert status == 1, output
    assert b'link' in output and directory.encode() in output, output
    assert output.index(directory.encode()) < output.index(b'error: The database recovery backup failed'), output
    assert_drained(events)


@pytest.mark.parametrize('entry', ('filterest', 'app/filterest'))
def test_real_native_restore_reason_is_present_at_return(tmp_path, entry):
    packet = packets.packet.__wrapped__(tmp_path)
    packets.create_packet(packet)
    root = packet['root']
    copy_launchers(root)
    with (packet['backup'] / 'database.dump').open('ab') as dump:
        dump.write(b'edited')
    environment, events = slow_scanner(root, dict(packet['environment'], FILTEREST_PROJECT_ROOT_OVERRIDE=str(root)))
    status, output = file_command(root, environment,
        [root / entry, 'restore-database', '--backup', packet['backup'], '--yes'])
    assert status == 1, output
    assert b'Backup checksum failed: database.dump' in output, output
    assert_drained(events)


@pytest.mark.parametrize('entry', ('ctl', 'app/ctl', 'app/server_tools/ctl/ctl_main.sh'))
def test_real_legacy_restore_refusal_is_present_at_return(tmp_path, entry):
    root = tmp_path / 'installation'
    root.mkdir()
    copy_launchers(root)
    (root / 'instances/proof').mkdir(parents=True)
    environment, events = slow_scanner(root, dict(os.environ))
    status, output = file_command(root, environment,
        [root / entry, '--instance', 'missing-proof', '--restore', root / 'missing.sql'])
    assert status == 1, output
    assert b'No instance matching: missing-proof' in output, output
    assert_drained(events)


@pytest.mark.parametrize('entry', ('filterest', 'app/filterest', 'app/server_tools/update_filterest.sh'))
def test_real_updater_refusal_is_present_at_return(tmp_path, entry):
    root = tmp_path / 'installation'
    root.mkdir()
    copy_launchers(root)
    # A local Git transport answers only read-only preflight questions. It refuses
    # every other invocation, so this updater cannot fetch or change a checkout.
    commands = root / 'tools'
    commands.mkdir()
    git = commands / 'git'
    (root / '.git').mkdir()
    git.write_text('#!/bin/bash\ncase "$*" in\n'
        '  *"branch --show-current"*) printf "main\\n" ;;\n'
        '  *"diff --quiet"*) printf "operator edit prevents update\\n" >&2; exit 23 ;;\n'
        '  *) exit 91 ;;\nesac\n')
    git.chmod(0o700)
    environment, events = slow_scanner(root, dict(os.environ,
        PATH=f'{commands}:{os.environ["PATH"]}', FILTEREST_ROOT=str(root)))
    arguments = [root / entry] + ([] if entry.endswith('.sh') else ['update']) + ['--yes']
    status, output = file_command(root, environment, arguments)
    assert status == 1, output
    assert b'tracked files have local changes' in output, output
    assert_drained(events)


@pytest.mark.parametrize('entry', ('filterest', 'app/filterest', 'app/server_tools/update_filterest.sh'))
@pytest.mark.parametrize('change', ('tracked', 'staged', 'both', 'staged-rename'))
def test_real_git_local_change_explanation_is_present_at_updater_return(tmp_path, entry, change):
    from test_recovery_checkout_preflight import metadata_snapshot

    root = tmp_path / 'installation'
    root.mkdir()
    copy_launchers(root)
    real_git = shutil.which('git')
    for arguments in (('init', '-b', 'main'), ('add', 'app/VERSION_APP', 'app/VERSION_DB'),
                      ('-c', 'user.name=Diagnostic Test', '-c', 'user.email=test@example.invalid',
                       'commit', '-m', 'tracked source')):
        subprocess.run([real_git, *arguments], cwd=root, check=True, capture_output=True)
    tracked = root / 'app/VERSION_APP'
    if change == 'staged-rename':
        subprocess.run([real_git, 'mv', 'app/VERSION_DB', 'app/operator revision'],
                       cwd=root, check=True, capture_output=True)
    else:
        tracked.write_text('operator revision\n')
        if change in ('staged', 'both'):
            subprocess.run([real_git, 'add', 'app/VERSION_APP'], cwd=root, check=True, capture_output=True)
        if change == 'both':
            tracked.write_text('later operator revision\n')
    # Only local-change inspection is allowed through to real Git. Any fetch or
    # destination inspection fails; a dirty checkout must give its reason first.
    commands = root / 'tools'
    commands.mkdir()
    git = commands / 'git'
    git.write_text('#!/bin/bash\ncase "$*" in\n'
        '  *"branch --show-current"|*"status --porcelain=v1 --untracked-files=no"|*"diff --cached --quiet")\n'
        f'    exec {shlex.quote(real_git)} "$@" ;;\n'
        '  *) exit 91 ;;\nesac\n')
    git.chmod(0o700)
    environment, events = slow_scanner(root, dict(os.environ,
        PATH=f'{commands}:{os.environ["PATH"]}', FILTEREST_ROOT=str(root)))
    git_before = metadata_snapshot(root / '.git')
    source_before = metadata_snapshot(root / 'app')
    arguments = [root / entry] + ([] if entry.endswith('.sh') else ['update']) + ['--yes']
    status, output = file_command(root, environment, arguments)
    explanation = (b'tracked files have local changes; commit or restore them first'
                   if change in ('tracked', 'both') else
                   b'the Git index has staged changes; commit or restore them first')
    assert status == 1 and explanation in output, output
    assert b'Checkout preflight failed' not in output
    assert_drained(events)
    assert metadata_snapshot(root / '.git') == git_before
    assert metadata_snapshot(root / 'app') == source_before
    assert not (root / 'backups').exists()
    assert not (root / 'data/runtime/filterest-update.lock').exists()


@pytest.mark.parametrize('kind', ('return', 'exit', 'errexit', 'source', 'nested', 'redirect', 'output'))
@pytest.mark.parametrize('status', (0, 23))
def test_shared_scan_drains_before_next_step_and_preserves_shell_state(tmp_path, kind, status):
    root = tmp_path
    environment, events = slow_scanner(root, dict(os.environ))
    scripts = {
        'return': 'emit() { STATE=changed; printf "cause\\n" >&2; return "$3"; }; '
                  'actual=0; filterest_recovery_scan "$2" stderr emit "$@" || actual=$?; '
                  'printf "next step %s %s\\n" "$actual" "$STATE"',
        'exit': 'trap \'printf "next step %s\\n" "$?"\' EXIT; '
                'emit() { printf "cause\\n" >&2; exit "$3"; }; '
                'filterest_recovery_scan "$2" stderr emit "$@"',
        'errexit': 'set -e; trap \'printf "next step %s\\n" "$?"\' EXIT; '
                   'emit() { printf "cause\\n" >&2; (exit "$3"); printf "body continued\\n"; }; '
                   'filterest_recovery_scan "$2" stderr emit "$@"',
        'source': 'actual=0; filterest_recovery_source "$2" "$2/settings.sh" || actual=$?; '
                  'printf "next step %s %s\\n" "$actual" "$STATE"',
        'nested': 'inner() { filterest_recovery_diagnostic "$2" "cause\\n" >&2; return "$3"; }; '
                  'outer() { actual=0; filterest_recovery_scan "$2" stderr inner "$@" || actual=$?; '
                  'printf "next step %s\\n" "$actual"; }; filterest_recovery_scan "$2" stderr outer "$@"',
        'redirect': 'emit() { printf "hidden cause\\n" >&2; return "$3"; }; '
                    'outer() { actual=0; filterest_recovery_scan "$2" stderr emit "$@" 2>/dev/null || actual=$?; '
                    'printf "next step %s\\n" "$actual"; }; filterest_recovery_scan "$2" stderr outer "$@"',
        'output': 'emit() { printf "cause stdout\\n"; printf "cause stderr\\n" >&2; return "$3"; }; '
                  'actual=0; filterest_recovery_output "$2" emit "$@" || actual=$?; '
                  'printf "next step %s\\n" "$actual"',
    }
    (root / 'settings.sh').write_text('STATE=changed; printf "cause\\n"; '
        f'return {status}\n')
    actual, content = file_command(root, environment,
        ['/bin/bash', '-c', 'source "$1"; ' + scripts[kind], 'probe', LIBRARY, root, status])
    assert actual == (status if kind in ('exit', 'errexit') else 0), content
    assert f'next step {status}'.encode() in content, content
    if kind != 'redirect':
        assert content.index(b'cause') < content.index(b'next step'), content
        assert_drained(events)
    else:
        assert b'hidden cause' not in content, content
    if kind in ('return', 'source'):
        assert b'changed' in content, content
    if kind == 'errexit' and status:
        assert b'body continued' not in content, content


@pytest.mark.parametrize('status', (0, 23))
def test_command_substitution_does_not_activate_parent_exit_cleanup(tmp_path, status):
    environment, events = slow_scanner(tmp_path, dict(os.environ))
    actual, content = file_command(tmp_path, environment, [
        '/bin/bash', '-c', r'''
source "$1"
trap 'printf "parent cleanup %s\n" "$?"' EXIT
emit() { printf 'private command data'; printf 'cause\n' >&2; return "$3"; }
actual=0
value="$(filterest_recovery_utility "$2" emit "$@")" || actual=$?
[[ "$value" == 'private command data' ]] || exit 91
printf 'next step %s\n' "$actual"
''', 'probe', LIBRARY, tmp_path, status])
    assert actual == 0, content
    assert content.count(b'parent cleanup') == 1, content
    assert content.index(b'cause') < content.index(b'next step') < content.index(b'parent cleanup'), content
    assert f'next step {status}'.encode() in content, content
    assert_drained(events)


def test_python_scanned_warning_precedes_following_step(tmp_path):
    key = bytes(range(32))
    keys = tmp_path / 'keys'
    keys.mkdir(mode=0o700)
    (keys / 'database_recovery.hmac.key').write_text(key.hex() + '\n')
    (keys / 'database_recovery.hmac.key').chmod(0o600)
    for path in (ROOT / 'app/server_tools/lib').glob('*.py'):
        shutil.copy2(path, tmp_path / path.name)
    script = tmp_path / 'entry.py'
    script.write_text('import sys\n'
        'from database_recovery_packet_io import prime_diagnostic_key, print_diagnostic\n'
        'prime_diagnostic_key(sys.argv[1])\n'
        f'print_diagnostic("warning: {key.hex()}", file=sys.stderr)\n'
        'print_diagnostic("2/3 next step", flush=True)\nraise SystemExit(23)\n')
    environment, events = slow_scanner(tmp_path, dict(os.environ))
    status, content = file_command(tmp_path, environment, [
        '/bin/bash', '-c', 'source "$1"; filterest_recovery_python "$2" python3 "$3" "$2"',
        'probe', LIBRARY, tmp_path, script])
    # The production bootstrap imports its own library beside the target script.
    # Use the actual product script directory as the module source in this probe.
    assert status == 23, content
    assert b'warning: <redacted:' in content and key.hex().encode() not in content, content
    assert content.index(b'warning:') < content.index(b'2/3 next step'), content
    assert_drained(events)


@pytest.mark.parametrize('entry', ('filterest', 'ctl', 'app/ctl'))
def test_recovery_launcher_cancellation_drains_child_diagnostics(tmp_path, entry):
    import signal
    import time

    root = tmp_path / 'installation'
    root.mkdir()
    copy_launchers(root)
    started = root / 'child-started'
    target = root / ('app/server_tools/update_filterest.sh' if entry == 'filterest'
                     else 'app/server_tools/ctl/ctl_main.sh')
    target.write_text('#!/bin/bash\n'
        'trap \'printf "child cleanup diagnostic\\n" >&2; exit 7\' TERM\n'
        'printf "initial diagnostic\\n" >&2\n'
        f'touch {shlex.quote(str(started))}\n'
        'while :; do /bin/sleep 0.1; done\n')
    target.chmod(0o700)
    environment, events = slow_scanner(root, dict(os.environ))
    arguments = [str(root / entry), 'update' if entry == 'filterest' else '--backup']
    log = root / 'cancel.log'
    with log.open('wb') as output:
        process = subprocess.Popen(arguments, cwd=root, env=environment,
            stdin=subprocess.DEVNULL, stdout=output, stderr=output)
        try:
            deadline = time.monotonic() + 15
            while not started.exists():
                assert process.poll() is None and time.monotonic() < deadline
                time.sleep(0.02)
            process.send_signal(signal.SIGTERM)
            assert process.wait(timeout=15) == 130
            content = log.read_bytes()
            assert b'child cleanup diagnostic' in content, content
            assert content.index(b'initial diagnostic') < content.index(b'child cleanup diagnostic'), content
            assert_drained(events)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
