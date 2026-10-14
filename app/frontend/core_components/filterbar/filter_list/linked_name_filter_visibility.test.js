// linked_name_filter_visibility.test.js
// Exercises linked-name visibility through layouts, chips and saved URLs/state.
// Connects real builders and persistence with synthetic result metadata.
// Proves K377 applies to every dataset without a server or database change.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { getParams, parseTableQueryString, setParams, useUrlParams } from "../../navigation/nav_engine/query_params.js";
import { primeDatasetAccessRegistry } from "../../navigation/nav_engine/dataset_access_registry.js";
import { saveOpenedFilters } from "../filterbar_engine/filterbar_state_saver.js";
import { buildFilterSection } from "./filter_column_builder.js";
import { build_favefox_style_filter_bar_from_columns } from "./favefox_style_filters_container/accordion_filter_builder.js";
import { createFilterBarContent } from "../filterbar_content_builder.js";
import { renderActiveFilters } from "./active_filter_tag_printer.js";
import { discardHiddenColumnFilters, getVisibleStoredFilters } from "./hidden_filter_state_reconciler.js";

vi.mock("../../endpoints/endpoint_data_fetcher.js", () => ({
    fetchFilterOptions: vi.fn(async () => []), fetchDatasetData: vi.fn(),
}));
vi.mock("../text_search/create_text_search_panel.js", () => ({
    tableMetaCache: {}, ongoingSearchResults: {},
    createDatasetSearchPanel: () => ({ element: document.createElement("div"), destroy: vi.fn() }),
}));
vi.mock("../top_row_buttons/top_row_builder.js", () => ({
    buildTopRow: () => document.createElement("div"), clearAllFilters: vi.fn(),
}));
vi.mock("../top_row_buttons/sort_dropdown_builder.js", () => ({
    createSortDropdown: () => document.createElement("div"),
}));

const dataset = "arbitrary_tasks";
const columns = ["status", "status_name", "owner_id", "owner_name (ln)", "title"];
const metadata = {
    status: { data_type: "text", foreign_table: "statuses", hide_in_filter_panel: true },
    owner_id: { data_type: "integer", foreign_table: "accounts", hide_everywhere: true },
    title: { data_type: "text" },
};

beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState({}, "", "/");
    primeDatasetAccessRegistry({ datasets: [{ dataset_name: dataset, table_uid: 7,
        names: [dataset], preferred_name: dataset, can_read_rows: true }] });
    setParams(dataset, {});
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { vi.unstubAllGlobals(); });

const builders = {
    legacy: (fields, types) => buildFilterSection(dataset, fields, types, false),
    accordion: (fields, types) => build_favefox_style_filter_bar_from_columns(dataset, fields, types, false, { layoutMode: "accordion" }),
    "inline-open": (fields, types) => build_favefox_style_filter_bar_from_columns(dataset, fields, types, false, { layoutMode: "inline-open" }),
};
const filterRows = element => Array.from(element.querySelectorAll('[data-testid^="column-filter-row-"]'))
    .map(row => row.dataset.testid);

describe.each(Object.entries(builders))("%s builder", (_layout, build) => {
    test.each(["hide_in_filter_panel", "hide_everywhere"])("keeps a stored owner_name input and condition beside a generated name with %s", flag => {
        const fields = ["owner_id", "owner_name (ln)", "owner_name"];
        const types = { owner_id: { data_type: "integer", foreign_table: "accounts", [flag]: true },
            owner_name: { data_type: "text", hide_in_filter_panel: false, hide_everywhere: false } };
        expect(filterRows(build(fields, types))).toEqual([`column-filter-row-${dataset}-owner_name`]);
        const filters = { [`${dataset}_owner_name`]: "Stored name", [`${dataset}_owner_name_exclude`]: "Other",
            [`${dataset}_owner_name (ln)`]: "Generated name" };
        setUnifiedTableState(dataset, { filters });
        setParams(dataset, filters);
        history.replaceState({}, "", `/${dataset}?${new URLSearchParams(filters)}`);
        expect(discardHiddenColumnFilters(dataset, fields, types)).toBe(true);
        const remaining = { [`${dataset}_owner_name`]: "Stored name", [`${dataset}_owner_name_exclude`]: "Other" };
        expect(getUnifiedTableState(dataset).filters).toEqual(remaining);
        expect(getParams(dataset)).toEqual(remaining);
        localStorage.setItem(`${dataset}_columns`, JSON.stringify(fields));
        localStorage.setItem(`${dataset}_dataTypes`, JSON.stringify(types));
        document.body.innerHTML = `<div id="${dataset}_card_top_controls"></div>`;
        renderActiveFilters(dataset);
        expect(document.querySelector(".active_filters").textContent).toContain("Stored name");
    });

    test.each(["hide_in_filter_panel", "hide_everywhere"])("hides the entire source/name pair with %s despite saved openings", flag => {
        saveOpenedFilters(dataset, ["status", "status_name", "owner_name (ln)"]);
        const types = { ...metadata, status: { ...metadata.status, hide_in_filter_panel: false, [flag]: true } };
        const element = build(columns, types);
        expect(filterRows(element)).toEqual([`column-filter-row-${dataset}-title`]);
    });

    test("visible source retains redundancy and datasets without generated columns keep their fields", () => {
        const types = { status: { data_type: "text", foreign_table: "statuses" },
            title: { data_type: "text" } };
        expect(filterRows(build(["status", "status_name", "title"], types)).sort()).toEqual([
            `column-filter-row-${dataset}-status`, `column-filter-row-${dataset}-title`,
        ]);
        expect(filterRows(build(["title", "count"], { title: "text", count: "integer" }))).toHaveLength(2);
    });
});

test("outer content builder carries hidden-source metadata through to the real filter layout", () => {
    const container = document.createElement("div");
    const content = createFilterBarContent(container, { tableName: dataset, tableUID: 7,
        columns, dataTypes: metadata, rowCount: 2, hasGeo: false, currentView: "card", includeOverviewSearch: false });
    expect(filterRows(container)).toEqual([`column-filter-row-${dataset}-title`]);
    content.destroy();
});

test.each(["URL", "saved state"])("%s restore discards hidden selections, repairs storage/address and leaves no orphan chips", origin => {
    const oldFilters = { [`${dataset}_status_name`]: "Old name", "owner_name (ln)_exclude": "Owner",
        [`${dataset}_status`]: "old", [`${dataset}_title`]: "Trip" };
    const params = { ...oldFilters, search: "travel", view: "card", sort_column: "title", sort_order: "ASC" };
    history.replaceState({}, "", `/${dataset}?${new URLSearchParams(params)}`);
    if (origin === "URL") useUrlParams(); else setParams(dataset, params);
    setUnifiedTableState(dataset, { filters: origin === "URL" ? parseTableQueryString(location.search).filters : oldFilters,
        offset: 30, sort: { column: "title", direction: "ASC" } });
    localStorage.setItem(`${dataset}_columns`, JSON.stringify(columns));
    localStorage.setItem(`${dataset}_dataTypes`, JSON.stringify(metadata));
    document.body.innerHTML = `<div id="${dataset}_card_top_controls"></div>`;
    // Even while the first listing is pending, chips use the known visibility.
    renderActiveFilters(dataset);
    expect(document.querySelectorAll(".active-filter-item")).toHaveLength(2); // search + title
    expect(document.querySelector(".active_filters").textContent).not.toContain("Old name");
    expect(document.querySelector(".active_filters").textContent).not.toContain("Owner");
    const historyLength = history.length;
    expect(discardHiddenColumnFilters(dataset, columns, metadata)).toBe(true);
    expect(history.length).toBe(historyLength);
    expect(getUnifiedTableState(dataset)).toMatchObject({ filters: { [`${dataset}_title`]: "Trip" }, offset: 0,
        sort: { column: "title", direction: "ASC" } });
    expect(getParams(dataset)).toEqual({ [`${dataset}_title`]: "Trip", search: "travel", view: "card", sort_column: "title", sort_order: "ASC" });
    expect(Object.fromEntries(new URLSearchParams(location.search))).toEqual(getParams(dataset));
    expect(JSON.parse(localStorage.getItem(`${dataset}_sorting_and_filtering_specs`)).filters).toEqual({ [`${dataset}_title`]: "Trip" });
    renderActiveFilters(dataset);
    expect(document.querySelector(".active_filters").textContent).toContain("Trip");
    expect(discardHiddenColumnFilters(dataset, columns, metadata)).toBe(false);
});

test("hide-everywhere omission clears old generated aliases; missing metadata never clears selections", () => {
    const filters = { [`${dataset}_status_name`]: "Old", "owner_name (ln)": "Owner", title: "Trip" };
    setUnifiedTableState(dataset, { filters });
    setParams(dataset, filters);
    expect(discardHiddenColumnFilters(dataset)).toBe(false);
    expect(getVisibleStoredFilters(dataset, filters)).toBe(filters);
    expect(discardHiddenColumnFilters(dataset, ["title"], { title: "text" })).toBe(true);
    expect(getUnifiedTableState(dataset).filters).toEqual({ title: "Trip" });
});
