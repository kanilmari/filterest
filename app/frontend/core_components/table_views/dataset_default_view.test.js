// @vitest-environment jsdom
// dataset_default_view.test.js
// Checks default precedence across fresh readers, selectors and old metadata.
// Connects nullable read metadata to existing site defaults without changing storage.
import { beforeEach, expect, test, vi } from "vitest";
const tree = vi.hoisted(() => vi.fn(() => ({})));
const hasRoutePermission = vi.hoisted(() => vi.fn(() => true));
vi.mock('../route_permission_checker.js', () => ({ hasRoutePermission }));
vi.mock("../config_fetcher.js", () => ({ getDefaultViewSync: () => "card" }));
vi.mock("../state_stores/table_specs_reader.js", () => ({ getAllSpecs: tree }));
import { predictDatasetOpeningView, resolveDatasetDefaultView } from "./dataset_default_view.js";
beforeEach(() => { localStorage.clear(); tree.mockReturnValue({}); hasRoutePermission.mockReturnValue(true); });
test("current metadata overrides cached and stale tree defaults without storage writes", () => {
    tree.mockReturnValue({ one: { default_view_name: "article_view" } });
    localStorage.setItem("one_tableMeta", JSON.stringify({ default_view_name: "calendar" }));
    expect(resolveDatasetDefaultView("one", { tableMeta: { default_view_name: "table" } })).toBe("table");
    expect(JSON.parse(localStorage.getItem("one_tableMeta")).default_view_name).toBe("calendar");
});
test("selector reads its own last row metadata rather than another dataset or tree", () => {
    tree.mockReturnValue({ one: { default_view_name: "article_view" }, two: { default_view_name: "table" } });
    localStorage.setItem("one_tableMeta", JSON.stringify({ default_view_name: "card" }));
    expect(resolveDatasetDefaultView("one")).toBe("card");
    expect(resolveDatasetDefaultView("two")).toBe("table");
});
test("an explicit null inherits the site instead of resurrecting a stale tree default", () => {
    tree.mockReturnValue({ one: { default_view_name: "article_view" } });
    expect(resolveDatasetDefaultView("one", { tableMeta: { default_view_name: null } })).toBe("card");
});
test.each([null, {}, { card_style_variant: "modern" }])("old metadata %j retains tree fallback", tableMeta => {
    tree.mockReturnValue({ one: { default_view_name: "table" } });
    expect(resolveDatasetDefaultView("one", { tableMeta })).toBe("table");
});
test("malformed cache and unknown defaults use the existing site fallback", () => {
    localStorage.setItem("one_tableMeta", "{broken");
    expect(resolveDatasetDefaultView("one")).toBe("card");
    expect(resolveDatasetDefaultView("one", { tableMeta: { default_view_name: "not-a-view" } })).toBe("card");
});
test.each([
    ['price_chart', 'table', 'table'],
    ['price_chart', 'price_chart', 'card'],
    [null, 'price_chart', 'card'],
])('a denied Chart default (%s, site %s) keeps its staging permission', (datasetDefault, globalDefault, fallback) => {
    hasRoutePermission.mockReturnValue(false);
    expect(resolveDatasetDefaultView('one', { tableMeta: { default_view_name: datasetDefault }, globalDefault })).toBe(fallback);
    hasRoutePermission.mockReturnValue(true);
    expect(resolveDatasetDefaultView('one', { tableMeta: { default_view_name: datasetDefault }, globalDefault })).toBe('price_chart');
});

// The side menu predicts an unopened dataset's view with rendering's own rules (owner 2026-11-22).
test.each([
    [{ default_view_name: 'table' }, 'card', 'table'],
    [{ default_view_name: null }, 'transposed', 'transposed'],
    [{ default_view_name: 'card' }, 'table', 'card'],
])('the catalogue default %j with site default %s opens as %s', (tableMeta, globalDefault, expected) => {
    expect(predictDatasetOpeningView('one', { tableMeta, globalDefault })).toBe(expected);
});
test('an Article default the reader may not open falls back as rendering does (Codex plan review r1)', () => {
    hasRoutePermission.mockImplementation(route => route !== '/ui/view/article_view');
    expect(predictDatasetOpeningView('one', { tableMeta: { default_view_name: 'article_view' }, globalDefault: 'table' }))
        .toBe('table');
    hasRoutePermission.mockReturnValue(true);
    expect(predictDatasetOpeningView('one', { tableMeta: { default_view_name: 'article_view' }, globalDefault: 'table' }))
        .toBe('article_view');
});
test('without a catalogue default the cached row metadata and the tree decide, as in rendering', () => {
    localStorage.setItem('one_tableMeta', JSON.stringify({ default_view_name: 'normal' }));
    expect(predictDatasetOpeningView('one', { globalDefault: 'card' })).toBe('normal');
    localStorage.clear();
    tree.mockReturnValue({ one: { default_view_name: 'transposed' } });
    expect(predictDatasetOpeningView('one', { globalDefault: 'card' })).toBe('transposed');
});
