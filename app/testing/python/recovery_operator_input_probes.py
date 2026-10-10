"""recovery_operator_input_probes.py: adversarial operator-input fixtures.

Connects real shell utility call sites to local failing transports and captures
scanner invocation metadata without contacting a database, Docker or the network.
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys

SOURCE = Path(__file__).resolve().parents[2]
KEY = b'\xfb\xff' + b'A' * 30
FORMS = ('raw', 'hex', 'base64', 'urlsafe', 'embedded-base64', 'utf16le-hex', 'utf16be-hex')
SHELL_FILES = (
    'server_tools/run_filterest_docker.sh', 'server_tools/update_filterest.sh',
    'server_tools/setup_local_dev_environment.sh', 'server_tools/lib/docker_deployment_settings.sh',
    'server_tools/lib/easelect_private_paths.sh', 'server_tools/ctl/lib/instance_restore.sh',
    'server_tools/ctl/lib/instance_restore_security.sh', 'server_tools/ctl/lib/instance_backup.sh',
)


def form_value(name):
    return {'raw': os.fsdecode(KEY), 'hex': KEY.hex().upper(),
        'base64': base64.b64encode(KEY).decode(), 'urlsafe': base64.urlsafe_b64encode(KEY).decode(),
        'embedded-base64': base64.b64encode(b'X' + KEY + b'after').decode(),
        'utf16le-hex': KEY.hex().upper().encode('utf-16le').decode(),
        'utf16be-hex': KEY.hex().upper().encode('utf-16be').decode()}[name]


def signing_root(path):
    (path / 'keys').mkdir(parents=True)
    key = path / 'keys/database_recovery.hmac.key'
    key.write_text(KEY.hex() + '\n')
    key.chmod(0o600)
    return path


def command_at(source, start):
    """Extract the real invocation, including nested quoted substitutions."""
    quote, stack, end = '', [], start
    while end < len(source):
        char = source[end]
        if char == "\\" and quote != "'":
            end += 2
            continue
        if quote != "'" and source[end:end + 2] == '$(':
            stack.append(quote)
            quote = ''
            end += 2
            continue
        if quote:
            if char == quote:
                quote = ''
        elif char in ('"', "'"):
            quote = char
        elif char == '(':
            stack.append('')
        elif char == ')':
            if not stack:
                break
            quote = stack.pop()
        elif not stack and (char in ';\n}' or source[end:end + 2] in ('||', '&&', '<<')):
            break
        end += 1
    return source[start:end].rstrip().removesuffix('\\').rstrip()


def utility_sites():
    sites = []
    for name in SHELL_FILES:
        source = (SOURCE / name).read_text()
        for match in re.finditer(r'filterest_recovery_(?:utility|output|to_file|version|content_to_file|mktemp) ', source):
            command = command_at(source, match.start())
            if command.endswith('"$@"') or command.startswith('filterest_recovery_utility >'):
                continue  # The shared dispatcher is exercised through real Compose calls.
            sites.append((name, source[:match.start()].count('\n') + 1, command))
    return sites


UTILITY_SITES = utility_sites()
EXPECTED_SITE_COUNTS = (34, 44, 17, 5, 1, 24, 14, 7)
assert tuple(sum(row[0] == name for row in UTILITY_SITES) for name in SHELL_FILES) == EXPECTED_SITE_COUNTS, "A recovery utility site lost its regression boundary"


def assert_utility_site(tmp_path, site, representation):
    root = signing_root(tmp_path / 'installation')
    value = form_value(representation)
    probe = str(root / ('--' + value))
    commands = tmp_path / 'tools'
    commands.mkdir()
    log = tmp_path / 'called'
    # Only the scanner's isolated interpreter runs normally; every tested utility
    # is a local failure that tries both raw and shell-escaped stderr disclosure.
    script = '#!/bin/bash\n' + 'if [[ "${1:-}" == -I ]]; then exec ' + shlex.quote(sys.executable) + ' "$@"; fi\n'
    script += 'printf "%s" "$*" >> ' + shlex.quote(str(log)) + '\nprintf "UNFILTERED utility: %s\\n" "$*" >&2\nprintf "ESCAPED: %q\\n" "$*" >&2\nprintf "port 8100 is already allocated\\n" >&2\nexit 23\n'
    for tool in ('mkdir', 'chmod', 'mktemp', 'cp', 'mv', 'rm', 'dirname', 'find', 'openssl', 'git', 'curl', 'docker', 'python3', 'gzip', 'cat', 'sed', 'du'):
        target = commands / tool
        target.write_text(script)
        target.chmod(0o700)
    command = site[2]
    variables = set(re.findall(r'\$(?:\{)?([A-Za-z_][A-Za-z0-9_]*)', command))
    values = {name: probe for name in variables}
    for name in ('PROJECT_ROOT', 'INSTALLATION_ROOT', 'project_root'):
        values[name] = str(root)
    values['security_file'] = str(root / 'security.sql')
    values['inventory_directory'] = str(root)
    values['library'] = str(SOURCE / 'server_tools/ctl/lib')
    values.update(mode='700', status='0', resource='network', GIT_SOURCE_PREFIX='',
                  interpreter='python3', runtime_uid='1000', runtime_gid='1000')
    # Recovery also wraps finite child launchers. Install the same failing
    # transport at their real paths; a nonexistent script would test status 127
    # rather than exercising the actual output/explanation boundary.
    child_paths = []
    if '"$SOURCE_ROOT/server_tools/' in command:
        child_paths.extend(Path(values['SOURCE_ROOT']) / 'server_tools' / name
            for name in ('install_filterest.sh', 'run_filterest_admin.sh'))
    if '"$INSTALLATION_ROOT/ctl"' in command:
        child_paths.append(root / 'ctl')
    if '"$INSTALLATION_ROOT/filterest"' in command:
        child_paths.append(root / 'filterest')
    for target in child_paths:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(script)
        target.chmod(0o700)
    if '| gzip -9 > "$backup_file"' in command:
        Path(values['backup_file']).parent.mkdir(parents=True, exist_ok=True)
    assignments = '\n'.join(name + '=' + shlex.quote(value) for name, value in values.items())
    # Index expansions in the Docker inventory refer to one original path.
    assignments += '\nids=("$PROBE")\n'
    library = SOURCE / 'server_tools/lib/installation_records.sh'
    shell = 'set -o pipefail\nsource ' + shlex.quote(str(library)) + '\n' + assignments + '\nprobe_site() {\n' + command + '\n}\nprobe_site\n'
    result = subprocess.run(['/bin/bash', '-c', shell], capture_output=True,
        env=dict(os.environ, PATH=str(commands) + ':' + os.environ['PATH'], PROBE=probe), cwd=root)
    output = result.stdout + result.stderr
    if any(name in command for name in ('filterest_recovery_to_file', 'filterest_recovery_content_to_file', 'filterest_recovery_mktemp')) and not log.exists():
        assert result.returncode == 1 and (b'Recovery path refused;' in output or b'Recovery content refused;' in output), (site, output)
        assert KEY not in output and value.encode('utf-8', errors='surrogateescape') not in output
        return
    assert log.exists(), (site, output)
    # The real empty-container lookup ends in grep status 1. Other pipelines
    # retain the failing utility's status through the caller's pipefail setting.
    expected_status = 1 if '| grep -Fq' in command else 23
    assert result.returncode == expected_status, (site, output)
    if '2>&1' not in command:
        assert b'port 8100 is already allocated' in output, (site, output)
        assert b'UNFILTERED utility:' in output and b'ESCAPED:' in output, (site, output)
    assert KEY not in output and value.encode('utf-8', errors='surrogateescape') not in output, (site, output)
    assert (b'Recovery command failed:' in output or b'Recovery file command failed:' in output) or '2>&1' in command, (site, output)
    if value.encode('utf-8', errors='surrogateescape') in log.read_bytes() and '2>&1' not in command:
        assert b'redacted:' in output, (site, output)


def assert_scanner_invocation(tmp_path, representation, failed=False):
    value = form_value(representation)
    root = signing_root(tmp_path / ('root-' + value))
    library = tmp_path / ('library-' + value)
    library.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(SOURCE / 'server_tools/lib', library, ignore=shutil.ignore_patterns('__pycache__'))
    commands = tmp_path / 'bin'
    commands.mkdir()
    capture = tmp_path / 'capture.json'
    stub = commands / 'python3'
    stub.write_text('#!' + sys.executable + '\nimport json, os, sys\n'
        + 'with open(' + repr(str(capture)) + ', "w") as handle:\n    json.dump({"argv":sys.argv, "environment":dict(os.environ)}, handle)\n'
        + ('sys.exit(23)\n' if failed else 'os.execv(' + repr(sys.executable) + ', ["python3", *sys.argv[1:]])\n'))
    stub.chmod(0o700)
    environment = dict(os.environ, PATH=str(commands) + ':' + os.environ['PATH'])
    for name in ('FILTEREST_ROOT', 'FILTEREST_APPLICATION_ROOT', 'FILTEREST_PROJECT_ROOT_OVERRIDE',
        'FILTEREST_BUILD_ROOT_OVERRIDE', 'FILTEREST_RUNTIME_ROOT_OVERRIDE', 'FILTEREST_LOG_FILE_OVERRIDE',
        'PYTHONPYCACHEPREFIX', 'FILTEREST_PROJECT_VENV_DIR', 'PLAYWRIGHT_BROWSERS_PATH', 'GOMODCACHE',
        'GOCACHE', 'NODE_PATH', 'FILTEREST_NODE_MODULES_ROOT', 'FILTEREST_TEST_CREDENTIAL_FILE',
        'EASELECT_RUNTIME_ENV_FILE', 'PROJECT_ROOT', 'UNRELATED_OPERATOR_EXPORT'):
        environment[name] = str(root)
    result = subprocess.run(['/bin/bash', '-c', 'source "$1"; filterest_recovery_diagnostic "$2" "%s\\n" "$3"',
        'probe', str(library / 'installation_records.sh'), str(root), str(root / 'packet')],
        env=environment, capture_output=True)
    captured = json.loads(capture.read_text())
    assert captured['argv'][1:4] == ['-I', '-B', '-c'] and len(captured['argv']) == 5
    assert set(captured['environment']) <= {'LC_CTYPE'}
    for item in (*captured['argv'], *captured['environment'].keys(), *captured['environment'].values()):
        assert KEY not in os.fsencode(item) and value not in item and str(root) not in item and str(library) not in item
    assert result.returncode == 0
    assert KEY not in result.stdout + result.stderr and value.encode('utf-8', errors='surrogateescape') not in result.stdout + result.stderr
    if failed:
        assert not result.stdout and b'sensitive details withheld' in result.stderr
    else:
        assert not result.stderr and b'redacted:' in result.stdout
    assert not list(library.rglob('__pycache__'))
