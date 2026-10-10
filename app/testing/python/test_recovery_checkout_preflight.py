"""Prove Git obstructions refuse through the updater before downtime or writes.

Use local Git repositories and a pipe-serving original application, wired to
the updater's real stop action. Database, release and Docker tools are recorders;
no real service, database, Docker daemon or network is used.
"""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys

import pytest

import test_native_lifecycle_roots as lifecycle
from test_recovery_log_before_update import ask_application
from test_update_prerequisites_before_downtime import installation_snapshot, assert_untouched


EXPLANATION = "Checkout has an existing lock or incomplete Git operation"
GUIDANCE = "Recovery checkout preflight refused; resolve existing obstructions before update."
LOCKS = (
    "ORIG_HEAD.lock", "packed-refs.lock", "FETCH_HEAD.lock", "shallow.lock",
    "refs/tags/v8.51.0.lock", "refs/tags/other/auto-followed.lock",
    "refs/remotes/origin/tags/v8.51.0.lock", "refs/heads/operator-release.lock",
    "index.lock", "HEAD.lock", "refs/heads/main.lock",
)
STATES = (
    "MERGE_HEAD", "MERGE_AUTOSTASH", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-apply",
    "rebase-merge", "sequencer", "BISECT_START",
)
OPERATOR_CONTENT = b"interrupted operation; retained for operator review\n"


def metadata_snapshot(root):
    """Include all Git bytes and modification times, without following links."""
    result = {}
    for path in sorted(root.rglob("*")):
        metadata = path.lstat()
        result[str(path.relative_to(root))] = (
            metadata.st_mode, metadata.st_uid, metadata.st_gid, metadata.st_mtime_ns,
            os.readlink(path) if stat.S_ISLNK(metadata.st_mode) else
            path.read_bytes() if stat.S_ISREG(metadata.st_mode) else None,
        )
    return result


@pytest.fixture
def original_application(monkeypatch):
    application = subprocess.Popen(
        [sys.executable, "-u", "-c", 'import sys\nfor request in sys.stdin.buffer:\n'
         ' sys.stdout.buffer.write(b"original application response\\n");sys.stdout.buffer.flush()'],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
    )
    native_stop = '\nif [[ "$(basename "$0") $1" == "run_filterest_admin.sh stop" ]]; then kill -TERM "$FILTEREST_TEST_ORIGINAL_PID"; fi\n'
    monkeypatch.setattr(lifecycle, "RECORD_CALL", lifecycle.RECORD_CALL + native_stop)
    tools = dict(lifecycle.FAKE_UPDATE_TOOLS)
    tools["docker"] = tools["docker"].replace(
        "    'stop app')\n", "    'stop app')\n        kill -TERM \"$FILTEREST_TEST_ORIGINAL_PID\"\n",
    )
    monkeypatch.setattr(lifecycle, "FAKE_UPDATE_TOOLS", tools)
    try:
        ask_application(application)
        yield application
    finally:
        application.terminate()
        application.communicate(timeout=3)


def assert_refused_while_serving(fixture, application, before, git_before):
    fixture["environment"]["FILTEREST_TEST_ORIGINAL_PID"] = str(application.pid)
    ask_application(application)
    result = lifecycle.run_update(fixture, "--yes")
    assert result.returncode != 0, result.stdout
    assert EXPLANATION in result.stderr and GUIDANCE in result.stderr
    assert "Filterest update completed" not in result.stdout
    ask_application(application)
    assert_untouched(fixture, before)
    assert metadata_snapshot(fixture["checkout"] / ".git") == git_before
    return result


@pytest.mark.parametrize("profile", ("admin", "docker"))
@pytest.mark.parametrize("name", (*LOCKS, *STATES))
def test_actual_updater_git_obstruction_refuses_while_original_serves(tmp_path, original_application, profile, name):
    fixture = lifecycle.build_update_fixture(tmp_path, profile)
    root = fixture["checkout"]
    if name.startswith("refs/remotes/"):
        subprocess.run(["git", "config", "--add", "remote.origin.fetch",
                        "+refs/tags/*:refs/remotes/origin/tags/*"],
                       cwd=root, check=True, capture_output=True)
    obstruction = root / ".git" / name
    obstruction.parent.mkdir(parents=True, exist_ok=True)
    if name in ("rebase-apply", "rebase-merge", "sequencer"):
        obstruction.mkdir()
        (obstruction / "operator-note").write_bytes(OPERATOR_CONTENT)
    else:
        obstruction.write_bytes(OPERATOR_CONTENT)
        obstruction.chmod(0o400)
    before, git_before = installation_snapshot(root), metadata_snapshot(root / ".git")
    result = assert_refused_while_serving(fixture, original_application, before, git_before)
    check = (name + " state" if name in STATES else "main branch lock" if name == "refs/heads/main.lock"
             else "reference lock" if name.startswith("refs/") else name.removesuffix(".lock") + " lock")
    assert EXPLANATION + ": " + check in result.stderr
    assert obstruction.is_dir() or obstruction.read_bytes() == OPERATOR_CONTENT


@pytest.mark.parametrize("kind", ("directory", "dangling-link"))
def test_actual_updater_orig_head_lock_types_remain_for_review(tmp_path, original_application, kind):
    fixture = lifecycle.build_update_fixture(tmp_path, "admin")
    root = fixture["checkout"]
    lock = root / ".git/ORIG_HEAD.lock"
    if kind == "directory":
        lock.mkdir()
    else:
        lock.symlink_to("operator-missing-lock-target")
    before, git_before = installation_snapshot(root), metadata_snapshot(root / ".git")
    assert_refused_while_serving(fixture, original_application, before, git_before)
    assert os.path.lexists(lock)


@pytest.mark.parametrize("name", ("operator-index", "operator índex\n"))
def test_actual_updater_honors_git_selected_index_lock(tmp_path, original_application, name):
    fixture = lifecycle.build_update_fixture(tmp_path, "admin")
    root = fixture["checkout"]
    index = tmp_path / name
    shutil.copy2(root / ".git/index", index)
    lock = Path(str(index) + ".lock")
    lock.write_bytes(OPERATOR_CONTENT)
    fixture["environment"]["GIT_INDEX_FILE"] = str(index)
    index_before = metadata_snapshot(tmp_path)[name]
    before, git_before = installation_snapshot(root), metadata_snapshot(root / ".git")
    assert_refused_while_serving(fixture, original_application, before, git_before)
    assert metadata_snapshot(tmp_path)[name] == index_before
    assert lock.read_bytes() == OPERATOR_CONTENT


@pytest.mark.parametrize("kind", ("linked-index", "default-lock-with-selected-index"))
def test_actual_updater_preserves_default_and_resolved_index_lock_refusals(tmp_path, original_application, kind):
    fixture = lifecycle.build_update_fixture(tmp_path, "admin")
    root = fixture["checkout"]
    default_index = root / ".git/index"
    index = tmp_path / "operator-index"
    shutil.copy2(default_index, index)
    if kind == "linked-index":
        default_index.unlink()
        default_index.symlink_to(index)
        lock = Path(str(index) + ".lock")
    else:
        fixture["environment"]["GIT_INDEX_FILE"] = str(index)
        lock = Path(str(default_index) + ".lock")
    lock.write_bytes(OPERATOR_CONTENT)
    before, git_before = installation_snapshot(root), metadata_snapshot(root / ".git")
    assert_refused_while_serving(fixture, original_application, before, git_before)
    assert lock.read_bytes() == OPERATOR_CONTENT


@pytest.mark.parametrize("profile", ("admin", "docker"))
def test_actual_updater_git_refusal_does_not_refresh_index(tmp_path, original_application, profile):
    fixture = lifecycle.build_update_fixture(tmp_path, profile)
    root = fixture["checkout"]
    file = root / "app/VERSION_APP"
    metadata = file.stat()
    os.utime(file, ns=(metadata.st_atime_ns, metadata.st_mtime_ns + 1_000_000_000))
    (root / ".git/ORIG_HEAD.lock").write_bytes(OPERATOR_CONTENT)
    before, git_before = installation_snapshot(root), metadata_snapshot(root / ".git")
    assert_refused_while_serving(fixture, original_application, before, git_before)


def test_full_checkout_preflight_does_not_refresh_index_without_an_obstruction(tmp_path):
    fixture = lifecycle.build_update_fixture(tmp_path, "admin")
    root = fixture["checkout"]
    file = root / "app/VERSION_APP"
    metadata = file.stat()
    os.utime(file, ns=(metadata.st_atime_ns, metadata.st_mtime_ns + 1_000_000_000))
    before, git_before = installation_snapshot(root), metadata_snapshot(root / ".git")
    result = subprocess.run(
        [sys.executable, str(root / "app/server_tools/lib/recovery_checkout_preflight.py"),
         "--root", str(root), "--target", fixture["target_commit"]],
        env=fixture["environment"], capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    assert installation_snapshot(root) == before
    assert metadata_snapshot(root / ".git") == git_before


@pytest.mark.parametrize("change", ("tracked", "staged", "both", "staged-rename"))
def test_actual_updater_retains_tracked_and_staged_refusals_without_index_writes(tmp_path, original_application, change):
    fixture = lifecycle.build_update_fixture(tmp_path, "admin")
    root = fixture["checkout"]
    file = root / "app/VERSION_APP"
    if change == "staged-rename":
        subprocess.run(["git", "mv", "app/VERSION_DB", "app/renamed-VERSION_DB"], cwd=root, check=True, capture_output=True)
    else:
        file.write_text("operator revision\n")
        if change in ("staged", "both"):
            subprocess.run(["git", "add", "app/VERSION_APP"], cwd=root, check=True, capture_output=True)
        if change == "both":
            file.write_text("later operator revision\n")
    before, git_before = installation_snapshot(root), metadata_snapshot(root / ".git")
    fixture["environment"]["FILTEREST_TEST_ORIGINAL_PID"] = str(original_application.pid)
    result = lifecycle.run_update(fixture, "--yes")
    explanation = ("tracked files have local changes; commit or restore them first"
                   if change in ("tracked", "both") else "the Git index has staged changes; commit or restore them first")
    assert result.returncode != 0 and explanation in result.stderr
    ask_application(original_application)
    assert_untouched(fixture, before)
    assert metadata_snapshot(root / ".git") == git_before


@pytest.mark.parametrize("branch", ("operator-release", "release/nästa"))
def test_preflight_checks_the_actual_branch_instead_of_only_main(tmp_path, branch):
    fixture = lifecycle.build_update_fixture(tmp_path, "admin")
    root = fixture["checkout"]
    subprocess.run(["git", "branch", "-m", branch], cwd=root, check=True, capture_output=True)
    lock = root / ".git/refs/heads" / (branch + ".lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    lock.write_bytes(OPERATOR_CONTENT)
    before, git_before = installation_snapshot(root), metadata_snapshot(root / ".git")
    result = subprocess.run(
        [sys.executable, str(root / "app/server_tools/lib/recovery_checkout_preflight.py"),
         "--root", str(root), "--target", fixture["target_commit"]],
        env=fixture["environment"], capture_output=True, text=True,
    )
    assert result.returncode != 0 and EXPLANATION in result.stderr and GUIDANCE in result.stderr
    assert installation_snapshot(root) == before
    assert metadata_snapshot(root / ".git") == git_before


@pytest.mark.parametrize("name", ("ORIG_HEAD.lock", "packed-refs.lock", "refs/heads/main.lock"))
def test_actual_updater_rechecks_git_locks_after_fetch_before_shutdown(tmp_path, original_application, name):
    fixture = lifecycle.build_update_fixture(tmp_path, "admin")
    root = fixture["checkout"]
    lock = root / ".git" / name
    # Model a concurrent lock arriving immediately after the early inspection.
    # Target evidence is already local; the fetch recorder creates only this
    # obstruction, then returns to the actual updater's second preflight.
    git = root.parent / "bin/git"
    real_git = shutil.which("git")
    git.write_text('''#!/usr/bin/env bash
if [[ "$3" == fetch ]]; then
    printf '%s\\n' 'interrupted operation; retained for operator review' > "$FILTEREST_TEST_LATE_GIT_LOCK"
    exit 0
fi
exec "$FILTEREST_TEST_REAL_GIT" "$@"
''')
    git.chmod(0o700)
    fixture["environment"].update(FILTEREST_TEST_REAL_GIT=real_git, FILTEREST_TEST_LATE_GIT_LOCK=str(lock))
    # Capture the state expected after that one simulated concurrent write.
    lock.write_bytes(OPERATOR_CONTENT)
    git_before = metadata_snapshot(root / ".git")
    lock.unlink()
    before = installation_snapshot(root)
    fixture["environment"]["FILTEREST_TEST_ORIGINAL_PID"] = str(original_application.pid)
    result = lifecycle.run_update(fixture, "--yes")
    assert result.returncode != 0 and EXPLANATION in result.stderr and GUIDANCE in result.stderr
    ask_application(original_application)
    assert_untouched(fixture, before)
    after = metadata_snapshot(root / ".git")
    # The simulated writer changes the lock/parent timestamps; all bytes, modes
    # and other metadata still belong to the original checkout.
    for path in (name, str(Path(name).parent)):
        if path in git_before:
            git_before[path] = (*git_before[path][:3], after[path][3], git_before[path][4])
    assert after == git_before


@pytest.mark.parametrize("profile", ("admin", "docker"))
def test_actual_update_does_not_need_the_git_config_lock(tmp_path, profile):
    fixture = lifecycle.build_update_fixture(tmp_path, profile)
    subprocess.run(["git", "config", "--add", "remote.origin.fetch",
                    "+refs/tags/*:refs/remotes/origin/tags/*"],
                   cwd=fixture["checkout"], check=True, capture_output=True)
    file = fixture["checkout"] / "app/VERSION_APP"
    metadata = file.stat()
    os.utime(file, ns=(metadata.st_atime_ns, metadata.st_mtime_ns + 1_000_000_000))
    lock = fixture["checkout"] / ".git/config.lock"
    lock.write_bytes(OPERATOR_CONTENT)
    before = lock.read_bytes(), lock.stat().st_mode, lock.stat().st_mtime_ns
    result = lifecycle.run_update(fixture, "--yes")
    assert result.returncode == 0, result.stderr
    assert lifecycle.git_output(fixture["checkout"], "rev-parse", "HEAD") == fixture["target_commit"]
    assert lifecycle.git_output(fixture["checkout"], "rev-parse", "refs/remotes/origin/tags/v8.51.0") == fixture["target_commit"]
    assert len(lifecycle.update_backups(fixture)) == 1
    assert (lock.read_bytes(), lock.stat().st_mode, lock.stat().st_mtime_ns) == before


@pytest.mark.parametrize("failure,check", (
    ("reference", "checked-out reference resolution"),
    ("destination", "Git update destination resolution"),
    ("inventory", "tracked path inventory"),
    ("comparison", "release path comparison"),
))
def test_checkout_git_inspection_failure_names_fixed_check_without_operator_paths(tmp_path, failure, check):
    fixture = lifecycle.build_update_fixture(tmp_path, "admin")
    root = fixture["checkout"]
    git = root.parent / "bin/git"
    git.write_text('''#!/usr/bin/env bash
case "$FILTEREST_TEST_REFUSE_CHECK:$*" in
    reference:*"rev-parse --symbolic-full-name HEAD" | \\
    destination:*"rev-parse --path-format=absolute --git-path index" | \\
    inventory:*"ls-files -z" | \\
    comparison:*"diff --no-renames --name-only -z --diff-filter=AMT HEAD "*)
        printf 'operator path: %s\\n' "$FILTEREST_TEST_PRIVATE_PATH" >&2
        exit 91 ;;
esac
exec "$FILTEREST_TEST_REAL_GIT" "$@"
''')
    git.chmod(0o700)
    fixture["environment"].update(FILTEREST_TEST_REAL_GIT=shutil.which("git"),
                                  FILTEREST_TEST_REFUSE_CHECK=failure,
                                  FILTEREST_TEST_PRIVATE_PATH=str(tmp_path / "operator índex\n"))
    before, git_before = installation_snapshot(root), metadata_snapshot(root / ".git")
    result = subprocess.run(
        [sys.executable, str(root / "app/server_tools/lib/recovery_checkout_preflight.py"),
         "--root", str(root), "--target", fixture["target_commit"]],
        env=fixture["environment"], capture_output=True, text=True,
    )
    assert result.returncode == 1 and not result.stdout
    assert result.stderr == f"Checkout preflight failed: {check}\n{GUIDANCE}\n"
    assert str(root) not in result.stderr and fixture["environment"]["FILTEREST_TEST_PRIVATE_PATH"] not in result.stderr
    assert_untouched(fixture, before)
    assert metadata_snapshot(root / ".git") == git_before
