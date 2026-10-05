"""Verify worker model selection, billing and installed Codex/Claude dispatch.

Exercises the shell entrypoint against local fake CLIs, including detached runs.
No model, registry, credentials, live application or database is contacted.
Protects exact version checks, subscription billing, background start
confirmation and prompt/argument boundaries from regressions.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time

import pytest


ROOT = Path(__file__).resolve().parents[3]
CORE = ROOT / "app/server_tools/agent_tools/worker_agent/worker_agent_core.sh"

# Variables through which a CLI would bill an API account or a cloud provider.
BILLING_VARIABLES = ('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK',
                     'CLAUDE_CODE_USE_VERTEX', 'OPENAI_API_KEY', 'CODEX_API_KEY')
# Recognisable stand-ins, so a test fails if the launcher ever prints a value.
FAKE_KEYS = {name: f'fake-value-of-{name.lower()}' for name in BILLING_VARIABLES}


@pytest.fixture
def worker(tmp_path):
    bin_dir = tmp_path / "tools with spaces"
    bin_dir.mkdir()
    codex = bin_dir / "codex"
    # Captures record environment variable names only, never their values.
    codex.write_text("""#!/usr/bin/python3
import json, os, pathlib, sys, time
if sys.argv[1:] == ['--version']:
    print('codex-cli ' + os.environ.get('FAKE_CODEX_VERSION', '0.160.0'))
    sys.exit(int(os.environ.get('FAKE_VERSION_EXIT', '0')))
if sys.argv[1:] == ['login', 'status']:
    pathlib.Path(os.environ['SIGN_IN_CAPTURE']).write_text(json.dumps(sorted(os.environ)))
    print(os.environ.get('FAKE_CODEX_LOGIN', 'Logged in using ChatGPT'), file=sys.stderr)
    sys.exit(int(os.environ.get('FAKE_CODEX_LOGIN_EXIT', '0')))
pathlib.Path(os.environ['CODEX_CAPTURE']).write_text(json.dumps({
    'args': sys.argv[1:], 'prompt': sys.stdin.read(), 'environment': sorted(os.environ),
    'pid': os.getpid()}))
time.sleep(float(os.environ.get('FAKE_CODEX_SECONDS', '0')))
print('codex\\n# Stub worker summary\\nLocal test completed.')
sys.exit(int(os.environ.get('FAKE_CODEX_EXIT', '0')))
""")
    codex.chmod(0o755)
    claude = bin_dir / "claude"
    claude.write_text("""#!/usr/bin/python3
import json, os, pathlib, sys
if sys.argv[1:3] == ['auth', 'status']:
    pathlib.Path(os.environ['SIGN_IN_CAPTURE']).write_text(json.dumps(sorted(os.environ)))
    method = os.environ.get('FAKE_CLAUDE_AUTH_METHOD', 'claude.ai')
    print(json.dumps({'loggedIn': method != 'none', 'authMethod': method,
                      'apiProvider': os.environ.get('FAKE_CLAUDE_PROVIDER', 'firstParty'),
                      'email': 'person@example.invalid'}))
    sys.exit(0 if method != 'none' else 1)
pathlib.Path(os.environ['CLAUDE_CAPTURE']).write_text(json.dumps({
    'args': sys.argv[1:], 'prompt': sys.stdin.read(), 'environment': sorted(os.environ)}))
print('# Stub worker summary\\nLocal test completed.')
""")
    claude.chmod(0o755)
    npx = bin_dir / "npx"
    npx.write_text('#!/bin/sh\ntouch "$NPX_CAPTURE"\nexit 91\n')
    npx.chmod(0o755)
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(('WORKER_', 'FILTEREST_WORKER_')) and key not in BILLING_VARIABLES}
    env.update({
        'PATH': f"{bin_dir}:{os.environ['PATH']}",
        'FILTEREST_WORKSPACE_ROOT': str(tmp_path),
        'CODEX_CAPTURE': str(tmp_path / 'capture.json'),
        'CLAUDE_CAPTURE': str(tmp_path / 'claude-capture.json'),
        'SIGN_IN_CAPTURE': str(tmp_path / 'sign-in-capture.json'),
        'NPX_CAPTURE': str(tmp_path / 'npx-called'),
    })
    output = tmp_path / 'runs'

    def run(*options, prompt='Only a local test.', overrides=None):
        current_env = {**env, **(overrides or {})}
        result = subprocess.run(
            ['bash', str(CORE), 'family=codex', '--no-full-access',
             '--no-summary-instr', '--output-dir', str(output),
             '--task-id', 'test-run', *options, '-'],
            cwd=tmp_path, env=current_env, input=prompt,
            text=True, capture_output=True, timeout=20,
        )
        assert not Path(env['NPX_CAPTURE']).exists(), 'worker must never invoke npx'
        return result

    return run, env, output, codex


@pytest.mark.parametrize('model', ['gpt-5.6-sol', 'gpt-6-astra'])
def test_explicit_model_effort_override_environment_and_preserve_stdin(worker, model):
    run, env, output, codex = worker
    prompt = '--model unwanted\nQuotes: " \' $HOME $(exit 99) `false`\n' + 'x' * 140000
    result = run('--codex-model', model, '--codex-reasoning-effort', 'xhigh',
                 prompt=prompt, overrides={'WORKER_CODEX_MODEL': 'env-model',
                                          'WORKER_CODEX_REASONING_EFFORT': 'low'})
    assert result.returncode == 0, result.stderr
    capture = json.loads(Path(env['CODEX_CAPTURE']).read_text())
    assert capture['args'] == ['exec', '--sandbox', 'workspace-write', '--model', model,
                               '-c', 'model_reasoning_effort="xhigh"', '-']
    assert capture['prompt'].startswith(prompt + '\n')
    status = next(output.glob('*/run_status.txt')).read_text()
    assert 'status=succeeded' in status
    assert f'codex_executable={codex}' in status
    assert 'codex_version=0.160.0' in status
    assert f'codex_model_requested={model}' in status
    assert 'codex_reasoning_effort_requested=xhigh' in status


def test_background_preserves_explicit_executable_and_environment_settings(worker):
    run, env, output, codex = worker
    result = run('--background', overrides={
        'WORKER_CODEX_BIN': str(codex), 'WORKER_CODEX_MODEL': 'gpt-6-astra',
        'WORKER_CODEX_REASONING_EFFORT': 'xhigh'})
    assert result.returncode == 0, result.stderr
    status_path = next(output.glob('*/run_status.txt'))
    for _ in range(100):
        status = status_path.read_text()
        if 'status=succeeded' in status or 'status=failed' in status:
            break
        time.sleep(0.05)
    assert 'status=succeeded' in status
    assert 'codex_model_requested=gpt-6-astra' in status
    capture = json.loads(Path(env['CODEX_CAPTURE']).read_text())
    assert '--model' in capture['args']
    assert 'gpt-6-astra' in capture['args']
    assert 'model_reasoning_effort="xhigh"' in capture['args']
    log = next(output.glob('*/worker_log_*.txt')).read_text()
    assert f'Worker Codex executable: {codex}' in log
    assert 'Worker Codex version: 0.160.0' in log


def test_omitted_model_takes_codex_default_while_effort_takes_the_project_default(worker):
    """The model is Codex's to choose; the amount of thinking is not.

    Codex's own reasoning default is its lowest setting, and a batch of workers
    once ran that way before anyone noticed. The project therefore sets the
    effort and leaves the model alone, so a run that names neither still thinks
    hard. A run may still name its own effort.
    """
    run, env, output, _ = worker
    result = run()
    assert result.returncode == 0, result.stderr
    assert json.loads(Path(env['CODEX_CAPTURE']).read_text())['args'] == [
        'exec', '--sandbox', 'workspace-write',
        '-c', 'model_reasoning_effort="xhigh"', '-']
    status = next(output.glob('*/run_status.txt')).read_text()
    assert 'codex_model_requested=Codex config default' in status
    assert 'codex_reasoning_effort_requested=xhigh' in status


@pytest.mark.parametrize('overrides,diagnostic', [
    ({'WORKER_CODEX_BIN': '/definitely-absent-codex'}, 'Codex executable not found'),
    ({'FAKE_CODEX_VERSION': '0.999.0'}, 'Codex version mismatch'),
    ({'FAKE_VERSION_EXIT': '1'}, 'Cannot read Codex version'),
    ({'WORKER_CODEX_VERSION': 'latest'}, 'exact CLI version'),
])
def test_unavailable_or_unapproved_cli_fails_without_dispatch(worker, overrides, diagnostic):
    run, env, _, _ = worker
    result = run(overrides=overrides)
    assert result.returncode != 0
    assert diagnostic in result.stderr
    assert not Path(env['CODEX_CAPTURE']).exists()


@pytest.mark.parametrize('options', [
    ['--codex-reasoning-effort', 'extra-high'],
    ['--codex-model', '--full-access'],
    ['--codex-model'],
])
def test_invalid_selection_cannot_start_a_model(worker, options):
    run, env, _, _ = worker
    result = run(*options)
    assert result.returncode != 0
    assert not Path(env['CODEX_CAPTURE']).exists()


def test_dry_run_shows_requested_settings_without_requiring_an_installation(worker):
    run, env, _, _ = worker
    result = run('--dry-run', '--codex-model', 'gpt-5.6-sol',
                 '--codex-reasoning-effort', 'xhigh',
                 overrides={'WORKER_CODEX_BIN': '/absent-for-dry-run'})
    assert result.returncode == 0, result.stderr
    assert 'gpt-5.6-sol' in result.stderr
    assert 'xhigh' in result.stderr
    assert 'not checked in dry-run' in result.stderr
    assert not Path(env['CODEX_CAPTURE']).exists()


def test_model_failure_propagates_without_fallback(worker):
    run, env, output, _ = worker
    result = run('--codex-model', 'unavailable-model',
                 overrides={'FAKE_CODEX_EXIT': '42'})
    assert result.returncode == 42
    status = next(output.glob('*/run_status.txt')).read_text()
    assert 'status=failed' in status
    assert 'exit_code=42' in status
    assert 'unavailable-model' in json.loads(Path(env['CODEX_CAPTURE']).read_text())['args']


def test_explicit_exact_version_upgrade(worker):
    run, _, output, _ = worker
    result = run(overrides={'WORKER_CODEX_VERSION': '0.156.0',
                            'FAKE_CODEX_VERSION': '0.156.0'})
    assert result.returncode == 0, result.stderr
    assert 'codex_version=0.156.0' in next(output.glob('*/run_status.txt')).read_text()


@pytest.mark.parametrize('access_options, expected_sandbox', [
    ((), 'workspace-write'),
    (('--no-full-access',), 'workspace-write'),
    (('--full-access',), 'danger-full-access'),
])
def test_worker_sandbox_defaults_to_workspace_write(worker, tmp_path, access_options, expected_sandbox):
    """A worker no longer receives full system access unless the run asks for it.

    Full access used to be the default, so every worker could reach the
    database, the network and the whole filesystem whether the task needed it or
    not. The explicit flag still works and must keep working.
    """
    _run, env, output, _codex = worker
    result = subprocess.run(
        ['bash', str(CORE), 'family=codex', '--no-summary-instr',
         '--output-dir', str(output), '--task-id', 'sandbox-default',
         *access_options, '-'],
        cwd=tmp_path, env=env, input='Only a local test.',
        text=True, capture_output=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr
    capture = json.loads(Path(env['CODEX_CAPTURE']).read_text())
    assert capture['args'][:3] == ['exec', '--sandbox', expected_sandbox]
    status = next(output.glob('*/run_status.txt')).read_text()
    if expected_sandbox == 'workspace-write':
        assert 'workspace only (no database, no network)' in status
    else:
        assert 'full (workspace, database and network)' in status


def captured_run(env, backend):
    """What the fake CLI saw when it ran the prompt, or None if it never ran."""
    capture = Path(env['CODEX_CAPTURE' if backend == 'codex' else 'CLAUDE_CAPTURE'])
    return json.loads(capture.read_text()) if capture.exists() else None


SIGNED_IN_ACCOUNT = {'codex': 'Codex signed in using ChatGPT',
                     'claude': 'Claude signed in with claude.ai'}


@pytest.mark.parametrize('backend, options', [
    ('codex', ()),
    ('claude', ()),
    ('codex', ('--subscription',)),
])
def test_subscription_is_the_default_and_its_run_never_sees_an_api_key(worker, backend, options):
    """Owner decision K174: a worker bills the signed-in subscription unless asked.

    The launcher used to hand its whole environment to the CLI, so a key that
    happened to be exported in the developer's shell quietly moved the run to
    API billing. The sign-in check runs under the same reduced environment.
    """
    run, env, output, _ = worker
    result = run(f'family={backend}', *options, overrides=FAKE_KEYS)
    assert result.returncode == 0, result.stderr
    assert not set(BILLING_VARIABLES) & set(captured_run(env, backend)['environment'])
    assert not set(BILLING_VARIABLES) & set(json.loads(Path(env['SIGN_IN_CAPTURE']).read_text()))
    status = next(output.glob('*/run_status.txt')).read_text()
    progress = next(output.glob('*/progress_*.md')).read_text()
    log = next(output.glob('*/worker_log_*.txt')).read_text()
    assert 'billing_mode=subscription' in status
    described = f'subscription ({SIGNED_IN_ACCOUNT[backend]}; API key variables removed)'
    assert f'- Billing: {described}' in progress
    assert f'Worker billing: {described}' in log
    shown = result.stdout + result.stderr + log
    assert not any(value in shown for value in FAKE_KEYS.values())
    assert 'person@example.invalid' not in shown


@pytest.mark.parametrize('backend', ['codex', 'claude'])
def test_api_billing_is_an_explicit_choice_that_keeps_the_environment(worker, backend):
    run, env, output, _ = worker
    result = run(f'family={backend}', '--api', overrides=FAKE_KEYS)
    assert result.returncode == 0, result.stderr
    assert set(BILLING_VARIABLES) <= set(captured_run(env, backend)['environment'])
    assert not Path(env['SIGN_IN_CAPTURE']).exists(), 'an --api run has no subscription to check'
    assert 'billing_mode=api' in next(output.glob('*/run_status.txt')).read_text()
    log = next(output.glob('*/worker_log_*.txt')).read_text()
    assert 'Worker billing: api (explicit --api; environment kept;' in log
    assert not any(value in result.stderr + log for value in FAKE_KEYS.values())


@pytest.mark.parametrize('backend, overrides, diagnostic', [
    ('codex', {'FAKE_CODEX_LOGIN': 'Not logged in', 'FAKE_CODEX_LOGIN_EXIT': '1'},
     'Codex is not signed in with a ChatGPT subscription'),
    ('codex', {'FAKE_CODEX_LOGIN': 'Logged in using an API key - sk-proj-***ABCD'},
     'Codex is signed in with an API key'),
    ('claude', {'FAKE_CLAUDE_AUTH_METHOD': 'none'}, '(sign-in: none)'),
    ('claude', {'FAKE_CLAUDE_AUTH_METHOD': 'api_key'}, '(sign-in: api_key)'),
    ('claude', {'FAKE_CLAUDE_PROVIDER': 'bedrock'}, '(sign-in: claude.ai via bedrock)'),
])
def test_subscription_run_is_refused_unless_the_cli_is_signed_in_with_it(
        worker, backend, overrides, diagnostic):
    """Keys in the environment must never stand in for a missing subscription."""
    run, env, output, _ = worker
    result = run(f'family={backend}', overrides={**FAKE_KEYS, **overrides})
    assert result.returncode != 0
    assert diagnostic in result.stderr
    assert 'Sign in with' in result.stderr and '--api' in result.stderr
    assert 'No worker was started' in result.stderr
    assert captured_run(env, backend) is None
    status = next(output.glob('*/run_status.txt')).read_text()
    assert 'status=failed' in status and 'billing_mode=subscription' in status
    for private in [*FAKE_KEYS.values(), 'sk-proj', 'person@example.invalid']:
        assert private not in result.stderr


@pytest.mark.parametrize('backend, key_variables', [
    ('codex', ('OPENAI_API_KEY', 'CODEX_API_KEY')),
    ('claude', ('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
                'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX')),
])
def test_api_run_without_a_key_for_its_backend_is_refused(worker, backend, key_variables):
    run, env, _, _ = worker
    other_backends_key = 'ANTHROPIC_API_KEY' if backend == 'codex' else 'OPENAI_API_KEY'
    result = run(f'family={backend}', '--api',
                 overrides={other_backends_key: FAKE_KEYS[other_backends_key]})
    assert result.returncode != 0
    assert all(name in result.stderr for name in key_variables)
    assert 'No worker was started' in result.stderr
    assert FAKE_KEYS[other_backends_key] not in result.stderr
    assert captured_run(env, backend) is None


@pytest.mark.parametrize('flags', [('--subscription', '--api'), ('--api', '--subscription')])
def test_subscription_and_api_together_are_refused(worker, flags):
    run, env, _, _ = worker
    result = run(*flags, overrides=FAKE_KEYS)
    assert result.returncode != 0
    assert 'contradict' in result.stderr
    assert captured_run(env, 'codex') is None
    assert not Path(env['SIGN_IN_CAPTURE']).exists()


def test_the_billing_line_alone_is_not_taken_for_a_quota_failure(tmp_path):
    """family=auto falls back to Codex on quota errors; the launcher's own line is not one."""
    runner = ROOT / 'app/server_tools/agent_tools/worker_agent/worker_agent_backend_runner.sh'
    log = tmp_path / 'worker_log.txt'

    def quota_error(text):
        log.write_text(text)
        return subprocess.run(
            ['bash', '-c', 'source "$1"; LOG_FILE="$2" check_quota_error', '_', str(runner), str(log)],
        ).returncode == 0

    header = 'Worker billing: subscription (Codex signed in using ChatGPT; API key variables removed)\n'
    assert not quota_error(header + 'Error: something else failed\n')
    assert quota_error(header + 'Error: insufficient_quota\n')
    assert quota_error('Your billing hard limit has been reached\n')


# The real setsid, found before any stand-in is put first on a launcher's PATH.
REAL_SETSID = shutil.which('setsid')


def replace_setsid(codex, script):
    """Put a stand-in setsid first on the launcher's PATH to control the detached start.

    It must be bash: dash drops the exported functions the detached run needs.
    $REAL_SETSID names the real one, through which a stand-in gives the run its
    own session and process group, as the launcher does.
    """
    if REAL_SETSID is None:
        pytest.skip('setsid is not installed')
    setsid = codex.parent / 'setsid'
    setsid.write_text(f'#!/bin/bash\nREAL_SETSID={REAL_SETSID}\n{script}\n')
    setsid.chmod(0o755)


def running(pid):
    """True while pid is a live process; a zombie has already stopped."""
    try:
        stat = Path(f'/proc/{pid}/stat').read_text()
    except OSError:
        return False
    return stat.rsplit(')', 1)[1].split()[0] != 'Z'


def group_exists(process_group):
    try:
        os.killpg(process_group, 0)
    except ProcessLookupError:
        return False
    return True


def kill_if_marked(pid, marker):
    """Test cleanup: kill pid only if it still carries this test's own marker."""
    try:
        if running(pid) and marker in Path(f'/proc/{pid}/environ').read_bytes():
            os.kill(pid, signal.SIGKILL)
    except OSError:
        pass


def test_background_start_is_reported_only_once_worker_pid_names_a_live_run(worker):
    """WL33: the launcher announced a start before the detached run had begun.

    Here the run begins a second late. The launcher must still be waiting then,
    and the pid it reports must be the live run's own, which also leads the
    process group recorded for --stop.
    """
    run, _, output, codex = worker
    replace_setsid(codex, 'sleep 1\nexec "$REAL_SETSID" "$@"')
    result = run('--background', overrides={'FAKE_CODEX_SECONDS': '3'})
    pid_files = list(output.glob('*/worker.pid'))
    assert pid_files, 'the launcher returned before the run wrote worker.pid'
    worker_pid = int(pid_files[0].read_text())
    assert result.returncode == 0, result.stderr
    assert f'Worker launched in background (PID: {worker_pid})' in result.stderr
    os.kill(worker_pid, 0)  # the reported run is alive; ProcessLookupError otherwise
    assert os.getpgid(worker_pid) == worker_pid
    status_path = next(output.glob('*/run_status.txt'))
    assert f'process_group={worker_pid}' in status_path.read_text()
    for _ in range(200):
        if 'status=succeeded' in status_path.read_text():
            break
        time.sleep(0.05)
    assert 'status=succeeded' in status_path.read_text()


def start_time(pid):
    """A process's start time, field 22 of /proc/<pid>/stat."""
    return Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19]


def stop_run(env, tmp_path, task_id, **extra):
    return subprocess.run(['bash', str(CORE), '--stop', task_id], cwd=tmp_path,
                          env={**env, 'FILTEREST_WORKER_OUTPUT_DIR_REL': 'runs', **extra},
                          text=True, capture_output=True, timeout=60)


def recorded_run(output, task_id, process_group, leader_start):
    """A run folder as a detached launch leaves it, for --stop to find."""
    run_dir = output / f'2026-10-04--12-00--{task_id}'
    run_dir.mkdir(parents=True)
    (run_dir / 'run_status.txt').write_text(
        f'task_id={task_id}\nstatus=running\nbackend=codex\nresearch_mode=false\n'
        f'billing_mode=subscription\nprocess_group={process_group}\n'
        f'process_group_leader_start={leader_start}\n')
    (run_dir / 'worker.pid').write_text(f'{process_group}\n')
    (run_dir / f'worker_log_{task_id}.txt').write_text('launch\n')
    return run_dir


def wait_for_backend_pid(env):
    for _ in range(150):
        try:
            return json.loads(Path(env['CODEX_CAPTURE']).read_text())['pid']
        except (OSError, ValueError, KeyError):
            time.sleep(0.1)
    return None


def test_unconfirmed_launch_records_no_result(worker):
    """A launch whose run never appears is unconfirmed, not failed: no result is recorded."""
    run, env, output, codex = worker
    replace_setsid(codex, 'exit 1')
    started = time.monotonic()
    result = run('--background', overrides={'WORKER_AGENT_LAUNCH_WAIT_SECONDS': '2'})
    assert result.returncode != 0
    assert 'Start not confirmed within 2 s — the run may still start' in result.stderr
    assert 'Worker launched in background' not in result.stderr
    assert time.monotonic() - started < 12, 'the wait must stay bounded'
    assert not list(output.glob('*/.worker_done_*')), 'an unconfirmed launch has no result'
    assert 'launch_unconfirmed=' in next(output.glob('*/run_status.txt')).read_text()
    assert 'launch_unconfirmed' in next(output.glob('*/worker_log_*.txt')).read_text()
    assert captured_run(env, 'codex') is None


def test_unconfirmed_launch_sends_no_signal_and_a_late_run_can_be_stopped(worker, tmp_path):
    """The launch gives up waiting, signals nothing, and the run that starts later is stoppable.

    The stand-in launcher records any TERM or INT it receives, then starts the
    run two seconds after the launcher has stopped waiting.
    """
    run, env, output, codex = worker
    signal_log = tmp_path / 'signals'
    replace_setsid(codex, 'trap \'echo TERM >> "$SIGNAL_LOG"\' TERM\n'
                          'trap \'echo INT >> "$SIGNAL_LOG"\' INT\n'
                          'sleep 3 & wait $!\n'
                          'exec "$REAL_SETSID" "$@"')
    backend_pid = None
    try:
        result = run('--background', overrides={'WORKER_AGENT_LAUNCH_WAIT_SECONDS': '1',
                                                'FAKE_CODEX_SECONDS': '60',
                                                'SIGNAL_LOG': str(signal_log)})
        assert result.returncode != 0
        assert 'Start not confirmed within 1 s — the run may still start' in result.stderr
        assert './worker_agent --status test-run' in result.stderr
        assert './worker_agent --stop test-run' in result.stderr
        assert 'launch_unconfirmed=' in next(output.glob('*/run_status.txt')).read_text()
        assert not list(output.glob('*/.worker_done_*'))

        backend_pid = wait_for_backend_pid(env)
        assert backend_pid and running(backend_pid), 'the late run never started'
        assert not signal_log.exists(), 'the launcher signalled the launch it gave up on'
        status = subprocess.run(['bash', str(CORE), '--status', 'test-run'], cwd=tmp_path,
                                env={**env, 'FILTEREST_WORKER_OUTPUT_DIR_REL': 'runs'},
                                text=True, capture_output=True, timeout=30)
        assert 'PID: alive' in status.stdout
        wrapper_pid = int(next(output.glob('*/worker.pid')).read_text())
        stopped = stop_run(env, tmp_path, 'test-run')
        assert stopped.returncode == 0, stopped.stderr
        assert f'(process group {wrapper_pid})' in stopped.stderr
        assert not running(backend_pid) and not group_exists(wrapper_pid)
    finally:
        if backend_pid:
            kill_if_marked(backend_pid, f"CODEX_CAPTURE={env['CODEX_CAPTURE']}".encode())


@pytest.mark.parametrize('alive_checks_after_kill, fail_check_at, expected_tail', [
    (2, 0, ['check', '-KILL'] + ['check', '-0'] * 3 + ['status=0']),
    (99, 0, ['check', '-KILL'] + ['check', '-0'] * 10 + ['status=1']),
    # The group's number is handed to another process during the grace: no KILL.
    (99, 6, ['check', 'status=2']),
])
def test_group_stop_confirms_identity_before_every_signal(
        alive_checks_after_kill, fail_check_at, expected_tail):
    """TERM to the whole group, the grace, KILL, a bounded re-check, each after an identity check.

    kill, sleep and the identity check are replaced inside the shell, so the
    exact sequence is visible: a group that outlives KILL is reported, and a
    group that stops being the run's receives nothing more.
    """
    state = ROOT / 'app/server_tools/agent_tools/worker_agent/worker_agent_run_state.sh'
    script = r'''
source "$1"
alive_after_kill="$2"
fail_check_at="$3"
killed=false
checks=0
calls=()
group_still_ours() {
    [[ "$1" == 4242 && "$2" == 777 ]] || exit 3
    checks=$(( checks + 1 ))
    calls+=("check")
    [[ "$fail_check_at" == 0 || "$checks" -lt "$fail_check_at" ]]
}
kill() {
    calls+=("$1")
    [[ "$2 $3" == "-- -4242" ]] || exit 3
    if [[ "$1" == -KILL ]]; then
        killed=true
    elif [[ "$1" == -0 && "$killed" == true ]]; then
        (( alive_after_kill-- > 0 ))
        return
    fi
    return 0
}
sleep() { :; }
own_process_group() { printf 1; }
stop_process_group 4242 777 3 && status=0 || status=$?
printf '%s\n' "${calls[@]}" "status=$status"
'''
    result = subprocess.run(
        ['bash', '-c', script, '_', str(state), str(alive_checks_after_kill), str(fail_check_at)],
        capture_output=True, text=True, check=True)
    head = ['check', '-0', 'check', '-TERM'] + ['check', '-0'] * 3
    assert result.stdout.splitlines() == head + expected_tail


def test_stop_ends_the_backend_not_just_its_wrapper(worker, tmp_path):
    """--stop signals the run's process group, so the backend stops with its wrapper.

    Signalling only the wrapper's pid let the backend run on: bash postpones a
    trap until its foreground command ends, and a later KILL orphaned the backend.
    """
    run, env, output, _ = worker
    launched = run('--background', overrides={'FAKE_CODEX_SECONDS': '60'})
    assert launched.returncode == 0, launched.stderr
    wrapper_pid = int(next(output.glob('*/worker.pid')).read_text())
    backend_pid = None
    try:
        backend_pid = wait_for_backend_pid(env)
        assert backend_pid and running(backend_pid), 'the fake backend never started'
        status = next(output.glob('*/run_status.txt')).read_text()
        assert f'process_group={wrapper_pid}\n' in status
        assert f'process_group_leader_start={start_time(wrapper_pid)}\n' in status
        stopped = stop_run(env, tmp_path, 'test-run')
        assert stopped.returncode == 0, stopped.stderr
        assert f'(process group {wrapper_pid})' in stopped.stderr
        assert not running(backend_pid), 'the backend kept running after --stop'
        assert not running(wrapper_pid)
        assert not group_exists(wrapper_pid)
        assert 'status=failed' in next(output.glob('*/run_status.txt')).read_text()
    finally:
        if backend_pid:
            kill_if_marked(backend_pid, f"CODEX_CAPTURE={env['CODEX_CAPTURE']}".encode())


def test_stop_refuses_a_group_whose_leader_has_another_start_time(worker, tmp_path):
    """A process holding the recorded leader pid with another start time is not the run's."""
    if REAL_SETSID is None:
        pytest.skip('setsid is not installed')
    _, env, output, _ = worker
    stranger = subprocess.Popen([REAL_SETSID, 'sleep', '300'])
    try:
        time.sleep(0.2)
        assert os.getpgid(stranger.pid) == stranger.pid
        recorded_run(output, 'reused-run', stranger.pid, int(start_time(stranger.pid)) + 1)
        stopped = stop_run(env, tmp_path, 'reused-run')
        assert stopped.returncode != 0
        assert 'can no longer be confirmed as this run' in stopped.stderr
        assert 'Nothing was signalled' in stopped.stderr
        assert stranger.poll() is None, 'a process that is not the run was signalled'
    finally:
        stranger.kill()
        stranger.wait()


def test_stop_kills_term_resistant_survivors_of_a_dead_leader(worker, tmp_path):
    """With no process holding the leader's pid, the group's survivors are still the run's.

    The number cannot be handed out again while the group has members, so --stop
    may signal them. The survivor ignores TERM, so it ends only by the KILL that
    follows the grace.
    """
    if REAL_SETSID is None:
        pytest.skip('setsid is not installed')
    _, env, output, _ = worker
    survivor_file = tmp_path / 'survivor.pid'
    leader = subprocess.Popen(
        [REAL_SETSID, 'bash', '-c', 'trap "" TERM; sleep 300 & echo $! > "$1"; read -r _', '_',
         str(survivor_file)], stdin=subprocess.PIPE)
    survivor = None
    try:
        for _ in range(50):
            if survivor_file.exists() and survivor_file.read_text().strip():
                break
            time.sleep(0.1)
        survivor = int(survivor_file.read_text())
        recorded_run(output, 'orphaned-run', leader.pid, start_time(leader.pid))
        leader.stdin.close()
        leader.wait()  # the leader is gone; its group lives on in the survivor
        assert running(survivor) and os.getpgid(survivor) == leader.pid
        started = time.monotonic()
        stopped = stop_run(env, tmp_path, 'orphaned-run', WORKER_AGENT_STOP_GRACE_SECONDS='1')
        assert stopped.returncode == 0, stopped.stderr
        assert f'(process group {leader.pid})' in stopped.stderr
        assert time.monotonic() - started >= 1, 'KILL came without the TERM grace'
        assert not running(survivor), 'a TERM-resistant survivor outlived --stop'
        assert not group_exists(leader.pid)
    finally:
        if survivor and running(survivor) and os.getpgid(survivor) == leader.pid:
            os.kill(survivor, signal.SIGKILL)


def test_background_is_refused_without_setsid_while_the_foreground_still_works(worker, tmp_path):
    run, env, _, codex = worker
    without_setsid = tmp_path / 'path without setsid'
    without_setsid.mkdir()
    for directory in os.environ['PATH'].split(os.pathsep):
        # Windows folders on a WSL PATH are slow to list and hold no setsid.
        if not directory.startswith('/') or directory.startswith('/mnt/') or not os.path.isdir(directory):
            continue
        for name in os.listdir(directory):
            link, target = without_setsid / name, os.path.join(directory, name)
            if (name != 'setsid' and not os.path.lexists(link)
                    and not os.path.isdir(target) and os.access(target, os.X_OK)):
                link.symlink_to(target)
    path = f'{codex.parent}:{without_setsid}'
    refused = run('--background', overrides={'PATH': path})
    assert refused.returncode != 0
    assert '--background needs setsid' in refused.stderr
    assert captured_run(env, 'codex') is None
    foreground = run(overrides={'PATH': path})
    assert foreground.returncode == 0, foreground.stderr
    assert captured_run(env, 'codex') is not None


@pytest.mark.parametrize('codex_exit', [0, 42])
def test_background_run_that_ends_before_confirmation_is_judged_by_its_sentinel(worker, codex_exit):
    """A run may already be over when the launcher first looks; its result decides.

    The stand-in launcher hides worker.pid until the run has finished, so the
    launcher can only see a finished run.
    """
    run, env, output, codex = worker
    replace_setsid(codex, 'visible="$PID_FILE"\n'
                          'PID_FILE="$visible.hidden" "$REAL_SETSID" "$@"\n'
                          'mv "$visible.hidden" "$visible"')
    result = run('--background', overrides={'FAKE_CODEX_EXIT': str(codex_exit)})
    assert captured_run(env, 'codex') is not None, 'the run itself did take place'
    log = next(output.glob('*/worker_log_*.txt'))
    if codex_exit == 0:
        assert result.returncode == 0, result.stderr
        assert 'Worker ran in background and has already finished successfully' in result.stderr
    else:
        assert result.returncode == codex_exit
        assert f'Worker run failed (exit {codex_exit}) before its launch was confirmed' in result.stderr
        assert f'Log file: {log}' in result.stderr
        assert 'Worker launched in background' not in result.stderr
        assert 'status=failed' in next(output.glob('*/run_status.txt')).read_text()


@pytest.mark.parametrize('stand_in, logged', [
    ('PID_FILE=/nonexistent-worker-directory/worker.pid exec "$REAL_SETSID" "$@"',
     'could not write worker.pid'),
    ('exec "$@"', 'does not lead its own process group'),
    # A stale check or --stop recorded a result before this late run began.
    ('printf "1\\t0\\tno\\n" > "$DONE_FILE"\nexec "$REAL_SETSID" "$@"',
     'already has a recorded result'),
])
def test_background_run_that_cannot_be_owned_never_starts_the_backend(worker, stand_in, logged):
    """A run that cannot publish its pid, does not lead its own group, or already
    has a recorded result refuses to start its backend."""
    run, env, output, codex = worker
    replace_setsid(codex, stand_in)
    result = run('--background')
    assert result.returncode != 0
    assert 'Worker run failed (exit 1) before its launch was confirmed' in result.stderr
    log = next(output.glob('*/worker_log_*.txt'))
    # The refusing run may log a moment after the launcher has read the result.
    for _ in range(50):
        if logged in log.read_text():
            break
        time.sleep(0.1)
    assert logged in log.read_text()
    assert captured_run(env, 'codex') is None
