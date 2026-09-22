"""Verify the one engine module: pinned version, per-profile arguments, allowlist.

The site assistant's argument list is a reviewed sandbox contract, so a golden
list guards it byte for byte. No Codex process is started here.
"""
from pathlib import Path
import subprocess
import sys

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import codex_engine

# The reviewed site-assistant contract, byte for byte: no network, no approvals,
# workspace writes only. It matches what shipped before the engine module
# existed, plus one deliberate change: --skip-git-repo-check, because the pinned
# CLI refuses to start in the job's non-Git folder without it (found by the
# first real local run on 2026-09-22; the VPS runner had never run this mode).
GOLDEN_SITE_ASSISTANT = [
    "/opt/codex", "exec", "--sandbox", "workspace-write",
    "-c", 'approval_policy="never"',
    "-c", "sandbox_workspace_write.network_access=false",
    "--skip-git-repo-check",
    "--ephemeral", "--color", "never",
    "--cd", "/jobs/1/workspace",
    "--output-last-message", "/jobs/1/answer.txt",
    "--image", "/jobs/1/workspace/attachment-1.png",
    "-",
]


def test_site_assistant_arguments_stay_byte_identical():
    command = codex_engine.build_job_command(
        {"codex_command": ["/opt/codex"]}, codex_engine.SITE_ASSISTANT,
        Path("/jobs/1/workspace"), Path("/jobs/1/answer.txt"), [Path("/jobs/1/workspace/attachment-1.png")])
    assert command == GOLDEN_SITE_ASSISTANT


def test_code_workspace_keeps_full_access_by_default_and_network_when_narrowed():
    config = {"codex_command": ["/opt/codex"], "model": "fixture-model",
              "modes": {"code_workspace": {"workspace": "/checkout"}}}
    command = codex_engine.build_job_command(config, codex_engine.CODE_WORKSPACE, "/checkout", "/jobs/2/answer.txt")
    assert command == ["/opt/codex", "exec", "--sandbox", "danger-full-access", "-c", 'approval_policy="never"',
                       "--ephemeral", "--color", "never", "--cd", "/checkout",
                       "--output-last-message", "/jobs/2/answer.txt", "--model", "fixture-model", "-"]
    config["modes"]["code_workspace"]["sandbox"] = "workspace-write"
    narrowed = codex_engine.build_job_command(config, codex_engine.CODE_WORKSPACE, "/checkout", "/a.txt")
    assert narrowed[1:6] == ["exec", "--sandbox", "workspace-write", "-c", "sandbox_workspace_write.network_access=true"]
    config["modes"]["code_workspace"]["sandbox"] = "read-only"
    with pytest.raises(ValueError, match="sandbox"):
        codex_engine.build_job_command(config, codex_engine.CODE_WORKSPACE, "/checkout", "/a.txt")


def test_only_the_site_assistant_may_name_another_engine(tmp_path):
    config = {"codex_command": ["/opt/codex"], "assistant_engine": {
        "name": "claude", "command": ["/usr/bin/claude"],
        "argv_template": ["-p", "--add-dir", "{workspace}", "--output-file", "{answer_file}"],
        "home_variable": "CLAUDE_CONFIG_DIR", "home": "/var/lib/claude"}}
    assert codex_engine.build_job_command(config, codex_engine.SITE_ASSISTANT, tmp_path, tmp_path / "a.txt") == [
        "/usr/bin/claude", "-p", "--add-dir", str(tmp_path), "--output-file", str(tmp_path / "a.txt")]
    assert codex_engine.engine_environment(config, codex_engine.SITE_ASSISTANT)["CLAUDE_CONFIG_DIR"] == "/var/lib/claude"
    code = codex_engine.build_job_command(dict(config, modes={"code_workspace": {}}), codex_engine.CODE_WORKSPACE,
                                          tmp_path, tmp_path / "a.txt")
    assert code[0] == "/opt/codex"
    with pytest.raises(ValueError):
        codex_engine.build_job_command({"codex_command": ["codex"]}, codex_engine.SITE_ASSISTANT, tmp_path, "a")
    with pytest.raises(ValueError):
        codex_engine.build_job_command({"codex_command": ["/opt/codex"]}, "isolated_copy", tmp_path, "a")


def test_environment_is_an_allowlist_in_every_mode(monkeypatch):
    for key, value in {"DATABASE_PASSWORD": "secret", "SESSION_SECRET_KEY": "secret",
                       "XDG_RUNTIME_DIR": "/run/user/1000", "PATH": "/usr/bin", "HOME": "/home/dev"}.items():
        monkeypatch.setenv(key, value)
    config = {"codex_home": "/var/lib/codex", "environment": {"GOTOOLCHAIN": "local"}}
    site = codex_engine.engine_environment(config, codex_engine.SITE_ASSISTANT, {"FILTEREST_SITE_ASSISTANT_INBOX": "/i"})
    code = codex_engine.engine_environment(config, codex_engine.CODE_WORKSPACE)
    for environment in (site, code):
        assert "DATABASE_PASSWORD" not in environment and "SESSION_SECRET_KEY" not in environment
        assert environment["CODEX_HOME"] == "/var/lib/codex" and environment["GOTOOLCHAIN"] == "local"
    assert site["FILTEREST_SITE_ASSISTANT_INBOX"] == "/i" and "XDG_RUNTIME_DIR" not in site
    # Code work may run ./ctl, which finds the running runner through the session folder.
    assert code["XDG_RUNTIME_DIR"] == "/run/user/1000"


@pytest.mark.parametrize("arguments,expected", [
    (("workspace-write", "gpt-6-astra", "xhigh"),
     ["exec", "--sandbox", "workspace-write", "--model", "gpt-6-astra", "-c", 'model_reasoning_effort="xhigh"', "-"]),
    (("danger-full-access", "", ""), ["exec", "--sandbox", "danger-full-access", "-"]),
])
def test_worker_arguments_match_the_terminal_launcher(arguments, expected):
    assert codex_engine.worker_arguments(*arguments) == expected


def test_command_line_serves_the_worker_launcher():
    script = str(Path(codex_engine.__file__))
    version = subprocess.run([sys.executable, script, "version"], capture_output=True, text=True, check=True)
    assert version.stdout.strip() == codex_engine.PINNED_CODEX_VERSION
    listed = subprocess.run([sys.executable, script, "worker-arguments", "--sandbox", "workspace-write",
                             "--reasoning-effort", "high"], capture_output=True, text=True, check=True)
    assert listed.stdout.split("\0")[:-1] == ["exec", "--sandbox", "workspace-write",
                                              "-c", 'model_reasoning_effort="high"', "-"]
    refused = subprocess.run([sys.executable, script, "worker-arguments", "--sandbox", "read-only"],
                             capture_output=True, text=True)
    assert refused.returncode == 2 and refused.stdout == ""
    # ./ctl agent start passes on exactly this list and nothing else.
    listed = subprocess.run([sys.executable, script, "workstation-environment"], capture_output=True, text=True, check=True)
    assert listed.stdout.split() == list(codex_engine.WORKSTATION_ENVIRONMENT)
    assert not {"DATABASE_PASSWORD", "DB_PASSWORD", "SESSION_SECRET_KEY"} & set(listed.stdout.split())
