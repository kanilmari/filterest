"""test_coding_agent_readiness.py
Verify subscription-only readiness and upload configuration with disposable files.
Connect the selected engine's local status commands to the modes advertised ready.
No Git writes, real runner, sign-in, network or model request is needed.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from codex_engine import PINNED_CODEX_VERSION
from coding_agent_runner import readiness, validate_config, workstation_config


CLI = """#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
arguments = sys.argv[1:]
with Path(os.environ['STATUS_TRACE']).open('a') as trace:
    trace.write(json.dumps({'command': sys.argv[0], 'arguments': arguments,
                            'home': os.environ.get('CODEX_HOME')}) + '\\n')
if arguments == ['--version']:
    print('codex-cli PINNED')
elif arguments == ['login', 'status']:
    output = os.environ.get('LOGIN_OUTPUT', 'Logged in using ChatGPT')
    print(output, file=sys.stdout if os.environ.get('LOGIN_STREAM') == 'stdout' else sys.stderr)
    sys.exit(int(os.environ.get('LOGIN_EXIT', '0')))
else:
    raise AssertionError('readiness must never start a model or sign in')
""".replace("PINNED", PINNED_CODEX_VERSION)


@pytest.fixture
def local_config(tmp_path):
    cli = tmp_path / "codex-stub"
    cli.write_text(CLI)
    cli.chmod(0o755)
    return {"socket": str(tmp_path / "runner.sock"), "jobs_root": str(tmp_path / "jobs"),
            "site_id": "test.invalid", "allowed_web_uids": [os.getuid() + 10000],
            "codex_command": [str(cli)], "modes": {"site_assistant": {}},
            "environment": {"STATUS_TRACE": str(tmp_path / "status.jsonl")}}


@pytest.mark.parametrize("output,stream,exit_code,accepted", [
    ("Logged in using ChatGPT", "stderr", 0, True),
    ("Logged in using ChatGPT  \n", "stdout", 0, True),
    ("Logged in using an API key", "stderr", 0, False),
    ("", "stdout", 0, False),
    ("Not logged in", "stderr", 1, False),
    ("Logged in using ChatGPT", "stderr", 1, False),
    ("prefix Logged in using ChatGPT", "stdout", 0, False),
    ("Logged in using ChatGPT extra", "stderr", 0, False),
])
def test_readiness_requires_the_workers_subscription_sign_in(local_config, output, stream, exit_code, accepted):
    local_config["environment"].update(LOGIN_OUTPUT=output, LOGIN_STREAM=stream, LOGIN_EXIT=str(exit_code))
    result = readiness(local_config)
    assert result["runner_ready"] is accepted
    assert result["authentication_verified"] is accepted
    assert result["reason_code"] == ("" if accepted else "runner_authentication_required")
    calls = [json.loads(line) for line in Path(local_config["environment"]["STATUS_TRACE"]).read_text().splitlines()]
    assert [call["arguments"] for call in calls] == [["--version"], ["login", "status"]]
    assert not Path(local_config["jobs_root"]).exists()


def test_readiness_checks_the_selected_assistant_command_and_home(local_config, tmp_path):
    selected = tmp_path / "selected-codex"
    selected.write_text(CLI)
    selected.chmod(0o755)
    local_config["codex_command"] = ["/missing-default-codex"]
    local_config["assistant_engine"] = {"name": "codex", "command": [str(selected)], "home": str(tmp_path / "account")}
    assert readiness(local_config)["runner_ready"] is True
    calls = [json.loads(line) for line in Path(local_config["environment"]["STATUS_TRACE"]).read_text().splitlines()]
    assert {call["command"] for call in calls} == {str(selected)}
    assert {call["home"] for call in calls} == {str(tmp_path / "account")}


def test_missing_selected_command_does_not_use_ready_default(local_config):
    local_config["assistant_engine"] = {"name": "codex", "command": ["/missing-selected-codex"]}
    assert readiness(local_config)["reason_code"] == "runner_tools_missing"
    assert not Path(local_config["environment"]["STATUS_TRACE"]).exists()


@pytest.mark.parametrize("failed_mode", ["code_workspace", "site_assistant"])
def test_each_mode_checks_its_own_command(local_config, tmp_path, failed_mode):
    checkout = tmp_path / "checkout"
    (checkout / ".git").mkdir(parents=True)  # readiness needs only the marker, no Git commands.
    local_config["modes"]["code_workspace"] = {"workspace": str(checkout)}
    working = local_config["codex_command"]
    local_config["assistant_engine"] = {"name": "codex", "command": working}
    if failed_mode == "code_workspace":
        local_config["codex_command"] = ["/missing-code-codex"]
    else:
        local_config["assistant_engine"]["command"] = ["/missing-assistant-codex"]
    result = readiness(local_config)
    assert result["runner_ready"] is True
    assert result["modes"] == [mode for mode in local_config["modes"] if mode != failed_mode]


def test_engine_without_subscription_checker_is_not_advertised_ready(local_config):
    local_config["assistant_engine"] = {"name": "claude", "command": local_config["codex_command"]}
    result = readiness(local_config)
    assert result["runner_ready"] is False and result["authentication_verified"] is False
    assert result["reason_code"] == "runner_engine_unsupported" and result["modes"] == []
    assert not Path(local_config["environment"]["STATUS_TRACE"]).exists()


@pytest.mark.parametrize("path", ["relative/uploads", "/uploads/../uploads", "", 42,
    "/uploads  ", "/uploads\n", "//uploads", "/uploads/", "/uploads/./images", "/uploads//images",
    "/uploads\u00a0", " /uploads", "/uploads\0"])
def test_invalid_upload_directory_configuration_is_refused(local_config, path):
    with pytest.raises(ValueError, match="upload_dir"):
        validate_config(dict(local_config, upload_dir=path))


def test_upload_directory_is_explicit_and_optional(local_config, tmp_path):
    assert "upload_dir" not in validate_config(local_config)
    uploads = str(tmp_path / "uploads")
    assert validate_config(dict(local_config, upload_dir=uploads))["upload_dir"] == uploads


def test_workstation_configuration_keeps_the_web_upload_directory(tmp_path):
    arguments = argparse.Namespace(workspace=str(tmp_path / "checkout"), repository=[],
        site_id="test.invalid", socket=str(tmp_path / "runner.sock"), jobs_root=str(tmp_path / "jobs"),
        codex="/codex-stub", site_tls_ca_file=None, upload_dir=str(tmp_path / "uploads"))
    assert workstation_config(arguments)["upload_dir"] == arguments.upload_dir


def run_launcher(tmp_path, development="", runtime="", environment=None, command=None):
    script = Path(__file__).resolve().parents[2] / "ctl/lib/coding_agent.sh"
    run_dir = tmp_path / "run"
    run_dir.mkdir(exist_ok=True)
    development_file = tmp_path / "development.env"
    runtime_file = tmp_path / "runtime.env"
    if development is not None:
        development_file.write_text(development)
    runtime_file.write_text(runtime)
    capture = tmp_path / "capture.py"
    capture.write_text("#!/usr/bin/env python3\nimport json,os,sys\n"
                       "print(json.dumps({'arguments': sys.argv[1:], 'exported': "
                       "os.environ.get('FILTEREST_CODING_AGENT_UPLOAD_DIR')}))\n")
    capture.chmod(0o755)
    process_environment = {"PATH": os.environ["PATH"], "XDG_STATE_HOME": str(tmp_path / "state"),
                           "XDG_RUNTIME_DIR": str(run_dir), "FILTEREST_CODING_AGENT_AUTOSTART": "0"}
    process_environment.update(environment or {})
    command = command or r'''
coding_agent_prepare_server 18555
printf '%s\n' "${FILTEREST_CODING_AGENT_UPLOAD_DIR:-}"
_coding_agent_write_config /codex-stub
'''
    return subprocess.run(["bash", "-c", r'''
PROJECT_ROOT="$2"
EASELECT_DEV_ENV_FILE="$3"
EASELECT_RUNTIME_ENV_FILE="$4"
FILTEREST_SOURCE_ROOT="$6"
source "$1"
_coding_agent_repositories() { :; }
capture_command="$5"
_coding_agent_python() { printf '%s' "$capture_command"; }
# Every launch is a disposable stub, even when testing autostart settings.
coding_agent_codex_path() { printf '/codex-stub'; }
coding_agent_start() { touch "$PROJECT_ROOT/started"; }
''' + command, "_", str(script), str(tmp_path), str(development_file), str(runtime_file), str(capture),
        str(script.parents[3])],
        env=process_environment, capture_output=True, text=True)


DOTENV_UPLOADS = [
    "FILTEREST_CODING_AGENT_UPLOAD_DIR={uploads}\n",
    'FILTEREST_CODING_AGENT_UPLOAD_DIR="{uploads}"\n',
    "FILTEREST_CODING_AGENT_UPLOAD_DIR='{uploads}'\n",
    " \t export FILTEREST_CODING_AGENT_UPLOAD_DIR \t= \t'{uploads}' \t# comment\r\n",
    'FILTEREST_CODING_AGENT_UPLOAD_DIR = "{uploads}"#comment\n',
    "FILTEREST_CODING_AGENT_UPLOAD_DIR = {uploads} \t # comment\n",
]


@pytest.mark.parametrize("template", DOTENV_UPLOADS)
@pytest.mark.parametrize("source", ["development", "runtime"])
@pytest.mark.parametrize("directory", ["chosen-uploads", "chosen uploads"])
def test_local_launcher_shares_decoded_upload_directory(tmp_path, template, source, directory):
    uploads = str(tmp_path / directory)
    content = template.format(uploads=uploads)
    completed = run_launcher(tmp_path, development=content if source == "development" else None,
                             runtime=content if source == "runtime" else "")
    assert completed.returncode == 0, completed.stderr
    exported, captured = completed.stdout.splitlines()
    capture = json.loads(captured)
    assert exported == capture["exported"] == uploads
    argv = capture["arguments"]
    assert argv[argv.index("--upload-dir") + 1] == uploads
    assert workstation_config(argparse.Namespace(workspace=str(tmp_path / "checkout"), repository=[],
        site_id="test.invalid", socket=str(tmp_path / "runner.sock"), jobs_root=str(tmp_path / "jobs"),
        codex="/codex-stub", site_tls_ca_file=None, upload_dir=uploads))["upload_dir"] == uploads


@pytest.mark.parametrize("directory", ["process-uploads", "process uploads", "literal #=$uploads"])
def test_process_upload_value_wins_and_is_not_dotenv_decoded(tmp_path, directory):
    uploads = str(tmp_path / directory)
    completed = run_launcher(tmp_path, development='FILTEREST_CODING_AGENT_UPLOAD_DIR="/development"\n',
                             runtime="FILTEREST_CODING_AGENT_UPLOAD_DIR='/runtime'\n",
                             environment={"FILTEREST_CODING_AGENT_UPLOAD_DIR": uploads})
    assert completed.returncode == 0, completed.stderr
    exported, captured = completed.stdout.splitlines()
    capture = json.loads(captured)
    assert exported == capture["exported"] == uploads
    assert capture["arguments"][capture["arguments"].index("--upload-dir") + 1] == uploads


@pytest.mark.parametrize("development,expected", [
    ("FILTEREST_CODING_AGENT_UPLOAD_DIR='/development'\n", "/development"),
    (None, "/runtime"),
    ("", "default"),  # Existing file selection does not fall through per key.
    ("FILTEREST_CODING_AGENT_UPLOAD_DIR=''\n", "default"),
])
def test_upload_file_selection_and_default_are_unchanged(tmp_path, development, expected):
    completed = run_launcher(tmp_path, development=development,
                             runtime='FILTEREST_CODING_AGENT_UPLOAD_DIR="/runtime"\n')
    assert completed.returncode == 0, completed.stderr
    exported, captured = completed.stdout.splitlines()
    if expected == "default":
        expected = str(tmp_path / "state/filterest-coding-agent/localhost-18555/uploads")
    capture = json.loads(captured)
    assert exported == capture["exported"] == expected
    assert capture["arguments"][capture["arguments"].index("--upload-dir") + 1] == expected


@pytest.mark.parametrize("setting", ["relative/uploads", "/uploads/../uploads", '\"/uploads\"',
    "/uploads  ", "/uploads\n", "//uploads", "///uploads", "/uploads/", "/uploads/./images",
    "/uploads//images", "/uploads\u00a0", " /uploads"])
@pytest.mark.parametrize("source", ["development", "runtime", "process"])
def test_invalid_upload_setting_fails_before_runner_or_web_export(tmp_path, setting, source):
    # Single quoting preserves literal double quotes, just as the backend does.
    content = "FILTEREST_CODING_AGENT_UPLOAD_DIR='" + setting + "'\n"
    completed = run_launcher(tmp_path, development=content if source == "development" else None,
        runtime=content if source == "runtime" else "",
        environment={"FILTEREST_CODING_AGENT_UPLOAD_DIR": setting} if source == "process" else {},
        command=r'''
coding_agent_prepare_server 18555
[[ -z "${FILTEREST_CODING_AGENT_SOCKET:-}" ]] || exit 98
[[ ! -e "$PROJECT_ROOT/started" ]] || exit 97
coding_agent_resolve 18555 || exit 1
_coding_agent_write_config /codex-stub
''')
    assert completed.returncode == 1
    assert "FILTEREST_CODING_AGENT_UPLOAD_DIR must be a canonical absolute path" in completed.stderr
    assert not completed.stdout
    assert not (tmp_path / "state").exists()


@pytest.mark.parametrize("source", ["development", "runtime"])
def test_malformed_dotenv_fails_closed_with_redacted_error(tmp_path, source):
    content = 'FILTEREST_CODING_AGENT_UPLOAD_DIR="/uploads\nSECRET="do-not-print\n'
    completed = run_launcher(tmp_path, development=content if source == "development" else None,
                             runtime=content if source == "runtime" else "",
                             command="coding_agent_prepare_server 18555\n"
                                     '[[ -z "${FILTEREST_CODING_AGENT_SOCKET:-}" ]] || exit 98\n'
                                     'coding_agent_resolve 18555\n')
    assert completed.returncode == 1
    assert "invalid dotenv settings" in completed.stderr
    assert "do-not-print" not in completed.stderr
    assert not completed.stdout
    assert not (tmp_path / "started").exists()


@pytest.mark.parametrize("source", ["development", "runtime"])
@pytest.mark.parametrize("quote", ["'", '\"'])
def test_upload_nul_is_refused_before_bash_can_discard_it(tmp_path, source, quote):
    content = f"FILTEREST_CODING_AGENT_UPLOAD_DIR={quote}/uploads\0/hidden{quote}\n"
    completed = run_launcher(tmp_path, development=content if source == "development" else None,
        runtime=content if source == "runtime" else "",
        command="coding_agent_resolve 18555\n")
    assert completed.returncode == 1
    assert "canonical absolute path" in completed.stderr and "NUL" in completed.stderr
    assert not completed.stdout


@pytest.mark.parametrize("key", ["APP_PORT", "PORT", "EASELECT_PORT"])
@pytest.mark.parametrize("quote", ["", "'", '\"'])
def test_every_port_parser_caller_accepts_dotenv_quotes(tmp_path, key, quote):
    completed = run_launcher(tmp_path, development=f" \t{key} = {quote}18556{quote} # port\n",
                             command="coding_agent_resolve\nprintf '%s' \"$CODING_AGENT_PORT\"\n")
    assert completed.returncode == 0, completed.stderr
    assert completed.stdout == "18556"


@pytest.mark.parametrize("quote", ["", "'", '\"'])
def test_quoted_operator_socket_is_left_alone(tmp_path, quote):
    completed = run_launcher(tmp_path,
        development=f"FILTEREST_CODING_AGENT_SOCKET={quote}/run/operator/runner.sock{quote} # socket\n",
        command='''coding_agent_prepare_server 18555
[[ -z "${FILTEREST_CODING_AGENT_SOCKET:-}" ]] || exit 98
[[ ! -e "$PROJECT_ROOT/started" ]] || exit 97
''')
    assert completed.returncode == 0, completed.stderr
    assert not completed.stdout


@pytest.mark.parametrize("quote", ["", "'", '\"'])
def test_quoted_autostart_zero_prevents_launch(tmp_path, quote):
    completed = run_launcher(tmp_path,
        development=f"FILTEREST_CODING_AGENT_AUTOSTART={quote}0{quote} # disabled\n",
        environment={"FILTEREST_CODING_AGENT_AUTOSTART": ""},
        command="coding_agent_prepare_server 18555\n")
    assert completed.returncode == 0, completed.stderr
    assert not (tmp_path / "started").exists()
    assert not completed.stdout


@pytest.mark.parametrize("content,expected", [
    ("ROOT=/srv\nFILTEREST_CODING_AGENT_UPLOAD_DIR=${ROOT}/uploads\n", "/srv/uploads"),
    ('ROOT=/srv\nFILTEREST_CODING_AGENT_UPLOAD_DIR="${ROOT}/chosen uploads"\n', "/srv/chosen uploads"),
    ("ROOT=/srv\nFILTEREST_CODING_AGENT_UPLOAD_DIR='${ROOT}/uploads'\n", "${ROOT}/uploads"),
    ('FILTEREST_CODING_AGENT_UPLOAD_DIR="/literal #uploads" # comment\n', "/literal #uploads"),
    ("FILTEREST_CODING_AGENT_UPLOAD_DIR=/literal#uploads\n", "/literal#uploads"),
    ("FILTEREST_CODING_AGENT_UPLOAD_DIR=/first\nFILTEREST_CODING_AGENT_UPLOAD_DIR='/last'\n", "/last"),
    ('FILTEREST_CODING_AGENT_UPLOAD_DIR="/escaped\\$ROOT/\\\"quote"\n', '/escaped$ROOT/"quote'),
    ("FILTEREST_CODING_AGENT_UPLOAD_DIR: '/yaml/uploads'\n", "/yaml/uploads"),
    ("OTHER='line one\nFILTEREST_CODING_AGENT_UPLOAD_DIR=/decoy'\n"
     "FILTEREST_CODING_AGENT_UPLOAD_DIR='/real'\n", "/real"),
    ("FILTEREST_CODING_AGENT_UPLOAD_DIR='/uploads  '\n", "/uploads  "),
])
def test_dotenv_decoder_matches_backend_value_rules(content, expected):
    script = Path(__file__).resolve().parents[2] / "ctl/lib/dotenv_reader.py"
    spec = importlib.util.spec_from_file_location("dotenv_reader", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.read_dotenv(content)["FILTEREST_CODING_AGENT_UPLOAD_DIR"] == expected


@pytest.mark.parametrize("assignment,directory", [
    ('ROOT={root}\nFILTEREST_CODING_AGENT_UPLOAD_DIR="${{ROOT}}/chosen uploads"\n', "chosen uploads"),
    ("FILTEREST_CODING_AGENT_UPLOAD_DIR='{root}/literal #$uploads' # comment\n", "literal #$uploads"),
])
def test_launcher_keeps_interpolation_literals_and_quoted_spaces(tmp_path, assignment, directory):
    completed = run_launcher(tmp_path, development=assignment.format(root=tmp_path))
    assert completed.returncode == 0, completed.stderr
    exported, captured = completed.stdout.splitlines()
    capture = json.loads(captured)
    assert exported == capture["exported"] == str(tmp_path / directory)
    assert capture["arguments"][capture["arguments"].index("--upload-dir") + 1] == exported


@pytest.mark.parametrize("spelling", ["literal", "escaped"])
def test_launcher_preserves_newlines_inside_double_quotes(tmp_path, spelling):
    expected = str(tmp_path / "line\nbreak")
    raw = expected.replace("\n", r"\n") if spelling == "escaped" else expected
    completed = run_launcher(tmp_path, development=f'FILTEREST_CODING_AGENT_UPLOAD_DIR="{raw}"\n',
                             command="coding_agent_prepare_server 18555\n_coding_agent_write_config /codex-stub\n")
    assert completed.returncode == 0, completed.stderr
    capture = json.loads(completed.stdout)
    assert capture["exported"] == expected
    assert capture["arguments"][capture["arguments"].index("--upload-dir") + 1] == expected


@pytest.mark.parametrize("suffix,quote", [
    (suffix, quote) for suffix in ["  ", "\n", r"\n", "/", "/./images", "/child/../images"]
    for quote in ["'", '\"'] if (suffix, quote) != (r"\n", "'")
])
def test_noncanonical_quoted_upload_directory_refuses_startup(tmp_path, suffix, quote):
    completed = run_launcher(tmp_path,
        development=f"FILTEREST_CODING_AGENT_UPLOAD_DIR={quote}{tmp_path}/uploads{suffix}{quote}\n",
        # Restore the actual startup function: resolution must fail before it
        # can check Codex, write configuration or launch any runner process.
        command='source "$1"\ncoding_agent_start 18555\n')
    assert completed.returncode == 1
    assert "canonical absolute path" in completed.stderr
    assert not completed.stdout
    assert not (tmp_path / "started").exists()
