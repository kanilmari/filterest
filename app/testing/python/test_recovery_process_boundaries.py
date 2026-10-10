"""test_recovery_process_boundaries.py: prove the named whole-process contract.

Exercise actual direct/public commands in key-bearing installation directories.
Implicit shell/Python failures must be scanned, drained, useful and status-preserving.
All helpers/transports are disposable local files; no database/daemon is contacted.
"""
from __future__ import annotations

import base64
import os
from pathlib import Path
import shlex
import subprocess
import sys

import pytest

from test_recovery_synchronous_diagnostics import copy_launchers

LIB = 'app/server_tools/lib/'
PYTHON = LIB + 'database_recovery.py'
UPDATE_PYTHON = LIB + 'database_recovery_update.py'
KEY = bytes(range(32))
# Target, its direct arguments, and its public/root route. Roots are already public.
ENTRIES = (
    ('filterest', ('update', '--help'), None),
    ('ctl', ('--backup', '--help'), None),
    ('app/filterest', ('update', '--help'), ('filterest', 'update', '--help')),
    ('app/ctl', ('--backup', '--help'), ('ctl', '--backup', '--help')),
    ('app/server_tools/ctl/ctl_main.sh', ('--backup', '--help'), ('ctl', '--backup', '--help')),
    ('app/server_tools/run_filterest_docker.sh', ('restore-database', '--help'), ('filterest', 'docker', 'restore-database', '--help')),
    ('app/server_tools/update_filterest.sh', ('--help',), ('filterest', 'update', '--help')),
    (PYTHON, ('restore', '--help'), ('filterest', 'restore-database', '--help')),
    (UPDATE_PYTHON, ('verify', '--help'), ('filterest', 'verify-update-backup', '--help')),
)
ROUTES = [(target, arguments, False) for target, arguments, _ in ENTRIES]
ROUTES += [(target, public, True) for target, _, public in ENTRIES if public]


@pytest.fixture
def installation(tmp_path):
    root = tmp_path / ('installation-' + KEY.hex())
    root.mkdir()
    copy_launchers(root)
    (root / 'keys').mkdir(mode=0o700)
    key = root / 'keys/database_recovery.hmac.key'
    key.write_text(KEY.hex() + '\n')
    key.chmod(0o600)
    environment = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    for name in ('FILTEREST_ROOT', 'FILTEREST_PROJECT_ROOT_OVERRIDE', 'FILTEREST_RECOVERY_PROMPT_FD',
                 'FILTEREST_RECOVERY_STDERR_PIPE', 'FILTEREST_RECOVERY_STDERR_DESTINATION'):
        environment.pop(name, None)
    return root, environment


def invoke(installation, target, arguments, public):
    root, environment = installation
    if public:
        command = [str(root / arguments[0]), *arguments[1:]]
    elif target.endswith('.py'):
        command = [sys.executable, '-B', str(root / target), *arguments]
    else:
        command = ['/bin/bash', str(root / target), *arguments]
    output, errors = root / 'stdout', root / 'stderr'
    with output.open('wb') as stdout, errors.open('wb') as stderr:
        result = subprocess.run(command, cwd='/tmp', env=environment, stdin=subprocess.DEVNULL,
            stdout=stdout, stderr=stderr, timeout=30)
        # Read before file contexts close: wait must include the final scan.
        return result.returncode, output.read_bytes(), errors.read_bytes()


def inject_body(path, body):
    """Place a raw diagnostic outside every per-site helper wrapper."""
    source = path.read_text()
    if path.suffix == '.py':
        marker = '        sys.exit(1)\n'
    else:
        marker = '    filterest_recovery_process_entry "${BASH_SOURCE[0]}"'
        start = source.index(marker)
        marker = source[start:source.index('\nfi\n', start) + 4]
    assert source.count(marker) == 1
    path.write_text(source.replace(marker, marker + '\n' + body + '\n', 1))


@pytest.mark.parametrize('target,arguments,public', ROUTES)
@pytest.mark.parametrize('damage', ('missing', 'unreadable', 'shell-syntax', 'shell-unbound', 'python-import', 'python-exception'))
def test_every_entrypoint_captures_implicit_diagnostics_and_status(installation, target, arguments, public, damage):
    root, _ = installation
    helper = root / ('implicit.py' if damage.startswith('python') else 'implicit.sh')
    expected, explanation = 1, b'No such file or directory'
    if damage == 'unreadable':
        helper.write_text('exit 0\n')
        helper.chmod(0)
        assert not os.access(helper, os.R_OK)
        explanation = b'Permission denied'
    elif damage == 'shell-syntax':
        helper.write_text('if then\n')
        expected, explanation = 2, b'syntax error'
    elif damage == 'shell-unbound':
        helper.write_text('set -u\nprintf "%s" "$WL99_E14_UNBOUND"\n')
        explanation = b'unbound variable'
    elif damage == 'python-import':
        helper.write_text('import wl99_e14_deliberately_missing_dependency\n')
        explanation = b'ModuleNotFoundError'
    elif damage == 'python-exception':
        helper.write_text('raise RuntimeError("uncaught recovery probe")\n')
        explanation = b'RuntimeError: uncaught recovery probe'
    if target.endswith('.py'):
        body = ('import subprocess\nraise SystemExit(subprocess.call(' +
                repr(([sys.executable, '-B', str(helper)] if helper.suffix == '.py' else
                      ['/bin/bash', '-eu', '-c', 'source "$1"', 'probe', str(helper)])) + '))')
    else:
        command = (shlex.quote(sys.executable) + ' -B ' + shlex.quote(str(helper)) if helper.suffix == '.py'
                   else '/bin/bash -eu -c \'source "$1"\' probe ' + shlex.quote(str(helper)))
        body = command + '\nexit $?'
    inject_body(root / target, body)
    status, output, errors = invoke(installation, target, arguments, public)
    content = output + errors
    assert status == expected, content
    assert KEY.hex().encode() not in content
    assert b'<redacted:' in content and explanation in errors, content
    assert not output, 'Implicit diagnostics must retain stderr'


@pytest.mark.parametrize('target,arguments,public', ROUTES)
@pytest.mark.parametrize('damage', ('missing', 'unreadable', 'syntax'))
def test_boundary_bootstrap_failures_are_fixed_and_path_free(installation, target, arguments, public, damage):
    root, _ = installation
    # A missing Python dependency in the pre-scanner boundary cannot be scanned.
    helper = root / (LIB + 'recovery_process_boundary.py')
    if damage == 'missing':
        helper.unlink()
    elif damage == 'unreadable':
        helper.chmod(0)
    else:
        helper.write_text('if this is invalid syntax\n')
    status, output, errors = invoke(installation, target, arguments, public)
    assert status == 1 and not output
    assert KEY.hex().encode() not in errors and b'sensitive details withheld' in errors
    assert b'Traceback' not in errors


PARSER_ROUTES = []
for target in ('ctl', 'app/ctl', 'app/server_tools/ctl/ctl_main.sh'):
    for option in ('--domain', '--role', '--instance-role', '-p', '--port', '--restore'):
        # --backup selects recovery without performing an operation after refusal.
        PARSER_ROUTES.append((target, ('--backup', option), 1))
        if target != 'ctl':
            PARSER_ROUTES.append(('ctl', ('--backup', option), 1))
for target in ('filterest', 'app/filterest', 'app/server_tools/update_filterest.sh'):
    prefix = () if target.endswith('.sh') else ('update',)
    for option in ('--version', '--ready-timeout'):
        PARSER_ROUTES.append((target, (*prefix, option), 1))
for target in ('filterest', 'app/filterest', 'app/server_tools/run_filterest_docker.sh'):
    prefix = ('restore-database',) if target.endswith('.sh') else ('docker', 'restore-database')
    for option in ('--app-port', '--db-port', '--base-url', '--output', '--backup', '--expect-version', '--timeout'):
        PARSER_ROUTES.append((target, (*prefix, option), 1))
for target, action, options in ((PYTHON, 'restore', ('--root', '--profile', '--settings', '--output', '--backup', '--archive')),
    (UPDATE_PYTHON, 'verify', ('--root', '--profile', '--settings', '--backup', '--destination', '--home'))):
    for option in options:
        PARSER_ROUTES.append((target, (action, '--profile', 'native', option), 2))
for public in ('restore-database', 'verify-update-backup', 'extract-update-backup'):
    for option in ('--backup', '--settings', '--archive' if public == 'restore-database' else '--destination'):
        PARSER_ROUTES.append(('filterest', (public, option), 2))


@pytest.mark.parametrize('target,arguments,expected', PARSER_ROUTES)
@pytest.mark.parametrize('following', ((), ('--yes',)))
def test_required_values_refuse_with_fixed_text(installation, target, arguments, expected, following):
    status, output, errors = invoke(installation, target, (*arguments, *following), False)
    assert status == expected and not output, (target, arguments, output, errors)
    assert KEY.hex().encode() not in errors
    assert b'requires' in errors or b'invalid arguments' in errors or b'applies only' in errors
    assert b'unbound variable' not in errors


@pytest.mark.parametrize('target,arguments,public', ROUTES)
@pytest.mark.parametrize('readonly_hook', (False, True))
def test_exported_markers_cannot_skip_the_process_scan(installation, target, arguments, public, readonly_hook):
    root, environment = installation
    environment.update(FILTEREST_RECOVERY_PROCESS_PID='3', BASH_EXECUTION_STRING=
        'unset FILTEREST_RECOVERY_PROCESS_PID; readonly FILTEREST_RECOVERY_PROCESS_PID="$BASHPID"; source "$0" "$@"',
        FILTEREST_RECOVERY_OUTPUT='0', FILTEREST_RECOVERY_STDERR_PIPE='9', FILTEREST_RECOVERY_STDERR_DESTINATION='8')
    if readonly_hook:
        hook = root / 'startup-hook.sh'
        hook.write_text('unset FILTEREST_RECOVERY_PROCESS_PID\nreadonly FILTEREST_RECOVERY_PROCESS_PID="$BASHPID"\n')
        environment['BASH_ENV'] = str(hook)
    body = ('print(' + repr('unwrapped ' + KEY.hex()) + ')\nraise SystemExit(23)' if target.endswith('.py')
        else 'printf \'unwrapped %s\\n\' ' + shlex.quote(KEY.hex()) + '\nexit 23')
    inject_body(root / target, body)
    status, output, errors = invoke(installation, target, arguments, public)
    assert status == 23 and b'<redacted:' in output and not errors
    assert KEY.hex().encode() not in output


@pytest.mark.parametrize('target,arguments,public', ROUTES)
def test_whole_process_retains_arbitrary_bytes_and_separate_destinations(installation, target, arguments, public):
    root, _ = installation
    output, errors = b'ordinary stdout\0\xff\n', b'ordinary stderr\0\xfe\n'
    body = ('import os\nos.write(1, ' + repr(output) + ')\nos.write(2, ' + repr(errors) + ')\nraise SystemExit(23)'
        if target.endswith('.py') else "printf 'ordinary stdout\\0\\377\\n'\nprintf 'ordinary stderr\\0\\376\\n' >&2\nexit 23")
    inject_body(root / target, body)
    assert invoke(installation, target, arguments, public) == (23, output, errors)


@pytest.mark.parametrize('status', (0, 23))
def test_outer_redaction_failure_withholds_both_streams_and_keeps_status(installation, status):
    root, environment = installation
    scanner = root / (LIB + 'database_recovery_packet_io.py')
    scanner.write_text(scanner.read_text() + '\n_original_diagnostic = safe_diagnostic\n'
        'def safe_diagnostic(message, *args, **kwargs):\n'
        '    if message:\n        raise RuntimeError("scanner refusal")\n'
        '    return _original_diagnostic(message, *args, **kwargs)\n')
    target = root / 'app/filterest'
    inject_body(target, f"printf 'private stdout\\n'; printf 'private stderr\\n' >&2; exit {status}")
    actual, output, errors = invoke(installation, 'app/filterest', ('update',), False)
    assert actual == status and not output
    assert errors == b'Recovery diagnostic unavailable; sensitive details withheld.\n'


@pytest.mark.parametrize('target,arguments,public', ROUTES)
def test_shell_bootstrap_cannot_print_before_its_syntax_refusal(installation, target, arguments, public):
    if target.endswith('.py') and not public:
        pytest.skip('Direct Python has no shell bootstrap; its syntax/import refusals run above')
    root, _ = installation
    helper = root / (LIB + 'recovery_process_boundary.sh')
    helper.write_text("printf '%s\\n' " + shlex.quote(KEY.hex()) + "\nif then\n")
    status, output, errors = invoke(installation, target, arguments, public)
    assert status == 1 and not output
    assert errors == b'Recovery process boundary unavailable; sensitive details withheld.\n'


@pytest.mark.parametrize('entry', ('filterest', 'app/filterest', 'app/server_tools/update_filterest.sh'))
def test_update_plan_and_prompt_are_scanned_on_stdout_before_input(installation, entry):
    import select
    import time
    root, environment = installation
    updater = root / 'app/server_tools/update_filterest.sh'
    source = updater.read_text()
    assert source.rstrip().endswith('main "$@"')
    # Skip all transport/update work; retain the actual display/confirmation functions.
    updater.write_text(source[:source.rindex('main "$@"')] +
        "PROFILE=development\nTARGET_VERSION=99.0.0\nTARGET_COMMIT=" + 'a' * 40 + '\n' +
        'RELEASE_REPOSITORY=' + shlex.quote('synthetic-' + KEY.hex()) + '\nshow_plan\nconfirm_plan\n')
    master, slave = os.openpty()
    command = [str(root / entry)] + ([] if entry.endswith('.sh') else ['update'])
    process = subprocess.Popen(command, cwd='/tmp', env=environment, stdin=slave,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    os.close(slave)
    try:
        output = b''
        deadline = time.monotonic() + 15
        while b'[y/N]' not in output and time.monotonic() < deadline:
            ready, _, _ = select.select([process.stdout], [], [], 0.2)
            if ready:
                chunk = os.read(process.stdout.fileno(), 4096)
                if not chunk:
                    break
                output += chunk
        assert b'Filterest stable update plan' in output and b'[y/N]' in output, output
        assert KEY.hex().encode() not in output and b'<redacted:' in output
        assert process.poll() is None
        os.write(master, b'no\n')
        remaining, errors = process.communicate(timeout=15)
        assert not remaining and process.returncode == 1 and b'update cancelled' in errors
    finally:
        os.close(master)
        if process.poll() is None:
            process.kill()
            process.communicate()


@pytest.mark.parametrize('target,arguments,_public', ENTRIES)
@pytest.mark.parametrize('signal_name', ('SIGTERM', 'SIGINT'))
def test_signal_cleanup_keeps_the_application_status_and_drains(installation, target, arguments, _public, signal_name):
    import signal
    import time
    root, environment = installation
    ready = root / 'ready'
    if target.endswith('.py'):
        body = ('import signal, time\n'
                'def stopped(signum, frame):\n    print(' + repr('cleanup ' + KEY.hex()) + ')\n    raise SystemExit(27)\n'
                'signal.signal(signal.SIGTERM, stopped)\nsignal.signal(signal.SIGINT, stopped)\n' +
                'open(' + repr(str(ready)) + ', "w").close()\nwhile True:\n    time.sleep(0.05)')
    else:
        body = "trap 'printf \"cleanup %s\\n\" " + KEY.hex() + "; exit 27' TERM INT\n" + \
            'touch ' + shlex.quote(str(ready)) + '\nwhile :; do /bin/sleep 0.05; done'
    inject_body(root / target, body)
    command = [sys.executable, '-B', str(root / target), *arguments] if target.endswith('.py') else \
        ['/bin/bash', str(root / target), *arguments]
    output = root / 'signal.log'
    with output.open('wb') as log:
        process = subprocess.Popen(command, cwd='/tmp', env=environment, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 15
            while not ready.exists():
                assert process.poll() is None and time.monotonic() < deadline
                time.sleep(0.02)
            process.send_signal(getattr(signal, signal_name))
            assert process.wait(timeout=15) == 27
            content = output.read_bytes()
            assert b'cleanup <redacted:' in content and KEY.hex().encode() not in content
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


@pytest.mark.parametrize('entry,arguments', (('app/ctl', ('--backup',)),
    ('app/server_tools/run_filterest_docker.sh', ('restore-database',))))
def test_ignored_root_hint_cannot_select_a_different_scanner_key(installation, entry, arguments):
    root, environment = installation
    other = root / 'unrelated-installation'
    (other / 'keys').mkdir(parents=True, mode=0o700)
    keyfile = other / 'keys/database_recovery.hmac.key'
    keyfile.write_text(bytes(reversed(KEY)).hex() + '\n')
    keyfile.chmod(0o600)
    environment['FILTEREST_ROOT'] = str(other)
    inject_body(root / entry, "printf 'actual installation key %s\\n' " + KEY.hex() + '\nexit 23')
    status, output, errors = invoke(installation, entry, arguments, False)
    assert status == 23 and not errors
    assert KEY.hex().encode() not in output and b'<redacted:' in output


@pytest.mark.parametrize('entry,arguments', tuple((path, args) for path, args, _ in ENTRIES if not path.endswith('.py')))
def test_environment_helper_failure_is_fixed_before_scanning(installation, entry, arguments):
    root, environment = installation
    commands = root / 'environment-tools'
    commands.mkdir()
    helper = commands / 'env'
    helper.write_text("#!/bin/bash\nprintf '%s\\n' " + KEY.hex() + ' >&2\nexit 23\n')
    helper.chmod(0o700)
    environment['PATH'] = str(commands) + ':' + environment['PATH']
    status, output, errors = invoke(installation, entry, arguments, False)
    assert status == 1 and not output
    assert errors == b'Recovery process boundary unavailable; sensitive details withheld.\n'
