"""The copied-file list of the installation fixtures covers every helper the copied scripts name.

Bridges installation_fixture_files.py and the heavy-installation fixtures that copy its list.
Exists because batch 518's build-stamp helper was missing from the fixed list: the nightly's
21 heavy failures ("cannot open …/server_tools/lib/build_stamp_ldflags.sh") are caught here
in the ordinary tier instead. The coverage guard below scans independently of the derivation
(plain word tokens for shell and data files, the ast for Python imports).
"""

from __future__ import annotations

import ast
import os
from pathlib import Path
import re

from installation_fixture_files import (APP_ROOT, COPIED_SCRIPT_SEEDS, LIBRARY_DIRS, LIFECYCLE_ENTRY_SCRIPTS,
                                        LIFECYCLE_LIBRARY_FILES, computed_library_references, library_files,
                                        referenced_library_files)


def uncopied_library_files(scripts, copied, app_root):
    """The library files the scripts name or import that `copied` lacks, found WITHOUT the derivation:
    every word token is compared with the library folders' file names, and Python imports come from the ast."""
    names = {path.name for folder in LIBRARY_DIRS if (app_root / folder).is_dir()
             for path in (app_root / folder).iterdir() if path.is_file()}
    wanted = set()
    for relative in scripts:
        text = (app_root / relative).read_text(encoding="utf-8", errors="replace")
        tokens = set(re.split(r"[^A-Za-z0-9_.-]+", text))
        if relative.endswith(".py"):
            for node in ast.walk(ast.parse(text)):
                if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("server_tools."):
                    if node.module.split(".")[-1] == "lib":
                        tokens.update(f"{alias.name}.py" for alias in node.names)
                    else:
                        tokens.add(node.module.split(".")[-1] + ".py")
                elif isinstance(node, ast.Import):
                    tokens.update(alias.name.split(".")[-1] + ".py" for alias in node.names
                                  if alias.name.startswith("server_tools."))
        for name in tokens & names:
            wanted.update(f"{folder}/{name}" for folder in LIBRARY_DIRS if (app_root / folder / name).is_file())
    return wanted - set(copied)


def test_every_named_helper_is_copied_by_an_independent_scan():
    scripts = list(LIFECYCLE_ENTRY_SCRIPTS) + [p for p in LIFECYCLE_LIBRARY_FILES if p.endswith((".sh", ".py"))]
    missing = uncopied_library_files(scripts, LIFECYCLE_LIBRARY_FILES, APP_ROOT)
    assert not missing, f"copied scripts name helpers the fixtures do not copy: {sorted(missing)}"


def test_the_build_stamp_helper_is_copied():
    assert "server_tools/lib/build_stamp_ldflags.sh" in LIFECYCLE_LIBRARY_FILES


def test_every_listed_file_exists_once_inside_the_app():
    assert len(set(LIFECYCLE_LIBRARY_FILES)) == len(LIFECYCLE_LIBRARY_FILES)
    root = APP_ROOT.resolve()
    assert [p for p in LIFECYCLE_LIBRARY_FILES if not (APP_ROOT / p).is_file()
            or not (APP_ROOT / p).resolve().is_relative_to(root)] == []


def test_no_copied_script_builds_a_library_file_name_at_run_time():
    scripts = list(COPIED_SCRIPT_SEEDS) + [p for p in LIFECYCLE_LIBRARY_FILES if p.endswith((".sh", ".py"))]
    assert computed_library_references(scripts) == []


def write_tree(root: Path, files: dict[str, str]) -> None:
    for relative, text in files.items():
        (root / relative).parent.mkdir(parents=True, exist_ok=True)
        (root / relative).write_text(text, encoding="utf-8")


def test_derivation_follows_every_literal_name_form(tmp_path: Path):
    root = tmp_path / "app"
    write_tree(root, {
        # cp-gate-522a's failing case: the folder in a variable, the file name literal
        "server_tools/entry.sh": 'HELPER_DIR="$SCRIPT_APPLICATION_ROOT/server_tools/lib"\nsh "$HELPER_DIR/new_helper.sh"\n'
                                 '. "$SCRIPT_DIR/lib/settings.env"\nsh "$ROOT/server_tools/lib/not_there.sh"\n',
        "server_tools/lib/new_helper.sh": 'python3 "$HERE/second.py"\n',
        "server_tools/lib/second.py": "from server_tools.lib import third, fourth\nimport server_tools.lib.fifth\nSQL = 'restore.sql'\n",
        "server_tools/lib/third.py": "", "server_tools/lib/fourth.py": "", "server_tools/lib/fifth.py": "",
        "server_tools/lib/settings.env": "A=1\n", "server_tools/lib/unused.sh": "",
        "server_tools/ctl/lib/restore.sql": "select 1;\n",
    })
    found = referenced_library_files(("server_tools/entry.sh",), root)
    assert found == {"server_tools/lib/new_helper.sh", "server_tools/lib/second.py", "server_tools/lib/third.py",
                     "server_tools/lib/fourth.py", "server_tools/lib/fifth.py", "server_tools/lib/settings.env",
                     "server_tools/ctl/lib/restore.sql"}
    # The independent scan agrees, and reports the gate's case when the copy list lacks it.
    assert uncopied_library_files(["server_tools/entry.sh", "server_tools/lib/new_helper.sh", "server_tools/lib/second.py"],
                                  found, root) == set()
    assert uncopied_library_files(["server_tools/entry.sh"], found - {"server_tools/lib/new_helper.sh"}, root) \
        == {"server_tools/lib/new_helper.sh"}


def test_a_link_out_of_the_app_is_never_derived(tmp_path: Path):
    root = tmp_path / "app"
    outside = tmp_path / "outside.sh"
    outside.write_text("echo outside\n", encoding="utf-8")
    write_tree(root, {"server_tools/entry.sh": 'sh "$D/lib/escape.sh"\n'})
    (root / "server_tools/lib").mkdir(parents=True)
    os.symlink(outside, root / "server_tools/lib/escape.sh")
    assert "escape.sh" not in library_files(root)
    assert referenced_library_files(("server_tools/entry.sh",), root) == set()


def test_a_computed_library_name_is_reported(tmp_path: Path):
    root = tmp_path / "app"
    write_tree(root, {"server_tools/entry.sh": 'tool=deploy\nsh "$SCRIPT_DIR/lib/${tool}.sh"\n'})
    assert computed_library_references(["server_tools/entry.sh"], root) == [("server_tools/entry.sh", 2)]
