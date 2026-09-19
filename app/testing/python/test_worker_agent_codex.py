"""Verify worker model selection and installed Codex dispatch.

Exercises the shell entrypoint against local fake CLIs, including detached runs.
No model, registry, credentials, live application or database is contacted.
Protects exact version checks and prompt/argument boundaries from regressions.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import time

import pytest


ROOT = Path(__file__).resolve().parents[3]
CORE = ROOT / "app/server_tools/agent_tools/worker_agent/worker_agent_core.sh"


@pytest.fixture
def worker(tmp_path):
    bin_dir = tmp_path / "tools with spaces"
    bin_dir.mkdir()
    codex = bin_dir / "codex"
    codex.write_text("""#!/usr/bin/python3
import json, os, pathlib, sys
if sys.argv[1:] == ['--version']:
    print('codex-cli ' + os.environ.get('FAKE_CODEX_VERSION', '0.155.1'))
    sys.exit(int(os.environ.get('FAKE_VERSION_EXIT', '0')))
pathlib.Path(os.environ['CODEX_CAPTURE']).write_text(json.dumps({
    'args': sys.argv[1:], 'prompt': sys.stdin.read()}))
print('codex\\n# Stub worker summary\\nLocal test completed.')
sys.exit(int(os.environ.get('FAKE_CODEX_EXIT', '0')))
""")
    codex.chmod(0o755)
    npx = bin_dir / "npx"
    npx.write_text('#!/bin/sh\ntouch "$NPX_CAPTURE"\nexit 91\n')
    npx.chmod(0o755)
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(('WORKER_', 'FILTEREST_WORKER_'))}
    env.update({
        'PATH': f"{bin_dir}:{os.environ['PATH']}",
        'FILTEREST_WORKSPACE_ROOT': str(tmp_path),
        'CODEX_CAPTURE': str(tmp_path / 'capture.json'),
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
    assert 'codex_version=0.155.1' in status
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
    assert 'Worker Codex version: 0.155.1' in log


def test_omitted_model_effort_leave_codex_defaults_explicitly_unresolved(worker):
    run, env, output, _ = worker
    result = run()
    assert result.returncode == 0, result.stderr
    assert json.loads(Path(env['CODEX_CAPTURE']).read_text())['args'] == [
        'exec', '--sandbox', 'workspace-write', '-']
    status = next(output.glob('*/run_status.txt')).read_text()
    assert 'codex_model_requested=Codex config default' in status
    assert 'codex_reasoning_effort_requested=Codex config default' in status


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
