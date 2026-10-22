"""Prove every component discovery path with one temporary cross-language canary.
Connect check planning, runners and source guards without a shipped component.
Keep the pass and skipped-test, orphan-key, missing-map and forbidden-import breaks observable.
"""

import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess

import pytest

from component_canary_fixture import write_canary
from import_boundary_checker import check
from python_test_tiers import needs_heavy_installation
from relevant_checks import ROOT, component_areas, git_changed_paths, make_plan, validate_map
from relevant_check_discovery import frontend_tests, go_inventory


@pytest.fixture
def canary(tmp_path):
    write_canary(tmp_path)
    return tmp_path


def assert_canary_discovered(root):
    plan = make_plan(root, ["app/components/canary/backend/canary.go",
                            "app/components/canary/frontend/index.js"])
    tests = {name for check in plan["fast"] for name in check.get("tests", [])}
    vitest = {path for check in plan["fast"] if check["kind"] == "vitest" for path in check["targets"]}
    assert "TestCanary" in tests, "skipped canary Go test"
    assert "app/components/canary/frontend/index.test.js" in vitest, "skipped canary Vitest test"
    assert "app/frontend/canary_consumer.test.js" in vitest, "lost reverse frontend importer"
    assert any(check["kind"] == "browser" for check in plan["heavy"])
    assert check(root) == [], "forbidden canary import"
    return plan


def test_canary_discovery_passes(canary):
    assert_canary_discovered(canary)
    assert "app/components/canary" in component_areas(canary)
    tests, dependencies, _ = go_inventory(canary)
    assert tests["app/components/canary/backend"] == {"TestCanary"}
    assert not needs_heavy_installation(["app/components/canary/backend/canary.go"])


@pytest.mark.parametrize("language", ["go", "vitest"])
def test_canary_skipped_test_break_fails_discovery(canary, language):
    relative = ("app/components/canary/backend/canary_test.go" if language == "go" else
                "app/components/canary/frontend/index.test.js")
    path = canary / relative
    path.rename(path.with_name(path.name.replace("_test.go", ".go").replace(".test.js", ".js")))
    with pytest.raises(AssertionError, match="skipped canary"):
        assert_canary_discovered(canary)


def test_canary_missing_check_map_break_fails(canary):
    path = canary / "app/testing/python/relevant_check_map.json"
    policy = json.loads(path.read_text())
    policy["browser_areas"] = []
    path.write_text(json.dumps(policy))
    with pytest.raises(ValueError, match="component areas"):
        assert_canary_discovered(canary)


def test_canary_forbidden_import_break_fails(canary):
    path = canary / "app/components/canary/frontend/index.js"
    path.write_text(path.read_text() + "\nimport '/frontend/private.js';\n")
    with pytest.raises(AssertionError, match="forbidden canary import"):
        assert_canary_discovered(canary)


def test_canary_browser_none_needs_reason(canary):
    policy = json.loads((canary / "app/testing/python/relevant_check_map.json").read_text())
    policy["browser_areas"][0]["specs"] = []
    with pytest.raises(ValueError, match="explicit none"):
        validate_map(canary, policy)
    policy["browser_areas"][0]["none"] = "Fixture's HTTP and unit tests cover its nonvisual entry."
    # A nonvisual component must retire its unused dummy spec too: the matrix
    # inventory may no longer contain an unclaimed browser proof.
    with pytest.raises(ValueError, match="matrix specs need a browser area"):
        validate_map(canary, policy)
    (canary / "app/testing/e2e/canary.spec.ts").unlink()
    validate_map(canary, policy)


def test_component_go_reverse_imports_assets_deletions_and_postgres_names(canary):
    source = canary / "app/backend/consumer/consumer.go"
    source.parent.mkdir(parents=True)
    source.write_text('package consumer\nimport _ "example/components/canary/backend"\n')
    (source.parent / "consumer_test.go").write_text('package consumer\nimport "testing"\nfunc TestConsumer(t *testing.T) {}\n')
    policy = json.loads((canary / "app/testing/python/relevant_check_map.json").read_text())
    policy["browser_areas"][0]["paths"].append("app/backend/consumer")
    (canary / "app/testing/python/relevant_check_map.json").write_text(json.dumps(policy))
    component_test = canary / "app/components/canary/backend/canary_test.go"
    component_test.write_text(component_test.read_text() + "\nfunc TestCanaryPostgres(t *testing.T) {}\n")
    for changed in ("app/components/canary/backend/canary.go", "app/components/canary/backend/deleted.go",
                    "app/components/canary/backend/testdata/input.json"):
        plan = make_plan(canary, [changed])
        assert any("TestConsumer" in c.get("tests", []) for c in plan["fast"])
        assert any("TestCanary" in c.get("tests", []) for c in plan["fast"])
        assert any("TestCanaryPostgres" in c.get("tests", []) for c in plan["heavy"])


def test_canary_css_and_public_url_reverse_imports(canary):
    path = canary / "app/frontend/canary_consumer.test.js"
    path.write_text("import '/components/canary/frontend/index.js';")
    assert path.relative_to(canary).as_posix() in frontend_tests(canary, {"app/components/canary/frontend/index.js"})
    path.write_text("import './entry.css';")
    (path.parent / "entry.css").write_text('@import "../components/canary/frontend/canary.css";')
    assert path.relative_to(canary).as_posix() in frontend_tests(canary, {"app/components/canary/frontend/canary.css"})


def test_computed_import_registry_selects_target_consumers_and_registry_edits(canary):
    owner = "app/components/canary/frontend/index.js"
    path = canary / owner
    path.write_text(path.read_text() + "\nawait import('./' + locale);\n")
    registry = "app/testing/python/component_import_registry.json"
    (canary / registry).write_text(json.dumps({owner + ":5": {"reason": "Fixed locale loaders.", "targets": ["./locale.js"]}}))
    assert check(canary) == []
    for changed in ("app/components/canary/frontend/locale.js", registry):
        plan = make_plan(canary, [changed])
        tests = {path for check in plan["fast"] if check["kind"] == "vitest" for path in check["targets"]}
        assert "app/components/canary/frontend/index.test.js" in tests
        assert "app/frontend/canary_consumer.test.js" in tests


@pytest.mark.parametrize("expression", [
    "`${await import('../components/canary/frontend/locale.js')}`",
    "`${ `${await import('../components/canary/frontend/locale.js')}` }`",
])
def test_template_reverse_import_selection(canary, expression):
    owner = "app/frontend/template_consumer.test.js"
    (canary / owner).write_text("const value = " + expression + ";")
    plan = make_plan(canary, ["app/components/canary/frontend/locale.js"])
    tests = {path for check in plan["fast"] if check["kind"] == "vitest" for path in check["targets"]}
    assert owner in tests


def test_template_computed_reverse_import_selection(canary):
    owner = "app/components/canary/frontend/index.js"
    (canary / owner).write_text("const value = `text\n${await import(`./${locale}.js`)}`;")
    registry = "app/testing/python/component_import_registry.json"
    (canary / registry).write_text(json.dumps({
        owner + ":2": {"reason": "Fixed locale loaders.", "targets": ["./locale.js"]},
    }))
    assert check(canary) == []
    for changed in ("app/components/canary/frontend/locale.js", registry):
        selected = frontend_tests(canary, {changed})
        assert "app/frontend/canary_consumer.test.js" in selected


def test_component_rename_keeps_old_and_new_paths(canary):
    subprocess.run(["git", "init", "-q", str(canary)], check=True)
    subprocess.run(["git", "-C", str(canary), "add", "."], check=True)
    subprocess.run(["git", "-C", str(canary), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                    "commit", "-qm", "fixture"], check=True)
    old = "app/components/canary/frontend/index.js"
    new = "app/components/canary/frontend/renamed.js"
    (canary / old).rename(canary / new)
    subprocess.run(["git", "-C", str(canary), "add", "-A"], check=True)
    assert {old, new} <= set(git_changed_paths(canary, "HEAD"))


def test_file_length_guard_rejects_oversize_component(canary):
    target = canary / "app/server_tools/scripts/check_file_length.sh"
    shutil.copy2(ROOT / target.relative_to(canary), target)
    for directory in ("frontend/core_components", "frontend/reusable_components", "backend/core_components", "backend/reusable_components"):
        (canary / "app" / directory).mkdir(parents=True, exist_ok=True)
    args = ["bash", str(target), "--strict"]
    assert subprocess.run(args, capture_output=True).returncode == 0
    (canary / "app/components/canary/frontend/oversize.js").write_text("// line\n" * 701)
    result = subprocess.run(args, capture_output=True, text=True)
    assert result.returncode == 1 and "oversize.js" in result.stdout


def test_stylelint_glob_collects_component_css(canary):
    package = json.loads((ROOT / "app/package.json").read_text())
    pattern = shlex.split(package["scripts"]["lint:css"])[1]
    modules = Path(os.environ.get("FILTEREST_NODE_MODULES_ROOT", ROOT / "data/runtime/node/node_modules"))
    result = subprocess.run(["node", "-e", "const glob = require(process.argv[1]); "
                             "process.stdout.write(JSON.stringify(glob.sync(process.argv[2], {cwd: process.argv[3]})));",
                             str(modules / "glob"), pattern, str(canary / "app")],
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert "components/canary/frontend/canary.css" in json.loads(result.stdout)


@pytest.mark.parametrize("skipped", [False, True])
def test_canary_go_runner_requires_an_actual_pass(canary, skipped):
    if skipped:
        path = canary / "app/components/canary/backend/canary_test.go"
        path.write_text(path.read_text().replace('func TestCanary(t *testing.T) {', 'func TestCanary(t *testing.T) {\n t.Skip("canary break")'))
    result = subprocess.run(["go", "test", "./backend/...", "./components/...", "-json", "-count=1"],
                            cwd=canary / "app", env={**os.environ, "GOPROXY": "off", "GOTOOLCHAIN": "local"},
                            capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr
    events = [json.loads(line) for line in result.stdout.splitlines() if line.startswith("{")]
    passed = any(e.get("Test") == "TestCanary" and e.get("Action") == "pass" for e in events)
    assert passed is not skipped, "skipped Go test was counted as a pass"


@pytest.mark.parametrize("skipped", [False, True])
def test_canary_vitest_runner_requires_an_actual_pass(canary, skipped):
    if skipped:
        path = canary / "app/components/canary/frontend/index.test.js"
        path.write_text(path.read_text().replace("test('canary entry'", "test.skip('canary entry'"))
    output = canary / "vitest.json"
    environment = {**os.environ,
                   "FILTEREST_NODE_MODULES_ROOT": os.environ.get("FILTEREST_NODE_MODULES_ROOT", str(ROOT / "data/runtime/node/node_modules")),
                   "FILTEREST_PROJECT_ROOT_OVERRIDE": str(canary)}
    result = subprocess.run(["node", str(ROOT / "app/server_tools/scripts/vitest_process_runner.mjs"),
                             "run", "--config", str(ROOT / "app/vitest.config.mjs"), "--maxWorkers=1",
                             "--reporter=json", "--outputFile=" + str(output)],
                            cwd=canary / "app", env=environment, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr + (output.read_text() if output.exists() else "")
    report = json.loads(output.read_text())
    passed = report["numPassedTests"] == 2 and report["numPendingTests"] == 0
    assert passed is not skipped, "skipped Vitest test was counted as a pass"


def test_empty_components_tree_still_accepts_the_qa_go_pattern(canary):
    shutil.rmtree(canary / "app/components/canary")
    result = subprocess.run(["go", "list", "./components/..."], cwd=canary / "app",
                            env={**os.environ, "GOPROXY": "off", "GOTOOLCHAIN": "local"},
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
