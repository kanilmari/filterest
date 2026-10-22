# test_build_stamp_launchers.py
# Exercises build stamps in isolated Git, copied-source and Docker shell contexts.
# Connects launcher arguments to the actual standard-library-only Go resolver.
# Prevents source attribution from following a foreign repo or a moving HEAD.
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile

import pytest

APP = Path(__file__).resolve().parents[2]
HELPER = APP / "server_tools/lib/build_stamp_ldflags.sh"
PACKAGE = Path("backend/core_components/build_stamp")
MODULE = re.search(r"^module (\S+)", (APP / "go.mod").read_text(), re.M)[1]
IMPORT = f"{MODULE}/{PACKAGE.as_posix()}"
SHA = "a1" * 20


def run(*args, cwd=None, env=None):
    return subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=True, check=True)


def git(root, *args):
    return run("git", "-C", str(root), *args).stdout.strip()


def commit(root):
    git(root, "add", ".")
    git(root, "-c", "user.name=Stamp fixture", "-c", "user.email=stamp@example.invalid",
        "commit", "-qm", "fixture")
    return git(root, "rev-parse", "HEAD")


def repository(root):
    app = root / "app"
    app.mkdir(parents=True)
    run("git", "init", "-q", str(root))
    (app / "tracked.txt").write_text("original\n")
    return app, commit(root)


def helper(command, app, *options, check=True):
    return subprocess.run(["sh", str(HELPER), command, str(app), *options],
                          text=True, capture_output=True, check=check)


def assert_time_only(flags):
    assert "gitCommit=" not in flags and "sourceDirty=" not in flags
    assert re.fullmatch(rf"-X {re.escape(IMPORT)}\.builtAt=\d{{4}}-\d\d-\d\dT\d\d:\d\d:\d\dZ\n?", flags)


def test_git_source_clean_edited_staged_and_untracked(tmp_path):
    app, sha = repository(tmp_path / "source")
    assert helper("source", app).stdout.strip() == f"{sha} false"
    clean = helper("ldflags", app, "--require-clean").stdout
    assert f"-X {IMPORT}.gitCommit={sha}" in clean
    assert f"-X {IMPORT}.sourceDirty=false" in clean
    assert f"-X {IMPORT}.builtAt=" in clean
    for change in ("edited", "staged", "untracked"):
        if change == "edited":
            (app / "tracked.txt").write_text("edited\n")
        elif change == "staged":
            git(app.parent, "add", ".")
        else:
            commit(app.parent)
            (app / "new.txt").write_text("untracked\n")
        assert helper("source", app).stdout.strip() == f"{sha if change != 'untracked' else git(app.parent, 'rev-parse', 'HEAD')} true"
        assert f"-X {IMPORT}.sourceDirty=true" in helper("ldflags", app).stdout
        refused = helper("ldflags", app, "--require-clean", check=False)
        assert refused.returncode != 0 and not refused.stdout


@pytest.mark.parametrize("foreign", [False, True])
def test_gitless_and_foreign_enclosing_repository(tmp_path, foreign):
    if foreign:
        repository(tmp_path)
    app = tmp_path / "copied-source" / "app"
    app.mkdir(parents=True)
    assert helper("source", app).stdout == ""
    assert_time_only(helper("ldflags", app).stdout)
    assert helper("ldflags", app, "--require-clean", check=False).returncode != 0


def test_unknown_module_directory_does_not_stamp_the_callers_repo(tmp_path):
    app, _ = repository(tmp_path / "source")
    result = subprocess.run(["sh", str(HELPER), "ldflags", ""], cwd=app,
                            text=True, capture_output=True, check=True)
    assert_time_only(result.stdout)


def test_archived_commit_stays_stamped_after_head_moves(tmp_path):
    app, _ = repository(tmp_path / "source")
    package = app / PACKAGE
    package.mkdir(parents=True)
    shutil.copyfile(APP / PACKAGE / "build_stamp_reader.go", package / "build_stamp_reader.go")
    go_version = re.search(r"^go (\S+)", (APP / "go.mod").read_text(), re.M)[1]
    (app / "go.mod").write_text(f"module {MODULE}\n\ngo {go_version}\n")
    (app / "main.go").write_text(f'''package main
import ("encoding/json"; "os"; buildstamp "{IMPORT}")
func main() {{ json.NewEncoder(os.Stdout).Encode(buildstamp.Current()) }}
''')
    archived = commit(app.parent)
    flags = helper("ldflags", app, "--require-clean").stdout.strip()
    (app / "tracked.txt").write_text("HEAD moved\n")
    head = commit(app.parent)
    assert archived != head
    archive = subprocess.run(["git", "-C", str(app.parent), "archive", archived], check=True, capture_output=True).stdout
    copied = tmp_path / "gitless"
    copied.mkdir()
    with tarfile.open(fileobj=io.BytesIO(archive)) as source:
        source.extractall(copied, filter="data")
    assert not (copied / ".git").exists()
    env = {**os.environ, "GOWORK": "off", "GOPROXY": "off", "GOTOOLCHAIN": "local"}
    binary = tmp_path / "probe"
    run("go", "build", "-buildvcs=false", "-ldflags", flags, "-o", str(binary), ".", cwd=copied / "app", env=env)
    got = json.loads(run(str(binary)).stdout)
    assert got == {"git_commit_sha": archived, "source_dirty": False,
                   "built_at": re.search(r"\.builtAt=(\S+)", flags)[1], "source_status": "stamped"}


def test_launchers_share_import_path_and_keep_native_build_order():
    helper_text = HELPER.read_text()
    docker = (APP / "docker/Dockerfile").read_text()
    assert IMPORT in helper_text and IMPORT in docker
    assert set(re.findall(r"(?:easelect|filterest)/backend/core_components/build_stamp", helper_text + docker)) == {IMPORT}
    local = (APP / "server_tools/ctl/lib/local.sh").read_text()
    sequence = ['mkdir -p "$LOCAL_BINARY_DIR"', "stamp_dir=$(cd", "go list -m -f '{{.Dir}}' easelect",
                'go_build_args+=(-ldflags', 'cd "$FILTEREST_BUILD_ROOT"\n        go build "${go_build_args[@]}" "${FILTEREST_GO_BUILD_TARGET:-.}"']
    positions = [local.index(piece) for piece in sequence]
    assert positions == sorted(positions)
    assert 'go_build_args=(-buildvcs=false "${go_build_args[@]}")' in local
    assert 'ldflags "$stamp_dir"' in local
    for path in ("server_tools/ctl/lib/local.sh", "server_tools/ctl/lib/docker.sh", "server_tools/run_filterest_docker.sh", "server_tools/release/build_assets.sh"):
        text = (APP / path).read_text()
        assert "build_stamp_ldflags.sh" in text
        assert "core_components/build_stamp" not in text  # helper owns the path
    for path, app_root in (("server_tools/ctl/lib/docker.sh", "$FILTEREST_SOURCE_ROOT"),
                           ("server_tools/run_filterest_docker.sh", "$APPLICATION_ROOT")):
        text = (APP / path).read_text()
        assert '${FILTEREST_GIT_COMMIT+x}' in text
        assert f'source "{app_root}"' in text
        assert 'export FILTEREST_GIT_COMMIT FILTEREST_SOURCE_DIRTY' in text
    compose = (APP / "docker/docker-compose.yml").read_text()
    assert 'FILTEREST_GIT_COMMIT: ${FILTEREST_GIT_COMMIT:-source-copy}' in compose
    assert 'FILTEREST_SOURCE_DIRTY: ${FILTEREST_SOURCE_DIRTY:-}' in compose


def test_release_flags_merge_after_clean_head_checks():
    text = (APP / "server_tools/release/build_assets.sh").read_text()
    assert text.count("-ldflags") == 1
    assert '-ldflags="-w -s -X main.buildEnv=prod $stamp_ldflags -linkmode external"' in text
    stamp = text.index('ldflags "$target_abs" --require-clean')
    assert text.index("must be clean before") < stamp
    assert text.index("reviewed published commit must match clean HEAD") < stamp
    assert stamp < text.index("build_architecture amd64")
    assert "-buildvcs=true" in text and "-trimpath" in text


def docker_build_command():
    text = (APP / "docker/Dockerfile").read_text()
    assert text.index("RUN go mod download") < text.index("ARG FILTEREST_GIT_COMMIT=")
    assert text.index("RUN go mod download") < text.index("ARG FILTEREST_SOURCE_DIRTY=")
    start = text.index("RUN case ")
    end = text.index("\nRUN ", start + 1)
    command = text[start + 4:end].replace("\\\n", " ")
    assert command.index("exit 1") < command.index("stamp_ldflags=")
    assert command.count("-ldflags") == 1 and "-w -s -X main.buildEnv=prod" in command
    return command


@pytest.mark.parametrize("commit_value,dirty,stamped,valid", [
    (SHA, "false", True, True), (SHA, "true", True, True), (SHA, "", False, True),
    ("", "", False, True), ("unknown", "false", False, True), ("source-copy", "true", False, True),
    ("short", "", False, False), (SHA.upper(), "", False, False), ("a" * 64, "false", False, False),
    ("unknown", "yes", False, False), (SHA, "yes", False, False),
    ("source-copy", "-X evil=value", False, False), ("-X evil=value", "false", False, False),
])
def test_docker_validation_and_commit_only_production_path(tmp_path, commit_value, dirty, stamped, valid):
    command = docker_build_command().replace("server_tools/lib/build_stamp_ldflags.sh", str(HELPER)).replace("ldflags /app", f'ldflags "{tmp_path}"')
    env = {**os.environ, "FILTEREST_GIT_COMMIT": commit_value, "FILTEREST_SOURCE_DIRTY": dirty}
    result = subprocess.run(["sh", "-eu", "-c", 'go() { printf "%s\\n" "$*"; };\n' + command],
                            env=env, text=True, capture_output=True)
    assert (result.returncode == 0) == valid, result.stderr
    if not valid:
        assert "go build" not in result.stdout and result.stdout == ""
        return
    assert re.search(r"\.builtAt=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", result.stdout)
    assert (f"{IMPORT}.gitCommit={commit_value}" in result.stdout) == stamped
    assert (f"{IMPORT}.sourceDirty={dirty}" in result.stdout) == stamped
