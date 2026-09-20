# test_codesize.py
# Verifies that the source-size measurement counts what a person writes.
# Bridges the codesize command with the repository's own idea of its contents.
# Exists because the measurement it replaced walked the filesystem: it counted
# dependency caches and committed archives, and reported roughly seventy times
# more Go than the project contains. Each case below is one way that happened.

import importlib.util
import subprocess
from pathlib import Path

import pytest

CODESIZE_PATH = Path(__file__).resolve().parents[2] / "server_tools/scripts/codesize.py"


def load_codesize():
    spec = importlib.util.spec_from_file_location("codesize", CODESIZE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


codesize = load_codesize()


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


@pytest.fixture
def repository(tmp_path):
    """A small Git repository with one file of each kind the tool separates."""
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.email", "t@example.invalid"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=tmp_path, check=True)

    write(tmp_path / "app/handler.go", "package app\n\nfunc Handle() {}\n")
    write(tmp_path / "app/handler_test.go", "package app\n\nfunc TestHandle() {}\n")
    write(tmp_path / "web/widget.js", "export const widget = 1;\n")
    write(tmp_path / "web/widget.test.js", "test('widget', () => {});\n")
    write(tmp_path / "server_tools/versioning/schema_snapshots/db-1.0.0.sql", "CREATE TABLE a();\n" * 40)
    write(tmp_path / ".gitignore", "ignored/\n")
    write(tmp_path / "ignored/dependency.go", "package dep\n" * 500)
    (tmp_path / "archive.zip").write_bytes(b"PK\x03\x04" + b"\0\n" * 200)

    subprocess.run(["git", "add", "-A"], cwd=tmp_path, check=True)
    subprocess.run(["git", "commit", "-qm", "seed"], cwd=tmp_path, check=True)
    return tmp_path


def measure(path, **kwargs):
    options = {
        "use_git": True,
        "test_globs": codesize.DEFAULT_TEST_GLOBS,
        "generated_globs": codesize.GENERATED_PATH_GLOBS,
        "tests_mode": "split",
    }
    options.update(kwargs)
    totals, _, binary_skipped = codesize.measure(
        [str(path)],
        options["use_git"],
        options["test_globs"],
        options["generated_globs"],
        options["tests_mode"],
    )
    return totals, binary_skipped


def test_untracked_dependencies_are_not_counted_as_this_project(repository):
    totals, _ = measure(repository)
    # ignored/dependency.go holds 500 lines that belong to nobody here.
    assert totals["source"]["Go"][1] == 3
    assert totals["source"]["Go"][0] == 1


def test_a_committed_archive_is_not_read_as_lines_of_source(repository):
    totals, binary_skipped = measure(repository)
    assert binary_skipped == 1
    # The six tracked text files are counted; the archive beside them is not,
    # and neither are the two hundred newlines inside it.
    counted = sum(
        entry[0] for group in totals.values() for entry in group.values()
    )
    assert counted == 6
    counted_lines = sum(
        entry[1] for group in totals.values() for entry in group.values()
    )
    assert counted_lines < 100


def test_tests_are_counted_apart_from_the_code_they_test(repository):
    totals, _ = measure(repository)
    assert totals["tests"]["Go"][0] == 1
    assert totals["tests"]["JavaScript"][0] == 1
    assert totals["source"]["JavaScript"][0] == 1


def test_a_schema_snapshot_is_generated_rather_than_written(repository):
    totals, _ = measure(repository)
    assert totals["generated"]["SQL"][1] == 40
    assert "SQL" not in totals["source"]


def test_excluding_tests_leaves_only_the_code_they_test(repository):
    totals, _ = measure(repository, tests_mode="exclude")
    assert totals["tests"] == {}
    assert totals["source"]["Go"][0] == 1


def test_only_tests_reports_no_ordinary_source(repository):
    totals, _ = measure(repository, tests_mode="only")
    assert totals["source"] == {}
    assert totals["tests"]["Go"][0] == 1


def test_a_caller_can_name_its_own_test_filenames(repository):
    write(repository / "web/widget.bench.js", "bench();\n")
    subprocess.run(["git", "add", "-A"], cwd=repository, check=True)
    subprocess.run(["git", "commit", "-qm", "bench"], cwd=repository, check=True)

    without = measure(repository)[0]
    assert without["source"]["JavaScript"][0] == 2

    with_pattern = measure(
        repository, test_globs=codesize.DEFAULT_TEST_GLOBS + ("*.bench.js",)
    )[0]
    assert with_pattern["source"]["JavaScript"][0] == 1
    assert with_pattern["tests"]["JavaScript"][0] == 2


def test_measuring_one_subdirectory_reports_only_that_subdirectory(repository):
    totals, _ = measure(repository / "app")
    assert totals["source"]["Go"][0] == 1
    assert "JavaScript" not in totals["source"]


def test_the_command_runs_and_names_what_it_measured(repository):
    completed = subprocess.run(
        ["python3", str(CODESIZE_PATH), str(repository)],
        capture_output=True,
        text=True,
        check=True,
    )
    assert "tracked by Git" in completed.stdout
    assert "authored:" in completed.stdout
    assert "skipped 1 binary files" in completed.stdout
