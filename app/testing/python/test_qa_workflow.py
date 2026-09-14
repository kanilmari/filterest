"""Exercise QA orchestration without running application tests or changing a checkout.

Real import/report tools run against disposable source trees; heavy tools record
their arguments so repair, exit-status and skipped-E2E contracts stay observable.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest


APP = Path(__file__).resolve().parents[2]
QA = Path("server_tools/scripts/qa.sh")
GITIGNORE = Path("server_tools/check_gitignore/check_gitignore.sh")
CSS = Path("frontend/styles/check_css_imports.js")
JS = Path("frontend/check_js_imports.js")
BYTECODE = Path("server_tools/lib/python_bytecode_cache.sh")

# Only the target resolver and expensive external tools are simulated. Import
# scripts below are the actual CLI programs, with the installed Node/glob.
FAKE_TOOL = r"""
import json, os, pathlib, subprocess, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ["QA_TEST_LOG"], "a") as log:
    log.write(json.dumps({"tool": name, "args": args, "cwd": os.getcwd()}) + "\n")
step = name
if name == "npm":
    step += "-" + args[1]
elif name == "go" and args:
    step += "-" + args[0]
if os.environ.get("QA_TEST_FAIL") == step:
    sys.exit(17)
if name == "node":
    if "--print-base-url" in args:
        print("https://localhost:8100")
    else:
        sys.exit(subprocess.call([os.environ["QA_REAL_NODE"], *args]))
elif name == "eslint":
    if "--fix" in args:
        pathlib.Path("lint-marker.js").write_text("// repaired\n")
elif name == "npm" and args[1] == "build":
    output = pathlib.Path(args[args.index("--outDir") + 1])
    output.mkdir()
    (output / "asset.js").write_text("build")
elif name == "go":
    if args[0] == "test":
        for arg in args:
            if arg.startswith("-coverprofile="):
                pathlib.Path(arg.split("=", 1)[1]).write_text("coverage")
    elif args[0] == "tool":
        print("total: (statements) " + os.environ.get("QA_TEST_COVERAGE", "10.0") + "%")
    elif args[0] == "list":
        print("example.invalid/filterest/backend/query")
        print("example.invalid/filterest/cmd/filterest")
elif name == "bc":
    left, right = sys.stdin.read().strip().split("<")
    print(int(float(left) < float(right)))
elif name == "curl":
    status = int(os.environ.get("QA_TEST_HTTP", "200"))
    if status == 0 or (status >= 400 and "--fail" in args):
        sys.exit(22)
"""


def source_hashes(root: Path) -> dict[str, str]:
    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in root.rglob("*")
        if path.is_file()
    }


@pytest.fixture
def node_environment() -> dict[str, str]:
    environment = os.environ.copy()
    for name in tuple(environment):
        if name.startswith(("FILTEREST_", "QA_PLAYWRIGHT_", "QA_TEST_")) or name in {
            "PYTHONPYCACHEPREFIX", "PYTHONPATH",
        }:
            environment.pop(name, None)
    node = shutil.which("node")
    assert node, "Install the documented development Node runtime first"
    modules = Path(os.environ.get(
        "FILTEREST_NODE_MODULES_ROOT", str(APP.parent / "data/runtime/node/node_modules")
    ))
    if modules.is_dir():
        environment["NODE_PATH"] = str(modules)
    probe = subprocess.run(
        [node, "-e", "require('glob')"], env=environment, capture_output=True, text=True,
    )
    assert probe.returncode == 0, probe.stderr
    environment["QA_REAL_NODE"] = node
    return environment


class Workflow:
    def __init__(self, tmp_path: Path, environment: dict[str, str]):
        self.root = tmp_path
        self.app = tmp_path / "installation/app"
        self.log = tmp_path / "calls.jsonl"
        self.bin = tmp_path / "bin"
        self.bin.mkdir()
        self.environment = environment.copy()
        self.environment.update({
            "PATH": str(self.bin) + os.pathsep + environment["PATH"],
            "QA_TEST_LOG": str(self.log),
            "FILTEREST_TEST_CREDENTIAL_FILE": str(tmp_path / "test-credentials"),
        })
        for relative in (QA, CSS, JS, GITIGNORE, BYTECODE):
            target = self.app / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(APP / relative, target)
        for relative, content in {
            "frontend/main.js": "import './dependency.js';\n",
            "frontend/dependency.js": "export const value = 1;\n",
            "frontend/styles/imports.css": '@import "./present.css";\n',
            "frontend/styles/present.css": "body {}\n",
            "lint-marker.js": "// untouched\n",
            "VERSION_APP": "9.0.0\n",
            "go.mod": "module example.invalid/filterest\n",
            "coverage.out": "preexisting coverage must survive\n",
            "server_tools/check_gitignore/missing_gitignore_paths.md": "kept report\n",
            "frontend/dist/existing.js": "kept asset\n",
        }.items():
            path = self.app / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        for relative in ("frontend/core_components", "frontend/reusable_components"):
            (self.app / relative).mkdir()
        (self.app.parent / ".gitignore").write_text("missing-runtime/\n*.log\n")
        for name in ("node", "npm", "eslint", "python3", "go", "curl", "bc", "playwright"):
            tool = self.bin / name
            tool.write_text(f"#!{sys.executable}\n" + FAKE_TOOL)
            tool.chmod(0o755)
        for relative in (
            "server_tools/scripts/check_file_length.sh",
            "server_tools/scripts/check_import_boundaries.sh",
        ):
            path = self.app / relative
            path.write_text('#!/bin/bash\nprintf "%s\\n" "fixture check $*"\n')
            path.chmod(0o755)

    def run(self, *args: str, credentials: bool = False, cwd: Path | None = None,
            **overrides: str) -> subprocess.CompletedProcess[str]:
        if credentials:
            Path(self.environment["FILTEREST_TEST_CREDENTIAL_FILE"]).write_text("fixture")
        return subprocess.run(
            ["bash", str(self.app / QA), *args], cwd=cwd or self.app,
            env={**self.environment, **overrides}, capture_output=True, text=True, timeout=30,
        )

    def calls(self, tool: str | None = None) -> list[dict]:
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        return [call for call in calls if tool is None or call["tool"] == tool]


@pytest.fixture
def workflow(tmp_path: Path, node_environment: dict[str, str]) -> Workflow:
    return Workflow(tmp_path, node_environment)


def test_default_checks_preserve_source_and_remove_temporary_artifacts(workflow: Workflow):
    before = source_hashes(workflow.app)
    result = workflow.run(credentials=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert source_hashes(workflow.app) == before
    assert "QA PASS:" in result.stdout and "PASS (smoke: desktop-card" in result.stdout
    assert "full matrix not run" in result.stdout
    calls = workflow.calls()
    assert not any("--fix" in call["args"] or "--fix-imports" in call["args"] for call in calls)
    build = next(call for call in calls if call["tool"] == "npm" and call["args"][1] == "build")
    output = Path(build["args"][-1])
    assert workflow.app not in output.parents and not output.parent.exists()
    cover = next(arg for call in calls for arg in call["args"] if arg.startswith("-coverprofile="))
    assert Path(cover.split("=", 1)[1]).parent == output.parent
    tests = [call["args"] for call in workflow.calls("go") if call["args"][0] == "test"]
    assert len(tests) == 2 and tests[0][1] == "./backend/..."
    assert tests[1] == ["test", "example.invalid/filterest/cmd/filterest", "-count=1"]


def test_explicit_fix_repairs_imports_lint_and_report(workflow: Workflow):
    (workflow.app / "frontend/main.js").write_text("import './old/dependency.js';\n")
    (workflow.app / "frontend/styles/imports.css").write_text('@import "./old/present.css";\n')
    result = workflow.run("--fix")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "./old/" not in (workflow.app / "frontend/main.js").read_text()
    assert "./old/" not in (workflow.app / "frontend/styles/imports.css").read_text()
    assert (workflow.app / "lint-marker.js").read_text() == "// repaired\n"
    report = (workflow.app / GITIGNORE.parent / "missing_gitignore_paths.md").read_text()
    assert "missing-runtime/" in report and "*.log" not in report
    assert "--fix" in workflow.calls("eslint")[0]["args"]
    assert all("--fix-imports" in call["args"] for call in workflow.calls("node")[1:])


@pytest.mark.parametrize("http,credentials,reason", [
    ("200", False, "credential file is absent"),
    ("0", True, "health check failed"),
    ("500", True, "health check failed"),
    ("503", True, "health check failed"),
])
def test_skipped_e2e_is_partial_never_all_pass(
    workflow: Workflow, http: str, credentials: bool, reason: str,
):
    result = workflow.run(credentials=credentials, QA_TEST_HTTP=http)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "QA PARTIAL:" in result.stdout and "E2E SKIPPED" in result.stdout
    assert reason in result.stdout
    assert "QA PASS:" not in result.stdout and "All QA checks passed" not in result.stdout
    assert workflow.calls("playwright") == []
    if credentials:
        args = workflow.calls("curl")[0]["args"]
        assert "--fail" in args and "--max-time" in args and "--connect-timeout" in args
    else:
        assert workflow.calls("curl") == []


@pytest.mark.parametrize("full,project", [("0", "mobile-article"), ("1", "desktop-card")])
def test_existing_e2e_selection_contract(workflow: Workflow, full: str, project: str):
    result = workflow.run(credentials=True, QA_PLAYWRIGHT_FULL=full, QA_PLAYWRIGHT_PROJECT=project)
    assert result.returncode == 0, result.stdout + result.stderr
    if full == "1":
        assert ["run", "test:e2e"] in [call["args"] for call in workflow.calls("npm")]
        assert workflow.calls("playwright") == []
        assert "PASS (full matrix)" in result.stdout
    else:
        assert workflow.calls("playwright")[0]["args"] == [
            "test", f"--project={project}", "testing/e2e/smoke.spec.ts",
            "testing/e2e/L_auth/L1_login.spec.ts",
        ]


@pytest.mark.parametrize("failure", [
    "npm-lint:css", "eslint", "python3", "go-test", "go-tool",
    "go-list", "npm-build", "playwright",
])
def test_tool_failure_propagates_without_success_summary(workflow: Workflow, failure: str):
    result = workflow.run(credentials=True, QA_TEST_FAIL=failure)
    assert result.returncode == 17, result.stdout + result.stderr
    assert "QA PASS:" not in result.stdout and "QA PARTIAL:" not in result.stdout
    for call in workflow.calls("go"):
        for arg in call["args"]:
            if arg.startswith("-coverprofile="):
                assert not Path(arg.split("=", 1)[1]).parent.exists()


def test_full_matrix_failure_propagates(workflow: Workflow):
    result = workflow.run(credentials=True, QA_PLAYWRIGHT_FULL="1", QA_TEST_FAIL="npm-test:e2e")
    assert result.returncode == 17
    assert "QA PASS:" not in result.stdout


def test_coverage_floor_is_unchanged(workflow: Workflow):
    result = workflow.run(QA_TEST_COVERAGE="6.9")
    assert result.returncode == 1
    assert "floor: 7%" in result.stdout
    assert not any(call["args"][1] == "build" for call in workflow.calls("npm"))


@pytest.mark.parametrize("relative", [CSS, JS])
def test_broken_import_stops_default_qa_without_repair(workflow: Workflow, relative: Path):
    entry = workflow.app / ("frontend/styles/imports.css" if relative == CSS else "frontend/main.js")
    entry.write_text('@import "./absent.css";\n' if relative == CSS else "import './absent.js';\n")
    before = source_hashes(workflow.app)
    result = workflow.run()
    assert result.returncode == 1, result.stdout + result.stderr
    assert source_hashes(workflow.app) == before
    assert workflow.calls("go") == []
    assert "QA PARTIAL:" not in result.stdout


def test_checkout_extension_keeps_caller_cwd_and_receives_no_new_arguments(workflow: Workflow):
    caller = workflow.root / "caller"
    caller.mkdir()
    extension = caller / "extension.sh"
    extension.write_text('#!/bin/bash\nprintf "EXTENSION:%s:%s\\n" "$PWD" "$#"\n')
    extension.chmod(0o755)
    result = workflow.run("--fix", cwd=caller, FILTEREST_ADDITIONAL_QA_SCRIPT="extension.sh")
    assert result.returncode == 0, result.stdout + result.stderr
    assert f"EXTENSION:{caller}:0" in result.stdout


@pytest.mark.parametrize("argument,code", [("--help", 0), ("--unexpected", 2)])
def test_arguments_return_before_any_workflow_tool(workflow: Workflow, argument: str, code: int):
    result = workflow.run(argument)
    assert result.returncode == code
    assert not workflow.log.exists()


def run_import(root: Path, relative: Path, entry: Path, environment: dict[str, str],
               *options: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [environment["QA_REAL_NODE"], str(APP / relative), str(entry), *options],
        cwd=root, env=environment, text=True, capture_output=True, timeout=10,
    )


@pytest.mark.parametrize("relative,suffix", [(CSS, "css"), (JS, "js")])
@pytest.mark.parametrize("mode", ["check", "fix", "ambiguous", "missing", "entry-directory"])
def test_real_importer_exit_and_repair_contract(
    tmp_path: Path, node_environment: dict[str, str], relative: Path, suffix: str, mode: str,
):
    entry = tmp_path / f"entry.{suffix}"
    statement = '@import "./old/target.css";\n' if suffix == "css" else "import './old/target.js';\n"
    entry.write_text(statement)
    if mode != "missing":
        (tmp_path / f"target.{suffix}").write_text("")
    if mode == "ambiguous":
        (tmp_path / "other").mkdir()
        (tmp_path / "other" / f"target.{suffix}").write_text("")
    if mode == "entry-directory":
        entry.unlink()
        entry.mkdir()
    before = source_hashes(tmp_path)
    options = () if mode in {"check", "entry-directory"} else ("--fix-imports",)
    result = run_import(tmp_path, relative, entry, node_environment, *options)
    assert result.returncode == (0 if mode == "fix" else 1), result.stdout + result.stderr
    if mode == "fix":
        assert "./old/" not in entry.read_text()
        assert run_import(tmp_path, relative, entry, node_environment).returncode == 0
    else:
        assert source_hashes(tmp_path) == before


@pytest.mark.parametrize("relative,suffix", [(CSS, "css"), (JS, "js")])
def test_real_importer_missing_entry_is_error(
    tmp_path: Path, node_environment: dict[str, str], relative: Path, suffix: str,
):
    result = run_import(tmp_path, relative, tmp_path / f"absent.{suffix}", node_environment)
    assert result.returncode == 1


def test_js_transitive_read_failure_is_error(tmp_path: Path, node_environment: dict[str, str]):
    entry = tmp_path / "entry.js"
    entry.write_text("import './directory';\n")
    (tmp_path / "directory").mkdir()
    result = run_import(tmp_path, JS, entry, node_environment)
    assert result.returncode == 1 and "error:" in result.stderr


@pytest.mark.parametrize("write", [False, True])
def test_gitignore_report_only_written_on_request(workflow: Workflow, write: bool):
    report = workflow.app / GITIGNORE.parent / "missing_gitignore_paths.md"
    options = ["--write-report"] if write else []
    result = subprocess.run(
        ["bash", str(workflow.app / GITIGNORE), *options],
        text=True, capture_output=True, timeout=10,
    )
    assert result.returncode == 0, result.stderr
    assert "missing-runtime/" in result.stderr
    assert "*.log" not in result.stderr
    assert ("Missing .gitignore paths" in report.read_text()) if write else (
        report.read_text() == "kept report\n"
    )


@pytest.mark.parametrize("relative,operation", [(CSS, "writeFileSync"), (JS, "readFileSync")])
def test_importer_reports_io_failure_as_error(
    tmp_path: Path, node_environment: dict[str, str], relative: Path, operation: str,
):
    suffix = "css" if relative == CSS else "js"
    entry = tmp_path / f"entry.{suffix}"
    entry.write_text('@import "./old/target.css";\n' if relative == CSS else "")
    target = tmp_path / f"target.{suffix}"
    target.write_text("")
    failing_path = entry if relative == CSS else target
    preload = tmp_path / "fail-io.cjs"
    preload.write_text(
        "const fs = require('fs');\n"
        f"const original = fs.{operation};\n"
        f"fs.{operation} = function (file, ...args) {{\n"
        f"  if (String(file) === {json.dumps(str(failing_path))} || "
        f"String(file) === {json.dumps(failing_path.name)}) throw new Error('fixture I/O failure');\n"
        "  return original.call(this, file, ...args);\n"
        "};\n"
    )
    result = run_import(tmp_path, relative, entry, {
        **node_environment, "NODE_OPTIONS": f"--require={preload}",
    }, "--fix-imports")
    assert result.returncode == 1, result.stdout + result.stderr
    assert "fixture I/O failure" in result.stdout + result.stderr


def test_gitignore_default_does_not_create_absent_report(workflow: Workflow):
    report = workflow.app / GITIGNORE.parent / "missing_gitignore_paths.md"
    report.unlink()
    result = subprocess.run(
        ["bash", str(workflow.app / GITIGNORE)], text=True, capture_output=True, timeout=10,
    )
    assert result.returncode == 0, result.stderr
    assert not report.exists()
    assert "missing-runtime/" in result.stdout
