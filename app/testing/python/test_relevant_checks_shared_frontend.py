"""test_relevant_checks_shared_frontend.py
Guard consumer browser coverage for shared frontend sources and tooling policy.
Connect the reviewed importer audit to the real map and offline planner.
Keep shared-source edits covered without changing their existing fast checks.
"""

import copy
import json

import pytest

from relevant_checks import MAP_PATH, ROOT, make_plan, matches


APPEARANCE = "Dataset appearance projection and binding"
VIEWS = "Dataset views"
WRITES = "Dataset writes and cell selection"
FILTERS = "Filtering and categories"
NAVIGATION = "Navigation and shared requests"
AUTH = "Sign-in and accounts"
HOME = "Front page"
TOOLING = "Developer tooling"

# Step 2's minimal existing-area combinations preserve consumer spec/project pairs.
RUNTIME_AREAS = {
    "reusable_components/appearance_projection_writer.js": {APPEARANCE, VIEWS, WRITES},
    "reusable_components/appearance_scope_reader.js": {APPEARANCE, VIEWS, FILTERS},
    "reusable_components/browser_identity_builder.js": {AUTH},
    "reusable_components/dom_element_checker.js": {NAVIGATION},
    "reusable_components/lang_value_reader.js": {VIEWS},
    "reusable_components/safe_external_http_url.js": {VIEWS, WRITES},
    "reusable_components/scroll_passthrough.js": {FILTERS, NAVIGATION},
    "reusable_components/symbol_asset_resolver.css": {"Themes and shells"},
    "reusable_components/symbol_asset_resolver.js": {VIEWS, FILTERS, NAVIGATION, HOME},
    "reusable_components/view_lifecycle_events.js": {FILTERS, NAVIGATION, HOME},
    "core_components/config_fetcher.js": {VIEWS, NAVIGATION, AUTH},
    "core_components/database_view_fetcher.js": {VIEWS, NAVIGATION},
    "core_components/function_access_checker.js": {VIEWS, "Administration"},
    "core_components/permission_cache_reader.js": {VIEWS, FILTERS, NAVIGATION, AUTH, HOME},
    "core_components/route_permission_checker.js": {VIEWS, FILTERS, NAVIGATION, AUTH, HOME},
}
TOOLING_PATHS = {"check_js_imports.js", "vite.config.mjs", "vitest.config.mjs"}
AUDITED_PATHS = {"app/frontend/" + path for path in RUNTIME_AREAS.keys() | TOOLING_PATHS}


@pytest.fixture(scope="module")
def policies():
    current = json.loads((ROOT / MAP_PATH).read_text())
    previous = copy.deepcopy(current)
    for entry in previous["browser_areas"]:
        entry["paths"] = [path for path in entry["paths"] if path not in AUDITED_PATHS]
    # This fixture deliberately removes named coverage to model the old policy.
    # Declare that historical no-browser state explicitly under the S2 guard.
    previous["nightly_only"].append({"paths": sorted(AUDITED_PATHS),
                                    "reason": "Historical pre-mapping selection fixture."})
    return current, previous


@pytest.mark.parametrize("relative", sorted(RUNTIME_AREAS.keys() | TOOLING_PATHS))
def test_shared_frontend_selects_consumer_browser_areas_and_preserves_fast_checks(policies, relative):
    current, previous = policies
    path = "app/frontend/" + relative
    entries = [entry for entry in current["browser_areas"]
               if any(matches(path, prefix) for prefix in entry["paths"])]
    expected_areas = RUNTIME_AREAS.get(relative, {TOOLING})
    assert {entry["area"] for entry in entries} == expected_areas
    before = make_plan(ROOT, [path], policy=previous)
    after = make_plan(ROOT, [path], policy=current)
    assert after["fast"] == before["fast"]
    assert not before["heavy"]
    browser = [check for check in after["heavy"] if check["kind"] == "browser"]
    expected_pairs = {(project, spec) for entry in entries
                      for project in entry.get("projects", []) for spec in entry["specs"]}
    actual_pairs = [(project, spec) for check in browser
                    for project in check["projects"] for spec in check["targets"]]
    assert set(actual_pairs) == expected_pairs
    assert len(actual_pairs) == len(expected_pairs)  # Overlapping areas never repeat proofs.
    if relative in RUNTIME_AREAS:
        assert browser and expected_pairs
    else:
        assert not after["heavy"]
        assert any(note.startswith("Browser none — Developer tooling:") for note in after["notes"])
        assert all(word in entries[0]["none"] for word in ("build", "test", "import-check"))
