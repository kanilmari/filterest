"""Exercise operator output and legacy recovery with local transports only.

Connects real lifecycle dispatch, SQL import and option parsing to synthetic
streams. No database, Docker daemon or network is used.
"""
from __future__ import annotations

import gzip
import os
from pathlib import Path
import subprocess

import pytest

from recovery_operator_input_probes import FORMS, KEY, SOURCE, form_value, signing_root

LIBRARY = SOURCE / 'server_tools/lib/installation_records.sh'


@pytest.mark.parametrize('operation, explanation', [
    ('up --detach', 'port 8100 is already allocated'),
    ('build', 'failed to solve: missing build input'),
    ('ps', 'Cannot connect to the Docker daemon'),
])
def test_lifecycle_dispatch_preserves_operator_failure_and_status(tmp_path, operation, explanation):
    root = signing_root(tmp_path / 'installation')
    runner = SOURCE / 'server_tools/run_filterest_docker.sh'
    result = subprocess.run(['/bin/bash', '-c', r'''
source "$1"
docker() { printf 'lifecycle progress\n'; printf '%s\n' "$EXPLANATION" >&2; return 23; }
shift
run docker compose --project-directory "$PROJECT_ROOT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
''', 'probe', str(runner), *operation.split()], capture_output=True,
        env=dict(os.environ, FILTEREST_PROJECT_ROOT_OVERRIDE=str(root),
                 FILTEREST_DOCKER_RUNNER_LIBRARY_ONLY='1', EXPLANATION=explanation))
    assert result.returncode == 23
    assert result.stdout == b'lifecycle progress\n'
    assert explanation.encode() in result.stderr


@pytest.mark.parametrize('representation', FORMS)
@pytest.mark.parametrize('status', [0, 23])
def test_operator_streams_scan_returned_representations_and_preserve_status(tmp_path, representation, status):
    root = signing_root(tmp_path / 'installation')
    payload = root / 'payload'
    value = form_value(representation).encode('utf-8', errors='surrogateescape')
    payload.write_bytes(b'ordinary cause: ' + value + b'\n')
    result = subprocess.run(['/bin/bash', '-c', r'''
source "$1"
emit() { cat "$PAYLOAD"; cat "$PAYLOAD" >&2; return "$COMMAND_STATUS"; }
filterest_recovery_output "$2" emit
''', 'probe', str(LIBRARY), str(root)], capture_output=True,
        env=dict(os.environ, PAYLOAD=str(payload), COMMAND_STATUS=str(status)))
    assert result.returncode == status
    for stream in (result.stdout, result.stderr):
        assert b'ordinary cause:' in stream and b'redacted:' in stream
        assert KEY not in stream and value not in stream


@pytest.mark.parametrize('status', [0, 23])
def test_operator_output_scanner_failure_withholds_both_streams(tmp_path, status):
    commands = tmp_path / 'bin'
    commands.mkdir()
    scanner = commands / 'python3'
    scanner.write_text('#!/bin/bash\nexit 29\n')
    scanner.chmod(0o700)
    result = subprocess.run(['/bin/bash', '-c', r'''
source "$1"
emit() { printf 'private stdout'; printf 'private stderr' >&2; return "$COMMAND_STATUS"; }
filterest_recovery_output "$2" emit
''', 'probe', str(LIBRARY), str(tmp_path)], capture_output=True,
        env=dict(os.environ, PATH=str(commands) + ':' + os.environ['PATH'], COMMAND_STATUS=str(status)))
    assert result.returncode == status
    assert not result.stdout
    assert b'sensitive details withheld' in result.stderr
    assert b'private' not in result.stdout + result.stderr


@pytest.mark.parametrize('program, status', [('/bin/true', 0), ('/bin/false', 1)])
def test_fast_external_capture_waits_for_its_scanner_under_nounset(tmp_path, program, status):
    result = subprocess.run(['/bin/bash', '-c', r'''
set -euo pipefail
source "$1"
for attempt in {1..10}; do
    actual=0
    output="$(filterest_recovery_utility "$2" "$3")" || actual=$?
    [[ "$actual" == "$4" && -z "$output" ]] || exit 29
done
''', 'probe', str(LIBRARY), str(tmp_path), program, str(status)], capture_output=True)
    assert result.returncode == 0
    assert b'unbound variable' not in result.stderr


@pytest.mark.parametrize('representation', FORMS)
@pytest.mark.parametrize('compressed, status', [(False, 0), (True, 0), (False, 23)])
def test_legacy_import_scans_postgres_rows_and_errors(tmp_path, representation, compressed, status):
    root = signing_root(tmp_path / 'installation')
    payload = root / 'returned_rows'
    value = form_value(representation).encode('utf-8', errors='surrogateescape')
    payload.write_bytes(b'PostgreSQL returned row: ' + value + b'\n')
    dump = root / ('packet.sql.gz' if compressed else 'packet.sql')
    dump.write_bytes(gzip.compress(b'SELECT 42;\n') if compressed else b'SELECT 42;\n')
    result = subprocess.run(['/bin/bash', '-c', r'''
source "$1"
docker() {
    if [[ "$1" == exec ]]; then
        cat > current.sql
        if grep -q '^SELECT 42;' current.sql; then
            cat "$PAYLOAD"; cat "$PAYLOAD" >&2
            printf 'PostgreSQL useful import explanation\n' >&2
            return "$IMPORT_STATUS"
        fi
    fi
    return 0
}
restore_copy_function_security() { return 0; }
restore_copy_database_settings() { return 0; }
wait_for_instance_app() { return 0; }
restore_instance_database_replacement proof "$2"
''', 'probe', str(SOURCE / 'server_tools/ctl/lib/instance_restore.sh'), str(dump)],
        capture_output=True, cwd=root, env=dict(os.environ, PROJECT_ROOT=str(root),
            DB_ADMIN_USER='fixture', DB_NAME='fixture', PAYLOAD=str(payload), IMPORT_STATUS=str(status)))
    assert result.returncode == (1 if status else 0)
    assert b'PostgreSQL useful import explanation' in result.stderr
    for stream in (result.stdout, result.stderr):
        assert b'PostgreSQL returned row:' in stream and b'redacted:' in stream
        assert KEY not in stream and value not in stream
    evidence = next((root / 'instances/proof/backups').glob('restore_*.txt')).read_text()
    assert ('phase=import_failed' if status else 'phase=ready') in evidence


@pytest.mark.parametrize('representation', FORMS[:5])
def test_legacy_parser_uses_fixed_unknown_option_text(tmp_path, representation):
    source = (SOURCE / 'server_tools/ctl/ctl_main.sh').read_text()
    parser = source[source.index('MODE="local"'):source.index('# Main\n')]
    root = signing_root(tmp_path / 'installation')
    (root / 'instances/example').mkdir(parents=True)
    common = SOURCE / 'server_tools/ctl/lib/common.sh'
    result = subprocess.run(['/bin/bash', '-c', 'set -euo pipefail\nsource "' + str(common) + '"\n' + parser,
        'probe', '--instance', 'example', '--restore', 'fixture.dump', '--bad-' + form_value(representation)],
        capture_output=True, cwd=root, env=dict(os.environ, PROJECT_ROOT=str(root)))
    assert result.returncode == 1
    assert b'Unknown option; use --help for supported options.' in result.stdout
    assert KEY not in result.stdout + result.stderr
    assert form_value(representation).encode('utf-8', errors='surrogateescape') not in result.stdout + result.stderr


@pytest.mark.parametrize('representation', FORMS)
@pytest.mark.parametrize('escape', ['octal', 'hex', 'mixed'])
def test_utility_filename_escapes_are_scanned_without_rewriting_the_cause(tmp_path, representation, escape):
    root = signing_root(tmp_path / 'installation')
    value = form_value(representation).encode('utf-8', errors='surrogateescape')
    quoted = b''.join((b'\\%03o' % byte if escape == 'octal' or (escape == 'mixed' and i % 2)
                     else b'\\x%02x' % byte) for i, byte in enumerate(value))
    result = subprocess.run(['/bin/bash', '-c', 'source "$1"; filterest_redact_recovery_diagnostics "$2"',
        'probe', str(LIBRARY), str(root)], input=b"cannot read $'prefix-" + quoted + b"': Permission denied\n",
        capture_output=True)
    assert result.returncode == 0 and not result.stderr
    assert b'Permission denied' in result.stdout and b'redacted:' in result.stdout
    assert KEY not in result.stdout and value not in result.stdout and quoted not in result.stdout


def test_updater_validation_preserves_specific_explanation(tmp_path):
    root = signing_root(tmp_path / 'installation')
    # Read definitions without dispatching main; the real validation heredoc runs.
    updater = SOURCE / 'server_tools/update_filterest.sh'
    source = updater.read_text().rsplit('main "$@"', 1)[0]
    source = source.replace('"${BASH_SOURCE[0]}"', '"$UPDATER_SOURCE"')
    result = subprocess.run(['/bin/bash', '-c', source + r'''
TEMP_DIR="$INSTALLATION_ROOT"
TARGET_TAG=v1.2.3; TARGET_COMMIT=abc; TARGET_VERSION=1.2.3
git() {
    case "$*" in
        *rev-parse*|*rev-list*) printf 'abc\n' ;;
        *show*) printf '{"product":"filterest","app_version":"1.2.3","channel":"stable","artifact_type":"wrong"}\n' ;;
    esac
}
fetch_and_verify_target
'''], capture_output=True, env=dict(os.environ, FILTEREST_ROOT=str(root), UPDATER_SOURCE=str(updater)))
    assert result.returncode == 1
    assert b"build identity artifact_type is 'wrong', expected 'runtime'" in result.stderr
