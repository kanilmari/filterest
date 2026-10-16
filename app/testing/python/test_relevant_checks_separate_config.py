"""test_relevant_checks_separate_config.py
Guard standalone browser proofs without admitting them to the main matrix.
Connect cookie-session changes to L4's own config and the offline planner.
Keep config selection, quoting and map validation testable without Playwright.
"""

from __future__ import annotations

import copy
import json
import subprocess

import pytest

from relevant_checks import MAP_PATH, ROOT, make_plan, validate_map


CONFIG = "app/testing/e2e/instance-cookie-isolation.playwright.config.ts"
SPEC = "app/testing/e2e/L_auth/L4_instance_cookie_isolation.test.ts"
SESSIONS = "app/backend/core_components/sessions"
HARNESS = "app/testing/e2e/helpers/cookie_instance_harness"


@pytest.fixture
def separate_policy():
    policy = json.loads((ROOT / MAP_PATH).read_text())
    policy["separate_config_checks"] = [{
        "paths": [SESSIONS, HARNESS], "config": CONFIG, "specs": [SPEC],
    }]
    return policy


@pytest.mark.parametrize("path", [
    SESSIONS + "/port_number_in_cookies.go",
    HARNESS + "/main.go",
    HARNESS + "/removed_helper.go",
    SPEC,
    CONFIG,
])
def test_cookie_changes_select_one_separate_config_command(separate_policy, path):
    plan = make_plan(ROOT, [path, path], policy=separate_policy)
    checks = [check for check in plan["heavy"] if check["kind"] == "browser-separate-config"]
    assert checks == [{
        "kind": "browser-separate-config", "targets": [SPEC], "config": CONFIG,
        "command": ('PLAYWRIGHT_HTML_OPEN=never ./filterest test --config "$PWD"/'
                    + CONFIG + " " + SPEC.removeprefix("app/") + " --workers=1"),
    }]
    # Main-config commands retain their projects and cannot absorb the .test.ts proof.
    for check in plan["heavy"]:
        if check["kind"] == "browser":
            assert SPEC not in check["targets"]
            assert check["projects"]
            assert "--config" not in check["command"]
    assert "projects" not in checks[0]


def test_multiple_cookie_changes_deduplicate_the_separate_command(separate_policy):
    plan = make_plan(ROOT, [SESSIONS + "/changed.go", HARNESS + "/main.go", SPEC, CONFIG],
                     policy=separate_policy)
    assert sum(check["kind"] == "browser-separate-config" for check in plan["heavy"]) == 1


def test_separate_proof_preserves_main_config_commands_and_projects(separate_policy):
    path = SESSIONS + "/port_number_in_cookies.go"
    baseline = copy.deepcopy(separate_policy)
    baseline.pop("separate_config_checks")
    before = make_plan(ROOT, [path], policy=baseline)
    after = make_plan(ROOT, [path], policy=separate_policy)
    assert [check for check in before["heavy"] if check["kind"] == "browser"] == [
        check for check in after["heavy"] if check["kind"] == "browser"]


@pytest.mark.parametrize("path", [
    "README.md", "app/frontend/core_components/auth/login.js",
    SESSIONS + "_unrelated/helper.go", HARNESS + "_unrelated/main.go",
])
def test_unrelated_changes_do_not_select_cookie_proof(separate_policy, path):
    plan = make_plan(ROOT, [path], policy=separate_policy)
    assert not any(check["kind"] == "browser-separate-config" for check in plan["heavy"])


@pytest.mark.parametrize("field", ["config", "specs", "paths"])
def test_separate_config_guard_rejects_missing_references(separate_policy, field):
    check = separate_policy["separate_config_checks"][0]
    if field == "config":
        check[field] = "app/testing/e2e/missing.playwright.config.ts"
    else:
        check[field] = ["app/testing/e2e/missing.test.ts"]
    with pytest.raises(ValueError, match="disappeared"):
        validate_map(ROOT, separate_policy)


@pytest.mark.parametrize("change, error", [
    ({"paths": []}, "nonempty paths and specs"),
    ({"specs": []}, "nonempty paths and specs"),
    ({"config": "app/playwright.config.ts"}, "not a separate browser config"),
    ({"specs": ["app/testing/python/test_relevant_checks.py"]}, "not a separate-config browser spec"),
])
def test_separate_config_guard_rejects_invalid_declarations(separate_policy, change, error):
    separate_policy["separate_config_checks"][0].update(change)
    with pytest.raises(ValueError, match=error):
        validate_map(ROOT, separate_policy)


def test_separate_config_guard_rejects_duplicate_configs(separate_policy):
    separate_policy["separate_config_checks"].append(copy.deepcopy(separate_policy["separate_config_checks"][0]))
    with pytest.raises(ValueError, match="unique configs"):
        validate_map(ROOT, separate_policy)


def test_main_config_guard_still_rejects_test_ts(separate_policy):
    area = next(area for area in separate_policy["browser_areas"] if area["specs"])
    area["specs"].append(SPEC)
    with pytest.raises(ValueError, match="not a matrix browser spec"):
        validate_map(ROOT, separate_policy)


def test_separate_config_command_resolves_before_launcher_changes_directory(separate_policy, tmp_path):
    # A recording launcher checks shell expansion and paths without launching a browser.
    plan = make_plan(ROOT, [SPEC], policy=separate_policy)
    command = next(check["command"] for check in plan["heavy"] if check["kind"] == "browser-separate-config")
    launcher = tmp_path / "filterest"
    launcher.write_text('#!/bin/sh\ncd app || exit 1\nprintf "%s\\n" "$@"\n')
    launcher.chmod(0o755)
    (tmp_path / "app").mkdir()
    result = subprocess.run(command, shell=True, cwd=tmp_path, text=True, capture_output=True, check=True)
    assert result.stdout.splitlines() == [
        "test", "--config", str(tmp_path / CONFIG), SPEC.removeprefix("app/"), "--workers=1",
    ]


def test_separate_config_map_guard_passes(separate_policy):
    validate_map(ROOT, separate_policy)


def test_repository_maps_the_cookie_proof(separate_policy):
    policy = json.loads((ROOT / MAP_PATH).read_text())
    assert separate_policy["separate_config_checks"][0] in policy.get("separate_config_checks", [])
