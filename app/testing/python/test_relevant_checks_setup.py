"""Prove emitted setup commands opt in and matrix proof/project pairs collect.

Use Playwright's --list mode only: no hooks, browser, server or database runs.
Connect the planner's shell environment and arguments to the real matrix config.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import shlex
import subprocess

import pytest

from relevant_checks import MAP_PATH, ROOT, make_plan
from e2e_matrix_reduction import load_reduction, resolve_spec_projects
from test_relevant_checks import fixture_repository, write


def browser_checks(plan):
    return [check for check in plan["heavy"] if check["kind"] == "browser"]


def command_environment_and_arguments(command):
    words = shlex.split(command)
    launcher = words.index("./filterest")
    assert words[launcher:launcher + 2] == ["./filterest", "test"]
    return dict(word.split("=", 1) for word in words[:launcher]), words[launcher + 2:]


@pytest.mark.parametrize("trigger", ["mapped-directory", "direct-spec", "mixed"])
def test_setup_commands_opt_in_for_mapped_direct_and_mixed_selection(fixture_repository, trigger):
    root, policy = fixture_repository
    setup = "app/testing/e2e/setup/fixture.spec.ts"
    write(root, setup, "// fixture proof\n")
    policy["browser_areas"][0]["specs"].append(setup)
    if trigger == "mapped-directory":
        policy["browser_areas"][0]["paths"].append("app/testing/e2e/setup")
        paths = ["app/testing/e2e/setup"]
    else:
        paths = [setup]
        if trigger == "mixed":
            paths.append("app/frontend/core_components/widget/leaf.js")
    checks = browser_checks(make_plan(root, paths, policy=policy))
    assert checks
    for check in checks:
        environment, arguments = command_environment_and_arguments(check["command"])
        assert environment["PLAYWRIGHT_INCLUDE_SETUP"] == "1"
        assert setup.removeprefix("app/") in arguments


def test_normal_browser_commands_keep_their_existing_environment(fixture_repository):
    root, policy = fixture_repository
    checks = browser_checks(make_plan(root, ["app/frontend/core_components/widget/leaf.js"], policy=policy))
    assert checks
    assert all(command_environment_and_arguments(check["command"])[0] == {
                   "PLAYWRIGHT_HTML_OPEN": "never", "FILTEREST_E2E_MATRIX": "reduced"}
               for check in checks)


def listed_pairs(arguments, environment, runtime):
    env = {**os.environ, **environment, "FILTEREST_TEST_RUNTIME_ROOT": str(runtime),
           "npm_config_offline": "true", "npm_config_cache": str(runtime / "npm-cache")}
    # Honour the same installed dependency override as source discovery. npx's
    # package lookup needs --prefix as well as PATH. Pin this worktree's config
    # explicitly so a shared dependency installation cannot redirect discovery.
    runner = ["npx", "--no-install"]
    dependency_root = env.get("FILTEREST_NODE_MODULES_ROOT")
    if dependency_root:
        env["PATH"] = str(Path(dependency_root) / ".bin") + os.pathsep + env.get("PATH", "")
        env["NODE_PATH"] = dependency_root + os.pathsep + env.get("NODE_PATH", "")
        runner += ["--prefix", str(Path(dependency_root).parent)]
    result = subprocess.run([*runner, "playwright", "test", "--config", str(ROOT / "app/playwright.config.ts"), *arguments,
                             "--list", "--reporter=json"], cwd=ROOT / "app", env=env,
                            text=True, capture_output=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert not report.get("errors"), report.get("errors")
    pairs = set()

    def visit(suite):
        for spec in suite.get("specs", []):
            file = (Path(report["config"]["rootDir"]) / spec["file"]).relative_to(ROOT).as_posix()
            pairs.update((file, test["projectName"]) for test in spec["tests"])
        for child in suite.get("suites", []):
            visit(child)

    for suite in report["suites"]:
        visit(suite)
    return pairs


def test_emitted_setup_command_collects_each_claimed_proof_project_pair(tmp_path):
    checks = browser_checks(make_plan(ROOT, ["app/testing/e2e/setup"]))
    assert checks
    for index, check in enumerate(checks):
        environment, arguments = command_environment_and_arguments(check["command"])
        assert environment["PLAYWRIGHT_INCLUDE_SETUP"] == "1"
        expected = {(spec, project) for spec in check["targets"] for project in check["projects"]}
        assert len(expected) == 12  # Two setup specs, all six existing projects.
        actual = listed_pairs(arguments, environment, tmp_path / str(index))
        assert actual == expected, f"Uncollected setup proof/project pairs: {sorted(expected - actual)}"


def test_every_mapped_matrix_spec_project_pair_collects(tmp_path):
    policy = json.loads((ROOT / MAP_PATH).read_bytes())
    reduction = load_reduction(ROOT)
    expected = {(spec, project) for area in policy["browser_areas"]
                for spec in area["specs"]
                for project in resolve_spec_projects(spec, area.get("projects", []), reduction)}
    specs = sorted({spec.removeprefix("app/") for spec, _ in expected})
    projects = sorted({project for _, project in expected})
    arguments = [*specs, *("--project=" + project for project in projects), "--workers=1"]
    actual = listed_pairs(arguments, {"PLAYWRIGHT_INCLUDE_SETUP": "1", "PLAYWRIGHT_HTML_OPEN": "never",
                                      "FILTEREST_E2E_MATRIX": "reduced"}, tmp_path)
    assert expected <= actual, f"Uncollected matrix proof/project pairs: {sorted(expected - actual)}"


@pytest.mark.parametrize("direct", [False, True])
def test_reduced_pairs_are_resolved_per_spec_before_grouping(fixture_repository, direct):
    root, policy = fixture_repository
    prefix = "app/testing/e2e/"
    specs = [prefix + name + ".spec.ts" for name in ("fixed", "blind", "sensitive")]
    for spec in specs:
        write(root, spec, "// fixture proof")
    write(root, "app/playwright.config.ts", " ".join("name: '" + width + mode + "'"
          for width in ("mobile", "tablet", "desktop") for mode in ("-card", "-bigcard")))
    write(root, prefix + "matrix-reduction.json", json.dumps({"version": 1,
          "one_project": {"fixed.spec.ts": "mobile-card"}, "one_card_mode": ["blind.spec.ts"]}))
    entry = policy["browser_areas"][0]
    entry["specs"] += specs
    entry["projects"] = ["desktop-bigcard", "tablet-bigcard"]
    policy["browser_areas"].append({**entry, "area": "Overlapping proof", "projects": ["desktop-card"]})
    paths = ["app/frontend/core_components/widget/leaf.js", *specs] if direct else [entry["paths"][0]]
    plan = make_plan(root, paths, policy=policy)
    checks = [check for check in plan["heavy"] if check["kind"] == "browser"]
    actual = [(spec, project) for check in checks for spec in check["targets"] for project in check["projects"]]
    assert len(actual) == len(set(actual)), "overlapping areas/direct changes must not repeat a pair"
    expected = {specs[0]: {"mobile-card"}, specs[1]: {"desktop-card", "tablet-card"},
                specs[2]: {"desktop-card", "desktop-bigcard", "tablet-bigcard"}}
    if direct:
        expected[specs[1]].add("mobile-card")
        expected[specs[2]].update(["mobile-card", "tablet-card"])
    for spec, projects in expected.items():
        assert {project for target, project in actual if target == spec} == projects
    assert all("FILTEREST_E2E_MATRIX=reduced" in check["command"] for check in checks)
