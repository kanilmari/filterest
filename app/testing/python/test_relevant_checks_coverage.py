"""test_relevant_checks_coverage.py
Prove complete production mapping, fail-closed selection and reproducible evidence.
Connect tracked-source inventory, real batch replays and the frozen nightly policy.
Keep all failure probes inside temporary trees, without services or browser runs.
"""

from __future__ import annotations

from collections import Counter
import copy
from datetime import date, timedelta
import json
from pathlib import Path
import re
import subprocess
import sys
import types

import pytest

import relevant_checks
from relevant_checks import MAP_PATH, ROOT, make_plan, validate_map
from relevant_check_coverage import (
    coverage_index, exemption, nightly_cross_cutting_paths, require_coverage,
    resolve_coverage, tracked_production_paths,
)
from relevant_check_discovery import go_inventory
from relevant_check_evidence import compare_plan, digest, tree_evidence
from test_relevant_checks import fixture_repository, write


ARTIFACTS = ROOT / "data/runtime/agent_tasks/_artifacts/worker_runs/2026-10-21--13-15--wo69-s2-fix1"
BATCHES = ROOT / "app/testing/fixtures/relevant_checks_batches.json"
# Frozen verbatim from nightly_policy.sh:22 (WO69 S2); no private repo dependency.
NIGHTLY_REGEX = (r"^app/frontend/(core_components/(navigation|auth|admin_tools/main|front_page|main_menu|header|"
                r"language|lang_|session|shell|app_shell|state)|shared/|"
                r"reusable_components/(language|lang_|menu|session|state))")
CLASS_ORDER = ["browser", "go", "source_guard", "python_guard", "nightly_only", "exception"]


def inventory(root, policy):
    index = coverage_index(root, policy, go_inventory(root)[0])
    files = tracked_production_paths(root)
    require_coverage(root, set(files), index)
    counts = Counter()
    for path in files:
        records = resolve_coverage(path, index)
        counts[min((entry["class"] for entry in records), key=CLASS_ORDER.index)] += 1
    return files, dict(sorted(counts.items()))


def test_every_tracked_production_file_has_a_named_check_and_inventory_counts_match():
    policy = json.loads((ROOT / MAP_PATH).read_bytes())
    paths, counts = inventory(ROOT, policy)
    assert paths and sum(counts.values()) == len(paths)
    assert policy["exceptions"] == []
    report = ARTIFACTS / "wo69_s2_inventory.md"
    if report.exists():
        recorded = re.search(r"Inventory counts JSON: `(.*?)`", report.read_text())[1]
        assert json.loads(recorded) == {"production": len(paths), **counts}


@pytest.mark.parametrize("path", ["app/frontend/new_area/new.js", "app/frontend/root_unmapped.js"])
def test_new_tracked_production_path_fails_with_full_path_and_mapping_instructions(fixture_repository, path):
    root, policy = fixture_repository
    write(root, path, "export const newBehaviour = true;")
    subprocess.run(["git", "init", "-q"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "add", "."], cwd=root, check=True, capture_output=True)
    with pytest.raises(ValueError) as result:
        make_plan(root, [path], policy=policy)
    assert path in str(result.value)
    assert "unmapped production" in str(result.value)
    assert "nightly_only" in str(result.value) and "reason, owner and expiry" in str(result.value)


@pytest.mark.parametrize("path", [
    "app/frontend/readme_renderer.js", "app/backend/changelog_handler.go",
    "app/frontend/README.js", "app/backend/CHANGELOG.go", "app/frontend/readme.txt",
    "app/backend/handler.spec.go", "app/backend/handler.test.go", "app/backend/handler_TEST.go",
    "app/backend/handler.test.js", "app/frontend/handler.spec.js", "app/frontend/handler.test.css",
    "app/frontend/handler.test.json", "app/frontend/handler.test.JS", "app/frontend/dist/handler.test.js",
    "app/frontend/testdata", "app/frontend/__tests__", "app/backend/__snapshots__",
    "app/frontend/testdata_renderer.js", "app/frontend/__tests___helpers.js",
])
def test_misleading_doc_and_test_names_are_inventoried_and_fail_unmapped(fixture_repository, path):
    root, policy = fixture_repository
    policy["source_guards"][0]["coverage_paths"] = []
    write(root, path)
    subprocess.run(["git", "init", "-q"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "add", "."], cwd=root, check=True, capture_output=True)
    assert exemption(path) is None
    assert path in tracked_production_paths(root)
    with pytest.raises(ValueError, match=re.escape(path)):
        require_coverage(root, {path}, [])
    with pytest.raises(ValueError, match=re.escape(path)):
        make_plan(root, [path], policy=policy)


@pytest.mark.parametrize("path,kind", [
    ("app/frontend/README", "documentation"), ("app/backend/CHANGELOG", "documentation"),
    ("app/frontend/guide.MD", "documentation"), ("app/backend/notes.rst", "documentation"),
    ("app/backend/handler_test.go", "test or test fixture"),
    ("app/frontend/handler.test.js", "test or test fixture"),
    ("app/backend/widget/testdata/example.go", "test or test fixture"),
    ("app/frontend/widget/__tests__/fixture.json", "test or test fixture"),
    ("app/frontend/widget/__snapshots__/example.snap", "test or test fixture"),
])
def test_only_exact_documentation_and_runner_or_fixture_conventions_are_exempt(fixture_repository, path, kind):
    root, _ = fixture_repository
    write(root, path)
    assert exemption(path) == kind
    require_coverage(root, {path}, [])


def test_all_unmapped_paths_are_reported_and_cli_has_no_traceback(fixture_repository, monkeypatch, capsys):
    root, _ = fixture_repository
    paths = ["app/frontend/new_one.js", "app/frontend/new_two.js"]
    for path in paths:
        write(root, path)
    monkeypatch.setattr(relevant_checks, "ROOT", root)
    monkeypatch.setattr(sys, "argv", ["relevant_checks.py", "--json", *paths])
    with pytest.raises(SystemExit) as result:
        relevant_checks.main()
    assert result.value.code == 2
    captured = capsys.readouterr()
    assert not captured.out and "Traceback" not in captured.err
    assert all(path in captured.err for path in paths)


@pytest.mark.parametrize("path", ["app/frontend/gone.js", "app/frontend/README.md",
                                  "CHANGELOG.md", "app/frontend/new.test.js",
                                  "app/backend/new_test.go", "app/frontend/__tests__/fixture.json"])
def test_deletions_docs_and_test_files_keep_existing_handling(fixture_repository, path):
    root, _ = fixture_repository
    if "gone" not in path:
        write(root, path)
    require_coverage(root, {path}, [])  # Exemptions need no named production proof.
    if "__tests__" in Path(path).parts:
        # The pre-existing area guard still rejects a new top-level directory;
        # coverage exemptions must not silently change that older handling.
        with pytest.raises(ValueError, match="component areas"):
            make_plan(root, [path])
    else:
        assert make_plan(root, [path])["changed_paths"] == [path]


def test_generic_tiers_length_lint_vitest_and_scanner_guards_do_not_certify_production(fixture_repository):
    root, policy = fixture_repository
    path = "app/frontend/unmapped.js"
    write(root, path)
    policy["python_guards"] = [{"paths": ["app/frontend"], "coverage_paths": [],
                                "tests": ["app/testing/python/test_widget.py"]}]
    with pytest.raises(ValueError, match="unmapped production"):
        make_plan(root, [path], policy=policy)


def test_untested_go_child_package_cannot_inherit_parent_package_tests(fixture_repository):
    root, policy = fixture_repository
    policy["source_guards"][0]["coverage_paths"] = []
    policy["browser_areas"][0]["paths"] = ["app/frontend/core_components/widget"]
    path = "app/backend/core_components/widget/child/new.go"
    write(root, path, "package child\n")
    with pytest.raises(ValueError, match=re.escape(path)):
        make_plan(root, [path], policy=policy)
    write(root, path.replace("new.go", "new_test.go"),
          'package child\nimport "testing"\nfunc TestChild(t *testing.T) {}\n')
    index = coverage_index(root, policy, go_inventory(root)[0])
    assert {record["id"] for record in resolve_coverage(path, index)} == {
        "go:app/backend/core_components/widget/child"}


def test_longest_prefix_inherits_and_retains_equal_length_proofs(fixture_repository):
    root, policy = fixture_repository
    parent = "app/frontend/core_components/widget"
    child = parent + "/child"
    write(root, child + "/new.js")
    policy["nightly_only"] = [{"paths": [child], "reason": "No maintained isolated assertion yet."}]
    index = coverage_index(root, policy, go_inventory(root)[0])
    assert {entry["class"] for entry in resolve_coverage(child + "/new.js", index)} == {"nightly_only"}
    assert {entry["class"] for entry in resolve_coverage(parent + "/leaf.js", index)} == {"browser"}


@pytest.mark.parametrize("path", [
    "app/frontend/core_components/ai_features/table_chat/table_chat_coding_agent_copy.js",
    "app/frontend/custom_views/embedding_status_translation_fallbacks.js",
])
def test_translation_fallbacks_select_the_existing_named_python_proof(path):
    proof = "app/testing/python/test_interface_language_seed_981.py"
    plan = make_plan(ROOT, [path])
    assert {record["class"] for record in plan["coverage"][path]} == {"python_guard"}
    assert {record["id"] for record in plan["coverage"][path]} == {"python:" + proof}
    assert any(check["kind"] == "python-guard" and check["targets"] == [proof] for check in plan["fast"])


@pytest.mark.parametrize("path", [
    "app/frontend/core_components/ai_features/table_chat/table_chat_attachments.js",
    "app/frontend/core_components/ai_features/table_chat/table_chat_pending_changes.js",
])
def test_other_nightly_files_read_by_the_catalogue_guard_select_that_proof(path):
    anchor = "app/backend/core_components/system_table_tools/lang_key_catalogue_scan_test.go"
    plan = make_plan(ROOT, [path])
    assert {record["id"] for record in plan["coverage"][path]} == {"source:" + anchor}
    assert any(check["kind"] == "go-unit" and "TestScanFindsLangKeysDeclaredInACatalogue" in check["tests"]
               for check in plan["fast"])


@pytest.mark.parametrize("spec", ["app/testing/e2e/N_new.spec.ts", "app/testing/e2e/N_new.spec.js"])
def test_unclaimed_matrix_spec_and_missing_mapping_refuse_validation(fixture_repository, spec):
    root, policy = fixture_repository
    write(root, spec)
    with pytest.raises(ValueError, match=re.escape(spec)):
        validate_map(root, policy)
    if spec.endswith(".js"):
        return  # The current curated matrix accepts TS specs only; JS cannot slip past discovery.
    policy["browser_areas"][0]["specs"].append(spec)
    validate_map(root, policy)
    policy["browser_areas"][0]["paths"].append("app/frontend/no_longer_here.js")
    with pytest.raises(ValueError, match="disappeared"):
        validate_map(root, policy)


def exception_for(path):
    return {"scope": path, "reason": "Temporary coverage review", "owner": "WO69 reviewer",
            "expires": (date.today() + timedelta(days=7)).isoformat()}


@pytest.mark.parametrize("change", ["expired", "malformed-date", "short-date", "prefix", "glob",
                                     "empty-owner", "empty-reason", "missing-scope", "duplicate"])
def test_invalid_exceptions_fail_validation(fixture_repository, change):
    root, policy = fixture_repository
    path = "app/frontend/unmapped.js"
    write(root, path)
    entry = exception_for(path)
    if change == "expired": entry["expires"] = (date.today() - timedelta(days=1)).isoformat()
    if change == "malformed-date": entry["expires"] = "2099-02-30"
    if change == "short-date": entry["expires"] = "2099-1-1"
    if change == "prefix": entry["scope"] = "app/frontend"
    if change == "glob": entry["scope"] = "app/frontend/*.js"
    if change == "empty-owner": entry["owner"] = " "
    if change == "empty-reason": entry["reason"] = " "
    if change == "missing-scope": entry.pop("scope")
    policy["exceptions"] = [entry] * (2 if change == "duplicate" else 1)
    with pytest.raises(ValueError, match="exception"):
        validate_map(root, policy)


def test_valid_exception_is_exact_and_nightly_entry_requires_reason(fixture_repository):
    root, policy = fixture_repository
    path = "app/frontend/unmapped.js"
    write(root, path)
    policy["exceptions"] = [exception_for(path)]
    assert make_plan(root, [path], policy=policy)["coverage"][path][0]["class"] == "exception"
    sibling = path + ".more.js"
    write(root, sibling)
    with pytest.raises(ValueError, match=re.escape(sibling)):
        make_plan(root, [sibling], policy=policy)
    policy["exceptions"] = []
    policy["nightly_only"] = [{"paths": [path], "reason": " "}]
    with pytest.raises(ValueError, match="written reason"):
        validate_map(root, policy)
    policy["nightly_only"][0]["reason"] = "External provider flow; nightly integration coverage."
    assert make_plan(root, [path], policy=policy)["coverage"][path][0]["class"] == "nightly_only"


def test_nightly_prefixes_match_frozen_regex_byte_for_byte_including_near_misses(monkeypatch, capsys):
    policy = json.loads((ROOT / MAP_PATH).read_bytes())
    paths = [prefix + suffix for prefix in policy["nightly_cross_cutting_prefixes"]
             for suffix in ("", "/module.js", "_sibling.js", "X/module.js")]
    paths += ["app/frontend/shared", "app/frontend/shares/file.js", "app/frontend/core_components/lang/file.js",
              "app/frontend/core_components/nauth/file.js", "app/frontend/reusable_components/menusX.js",
              "xapp/frontend/shared/file.js", "app/backend/core_components/auth/file.go", "CHANGELOG.md"]
    paths += paths[:2]  # grep preserves order and repeated lines.
    expected = subprocess.run(["grep", "-E", NIGHTLY_REGEX], input="\n".join(paths) + "\n",
                              text=True, capture_output=True, check=True).stdout
    selected = nightly_cross_cutting_paths(paths, policy)
    assert "\n".join(selected) + "\n" == expected
    monkeypatch.setattr(sys, "argv", ["relevant_checks.py", "--nightly-cross-cutting", *paths])
    assert relevant_checks.main() == 0
    assert capsys.readouterr().out == expected


def test_selection_evidence_recomputes_identically_and_detects_map_and_tree_changes(fixture_repository):
    root, policy = fixture_repository
    path = "app/frontend/core_components/widget/leaf.js"
    plan = make_plan(root, [path])
    assert plan == make_plan(root, [path])
    assert plan["evidence"]["map_sha256"] == digest((root / MAP_PATH).read_bytes())
    assert plan["evidence"]["tree"] == tree_evidence(root)
    checks = plan["fast"] + plan["heavy"]
    assert len(plan["evidence"]["checks"]) == len(checks)
    for item, check in zip(plan["evidence"]["checks"], checks):
        assert item["id"].startswith(check["kind"] + ":") and item["targets"] == check["targets"]
    assert plan["evidence"]["projects"] == ["desktop-card", "mobile-card", "tablet-card"]
    compare_plan(plan, make_plan(root, [path]))
    policy["exceptions"] = []
    with pytest.raises(ValueError, match="map_sha256"):
        compare_plan(plan, make_plan(root, [path], policy=policy))
    write(root, path, "export const changed = true;")
    with pytest.raises(ValueError, match="tree"):
        compare_plan(plan, make_plan(root, [path]))


def test_clean_git_tree_and_staged_unstaged_untracked_evidence(tmp_path):
    def git(*args):
        return subprocess.run(["git", *args], cwd=tmp_path, capture_output=True, text=True, check=True).stdout.strip()
    git("init", "-q")
    write(tmp_path, "app/source.js", "initial")
    git("add", ".")
    tree = git("write-tree")
    commit = git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit-tree", tree, "-m", "fixture")
    git("update-ref", "HEAD", commit)
    assert tree_evidence(tmp_path) == tree
    write(tmp_path, "app/source.js", "changed")
    unstaged = tree_evidence(tmp_path)
    assert unstaged.startswith("diff-sha256:") and unstaged == tree_evidence(tmp_path)
    git("add", ".")
    staged = tree_evidence(tmp_path)
    assert staged != unstaged
    write(tmp_path, "app/new.js", "addition")
    assert tree_evidence(tmp_path) != staged


def test_cli_saved_plan_round_trip_and_mismatch(fixture_repository, tmp_path, monkeypatch, capsys):
    root, _ = fixture_repository
    path = "app/frontend/core_components/widget/leaf.js"
    saved = tmp_path.parent / (tmp_path.name + "-saved-plan.json")
    try:
        saved.write_text(json.dumps(make_plan(root, [path])))
        monkeypatch.setattr(relevant_checks, "ROOT", root)
        monkeypatch.setattr(sys, "argv", ["relevant_checks.py", "--json", "--compare-plan", str(saved)])
        assert relevant_checks.main() == 0
        assert json.loads(capsys.readouterr().out) == json.loads(saved.read_text())
        policy_path = root / MAP_PATH
        policy_path.write_text(policy_path.read_text() + "\n")  # Raw map bytes are pinned too.
        with pytest.raises(SystemExit) as result:
            relevant_checks.main()
        assert result.value.code == 2 and "map_sha256" in capsys.readouterr().err
    finally:
        saved.unlink(missing_ok=True)


@pytest.fixture(scope="module")
def original_planner():
    baseline = json.loads(BATCHES.read_bytes())["baseline_revision"]
    def original(path):
        return subprocess.run(["git", "show", f"{baseline}:{path}"], cwd=ROOT,
                              capture_output=True, text=True, check=True).stdout
    # baseline_revision is origin/main at the start of WO69 S2, pinned so the
    # regression remains meaningful after this change itself reaches main.
    module = types.ModuleType("original_relevant_checks")
    module.__file__ = str(ROOT / "app/testing/python/relevant_checks.py")
    exec(compile(original("app/testing/python/relevant_checks.py"), module.__file__, "exec"), module.__dict__)
    return module, json.loads(original(MAP_PATH))


def selection(plan):
    """Compare selected proof/project pairs, not command grouping or additive IDs."""
    selected = set()
    for group in ("fast", "heavy"):
        for check in plan[group]:
            for target in check["targets"]:
                for project in check.get("projects", [check.get("config", "")]):
                    selected.add((group, check["kind"], target, project))
            for name in check.get("tests", []):
                selected.add((group, check["kind"], tuple(check["targets"]), name))
    return selected


@pytest.mark.parametrize("batch", json.loads(BATCHES.read_bytes())["batches"], ids=lambda batch: "batch" + batch["batch"])
def test_recent_real_batch_selection_never_narrows(original_planner, batch):
    module, policy = original_planner
    actual = subprocess.run(["git", "show", "--format=", "--name-only", batch["commit"]], cwd=ROOT,
                            capture_output=True, text=True, check=True).stdout.splitlines()
    assert actual == batch["paths"], "replay paths must come from the published real batch commit"
    before = module.make_plan(ROOT, batch["paths"], policy=policy)
    after = make_plan(ROOT, batch["paths"])
    assert selection(before) <= selection(after)
