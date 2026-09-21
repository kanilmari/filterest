"""Keep a Filterest checkout's tracked source inside its own boundary.

Bridges the release source check with small Git fixtures. Exists so a private
name supplied by an embedding workspace, a tracked operator home or an escaping
symlink stops a release. The example names here stand in for real private ones,
which this repository never lists.
"""

from __future__ import annotations

from pathlib import Path
import subprocess

import pytest

from server_tools.release import audit_source_boundary as boundary


PRIVATE_NAME = "example_private_shell"
CANDIDATE_NAME = "example_candidate_source"
OPERATOR_IGNORES = "".join(f"/{home}/\n" for home in boundary.OPERATOR_HOMES)


def init(root: Path, *, ignore_operator_homes: bool = True) -> Path:
    root.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main", str(root)], check=True)
    if ignore_operator_homes:
        track(root, ".gitignore", OPERATOR_IGNORES)
    return root


def track(root: Path, relative: str, text: str) -> None:
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)
    subprocess.run(["git", "-C", str(root), "add", "-f", "--", relative], check=True)


def codes(root: Path, names=(PRIVATE_NAME, CANDIDATE_NAME)) -> list[tuple[str, str]]:
    return [(finding.path, finding.code) for finding in boundary.audit(root, names)]


def test_source_addressing_a_named_private_owner_is_refused(tmp_path):
    root = init(tmp_path / "product")
    track(root, "app/backend/main.go", f'package main\nimport _ "example/{PRIVATE_NAME}/runtime"\n')

    assert codes(root) == [("app/backend/main.go", "public-sibling-source-dependency")]


@pytest.mark.parametrize(("filename", "content"), (
    ("main.go", f'package main\nimport _ "example/{PRIVATE_NAME}/runtime"\n'),
    ("load.go", f'package main\nvar code = os.ReadFile("../{PRIVATE_NAME}/code.go")\n'),
    ("main.js", f"import x from '../{PRIVATE_NAME}/runtime.js';\n"),
    ("dynamic.mjs", f"await import('../{PRIVATE_NAME}/runtime.mjs');\n"),
    ("load.js", f"const p = '../{PRIVATE_NAME}/runtime.js'; require(p);\n"),
    ("execute.js", f"childProcess.execFile('../{PRIVATE_NAME}/run');\n"),
    ("main.py", f"from {PRIVATE_NAME}.runtime import run\n"),
    ("dynamic.py", f"importlib.import_module('{PRIVATE_NAME}.runtime')\n"),
    ("execute.py", f"exec(Path('../{PRIVATE_NAME}/code.py').read_text())\n"),
    ("run.sh", f". ../{PRIVATE_NAME}/run.sh\n"),
    ("execute.sh", f"exec python3 ../{PRIVATE_NAME}/run.py\n"),
    ("package.json", f'{{"dependencies":{{"private":"file:../{PRIVATE_NAME}"}}}}'),
))
def test_every_way_of_loading_private_source_is_refused(tmp_path, filename, content):
    root = init(tmp_path / "product")
    track(root, "app/backend/" + filename, content)

    assert codes(root) == [("app/backend/" + filename, "public-sibling-source-dependency")]


def test_a_built_bundle_importing_a_private_owner_is_refused(tmp_path):
    # Built bundles are not text-scanned, but what they import still counts.
    root = init(tmp_path / "product")
    track(root, "app/frontend/dist/main.js", f'import x from "../../{CANDIDATE_NAME}/x.js";\n')
    track(root, "app/frontend/dist/about.js", f'const note = "built without {CANDIDATE_NAME}";\n')

    assert codes(root) == [("app/frontend/dist/main.js", "runtime-forbidden-import")]


def test_docs_and_tests_may_name_private_owners(tmp_path):
    root = init(tmp_path / "product")
    track(root, "app/docs/guide.md", f"The {PRIVATE_NAME} shell may compose Filterest.\n")
    track(root, "app/testing/python/test_example.py", f"NAME = '{PRIVATE_NAME}'\n")
    track(root, "app/backend/example_test.go", f'// {PRIVATE_NAME}\n')

    assert codes(root) == []


def test_without_supplied_names_only_the_structure_is_checked(tmp_path):
    root = init(tmp_path / "product")
    track(root, "app/backend/main.go", f'import _ "example/{PRIVATE_NAME}/runtime"\n')

    assert codes(root, names=()) == []


def test_tracked_operator_homes_and_private_roots_are_refused(tmp_path):
    root = init(tmp_path / "product")
    track(root, "keys/filterest_runtime/runtime_environment.env", "DB_NAME=x\n")
    track(root, f"{PRIVATE_NAME}/tool.py", "print('private')\n")

    assert codes(root) == [
        ("example_private_shell/tool.py", "tracked-operator-or-private-path"),
        ("keys/filterest_runtime/runtime_environment.env", "tracked-operator-or-private-path"),
    ]


def test_operator_homes_must_be_ignored(tmp_path):
    root = init(tmp_path / "product", ignore_operator_homes=False)
    track(root, "README.md", "Filterest\n")

    assert codes(root) == [
        (f"{home}/", "operator-home-not-ignored") for home in sorted(boundary.OPERATOR_HOMES)
    ]


def test_symlinks_must_stay_inside_the_checkout(tmp_path):
    root = init(tmp_path / "product")
    track(root, "app/docs/target.md", "target\n")
    (root / "app/docs/inside.md").symlink_to("target.md")
    (root / "app/docs/outside.md").symlink_to("../../../outside.md")
    subprocess.run(["git", "-C", str(root), "add", "app/docs"], check=True)

    assert codes(root) == [("app/docs/outside.md", "escaping-symlink")]


def test_command_reports_success_and_failure(tmp_path, capsys):
    root = init(tmp_path / "product")
    track(root, "app/backend/main.go", "package main\n")

    assert boundary.main(["--target", str(root), "--forbidden-name", PRIVATE_NAME]) == 0
    assert "1 private owner name(s) checked" in capsys.readouterr().out

    track(root, "app/backend/other.go", f'import _ "example/{PRIVATE_NAME}"\n')
    assert boundary.main(["--target", str(root), "--forbidden-name", PRIVATE_NAME]) == 1
    assert "[public-sibling-source-dependency] app/backend/other.go" in capsys.readouterr().out


def test_this_checkout_passes_without_private_names() -> None:
    assert boundary.DEFAULT_TARGET == Path(__file__).resolve().parents[3]
    tracked = boundary.read_tracked_paths(boundary.DEFAULT_TARGET)
    assert boundary.inspect_symlinks(boundary.DEFAULT_TARGET, tracked) == ()
