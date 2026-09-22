#!/usr/bin/env python3
"""codex_engine.py

The one place that knows how Filterest starts Codex.

Between: the coding-agent runner's job modes (the chat's code workspace and site
assistant), the developer's ./worker_agent terminal launcher, and the single
pinned Codex CLI version.

Why: three launchers used to build their own Codex argument lists against three
Codex versions, and one of them handed Codex the web server's whole environment.
This module owns the pinned version, each profile's exact arguments and the
environment allowlist, so a change is made once and every path follows it.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

# Exact installed CLI version every path requires. Upgrade deliberately: check
# the new version's `exec --help` and a harmless sandbox probe first.
PINNED_CODEX_VERSION = "0.155.1"

CODE_WORKSPACE = "code_workspace"
SITE_ASSISTANT = "site_assistant"
JOB_MODES = (CODE_WORKSPACE, SITE_ASSISTANT)

# Every engine child starts from these variables only. Nothing else in the
# runner's environment (database passwords, API keys, session secrets) reaches
# the model unless an operator names it in the runner configuration. CODEX_HOME
# is only the location of the Codex account folder; a configured codex_home wins.
BASE_ENVIRONMENT = ("PATH", "LANG", "LC_ALL", "HOME", "CODEX_HOME")

# Code work runs on the developer's own machine and must behave like the
# developer's terminal for ./ctl, Go and npm. These are ordinary, non-secret
# session settings; credentials stay in the project's protected key files,
# which the project's own wrappers read.
WORKSTATION_ENVIRONMENT = BASE_ENVIRONMENT + (
    "USER", "LOGNAME", "SHELL", "TERM", "TZ", "TMPDIR",
    "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME",
    "GOPATH", "GOCACHE", "GOMODCACHE", "GOTOOLCHAIN",
)

# Code work keeps today's access (network, database wrappers, restarts), so its
# default is Codex's full-access sandbox. workspace-write is the narrower choice
# an operator may configure; it keeps network access so tests still run.
CODE_WORKSPACE_SANDBOXES = ("danger-full-access", "workspace-write")
WORKER_SANDBOXES = ("danger-full-access", "workspace-write")
REASONING_EFFORTS = ("none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra")

# Argument templates per engine and mode. The site assistant list is guarded by
# a golden test: it changes only deliberately, with the test.
ENGINE_TEMPLATES = {
    "codex": {
        SITE_ASSISTANT: [
            "exec", "--sandbox", "workspace-write",
            "-c", 'approval_policy="never"',
            "-c", "sandbox_workspace_write.network_access=false",
            # The job folder is deliberately not a Git checkout; without this the
            # pinned CLI refuses to start there ("Not inside a trusted directory").
            "--skip-git-repo-check",
            "--ephemeral", "--color", "never",
            "--cd", "{workspace}",
            "--output-last-message", "{answer_file}",
            "-",
        ],
        CODE_WORKSPACE: [
            "exec", "--sandbox", "{sandbox}",
            "-c", 'approval_policy="never"',
            "--ephemeral", "--color", "never",
            "--cd", "{workspace}",
            "--output-last-message", "{answer_file}",
            "-",
        ],
    },
}


def build_job_command(config, mode, workspace, answer_file, images=()):
    """Build one runner job's engine argv from configuration, never from the model."""
    if mode not in JOB_MODES:
        raise ValueError("unknown job mode %r" % mode)
    # Only the site assistant may name another engine; code work is Codex only.
    engine = (config.get("assistant_engine") or {}) if mode == SITE_ASSISTANT else {}
    name = str(engine.get("name") or "codex")
    command = list(engine.get("command") or config.get("codex_command") or [])
    if not command or not os.path.isabs(command[0]):
        raise ValueError("the engine needs an installed absolute executable")
    template = list(engine.get("argv_template") or ENGINE_TEMPLATES.get(name, {}).get(mode) or [])
    if not template:
        raise ValueError("engine %r has no argument template for %s" % (name, mode))
    sandbox = code_workspace_sandbox(config) if mode == CODE_WORKSPACE else ""
    arguments = [part.replace("{workspace}", str(workspace))
                     .replace("{answer_file}", str(answer_file))
                     .replace("{sandbox}", sandbox)
                 for part in template]
    if mode == CODE_WORKSPACE and sandbox == "workspace-write":
        # The narrower sandbox still keeps the network that tests and restarts need.
        arguments = arguments[:3] + ["-c", "sandbox_workspace_write.network_access=true"] + arguments[3:]
    model = engine.get("model") or config.get("model")
    if model:
        arguments = arguments[:-1] + ["--model", str(model), arguments[-1]]
    for image in images:
        arguments = arguments[:-1] + ["--image", str(image), arguments[-1]]
    return command + arguments


def code_workspace_sandbox(config):
    """The configured code-work sandbox; the default keeps today's full access."""
    sandbox = ((config.get("modes") or {}).get(CODE_WORKSPACE) or {}).get("sandbox") or "danger-full-access"
    if sandbox not in CODE_WORKSPACE_SANDBOXES:
        raise ValueError("code workspace sandbox must be one of " + ", ".join(CODE_WORKSPACE_SANDBOXES))
    return sandbox


def engine_environment(config, mode, extra=None):
    """Deliberate allowlist; an engine never inherits site or database secrets."""
    keys = WORKSTATION_ENVIRONMENT if mode == CODE_WORKSPACE else BASE_ENVIRONMENT
    environment = {key: os.environ[key] for key in keys if key in os.environ}
    environment.update(config.get("environment", {}))
    engine = (config.get("assistant_engine") or {}) if mode == SITE_ASSISTANT else {}
    home_variable = engine.get("home_variable") or "CODEX_HOME"
    home_value = engine.get("home") or config.get("codex_home")
    if home_value:
        environment[home_variable] = str(home_value)
    environment.update(extra or {})
    return environment


def worker_arguments(sandbox, model="", reasoning_effort=""):
    """Arguments for the developer's ./worker_agent run; the prompt arrives on stdin."""
    if sandbox not in WORKER_SANDBOXES:
        raise ValueError("worker sandbox must be one of " + ", ".join(WORKER_SANDBOXES))
    arguments = ["exec", "--sandbox", sandbox]
    if model:
        arguments += ["--model", model]
    if reasoning_effort:
        if reasoning_effort not in REASONING_EFFORTS:
            raise ValueError("reasoning effort must be one of " + ", ".join(REASONING_EFFORTS))
        arguments += ["-c", 'model_reasoning_effort="%s"' % reasoning_effort]
    return arguments + ["-"]


def executable_status(command, environment, timeout=10):
    """Local installation and account status only; never a model request."""
    status = {"installed": False, "version": "", "pinned": False, "authenticated": False}
    if not command or not os.path.isabs(command[0]) or not os.access(command[0], os.X_OK):
        return status
    try:
        completed = subprocess.run([*command, "--version"], env=environment, capture_output=True,
                                   text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return status
    if completed.returncode != 0:
        return status
    status["installed"] = True
    status["version"] = completed.stdout.strip().removeprefix("codex-cli ").strip()
    status["pinned"] = status["version"] == PINNED_CODEX_VERSION
    try:
        login = subprocess.run([*command, "login", "status"], env=environment,
                               capture_output=True, timeout=timeout)
        status["authenticated"] = login.returncode == 0
    except (OSError, subprocess.SubprocessError):
        pass
    return status


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("version", help="print the pinned Codex CLI version")
    commands.add_parser("workstation-environment",
                        help="print the variable names a developer machine's runner may pass on")
    worker = commands.add_parser("worker-arguments",
                                 help="print ./worker_agent's Codex arguments, NUL-terminated")
    worker.add_argument("--sandbox", required=True)
    worker.add_argument("--model", default="")
    worker.add_argument("--reasoning-effort", default="")
    arguments = parser.parse_args(argv)
    if arguments.command == "version":
        print(PINNED_CODEX_VERSION)
        return 0
    if arguments.command == "workstation-environment":
        print("\n".join(WORKSTATION_ENVIRONMENT))
        return 0
    try:
        values = worker_arguments(arguments.sandbox, arguments.model, arguments.reasoning_effort)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2
    sys.stdout.write("".join(value + "\0" for value in values))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
