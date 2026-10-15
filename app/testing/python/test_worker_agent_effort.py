"""Verify family-specific effort arguments using local fake CLIs only.

Connect worker parsing, local help capability checks and foreground/detached
metadata without model requests, credentials, database or network access.
Protect the existing Codex vocabulary and refuse Claude efforts before dispatch.
"""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import time

import pytest

from test_worker_agent_codex import CORE, captured_run, worker  # noqa: F401


CLAUDE_HELP = """Usage: claude [options] [prompt]
Options:
  --effort <level>                      Effort level for the current session
                                        (low, medium, high, xhigh, max)
  --model <model>                       Model for the current session
"""


@pytest.fixture
def effort_worker(worker):
    run, env, output, codex = worker
    claude = codex.parent / 'claude'
    claude.write_text('''#!/usr/bin/python3
import json, os, pathlib, sys
if sys.argv[1:] == ['--help']:
    pathlib.Path(os.environ['HELP_CAPTURE']).write_text('help')
    print(os.environ['FAKE_CLAUDE_HELP'])
    sys.exit(int(os.environ.get('FAKE_CLAUDE_HELP_EXIT', '0')))
if sys.argv[1:3] == ['auth', 'status']:
    pathlib.Path(os.environ['SIGN_IN_CAPTURE']).write_text('auth')
    print(json.dumps({'loggedIn': True, 'authMethod': 'claude.ai'}))
    sys.exit(0)
pathlib.Path(os.environ['CLAUDE_CAPTURE']).write_text(json.dumps({
    'args': sys.argv[1:], 'prompt': sys.stdin.read()}))
print('# Stub worker summary')
sys.exit(int(os.environ.get('FAKE_CLAUDE_EXIT', '0')))
''')
    env.update({'HELP_CAPTURE': str(output.parent / 'help-capture'),
                'FAKE_CLAUDE_HELP': CLAUDE_HELP,
                'FILTEREST_WORKER_OUTPUT_DIR_REL': 'runs'})
    git = codex.parent / 'git'
    git.write_text('#!/bin/sh\ntouch "$GIT_CAPTURE"\nexit 99\n')
    git.chmod(0o755)
    env['GIT_CAPTURE'] = str(output.parent / 'git-called')
    return run, env, output, codex


def assert_no_run(env, output):
    assert not output.exists(), 'refusal must precede creation of run artifacts'
    for name in ('CLAUDE_CAPTURE', 'CODEX_CAPTURE', 'SIGN_IN_CAPTURE', 'GIT_CAPTURE'):
        assert not Path(env[name]).exists(), f'refusal called {name}'


def finished_status(output):
    status_path = next(output.glob('*/run_status.txt'))
    for _ in range(100):
        text = status_path.read_text()
        if 'status=succeeded' in text or 'status=failed' in text:
            return text
        time.sleep(0.05)
    pytest.fail('fake worker did not finish')


@pytest.mark.parametrize('level', ['low', 'medium', 'high', 'xhigh', 'max'])
def test_claude_effort_maps_to_documented_cli_flag_and_is_recorded(effort_worker, level):
    run, env, output, _ = effort_worker
    result = run('family=claude', '--claude-effort', level)
    assert result.returncode == 0, result.stderr
    assert captured_run(env, 'claude')['args'] == [
        '--print', '--model', 'opus', '--permission-mode', 'bypassPermissions',
        '--no-session-persistence', '--effort', level]
    assert f'claude_effort_requested={level}\n' in finished_status(output)
    assert f'Claude effort requested: {level}' in result.stderr
    assert f'Worker Claude effort requested: {level}' in next(output.glob('*/worker_log_*')).read_text()
    assert f'- Claude effort requested: {level}' in next(output.glob('*/progress_*')).read_text()
    assert captured_run(env, 'codex') is None


@pytest.mark.parametrize('options', [('--background',), ('--research',)])
def test_claude_effort_survives_detached_and_research_execution(effort_worker, options):
    run, env, output, _ = effort_worker
    result = run('family=claude', '--claude-effort', 'high', *options)
    assert result.returncode == 0, result.stderr
    assert 'claude_effort_requested=high\n' in finished_status(output)
    arguments = captured_run(env, 'claude')['args']
    assert arguments[arguments.index('--effort') + 1] == 'high'
    if '--research' in options:
        assert arguments[-2:] == ['--tools', 'Read,Grep,Glob']
    assert 'Worker Claude effort requested: high' in next(output.glob('*/worker_log_*')).read_text()


def test_claude_omitted_effort_keeps_original_arguments_without_help_probe(effort_worker):
    run, env, output, _ = effort_worker
    result = run('family=claude')
    assert result.returncode == 0, result.stderr
    assert captured_run(env, 'claude')['args'] == [
        '--print', '--model', 'opus', '--permission-mode', 'bypassPermissions',
        '--no-session-persistence']
    assert 'claude_effort_requested=Claude CLI default\n' in finished_status(output)
    assert not Path(env['HELP_CAPTURE']).exists()


@pytest.mark.parametrize('level', ['none', 'minimal', 'ultra', 'extra-high', 'HIGH', '--api', 'high\nmax'])
def test_unknown_claude_level_refused_before_any_cli_or_artifact(effort_worker, level):
    run, env, output, _ = effort_worker
    result = run('family=claude', '--claude-effort', level, '--background')
    assert result.returncode != 0
    assert 'Invalid Claude effort' in result.stderr
    assert_no_run(env, output)
    assert not Path(env['HELP_CAPTURE']).exists()


@pytest.mark.parametrize('options', [('--claude-effort',), ('--claude-effort', '')])
def test_missing_claude_effort_value_is_refused(effort_worker, options):
    run, env, output, _ = effort_worker
    result = run('family=claude', *options)
    assert result.returncode != 0
    assert_no_run(env, output)


@pytest.mark.parametrize('help_text,help_exit,diagnostic', [
    ('Usage: claude\n  --model <model>   Model (low, high)\n', '0', 'Unsupported Claude effort'),
    ('  --effort <level>  Effort (low, medium, high)\n  --model <model>  Model (max)\n',
     '0', 'Unsupported Claude effort'),
    (CLAUDE_HELP, '1', 'Cannot read Claude CLI --help'),
    ('  --effort <level>  Effort (low, medium, high, xhigh, maximum)\n',
     '0', 'Unsupported Claude effort'),
])
@pytest.mark.parametrize('dry_run', [(), ('--dry-run',)])
def test_unsupported_installed_cli_refused_before_run_artifacts(
        effort_worker, help_text, help_exit, diagnostic, dry_run):
    run, env, output, _ = effort_worker
    result = run('family=claude', '--claude-effort', 'max', *dry_run, overrides={
        'FAKE_CLAUDE_HELP': help_text, 'FAKE_CLAUDE_HELP_EXIT': help_exit})
    assert result.returncode != 0
    assert diagnostic in result.stderr
    assert_no_run(env, output)


def test_missing_installed_claude_refused_before_run_artifacts(effort_worker, tmp_path):
    run, env, output, codex = effort_worker
    (codex.parent / 'claude').unlink()
    # Isolate discovery from any real extension install; no real worker may run.
    result = run('family=claude', '--claude-effort', 'high', overrides={'HOME': str(tmp_path)})
    assert result.returncode != 0
    assert 'Claude CLI not found' in result.stderr
    assert_no_run(env, output)


def test_claude_effort_on_codex_family_is_not_silently_ignored(effort_worker):
    run, env, output, _ = effort_worker
    result = run('--claude-effort', 'high')
    assert result.returncode != 0
    assert 'requires family=claude or family=auto' in result.stderr
    assert_no_run(env, output)
    assert not Path(env['HELP_CAPTURE']).exists()


@pytest.mark.parametrize('level', ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
def test_every_existing_codex_effort_retains_exact_invocation_and_metadata(effort_worker, level):
    run, env, output, _ = effort_worker
    result = run('--codex-reasoning-effort', level, '--codex-model', 'gpt-6-astra')
    assert result.returncode == 0, result.stderr
    assert captured_run(env, 'codex')['args'] == [
        'exec', '--sandbox', 'workspace-write', '--model', 'gpt-6-astra',
        '-c', f'model_reasoning_effort="{level}"', '-']
    status = finished_status(output)
    assert f'codex_reasoning_effort_requested={level}\n' in status
    assert 'claude_effort_requested=' not in status
    assert not Path(env['HELP_CAPTURE']).exists()


def test_empty_codex_environment_effort_keeps_engine_default(effort_worker):
    run, env, output, _ = effort_worker
    # Shell :- expansion retains the project's existing xhigh default.
    result = run(overrides={'WORKER_CODEX_REASONING_EFFORT': ''})
    assert result.returncode == 0, result.stderr
    assert captured_run(env, 'codex')['args'] == [
        'exec', '--sandbox', 'workspace-write', '-c', 'model_reasoning_effort="xhigh"', '-']
    assert 'codex_reasoning_effort_requested=xhigh\n' in finished_status(output)


def test_auto_uses_claude_effort_independently_of_codex_effort(effort_worker):
    run, env, output, _ = effort_worker
    result = run('family=auto', '--claude-effort', 'high', '--codex-reasoning-effort', 'minimal')
    assert result.returncode == 0, result.stderr
    assert captured_run(env, 'codex') is None
    assert captured_run(env, 'claude')['args'][-2:] == ['--effort', 'high']
    assert 'claude_effort_requested=high\n' in finished_status(output)


def test_help_and_dry_run_show_claude_selection(effort_worker):
    run, env, output, _ = effort_worker
    help_result = run('--help')
    assert help_result.returncode == 0
    assert '--claude-effort <level>' in help_result.stdout
    assert 'low, medium, high, xhigh, max' in help_result.stdout
    result = run('family=claude', '--dry-run', '--claude-effort', 'high')
    assert result.returncode == 0, result.stderr
    assert 'Claude effort requested: high' in result.stderr
    assert 'claude_effort_requested=high\n' in next(output.glob('*/run_status.txt')).read_text()
    assert captured_run(env, 'claude') is None
    assert not Path(env['SIGN_IN_CAPTURE']).exists()


def test_status_displays_recorded_claude_effort(effort_worker):
    run, env, _, _ = effort_worker
    result = run('family=claude', '--claude-effort', 'medium')
    assert result.returncode == 0, result.stderr
    status = subprocess.run(['bash', str(CORE), '--status', 'test-run'],
                            env=env, text=True, capture_output=True, timeout=10)
    assert status.returncode == 0, status.stderr
    assert 'Claude effort requested: medium' in status.stdout
