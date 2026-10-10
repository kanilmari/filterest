"""test_recovery_quoted_routes.py: real filename diagnostics and output routes.

Connects GNU utilities, the actual legacy parser/lookup and shared scanners.
Uses disposable local files and synthetic keys; no DB, daemon or network.
"""
from __future__ import annotations

import base64
import os
from pathlib import Path
import random
import select
import shlex
import subprocess
import sys
import time

import pytest

from recovery_operator_input_probes import FORMS, KEY, SOURCE, form_value, signing_root

LIBRARY = SOURCE / 'server_tools/lib/installation_records.sh'
CTL = SOURCE / 'server_tools/ctl/ctl_main.sh'
LOCALES = ('C', 'C.utf8')
TOOLS = ('cat', 'ls', 'stat', 'cp', 'mv', 'rm', 'mkdir', 'chmod', 'tar',
         'gzip', 'sha256sum', 'find', 'readlink', 'realpath')
QUOTES = ('single', 'ansi-octal', 'ansi-hex', 'ansi-unicode', 'double',
          'backslash', 'locale', 'mixed')


def root_with_key(path, key):
    root = signing_root(path)
    (root / 'keys/database_recovery.hmac.key').write_text(key.hex() + '\n')
    return root


def represented(key, form):
    if form == 'raw':
        return key
    if form == 'hex':
        return key.hex().upper().encode()
    if form in ('utf16le-hex', 'utf16be-hex'):
        return key.hex().upper().encode('utf-16le' if form == 'utf16le-hex' else 'utf-16be')
    encoder = base64.urlsafe_b64encode if form == 'urlsafe' else base64.b64encode
    return encoder(b'X' + key + b'after' if form == 'embedded-base64' else key)


def quoted(value, style, *, compact=False):
    """Generate independent, inert shell spelling; never evaluate the result."""
    # Split inside the key, not only at the filename prefix as the E9 test did.
    pieces = [value[:len(value)//2], value[len(value)//2:]]
    if style in ('ansi-octal', 'ansi-hex', 'ansi-unicode'):
        escape = {'ansi-octal': lambda byte: b'\\%03o' % byte,
                  'ansi-hex': lambda byte: b'\\x%02x' % byte,
                  'ansi-unicode': lambda byte: b'\\u%04x' % byte}[style]
        return b''.join(b"$'" + b''.join(escape(byte) for byte in (piece[:2] if compact else piece))
                        + (piece[2:] if compact else b'') + b"'" for piece in pieces)
    if style == 'backslash':
        return b''.join(b'\\' + bytes([byte]) for byte in value)
    if style == 'mixed':
        return b"'" + pieces[0] + b"'$'" + b''.join(b'\\%03o' % byte for byte in pieces[1]) + b"'"
    delimiter = b"'" if style == 'single' else b'"'
    prefix = b'$' if style == 'locale' else b''
    return b''.join(prefix + delimiter + piece + delimiter for piece in pieces)


def run_shell(root, script, *arguments, **options):
    return subprocess.run(['/bin/bash', '-c', 'source "$1"\nshift\n' + script,
        'probe', str(LIBRARY), str(root), *map(str, arguments)], capture_output=True, timeout=60,
        env=dict(os.environ, PROJECT_ROOT=str(root)), **options)


def assert_redacted(result, key=KEY):
    assert key not in result.stdout + result.stderr
    assert b'redacted:' in result.stdout + result.stderr


def random_keys():
    generator = random.Random(9910)
    keys = []
    while len(keys) < 24:
        key = generator.randbytes(32)
        if b'\0' not in key:
            keys.append(key)
    return keys


PATH_CASES = [('e9-' + form, KEY, form) for form in FORMS]
PATH_CASES += [('random-%02d' % index, key, 'raw') for index, key in enumerate(random_keys())]


def utility_arguments(tool, path, root):
    if tool in ('cp', 'mv'):
        return [tool, '--', path, str(root / 'destination')]
    if tool == 'chmod':
        return [tool, '600', '--', path]
    if tool == 'tar':
        return [tool, '-cf', '/dev/null', '--', path]
    if tool == 'gzip':
        return [tool, '-dc', '--', path]
    if tool == 'find':
        return [tool, path, '-print']
    if tool in ('readlink', 'realpath'):
        return [tool, *(['-v'] if tool == 'readlink' else []), '-e', '--', path]
    return [tool, '--', path]


@pytest.mark.parametrize('locale', LOCALES)
@pytest.mark.parametrize('tool', TOOLS)
@pytest.mark.parametrize('case,key,form', PATH_CASES, ids=[case[0] for case in PATH_CASES])
def test_real_utility_filename_errors_keep_explanation_and_status(tmp_path, locale, tool, case, key, form):
    root = root_with_key(tmp_path / 'installation', key)
    value = represented(key, form)
    # NUL is impossible in argv/filenames; cover UTF-16 via printed backslash
    # spelling as well as via scanner input in the quote tests below.
    if b'\0' in value:
        value = quoted(value, 'ansi-hex')
    path = os.fsdecode(os.fsencode(root) + b'/prefix-' + value + b'/VERSION_APP')
    if tool == 'mkdir':
        # mkdir otherwise creates its final component; refuse a missing parent.
        pass
    arguments = utility_arguments(tool, path, root)
    environment = dict(os.environ, LC_ALL=locale)
    original = subprocess.run(arguments, capture_output=True, env=environment, timeout=30)
    assert original.returncode != 0 and original.stderr, (case, tool, original)
    result = subprocess.run(['/bin/bash', '-c',
        'source "$1"; root="$2"; shift 2; filterest_recovery_output "$root" "$@"',
        'probe', str(LIBRARY), str(root), *arguments], capture_output=True, env=environment, timeout=60)
    assert result.returncode == original.returncode
    assert_redacted(result, key)
    assert not result.stdout
    # All bytes outside replacement spans must still occur in the real utility
    # explanation, in order. Exclude the wrapper's additional invocation note.
    retained = result.stderr.split(b'Recovery command failed:', 1)[0]
    assert b'redacted:' in retained, (case, tool, retained)
    cursor = 0
    for part in retained.split(b'<redacted: contains the recovery key>'):
        if part:
            position = original.stderr.find(part, cursor)
            assert position >= cursor, (case, tool, original.stderr, result.stderr)
            cursor = position + len(part)
    assert any(cause in retained for cause in (b'No such file or directory', b'File name too long'))


@pytest.mark.parametrize('form', FORMS)
@pytest.mark.parametrize('style', QUOTES)
@pytest.mark.parametrize('chunk_size', [1, 7, 63, 65536])
def test_concatenated_segments_across_chunks_are_scanned_without_evaluation(tmp_path, form, style, chunk_size):
    root = signing_root(tmp_path / 'installation')
    # Unicode escapes encode Unicode codepoints, so use ASCII hexadecimal for
    # that spelling; other forms also cover surrogate-containing raw bytes.
    value = represented(KEY, 'hex' if style == 'ansi-unicode' else form)
    message = b"cat: prefix-" + quoted(value, style) + b"/VERSION_APP: Permission denied\n"
    process = subprocess.Popen(['/bin/bash', '-c',
        'source "$1"; filterest_redact_recovery_diagnostics "$2"', 'probe', str(LIBRARY), str(root)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    for start in range(0, len(message), chunk_size):
        process.stdin.write(message[start:start + chunk_size])
        process.stdin.flush()
    process.stdin.close()
    process.stdin = None
    stdout, stderr = process.communicate(timeout=60)
    result = subprocess.CompletedProcess(process.args, process.returncode, stdout, stderr)
    assert result.returncode == 0 and not stderr
    assert_redacted(result)
    assert value not in stdout
    assert stdout.startswith(b'cat: ') and stdout.endswith(b'/VERSION_APP: Permission denied\n')
    sentinel = root / 'executed'
    executable_text = b'$(touch ' + os.fsencode(sentinel) + b') ${UNSET} `false`'
    inert = run_shell(root, 'filterest_redact_recovery_diagnostics "$1"', input=executable_text)
    assert inert.stdout == executable_text and not inert.stderr and not sentinel.exists()


@pytest.mark.parametrize('escape', [b'e', b'E'])
@pytest.mark.parametrize('chunk_size', [1, 7, 63, 65536])
def test_named_control_escapes_join_plain_segments(tmp_path, escape, chunk_size):
    key = b'\a\b\t\n\v\f\r\x1b' + b'A' * 24
    root = root_with_key(tmp_path / 'installation', key)
    message = b"cat: prefix-$'\\a\\b\\t\\n\\v\\f\\r\\" + escape + b"''" + b'A' * 24
    message += b"'/VERSION_APP: Permission denied\n"
    process = subprocess.Popen(['/bin/bash', '-c',
        'source "$1"; filterest_redact_recovery_diagnostics "$2"', 'probe', str(LIBRARY), str(root)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    for start in range(0, len(message), chunk_size):
        process.stdin.write(message[start:start + chunk_size])
        process.stdin.flush()
    process.stdin.close()
    process.stdin = None
    stdout, stderr = process.communicate(timeout=60)
    assert process.returncode == 0 and not stderr and key not in stdout
    assert stdout == b'cat: <redacted: contains the recovery key>/VERSION_APP: Permission denied\n'


@pytest.mark.parametrize('action', ['--backup', '--restore'])
@pytest.mark.parametrize('kind', ['missing', 'ambiguous', 'exact', 'partial'])
@pytest.mark.parametrize('style', QUOTES)
@pytest.mark.parametrize('form', FORMS[:5])
def test_real_legacy_parser_and_lookup_scan_queries_and_candidate_lists(tmp_path, action, kind, style, form):
    root = signing_root(tmp_path / 'installation')
    # Representations are passed as text, as printed by utilities/shells, with
    # no shell interpretation of the argument and no mocked lookup/dispatch.
    value = represented(KEY, 'hex' if style == 'ansi-unicode' else form)
    if style == 'mixed' and form == 'raw':
        value = represented(KEY, 'hex')
    query = os.fsdecode(quoted(value, style, compact=True)).replace('/', r'\057')
    instances = root / 'instances'
    instances.mkdir()
    candidate = 'proof-' + query
    if kind == 'missing':
        (instances / candidate).mkdir()
        query = 'missing-' + query
    elif kind == 'ambiguous':
        for suffix in ('-one', '-two'):
            (instances / (candidate + suffix)).mkdir()
    else:
        (instances / candidate).mkdir()
        if kind == 'exact':
            query = candidate
    arguments = [str(CTL), '--instance', query, action]
    if action == '--restore':
        arguments.append('fixture.dump')
    result = subprocess.run(['/bin/bash', *arguments], capture_output=True, cwd=root, timeout=60,
        env=dict(os.environ, FILTEREST_PROJECT_ROOT_OVERRIDE=str(root)))
    assert result.returncode == 1
    output = result.stdout + result.stderr
    assert KEY not in output and os.fsencode(query) not in output
    if kind == 'missing':
        assert b'No instance matching:' in output and b'Available instances:' in output
        assert b'redacted:' in output
    elif kind == 'ambiguous':
        assert b'Multiple instances match:' in output and b'Please be more specific.' in output
        assert output.count(b'redacted:') >= 3
    else:
        assert b'Recovery path refused; sensitive details withheld.' in output


@pytest.mark.parametrize('action', ['--backup', '--restore'])
def test_ordinary_legacy_lookup_failure_keeps_explanation(tmp_path, action):
    root = signing_root(tmp_path / 'installation')
    (root / 'instances/ordinary').mkdir(parents=True)
    result = subprocess.run(['/bin/bash', str(CTL), '--instance', 'absent', action, *(['fixture.dump'] if action == '--restore' else [])],
        capture_output=True, cwd=root, env=dict(os.environ, FILTEREST_PROJECT_ROOT_OVERRIDE=str(root)), timeout=60)
    assert result.returncode == 1 and not result.stdout
    assert b'No instance matching: absent' in result.stderr and b'ordinary' in result.stderr


@pytest.mark.parametrize('form', FORMS[:5])
def test_settings_source_scans_both_streams_and_preserves_assignments_and_status(tmp_path, form):
    root = signing_root(tmp_path / 'installation')
    settings = root / 'settings.env'
    settings.write_text('ASSIGNED=preserved\nprintf "%s\\n" "$PROBE"\nprintf "source cause: %s\\n" "$PROBE" >&2\nreturn 23\n')
    result = run_shell(root, 'PROBE="$3"; status=0; filterest_recovery_source "$1" "$2" || status=$?; '
        '[[ "$ASSIGNED" == preserved ]] || exit 29; exit "$status"', settings, form_value(form))
    assert result.returncode == 23 and b'source cause:' in result.stderr
    assert_redacted(result)
    assert os.fsencode(form_value(form)) not in result.stdout + result.stderr


@pytest.mark.parametrize('style', QUOTES)
def test_python_cli_path_refusal_scans_quoted_values_without_shell_wrapper(tmp_path, style):
    root = signing_root(tmp_path / 'installation')
    path = root.parent / os.fsdecode(quoted(KEY.hex().upper().encode(), style, compact=True))
    result = subprocess.run([sys.executable, '-B', str(SOURCE / 'server_tools/lib/database_recovery.py'),
        'preflight', '--root', str(root), '--profile', 'native', '--settings', str(path)],
        capture_output=True, timeout=60)
    assert result.returncode == 1 and b'Protected settings' in result.stderr
    assert_redacted(result)
    assert os.fsencode(path.name) not in result.stdout + result.stderr


@pytest.mark.parametrize('script', ['ctl', 'app/ctl', 'app/server_tools/ctl/ctl_main.sh'])
def test_legacy_launcher_location_failures_use_fixed_text(tmp_path, script):
    copied = tmp_path / ('prefix-' + KEY.hex() + '.sh')
    copied.write_bytes((SOURCE.parent / script).read_bytes())
    commands = tmp_path / 'bin'
    commands.mkdir()
    utility = commands / 'dirname'
    utility.write_text('#!/bin/bash\nprintf "%s\\n" "$*" >&2\nexit 23\n')
    utility.chmod(0o700)
    result = subprocess.run(['/bin/bash', str(copied), '--instance', 'missing', '--backup'], capture_output=True,
        env=dict(os.environ, PATH=str(commands) + ':' + os.environ['PATH']), timeout=60)
    assert result.returncode == 1 and not result.stdout
    assert result.stderr == b'Recovery launcher location unavailable; sensitive details withheld.\n'


def test_direct_app_launcher_has_no_unscanned_basename_route(tmp_path):
    root = signing_root(tmp_path / ('installation-' + KEY.hex()))
    application = root / 'app'
    application.mkdir()
    for name in ('server_tools', 'go.mod', 'VERSION_APP'):
        (application / name).symlink_to(SOURCE / name)
    (application / 'ctl').write_bytes((SOURCE / 'ctl').read_bytes())
    commands = tmp_path / 'bin'
    commands.mkdir()
    sentinel = tmp_path / 'basename-called'
    utility = commands / 'basename'
    utility.write_text('#!/bin/bash\nprintf "%s\\n" "$*" >&2\ntouch "$SENTINEL"\nexit 23\n')
    utility.chmod(0o700)
    environment = {name: value for name, value in os.environ.items()
                   if name not in ('FILTEREST_PROJECT_ROOT_OVERRIDE', 'FILTEREST_ROOT')}
    environment.update(PATH=str(commands) + ':' + os.environ['PATH'], SENTINEL=str(sentinel))
    result = subprocess.run(['/bin/bash', str(root / 'app/ctl'), '--backup', '--help'],
        capture_output=True, env=environment, cwd=root, timeout=60)
    assert result.returncode == 0 and b'FILTEREST CONTROL CLI' in result.stdout
    # The cache helper still calls basename inside its actual scanner boundary;
    # initialization's former unwrapped call would print this path verbatim.
    assert sentinel.exists() and b'redacted:' in result.stderr
    assert KEY.hex().encode() not in result.stdout + result.stderr


@pytest.mark.parametrize('form', FORMS[:5])
def test_restore_settings_warning_scans_values_after_source(tmp_path, form):
    root = signing_root(tmp_path / 'installation')
    instance = root / 'instances/proof'
    instance.mkdir(parents=True)
    (instance / '.env').write_bytes(os.fsencode('instance=' + shlex.quote('configured-' + form_value(form)) + '\n'))
    dump = root / 'fixture.sql'
    dump.write_text('SELECT 42;\n')
    result = run_shell(root, 'source "$2"; restore_instance proof "$3"',
        SOURCE / 'server_tools/ctl/lib/instance_backup.sh', dump, cwd=root, input=b'no\n')
    assert result.returncode == 0 and b'will overwrite the database' in result.stdout
    assert b'Cancelled.' in result.stdout
    assert_redacted(result)
    assert os.fsencode(form_value(form)) not in result.stdout + result.stderr


def test_embedded_restore_dispatch_scans_child_output_without_changing_status(tmp_path):
    root = signing_root(tmp_path / 'installation')
    # Use the actual final dispatch, with only its daemon transport substituted.
    main = CTL.read_text().split('case $MODE in\n', 1)[1]
    shell = 'MODE=docker; RESTORE_DB=true; PROBE="$2"; start_docker() { printf "%s\\n" "$PROBE"; '
    shell += 'printf "embedded cause: %s\\n" "$PROBE" >&2; return 23; }; case $MODE in\n' + main
    result = run_shell(root, shell, form_value('hex'))
    assert result.returncode == 23 and b'embedded cause:' in result.stderr
    assert_redacted(result)


def test_real_root_legacy_restore_prompt_is_visible_before_answer(tmp_path):
    root = signing_root(tmp_path / 'installation')
    (root / 'app').symlink_to(SOURCE, target_is_directory=True)
    launcher = root / 'ctl'
    launcher.write_bytes((SOURCE.parent / 'ctl').read_bytes())
    launcher.chmod(0o700)
    (root / 'instances/proof').mkdir(parents=True)
    (root / 'instances/proof/.env').write_text('DB_NAME=fixture\nDB_ADMIN_USER=fixture\n')
    dump = root / 'fixture.sql'
    dump.write_text('SELECT 42;\n')
    master, slave = os.openpty()
    process = subprocess.Popen([str(launcher), '--instance', 'proof', '--restore', str(dump)],
        stdin=slave, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=root,
        env={name: value for name, value in os.environ.items()
             if name not in ('EASELECT_RESTORE_CONFIRM', 'FILTEREST_RECOVERY_PROMPT_FD')})
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
        assert b'Continue? (yes/no):' in prompt and process.poll() is None
        os.write(master, b'no\n')
        stdout, stderr = process.communicate(timeout=15)
        assert process.returncode == 0 and b'Cancelled.' in stdout
        assert b'Continue?' not in stdout and not stderr
    finally:
        os.close(master)
        if process.poll() is None:
            process.kill()
            process.communicate()


@pytest.mark.parametrize('form', FORMS[:5])
@pytest.mark.parametrize('kind', ['instance-refusal', 'directory', 'policy', 'redirection', 'mass-list', 'mass-counts'])
def test_legacy_backup_route_classes_are_scanned(tmp_path, form, kind):
    root = signing_root(tmp_path / 'installation')
    value = form_value(form).replace('/', r'\057')
    # Preserve the original representation for Base64 by encoding literal / in
    # shell spelling, which the joined shadow checks.
    instance = 'proof-' + value if kind in ('instance-refusal', 'mass-list') else 'proof'
    if kind not in ('instance-refusal', 'mass-list'):
        folder = root / 'instances/proof'
        folder.mkdir(parents=True)
        (folder / '.env').write_text('DB_NAME=fixture\nDB_ADMIN_USER=fixture\n')
        if kind == 'mass-counts':
            with (folder / '.env').open('ab') as settings:
                settings.write(os.fsencode('skip_count=' + shlex.quote(value) + '\n'))
    if kind == 'mass-list':
        (root / 'instances' / instance).mkdir(parents=True)
    library = SOURCE / 'server_tools/ctl/lib/instance_backup.sh'
    shell = 'RED=""; BLUE=""; GREEN=""; YELLOW=""; NC=""; FILTEREST_SOURCE_ROOT=' + shlex.quote(str(SOURCE)) + '; source "$2"; '
    shell += 'project_default_db_name() { printf fixture; }; '
    # Only container transport is synthetic; filesystem errors and dump policy
    # parsing/warnings are real. No database or Docker daemon is contacted.
    shell += 'docker() { if [[ "$1" == ps ]]; then printf "easelect-proof-db\\n"; '
    shell += 'elif [[ "$*" == *pg_dump* ]]; then printf "SELECT 42;\\n"; '
    shell += 'else printf "public\\tordinary\\t%s\\n" "$PROBE"; fi; }; '
    target = root / ('prefix-' + value) / 'dump.gz'
    if kind == 'directory':
        target.parent.parent.mkdir(exist_ok=True)
        target.parent.write_bytes(b'blocking file')
        shell += 'backup_instance proof "$3"'
    elif kind in ('policy', 'redirection'):
        target = root / ('missing-' + value) / 'dump.gz' if kind == 'redirection' else root / 'dump.gz'
        shell += 'PROBE="$4"; write_instance_database_backup proof "$3" fixture fixture'
    elif kind in ('mass-list', 'mass-counts'):
        shell += 'source "$3"; backup_all_instances'
        target = SOURCE / 'server_tools/ctl/lib/instance_mass.sh'
    else:
        shell += 'backup_instance "$3"'
        target = instance
    result = run_shell(root, shell, library, target, value, cwd=root)
    output = result.stdout + result.stderr
    content_refusal = b'Recovery content refused; no complete file was published.' in output
    if content_refusal:
        # E15 checks artifact names before filesystem utilities can reach the
        # old diagnostic-error path. That earlier, fixed refusal is valid too.
        assert result.returncode != 0
        assert not list(root.rglob('*.partial.*'))
    elif kind == 'redirection':
        assert result.returncode and b'No such file or directory' in output
        assert_redacted(result)
    else:
        assert_redacted(result)
    assert os.fsencode(value) not in output and KEY not in output
    if kind == 'policy':
        assert result.returncode == 0 and b'ignoring unknown sql_dump_policy' in result.stderr
    if kind == 'directory' and not content_refusal:
        assert result.returncode == 1 and b'File exists' in result.stderr


@pytest.mark.parametrize('form', FORMS[:5])
@pytest.mark.parametrize('script', ['app/filterest', 'app/ctl'])
def test_launcher_cache_refusals_scan_operator_environment(tmp_path, form, script):
    root = signing_root(tmp_path / 'installation')
    # app-level calls retain the caller's explicit relative cache setting.
    value = form_value(form)
    cache = 'relative-' + value
    arguments = ['update', '--help'] if script == 'app/filterest' else ['--backup', '--help']
    result = subprocess.run(['/bin/bash', str(SOURCE.parent / script), *arguments], capture_output=True,
        env=dict(os.environ, FILTEREST_PROJECT_ROOT_OVERRIDE=str(root), PYTHONPYCACHEPREFIX=cache), timeout=60)
    assert result.returncode == 1 and b'PYTHONPYCACHEPREFIX must be an absolute path' in result.stderr
    assert_redacted(result)
    assert os.fsencode(value) not in result.stdout + result.stderr


@pytest.mark.parametrize('function', ['stop_runtime', 'apply_update', 'start_updated_runtime', 'docker_runner'])
@pytest.mark.parametrize('form', FORMS[:5])
def test_update_child_command_streams_are_scanned(tmp_path, function, form):
    root = signing_root(tmp_path / 'installation')
    child = root / 'child'
    child.write_text('#!/bin/bash\nprintf "child progress: %s\\n" "$PROBE"\nprintf "child cause: %s\\n" "$PROBE" >&2\nexit 23\n')
    child.chmod(0o700)
    updater = SOURCE / 'server_tools/update_filterest.sh'
    source = updater.read_text().rsplit('main "$@"', 1)[0].replace('"${BASH_SOURCE[0]}"', shlex.quote(str(updater)))
    # Supply the child to the real wrapper sites; no output scanner is mocked.
    if function == 'docker_runner':
        invoke = 'DOCKER_RUNNER="$CHILD"; docker_runner stop-app'
    elif function == 'stop_runtime':
        (root / 'ctl').symlink_to(child)
        invoke = 'PROFILE=development; stop_runtime'
    elif function == 'apply_update':
        native = root / 'native/server_tools'
        native.mkdir(parents=True)
        (native / 'install_filterest.sh').symlink_to(child)
        invoke = 'git() { return 0; }; PROFILE=development; SOURCE_ROOT="$INSTALLATION_ROOT/native"; apply_update'
    else:
        native = root / 'native/server_tools'
        native.mkdir(parents=True)
        (native / 'run_filterest_admin.sh').symlink_to(child)
        invoke = 'PROFILE=admin; SOURCE_ROOT="$INSTALLATION_ROOT/native"; start_updated_runtime'
    result = subprocess.run(['/bin/bash', '-c', source + '\n' + invoke], capture_output=True, timeout=60,
        env=dict(os.environ, FILTEREST_ROOT=str(root), CHILD=str(child), PROBE=form_value(form)))
    assert result.returncode == 23 and b'child cause:' in result.stderr and b'child progress:' in result.stdout
    assert_redacted(result)
    assert os.fsencode(form_value(form)) not in result.stdout + result.stderr
