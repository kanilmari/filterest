"""test_relevant_checks.py
Guard the reviewed map and automatic discovery against stale or missing coverage.
Connect real repository areas to fixture change sets and new test declarations.
Keep planning reliable without PostgreSQL, browsers, sockets or network access.
"""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path
import shlex
import subprocess
import sys

import pytest

from relevant_checks import (
    MANUAL_SPECS, MAP_PATH, ROOT, git_changed_paths, make_plan, manual_specs,
    matches, normalize_path, render_plan, validate_map,
)
from relevant_check_discovery import frontend_tests, go_inventory
from python_test_tiers import HEAVY_INSTALLATION_FILES, needs_heavy_installation, tier_for_path


def write(root, path, text=""):
    file = root / path
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(text)


@pytest.fixture
def fixture_repository(tmp_path):
    files = {
        "app/go.mod": "module example\n\ngo 1.26.5\n",
        "app/playwright.config.ts": "projects: [{ name: 'mobile-card' }, { name: 'tablet-card' }, { name: 'desktop-card' }]",
        "app/backend/core_components/widget/widget.go": "package widget\n",
        "app/backend/core_components/widget/widget_test.go":
            'package widget\nimport "testing"\nfunc TestWidget(t *testing.T) {}\nfunc TestWidgetPostgres(t *testing.T) {}\n',
        "app/backend/core_components/sessions/guard_test.go":
            'package sessions\nimport "testing"\nfunc TestSessionGuard(t *testing.T) {}\n',
        "app/frontend/core_components/widget/leaf.js": "export const value = 1;\n",
        "app/frontend/core_components/widget/importer.js": "export { value } from './leaf.js';\n",
        "app/frontend/core_components/widget/importer.test.js": "import {\n value\n} from './importer.js';\n",
        "app/frontend/core_components/widget/lazy.test.js": "const load = () => import('./leaf.js');\n",
        "app/testing/e2e/W_widget.spec.ts": "// browser proof\n",
        "app/testing/python/test_widget.py": "from widget_fixture import database\n",
        "app/testing/python/widget_fixture.py": "MIGRATION = '20990101000001_widget.sql'\n",
        "app/testing/python/test_bootstrap_ledger_postgres.py": "# full ledger proof\n",
        "app/server_tools/migrations/20990101000001_widget.sql": "-- fixture migration\n",
        "app/server_tools/scripts/check_file_length.sh": "exit 0\n",
    }
    for path, text in files.items():
        write(tmp_path, path, text)
    policy = {
        "version": 1,
        "browser_areas": [
            {"area": "Widget", "paths": ["app/frontend/core_components/widget", "app/backend/core_components/widget",
                                           "app/frontend/core_components/widget/leaf.js"],
             "specs": ["app/testing/e2e/W_widget.spec.ts"], "projects": ["mobile-card", "tablet-card", "desktop-card"]},
            {"area": "Sessions", "paths": ["app/backend/core_components/sessions"], "specs": [], "none": "Go guard has no isolated browser flow."},
        ],
        "source_guards": [{"paths": ["app/backend"], "package": "app/backend/core_components/sessions",
                           "anchor": "app/backend/core_components/sessions/guard_test.go"}],
        "bootstrap_proofs": ["app/testing/python/test_bootstrap_ledger_postgres.py"],
        "file_length_guard": "app/server_tools/scripts/check_file_length.sh",
    }
    write(tmp_path, MAP_PATH, json.dumps(policy))
    return tmp_path, policy


def test_repository_map_is_current_and_covers_every_area():
    policy = json.loads((ROOT / MAP_PATH).read_text())
    validate_map(ROOT, policy)
    # Reuse the tier owner, including newly reviewed heavy files.
    assert all((ROOT / "app/testing/python" / name).is_file() for name in HEAVY_INSTALLATION_FILES)


@pytest.mark.parametrize("path", [
    "app/frontend/core_components/general_tables/gt_1_row_crud/gt_1_1_row_create/row_creation_handler.js",
    "app/frontend/reusable_components/modal/modal_builder.js",
])
def test_add_row_and_shared_modal_select_close_proof_in_every_project(path):
    plan = make_plan(ROOT, [path])
    projects = {project for check in plan["heavy"] if check["kind"] == "browser"
                and "app/testing/e2e/J_modals/J2_modal_close.spec.ts" in check["targets"]
                for project in check["projects"]}
    assert projects == {"mobile-card", "mobile-bigcard", "tablet-card", "tablet-bigcard",
                        "desktop-card", "desktop-bigcard"}


@pytest.mark.parametrize("path", [
    "app/frontend/core_components/widget/leaf.js", "app/frontend/core_components/widget",
    "app/testing/e2e/W_widget.spec.ts", "app/backend/core_components/sessions/guard_test.go",
    "app/testing/python/test_bootstrap_ledger_postgres.py", "app/server_tools/scripts/check_file_length.sh",
])
def test_move_or_delete_curated_target_refuses_plan(fixture_repository, path):
    root, policy = fixture_repository
    target = root / path
    target.rename(target.with_name(target.name + ".moved"))
    with pytest.raises(ValueError, match="disappeared"):
        make_plan(root, ["app/backend/core_components/widget/widget.go"], policy=policy)


@pytest.mark.parametrize("area", ["app/frontend/core_components/new", "app/backend/core_components/new",
                                 "app/backend/pipeline/new", "app/frontend/reusable_components/new",
                                 "app/frontend/new_top_level", "app/components/new"])
def test_new_area_requires_explicit_browser_decision(fixture_repository, area):
    root, policy = fixture_repository
    write(root, area + "/source.txt")
    with pytest.raises(ValueError, match="component areas"):
        validate_map(root, policy)
    updated = copy.deepcopy(policy)
    updated["browser_areas"].append({"area": "New", "paths": [area], "specs": [], "none": "Covered by consumer tests."})
    validate_map(root, updated)


def test_removed_area_entry_and_empty_none_fail(fixture_repository):
    root, policy = fixture_repository
    updated = copy.deepcopy(policy)
    updated["browser_areas"].pop()
    with pytest.raises(ValueError, match="component areas"):
        validate_map(root, updated)
    updated = copy.deepcopy(policy)
    updated["browser_areas"][1]["none"] = "  "
    with pytest.raises(ValueError, match="explicit none"):
        validate_map(root, updated)


@pytest.mark.parametrize("placement", ["same-area", "other-area", "other-area-twice"])
def test_shared_curated_paths_only_reject_duplicates_within_an_area(fixture_repository, placement):
    root, policy = fixture_repository
    entry = policy["browser_areas"][0]
    shared = entry["paths"][0]
    target = entry if placement == "same-area" else {**entry, "area": "Shared consumer", "paths": []}
    if target is not entry:
        policy["browser_areas"].append(target)
    target["paths"].extend([shared] * (2 if placement == "other-area-twice" else 1))
    if placement == "other-area":
        validate_map(root, policy)
    else:
        with pytest.raises(ValueError, match="duplicate curated path"):
            validate_map(root, policy)


def test_removed_or_unknown_project_fails(fixture_repository):
    root, policy = fixture_repository
    policy["browser_areas"][0]["projects"] = ["retired-card"]
    with pytest.raises(ValueError, match="browser projects"):
        validate_map(root, policy)


def test_deleted_spec_and_changed_map_restore_consistency(fixture_repository):
    root, policy = fixture_repository
    (root / "app/testing/e2e/W_widget.spec.ts").unlink()
    with pytest.raises(ValueError, match="disappeared"):
        validate_map(root, policy)
    entry = policy["browser_areas"][0]
    entry["specs"] = []
    entry.pop("projects")
    entry["none"] = "Widget browser flow was removed; unit proofs remain."
    validate_map(root, policy)


def test_new_postgres_declaration_appears_without_map_edit(fixture_repository):
    root, _ = fixture_repository
    path = "app/backend/core_components/widget/widget.go"
    before = make_plan(root, [path])
    write(root, path.replace(".go", "_new_test.go"),
          'package widget\nimport "testing"\n// func TestCommentPostgres(t *testing.T) {}\n'
          'const sample = `func TestStringPostgres(t *testing.T) {}`\n'
          'func TestNewPostgres(t *testing.T) {}\n')
    after = make_plan(root, [path])
    previous = next(c for c in before["heavy"] if c["kind"] == "go-postgres")
    discovered = next(c for c in after["heavy"] if c["kind"] == "go-postgres")
    assert previous["tests"] == ["TestWidgetPostgres"]
    assert discovered["tests"] == ["TestNewPostgres", "TestWidgetPostgres"]
    assert "TestNewPostgres" in discovered["command"]


def test_go_importer_proofs_and_embedded_contracts_are_discovered(fixture_repository):
    root, _ = fixture_repository
    write(root, "app/backend/core_components/sessions/consumer_test.go",
          'package sessions\nimport ("testing"; _ "example/backend/core_components/widget")\n'
          'func TestConsumerPostgres(t *testing.T) {}\n')
    write(root, "app/backend/core_components/widget/contract.json", "{}")
    plan = make_plan(root, ["app/backend/core_components/widget/contract.json"])
    assert any("TestConsumerPostgres" in c.get("tests", []) for c in plan["heavy"])


def test_child_package_edit_does_not_select_ancestor_packages(fixture_repository):
    root, _ = fixture_repository
    write(root, "app/backend/core_components/root_test.go",
          'package core\nimport "testing"\nfunc TestUnrelatedPostgres(t *testing.T) {}\n')
    plan = make_plan(root, ["app/backend/core_components/widget/widget.go"])
    assert not any("TestUnrelatedPostgres" in c.get("tests", []) for c in plan["heavy"])


def test_frontend_imports_reexports_lazy_imports_cycles_css_and_deleted_paths(fixture_repository):
    root, policy = fixture_repository
    base = "app/frontend/core_components/widget/"
    write(root, base + "leaf.js", "import './importer.js';\nimport './leaf.css';\n")
    write(root, base + "leaf.css", "@import './colors.css';\n")
    write(root, base + "leaf.test.js", "// paired test with mocked imports\n")
    assert frontend_tests(root, {base + "colors.css"}) == [base + name for name in
                                                         ("importer.test.js", "lazy.test.js", "leaf.test.js")]
    (root / (base + "leaf.js")).unlink()
    # A mapped source removal must update the map in the same change.
    policy["browser_areas"][0]["paths"].remove(base + "leaf.js")
    write(root, MAP_PATH, json.dumps(policy))
    plan = make_plan(root, [base + "leaf.js"])
    assert next(c for c in plan["fast"] if c["kind"] == "vitest")["targets"] == [base + name for name in
                                                                              ("importer.test.js", "lazy.test.js", "leaf.test.js")]
    assert not any(c["kind"] == "eslint" for c in plan["fast"])


@pytest.mark.parametrize("changed,expected", [
    ("app/backend/core_components/widget/widget.go", {
        "go-unit": ["TestSessionGuard", "TestWidget"], "go-postgres": ["TestWidgetPostgres"],
        "browser": ["app/testing/e2e/W_widget.spec.ts"],
    }),
    ("app/frontend/core_components/widget/leaf.js", {
        "vitest": ["app/frontend/core_components/widget/importer.test.js", "app/frontend/core_components/widget/lazy.test.js"],
        "eslint": ["app/frontend/core_components/widget/leaf.js"], "browser": ["app/testing/e2e/W_widget.spec.ts"],
    }),
    ("app/server_tools/migrations/20990101000001_widget.sql", {
        "python-heavy-installation": ["app/testing/python/test_bootstrap_ledger_postgres.py"],
        "python-postgres": ["app/testing/python/test_widget.py"],
    }),
])
def test_fixture_change_sets_have_stable_targets_and_ready_commands(fixture_repository, changed, expected):
    root, _ = fixture_repository
    plan = make_plan(root, [changed, "./" + changed])
    checks = plan["fast"] + plan["heavy"]
    actual = {}
    for check in checks:
        if check["kind"] in {"map-guards", "file-length", "python-ordinary"}:
            continue
        actual.setdefault(check["kind"], []).extend(check.get("tests", check["targets"]))
    assert actual == expected
    assert make_plan(root, [changed]) == plan
    assert render_plan(plan).startswith("FAST\n  map-guards:")
    assert "\nHEAVY\n" in render_plan(plan)
    commands = {c["kind"]: c["command"] for c in checks}
    assert commands["python-ordinary"] == (
        "env -u FILTEREST_TEST_DISPOSABLE_POSTGRES -- data/runtime/python/venv/bin/python -m pytest --category ordinary app/testing/python")
    if "go-postgres" in commands:
        assert commands["go-postgres"] == (
            "(cd app && FILTEREST_TEST_DISPOSABLE_POSTGRES=1 flock /tmp/filterest_pg_suites.lock go test "
            "./backend/core_components/widget -count=1 -run '^(TestWidgetPostgres)$')")
    if "vitest" in commands:
        assert commands["vitest"] == ("./filterest test-unit app/frontend/core_components/widget/importer.test.js "
                                      "app/frontend/core_components/widget/lazy.test.js")
        node_root = '${FILTEREST_NODE_MODULES_ROOT:-$PWD/data/runtime/node/node_modules}'
        assert commands["eslint"] == (f'FILTEREST_NODE_MODULES_ROOT="{node_root}" node "{node_root}/eslint/bin/eslint.js" '
                                       '--config app/eslint.config.mjs app/frontend/core_components/widget/leaf.js')
    if "python-postgres" in commands:
        assert commands["python-postgres"] == (
            "FILTEREST_TEST_DISPOSABLE_POSTGRES=1 flock /tmp/filterest_pg_suites.lock data/runtime/python/venv/bin/python "
            "-m pytest app/testing/python/test_widget.py")
    if "browser" in commands:
        assert commands["browser"] == ("PLAYWRIGHT_HTML_OPEN=never ./filterest test testing/e2e/W_widget.spec.ts "
                                       "--project=desktop-card --project=mobile-card --project=tablet-card --workers=1")


def test_real_dataset_kind_migration_and_scroll_batches_include_late_failure_proofs():
    batches = [
        ["app/backend/core_components/dataset_kinds/kind_contract_validator.go"],
        ["app/server_tools/migrations/20261009000077_retire_global_dataset_alias_catalogue.sql"],
        ["app/frontend/core_components/infinite_scroll/infinite_scroll_handler.js"],
    ]
    plans = [make_plan(ROOT, batch) for batch in batches]
    tests = {name for c in plans[0]["heavy"] for name in c.get("tests", [])}
    assert {"TestDatasetKindPostgresFreshLegacyEmptyRelationsDrift", "TestDatasetKindPostgresUpgradeReplayPreservesRightsAndDefaults"} <= tests
    assert any("TestNoBackendCodeReadsOrWritesANameInTheSession" in c.get("tests", []) for c in plans[0]["fast"])
    assert any("TestDatasetCataloguePostgresRetiredAliasGrantsMigration" in c.get("tests", []) for c in plans[1]["heavy"])
    for plan in plans[:2]:
        specs = {Path(path).name for c in plan["heavy"] if c["kind"] == "browser" for path in c["targets"]}
        assert "G10_dataset_name_pool_access.spec.ts" in specs
    specs = {Path(path).name for c in plans[2]["heavy"] if c["kind"] == "browser" for path in c["targets"]}
    assert {"E13_row_group_category_panel.spec.ts", "Q2_offset_reset.spec.ts", "C3_close_big_card.spec.ts", "P2_select_range.spec.ts"} <= specs


def test_bootstrap_generator_keeps_ledger_and_migration_specific_opt_in_proofs():
    plan = make_plan(ROOT, ["app/server_tools/public_bootstrap/generate_bootstrap.py"])
    tier = next(c for c in plan["heavy"] if c["kind"] == "python-heavy-installation")
    assert "app/testing/python/test_bootstrap_ledger_postgres.py" in tier["targets"]
    assert "FILTEREST_TEST_DISPOSABLE_POSTGRES=1" in tier["command"]
    assert any("TestDatasetKindPostgresUpgradeReplayPreservesRightsAndDefaults" in c.get("tests", []) for c in plan["heavy"])
    assert any("app/testing/python/test_article_view_migration.py" in c["targets"] for c in plan["heavy"])


def test_python_plan_reuses_selector_partition():
    plan = make_plan(ROOT, ["app/server_tools/update_filterest.sh"])
    for group, kind, tier in [("fast", "python-ordinary", "ordinary"), ("heavy", "python-heavy-installation", "heavy-installation")]:
        check = next(c for c in plan[group] if c["kind"] == kind)
        assert check["targets"] == sorted(file.relative_to(ROOT).as_posix() for file in
                                           (ROOT / "app/testing/python").glob("test_*.py") if tier_for_path(file) == tier)
    assert needs_heavy_installation(plan["changed_paths"])


@pytest.mark.parametrize("changed", ["source", "deleted", "guard"])
def test_python_source_guard_selects_focused_ordinary_proof(fixture_repository, changed):
    root, policy = fixture_repository
    source = "app/frontend/core_components/widget/leaf.js"
    test = "app/testing/python/test_widget.py"
    policy["python_guards"] = [{"paths": ["app/frontend/core_components/widget", test], "tests": [test]}]
    if changed == "deleted":
        (root / source).unlink()
        policy["browser_areas"][0]["paths"].remove(source)
    plan = make_plan(root, [test if changed == "guard" else source], policy=policy)
    check = next(check for check in plan["fast"] if check["kind"] == "python-guard")
    assert check["targets"] == [test]
    assert shlex.split(check["command"]) == ["env", "-u", "FILTEREST_TEST_DISPOSABLE_POSTGRES", "--",
                                            "data/runtime/python/venv/bin/python", "-m", "pytest", test]
    assert any(check["kind"] == "python-ordinary" for check in plan["fast"])


@pytest.mark.parametrize("change", ["empty-paths", "empty-tests", "missing-path", "missing-test", "not-test", "heavy-test"])
def test_python_source_guard_refuses_invalid_or_stale_map(fixture_repository, change):
    root, policy = fixture_repository
    guard = {"paths": ["app/frontend/core_components/widget"], "tests": ["app/testing/python/test_widget.py"]}
    policy["python_guards"] = [guard]
    if change.startswith("empty-"):
        guard[change.removeprefix("empty-")] = []
    elif change.startswith("missing-"):
        if change == "missing-path":
            guard["paths"] = ["app/missing"]
        else:
            guard["tests"] = ["app/testing/python/test_missing.py"]
    elif change == "not-test":
        guard["tests"] = ["app/frontend/core_components/widget/leaf.js"]
    else:
        guard["tests"] = ["app/testing/python/test_update_verification.py"]
        write(root, guard["tests"][0])
    with pytest.raises(ValueError):
        validate_map(root, policy)


def test_every_reviewed_provenance_file_has_a_mapped_ordinary_guard():
    from test_reviewed_provenance_hashes import REVIEWED_FILES

    test = "app/testing/python/test_reviewed_provenance_hashes.py"
    policy = json.loads((ROOT / MAP_PATH).read_text())
    guards = [guard for guard in policy["python_guards"] if test in guard["tests"]]
    assert guards and tier_for_path(Path(test)) == "ordinary"
    for _, relative, _ in REVIEWED_FILES:
        assert any(matches(relative, prefix) for guard in guards for prefix in guard["paths"]), relative
    plan = make_plan(ROOT, [row[1] for row in REVIEWED_FILES])
    assert any(check["kind"] == "python-guard" and test in check["targets"] for check in plan["fast"])


def test_git_range_keeps_deleted_and_both_rename_paths(tmp_path):
    def git(*args):
        return subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True, text=True).stdout.strip()
    git("init", "-q")
    write(tmp_path, "old name.js", "same source\n")
    write(tmp_path, "deleted.go", "package old\n")
    git("add", ".")
    baseline = git("write-tree")  # A tree suffices; this test creates no commits.
    (tmp_path / "old name.js").rename(tmp_path / "new name.js")
    (tmp_path / "deleted.go").unlink()
    git("add", "-A")
    assert git_changed_paths(tmp_path, baseline) == ["deleted.go", "old name.js", "new name.js"]


@pytest.mark.parametrize("path", ["../escape", "/absolute", "", ".", "app/../../escape", r"C:\repo\file"])
def test_invalid_paths_are_not_silently_ignored(path):
    with pytest.raises(ValueError):
        normalize_path(path)


def test_git_range_cannot_be_used_to_pass_mutating_output_option(tmp_path):
    with pytest.raises(ValueError, match="not an option"):
        git_changed_paths(tmp_path, "--output=unexpected.txt")
    assert not (tmp_path / "unexpected.txt").exists()


def test_appearance_binding_selects_scaling_snapshots_and_native_proofs():
    plan = make_plan(ROOT, ["app/frontend/core_components/table_views/dataset_appearance_state.js"])
    unit = {target for check in plan["fast"] if check["kind"] == "vitest" for target in check["targets"]}
    assert {"app/frontend/core_components/table_views/dataset_appearance_scaling.test.js",
            "app/frontend/core_components/table_views/dataset_appearance_equivalence.test.js"} <= unit
    browser = {target for check in plan["heavy"] if check["kind"] == "browser" for target in check["targets"]}
    assert {"app/testing/e2e/C_card_view/" + name + ".spec.ts" for name in (
        "C1_card_render", "C3_close_big_card", "C10_image_first_article", "C12_article_reload_reading_position",
        "C13_related_dataset_appearance", "C17_article_toolbar_group_permissions", "C18_article_open_appearance_probe",
    )} <= browser
    assert "app/testing/e2e/T_admin/T7_card_visibility.spec.ts" in browser
    assert "app/testing/e2e/T_admin/T14_dataset_cover_palette.spec.ts" in browser


def test_cli_json_empty_batch_and_invalid_input():
    command = [sys.executable, "-B", str(ROOT / "app/testing/python/relevant_checks.py")]
    empty = subprocess.run([*command, "--json"], capture_output=True, text=True, timeout=10)
    assert empty.returncode == 0, empty.stderr
    payload = json.loads(empty.stdout)
    evidence = payload.pop("evidence")  # S2 pins empty plans too; existing keys retain their values.
    assert evidence["tree"] and evidence["map_sha256"] and evidence["checks"] == []
    assert payload == {"version": 1, "changed_paths": [], "fast": [], "heavy": [], "notes": []}
    invalid = subprocess.run([*command, "../escape"], capture_output=True, text=True, timeout=10)
    assert invalid.returncode == 2
    assert not invalid.stdout


def assert_postgres_proof(plan, *paths):
    proof = next(check for check in plan["heavy"] if check["kind"] == "python-postgres")
    assert set(paths) <= set(proof["targets"])
    assert "FILTEREST_TEST_DISPOSABLE_POSTGRES=1 flock /tmp/filterest_pg_suites.lock" in proof["command"]
    assert set(paths) <= set(shlex.split(proof["command"]))


def test_changed_article_view_migration_selects_postgres_proof():
    path = "app/testing/python/test_article_view_migration.py"
    assert_postgres_proof(make_plan(ROOT, [path]), path)


def test_home_article_configuration_selects_privacy_postgres_proofs():
    plan = make_plan(ROOT, ["app/backend/core_components/system_config_checks/front_page_article_buttons.go"])
    proofs = [check for check in plan["heavy"] if check["kind"] == "go-postgres"]
    commands = "\n".join(check["command"] for check in proofs)
    assert "TestFrontPageArticleButtonsPostgresVisitorRightsProjectionAndLanguages" in commands
    assert "TestFrontPageArticleButtonsPostgresDeletedTargetsAdminDiagnosticsAndKeyTitle" in commands
    assert "TestFrontPageArticleButtonsPostgresRevisionPersistenceAndConcurrentSave" in commands
    assert "TestFrontPageArticleButtonsPostgresSlowOmissionsKeepEnabledBoxes" in commands


def test_home_article_delete_guard_selects_ordered_postgres_proof():
    path = "app/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_delete/delete_generic_rows.go"
    plan = make_plan(ROOT, [path])
    proofs = [check for check in plan["heavy"] if check["kind"] == "go-postgres"]
    assert any("TestArticleButtonsPostgresFirstSaveSurvivesOrderedGenericDeletion" in check["tests"] for check in proofs)


def test_shared_home_article_labels_select_browser_language_contract():
    plan = make_plan(ROOT, ["app/testing/shared_contracts/home_article_label_examples.json"])
    targets = {path for check in plan["fast"] if check["kind"] == "vitest" for path in check["targets"]}
    assert "app/frontend/core_components/table_views/dataset_value_localizer_home_article_contract.test.js" in targets


def test_changed_dataset_appearance_offline_postgres_selects_postgres_proof():
    path = "app/testing/python/test_dataset_appearance_offline_postgres.py"
    assert_postgres_proof(make_plan(ROOT, [path]), path)


def test_changed_revoked_sign_in_store_selects_postgres_proof():
    path = "app/testing/python/test_revoked_sign_in_store.py"
    assert_postgres_proof(make_plan(ROOT, [path]), path)


@pytest.mark.parametrize("helper,consumer", [
    ("row_actor_support_contracts.py", "test_login_name_postgres.py"),
    ("test_field_settings_language_seed.py", "test_article_view_migration.py"),
])
def test_changed_postgres_fixture_selects_importing_tests(helper, consumer):
    plan = make_plan(ROOT, ["app/testing/python/" + helper])
    assert_postgres_proof(plan, "app/testing/python/" + consumer)


def test_python_postgres_discovery_follows_helpers_reexports_and_cycles(fixture_repository):
    root, _ = fixture_repository
    base = "app/testing/python/"
    write(root, base + "postgres_fixture.py", 'import os\nimport pytest\nfrom . import bridge\n'
          '@pytest.fixture\ndef database():\n'
          '    if os.environ.get("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1":\n'
          '        pytest.skip("PostgreSQL disabled")\n')
    write(root, base + "bridge.py", "from postgres_fixture import database\n")
    write(root, base + "test_new_feature.py", "from bridge import database\ndef test_database(database): pass\n")
    write(root, base + "test_static_feature.py", "def test_static(): pass\n")
    # A docstring and a quoted example alone do not require PostgreSQL.
    write(root, base + "test_example.py", '"""FILTEREST_TEST_DISPOSABLE_POSTGRES"""\n'
          'EXAMPLE = \'os.environ.get("FILTEREST_TEST_DISPOSABLE_POSTGRES")\'\n')
    for changed in ("postgres_fixture.py", "bridge.py", "test_new_feature.py"):
        plan = make_plan(root, [base + changed])
        assert_postgres_proof(plan, base + "test_new_feature.py")
        proof = next(check for check in plan["heavy"] if check["kind"] == "python-postgres")
        assert proof["targets"] == [base + "test_new_feature.py"]
    for changed in ("test_static_feature.py", "test_example.py"):
        assert not make_plan(root, [base + changed])["heavy"]


@pytest.mark.parametrize("python", ["", " ", "-", "--help", " --help", "--split-string=sh -c 'echo intercepted'"])
def test_interpreter_refuses_empty_and_option_like_values(fixture_repository, python):
    root, _ = fixture_repository
    for paths in ([], ["app/testing/python/test_widget.py"]):
        with pytest.raises(ValueError, match="interpreter"):
            make_plan(root, paths, python=python)


@pytest.mark.parametrize("python", [
    pytest.param("--split-string=sh -c 'echo intercepted'", id="split-string-env-option"),
    pytest.param("", id="empty-interpreter"),
    pytest.param("--help", id="option-interpreter"),
])
def test_cli_rejects_unsafe_python_interpreter(python):
    result = subprocess.run([sys.executable, "-B", str(ROOT / "app/testing/python/relevant_checks.py"),
                             "--python=" + python, "app/testing/python/test_revoked_sign_in_store.py"],
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 2
    assert not result.stdout
    assert "interpreter" in result.stderr


def test_printed_python_command_ends_env_options_and_quotes_interpreter(fixture_repository, tmp_path):
    root, _ = fixture_repository
    interpreter = tmp_path / "python with spaces"
    interpreter.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n'
                           'test "${FILTEREST_TEST_DISPOSABLE_POSTGRES+x}" != x\n')
    interpreter.chmod(0o755)
    plan = make_plan(root, ["app/testing/python/test_widget.py"], python=str(interpreter))
    command = next(check["command"] for check in plan["fast"] if check["kind"] == "python-ordinary")
    assert shlex.split(command)[:5] == ["env", "-u", "FILTEREST_TEST_DISPOSABLE_POSTGRES", "--", str(interpreter)]
    result = subprocess.run(["bash", "-c", command], cwd=root, capture_output=True, text=True, timeout=10,
                            env={"FILTEREST_TEST_DISPOSABLE_POSTGRES": "1"})
    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == ["-m", "pytest", "--category", "ordinary", "app/testing/python"]


def test_per_change_length_guard_uses_normal_mode_with_unrelated_legacy_files(fixture_repository):
    root, policy = fixture_repository
    guard = policy["file_length_guard"]
    write(root, guard, (ROOT / guard).read_text())
    write(root, "app/backend/core_components/widget/untouched_legacy.go", "// legacy line\n" * 701)
    plan = make_plan(root, ["app/backend/core_components/widget/widget.go"])
    command = next(check["command"] for check in plan["fast"] if check["kind"] == "file-length")
    assert "--strict" not in shlex.split(command)
    result = subprocess.run(["bash", "-c", command], cwd=root, capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr
    assert "untouched_legacy.go (701 lines)" in result.stdout
    assert "Warning only" in result.stdout


# Selectors and helper calls live with their owning map entry; this list only
# prevents deleting a reviewed component's guard metadata from disabling its proof.
SHARED_BROWSER_AREAS = {
    "Translations", "Main menu and Home menu button", "Navigation and shared requests",
    "Sign-in and accounts", "Filtering and categories", "Card and article opener", "Themes and shells",
}


def browser_driver_source(source):
    """Ignore comments, retain selector strings and normalize named helper aliases."""
    token = r'''("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|//[^\n]*|/\*[\s\S]*?\*/'''
    source = re.sub(token, lambda m: m[0] if m[1] else re.sub(r"[^\n]", " ", m[0]), source)
    imports = re.findall(r"\bimport\s*\{([^}]+)\}\s*from\s*['\"]", source)
    aliases = [pair for declaration in imports
               for pair in re.findall(r"\b(\w+)\s+as\s+(\w+)", declaration)]
    for original, alias in aliases:
        source = re.sub(r"\b" + re.escape(alias) + r"(?=\s*(?:\(|[,)]))", original, source)
    return source


def shared_browser_evidence(root, policy):
    """Statically link every matrix spec's recorded driver to its canonical area."""
    excluded = manual_specs(root)
    sources = {path.relative_to(root).as_posix(): browser_driver_source(path.read_text())
               for path in sorted((root / "app/testing/e2e").rglob("*.spec.ts"))
               if path.relative_to(root).as_posix() not in excluded
               and "setup" not in path.relative_to(root / "app/testing/e2e").parts}
    evidence = {}
    for entry in policy["browser_areas"]:
        if "drivers" not in entry:
            continue
        assert entry["drivers"], f"{entry['area']}: missing driver patterns"
        patterns = [re.compile(pattern) for pattern in entry["drivers"]]
        consumers = {}
        for spec, source in sources.items():
            hits = [hit for pattern in patterns if (hit := pattern.search(source))]
            if hits:
                hit = min(hits, key=lambda match: match.start())
                consumers[spec] = (source.count("\n", 0, hit.start()) + 1, hit[0])
        assert consumers, f"{entry['area']}: no specs match its recorded drivers"
        evidence[entry["area"]] = consumers
    return evidence


def assert_shared_browser_coverage(root, policy):
    """Refuse missing consumers in the entry itself, even if another area covers them."""
    entries = {entry["area"]: entry for entry in policy["browser_areas"] if "drivers" in entry}
    assert SHARED_BROWSER_AREAS <= entries.keys(), "shared component lost its canonical driver rule"
    missing = []
    for area, consumers in shared_browser_evidence(root, policy).items():
        for spec, (line, marker) in consumers.items():
            if spec not in entries[area]["specs"]:
                missing.append(f"{area}: {spec}:{line} drives {marker!r} but is not selected")
    assert not missing, "\n".join(missing)


def test_shared_components_select_every_driving_browser_spec():
    assert_shared_browser_coverage(ROOT, json.loads((ROOT / MAP_PATH).read_text()))


@pytest.mark.parametrize("area", sorted(SHARED_BROWSER_AREAS))
def test_shared_component_guard_rejects_removed_consumer(area):
    policy = json.loads((ROOT / MAP_PATH).read_text())
    entry = next(entry for entry in policy["browser_areas"] if entry["area"] == area)
    spec = next(iter(shared_browser_evidence(ROOT, policy)[area]))
    entry["specs"].remove(spec)
    with pytest.raises(AssertionError, match=re.escape(spec)):
        assert_shared_browser_coverage(ROOT, policy)


def test_shared_component_guard_finds_new_nested_spec_and_helper_alias(tmp_path):
    policy = json.loads((ROOT / MAP_PATH).read_text())
    # Seed each area with an existing consumer so empty/stale rules still fail.
    for area, consumers in shared_browser_evidence(ROOT, policy).items():
        spec = next(iter(consumers))
        write(tmp_path, spec, (ROOT / spec).read_text())
    new_spec = "app/testing/e2e/new/nested/new_driver.spec.ts"
    write(tmp_path, new_spec,
          "import { ensureNavbarVisible as revealMenu } from '../../helpers/navbar';\n"
          "await revealMenu(page);\nawait page.getByTestId('language-menu-button').click();\n")
    with pytest.raises(AssertionError, match=re.escape(new_spec) + ":2"):
        assert_shared_browser_coverage(tmp_path, policy)
    for entry in policy["browser_areas"]:
        if entry["area"] in {"Translations", "Main menu and Home menu button"}:
            entry["specs"].append(new_spec)
    assert_shared_browser_coverage(tmp_path, policy)
    # The explicit manual-only boundary remains outside matrix selection.
    write(tmp_path, MANUAL_SPECS, json.dumps([new_spec.removeprefix("app/testing/e2e/")]))
    for entry in policy["browser_areas"]:
        if new_spec in entry["specs"]:
            entry["specs"].remove(new_spec)
    assert_shared_browser_coverage(tmp_path, policy)


def test_shared_component_guard_ignores_commented_driver_examples():
    assert "language-menu-button" not in browser_driver_source(
        "// getByTestId('language-menu-button')\n/* language-menu-button */")
    assert "https://host/language-menu-button" in browser_driver_source(
        "const selector = 'https://host/language-menu-button';")
    policy = json.loads((ROOT / MAP_PATH).read_text())
    next(entry for entry in policy["browser_areas"] if entry["area"] == "Translations").pop("drivers")
    with pytest.raises(AssertionError, match="canonical driver rule"):
        assert_shared_browser_coverage(ROOT, policy)


@pytest.mark.parametrize("area,source", [
    ("Filtering and categories", "await page.locator('#example_row_group_facets [data-heading-id]').click();"),
    ("Filtering and categories", "await page.getByTestId('row-group-facets').isVisible();"),
    ("Filtering and categories", "await page.getByTestId('row-group-facet-heading').click();"),
    ("Filtering and categories", "await page.getByTestId('row-group-match-mode').check();"),
    ("Filtering and categories", "await page.locator('.row-group-facet-heading').click();"),
    ("Filtering and categories", "await page.locator('[data-row-group-slug=example] button').click();"),
    ("Filtering and categories", "await page.locator('[data-option-value=example]').click();"),
    ("Filtering and categories", "await closeCategoryPopup(page);"),
    ("Filtering and categories", "await page.locator('[id$=\"_filterBar_panel\"]').isVisible();"),
    ("Filtering and categories", "await page.getByTestId('dataset-search-input').fill('example');"),
    ("Themes and shells", "await page.emulateMedia({ colorScheme: 'dark' });\n"
     "await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');"),
    ("Themes and shells", "async function forceTheme() { document.body.classList.add(`${theme}-mode`); }\n"
     "await page.evaluate(forceTheme); await expect(page.locator('body')).toHaveClass(/dark-mode/);"),
    ("Themes and shells", "import { assertImageFirstVisualContract as checkTheme } from '../helpers/image-first-article';\n"
     "await checkTheme(page, stage, 900);"),
    ("Main menu and Home menu button", "document.getElementById('navbar')?.click();"),
    ("Main menu and Home menu button", "await page.locator('[id=\"showMenuButton\"]').click();"),
    ("Main menu and Home menu button", "import { installMenuVisibilityProbe as probe } from '../helpers/menu_control_visibility';\n"
     "await page.evaluate(probe);"),
    ("Navigation and shared requests", "await page.locator('[id=\"navBackBtn\"]').click();"),
    ("Sign-in and accounts", "document.getElementById('sign_out_other_devices')?.click();"),
    ("Card and article opener", "await closeBigCard(page);"),
] + [("Themes and shells", f"document.body.classList.{action}('{mode}-mode');")
     for action in ("add", "remove", "toggle") for mode in ("light", "dark", "system")])
def test_shared_component_guard_detects_alternate_driver_forms(tmp_path, area, source):
    policy = json.loads((ROOT / MAP_PATH).read_text())
    for consumers in shared_browser_evidence(ROOT, policy).values():
        spec = next(iter(consumers))
        write(tmp_path, spec, (ROOT / spec).read_text())
    spec = "app/testing/e2e/new/alternate_driver.spec.ts"
    write(tmp_path, spec, source)
    consumers = shared_browser_evidence(tmp_path, policy)
    assert spec in consumers[area]
    for entry in policy["browser_areas"]:
        if entry["area"] != area and spec in consumers.get(entry["area"], {}):
            entry["specs"].append(spec)
    with pytest.raises(AssertionError, match=re.escape(area + ": " + spec)):
        assert_shared_browser_coverage(tmp_path, policy)
    next(entry for entry in policy["browser_areas"] if entry["area"] == area)["specs"].append(spec)
    assert_shared_browser_coverage(tmp_path, policy)


@pytest.mark.parametrize("area,spec", [
    ("Filtering and categories", "app/testing/e2e/E_search_filter/E14_selected_category_refresh.spec.ts"),
    ("Themes and shells", "app/testing/e2e/C_card_view/C14_product_card_row_commits.spec.ts"),
])
def test_shared_component_guard_rejects_review_gap_removals(area, spec):
    policy = json.loads((ROOT / MAP_PATH).read_text())
    next(entry for entry in policy["browser_areas"] if entry["area"] == area)["specs"].remove(spec)
    with pytest.raises(AssertionError, match=re.escape(spec)):
        assert_shared_browser_coverage(ROOT, policy)


def test_theme_driver_rule_ignores_reads_and_unrelated_media_emulation():
    policy = json.loads((ROOT / MAP_PATH).read_text())
    theme = next(entry for entry in policy["browser_areas"] if entry["area"] == "Themes and shells")
    sources = ["document.body.classList.contains('dark-mode');", "page.emulateMedia({ reducedMotion: 'reduce' });"]
    assert all(not re.search(pattern, source) for source in sources for pattern in theme["drivers"])
