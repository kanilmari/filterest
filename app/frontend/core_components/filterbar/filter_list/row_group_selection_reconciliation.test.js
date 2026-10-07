// row_group_selection_reconciliation.test.js
// Verifies resolved facets reconcile real browser state, parameters, history and tags.
// Bridges the facet renderer with the actual shared state and dataset address owner.
// Prevents disabled headings and disappeared values from locking out valid selections.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { forgetPageDatasetParams, getParams, parseDatasetParamsFromSearch, setParams } from "../../navigation/nav_engine/query_params.js";
import { renderActiveFilters } from "./active_filter_tag_printer.js";
import { renderRowGroupFacets, toggleRowGroupFacet } from "./row_group_facet_printer.js";

const { endpointRouterMock, refreshMock, searchMock } = vi.hoisted(() => ({
    endpointRouterMock: vi.fn(), refreshMock: vi.fn(), searchMock: vi.fn(),
}));

vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", async () => ({
    ...await import("../../state_stores/table_state_store.js"), refreshTableUnified: refreshMock,
}));
vi.mock("../text_search/create_text_search_panel.js", () => ({
    ongoingSearchResults: {}, do_intelligent_search: searchMock, rerenderCachedSearchResults: vi.fn(),
}));
vi.mock("../text_search/dataset_search_executor.js", () => ({ do_intelligent_search: searchMock }));
vi.mock("../text_search/dataset_search_clearer.js", () => ({ clearCommittedDatasetSearch: vi.fn() }));
vi.mock("../../endpoints/endpoint_router.js", () => ({ endpoint_router: endpointRouterMock }));
vi.mock("../../route_permission_checker.js", () => ({ hasRoutePermission: vi.fn(() => false) }));
vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: key => key }));
vi.mock("../../table_views/dataset_value_localizer.js", () => ({
    bindDatasetLanguageRenderer: (_element, render) => render("fi"),
    resolveDatasetDisplayValue: value => value?.fi || "",
}));

const available = { id: 1, slug: "available", title: { fi: "Saatavilla" }, row_count: 4, selected: false };
const authoritative = { authoritative: true };

function seedURL(selection, { article = false, search = "matka" } = {}) {
    const params = new URLSearchParams({ row_group: selection, status: "open", search,
        sort_column: "id", sort_order: "ASC", view: article ? "article_view" : "card", offset: "12" });
    history.replaceState({ __filterestEntryId: "original-entry", dataset: "travel_info",
        ...(article ? { bigCard: true, rowId: "42", articleReturnAvailable: true, articleOriginEntry: "list-entry" } : {}),
    }, "", `/travel_info${article ? "/42-trip" : ""}?${params}#details`);
    setParams("travel_info", parseDatasetParamsFromSearch(location.search));
    setChosenDatasetView("travel_info", article ? "article_view" : "card");
    setUnifiedTableState("travel_info", {
        filters: { row_group: selection, status: "open" }, offset: 12,
        sort: { column: "id", direction: "ASC" },
        ...(article ? { articleView: { collapsed: true, expandedId: 42, scrollTop: 90 } } : {}),
    });
    renderActiveFilters("travel_info");
}

function selectedTags() {
    return [...document.querySelectorAll("[data-row-group-table]")].map(item => item.dataset.rowGroupSlug);
}

describe("authoritative row-group selections", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
        forgetPageDatasetParams();
        document.body.innerHTML = '<div id="travel_info_card_top_controls"></div>';
    });

    afterEach(() => {
        expect(endpointRouterMock).not.toHaveBeenCalled();
        vi.restoreAllMocks();
    });

    test("drops URL selections of a disabled heading once, preserving search, filters and article navigation", async () => {
        seedURL("disabled_boat,disabled_train", { article: true });
        const originalState = getUnifiedTableState("travel_info");
        const originalHistory = { ...history.state };
        const replace = vi.spyOn(history, "replaceState");
        const push = vi.spyOn(history, "pushState");
        expect(selectedTags()).toEqual(["disabled_boat", "disabled_train"]);

        renderRowGroupFacets("travel_info", [available], authoritative);
        await Promise.resolve();

        expect(getUnifiedTableState("travel_info")).toEqual({ ...originalState, filters: { status: "open" } });
        expect(getParams("travel_info")).toEqual({ status: "open", search: "matka", sort_column: "id",
            sort_order: "ASC", view: "article_view", offset: "12" });
        expect(new URLSearchParams(location.search).has("row_group")).toBe(false);
        expect(location.pathname).toBe("/travel_info/42-trip");
        expect(location.hash).toBe("#details");
        expect(history.state).toEqual(originalHistory);
        expect(selectedTags()).toEqual([]);
        expect(document.querySelector('.active_filters').textContent).toContain("matka");
        expect(document.querySelector('.active_filters').textContent).toContain("open");
        const tags = document.querySelector('.active_filters').firstChild;
        renderRowGroupFacets("travel_info", [available], authoritative);
        await Promise.resolve();
        expect(document.querySelector('.active_filters').firstChild).toBe(tags);
        expect(replace).toHaveBeenCalledTimes(1);
        expect(push).not.toHaveBeenCalled();
        expect(refreshMock).not.toHaveBeenCalled();
        expect(searchMock).not.toHaveBeenCalled();
    });

    test("twenty rejected URL slugs release the limit and allow the next valid value", async () => {
        seedURL(Array.from({ length: 20 }, (_, i) => `disabled_${i}`).join(","), { search: "" });
        expect(await toggleRowGroupFacet("travel_info", "available")).toBe(false);
        const host = renderRowGroupFacets("travel_info", [available], authoritative);
        await Promise.resolve();
        expect(selectedTags()).toEqual([]);
        host.querySelector('[data-testid="row-group-facet-heading"]').click();
        expect(host.querySelector('[data-row-group-slug="available"]').disabled).toBe(false);
        expect(refreshMock).not.toHaveBeenCalled();
        expect(searchMock).not.toHaveBeenCalled();
        expect(await toggleRowGroupFacet("travel_info", "available")).toBe(true);
        expect(getUnifiedTableState("travel_info").filters.row_group).toBe("available");
        expect(refreshMock).toHaveBeenCalledExactlyOnceWith("travel_info", { skipUrlParams: true });
    });

    test("keeps a valid selected zero-count value while removing a disappeared value", async () => {
        seedURL("disappeared,zero");
        const zero = { id: 2, slug: "zero", title: { fi: "Nolla" }, row_count: 0, selected: true };
        const host = renderRowGroupFacets("travel_info", [available, zero], authoritative);
        await Promise.resolve();
        expect(getUnifiedTableState("travel_info").filters).toEqual({ row_group: "zero", status: "open" });
        expect(getParams("travel_info").row_group).toBe("zero");
        expect(new URLSearchParams(location.search).get("row_group")).toBe("zero");
        expect(selectedTags()).toEqual(["zero"]);
        host.querySelector('[data-testid="row-group-facet-heading"]').click();
        expect(host.querySelector('[data-row-group-slug="zero"]').checked).toBe(true);
        expect(document.querySelector('.row-group-filter-label').textContent).toBe("filters: Nolla");
        expect(refreshMock).not.toHaveBeenCalled();
        expect(searchMock).not.toHaveBeenCalled();
    });

    test("shared tag updates synchronize panel selections immediately without awaiting fresh metadata", async () => {
        seedURL("zero");
        const host = renderRowGroupFacets("travel_info", [{ id: 2, slug: "zero", title: { fi: "Nolla" }, row_count: 0, selected: true }], authoritative);
        host.querySelector('[data-testid="row-group-facet-heading"]').click();
        expect(host.querySelector('input[type="checkbox"]').checked).toBe(true);
        const checkbox = host.querySelector('input[type="checkbox"]');
        checkbox.focus();
        setUnifiedTableState("travel_info", { filters: { status: "open" } });
        const params = { ...getParams("travel_info") };
        delete params.row_group;
        setParams("travel_info", params);
        renderActiveFilters("travel_info");
        expect(host.querySelector('input[type="checkbox"]').checked).toBe(false);
        expect(host.querySelector('.row-group-facet-heading__badge')).toBeNull();
        expect(document.activeElement).toBe(host.querySelector('input[type="checkbox"]'));
        expect(refreshMock).not.toHaveBeenCalled();
    });

    test("an authoritative empty array clears the selection even without a facet host", async () => {
        seedURL("disabled");
        expect(renderRowGroupFacets("travel_info", [], authoritative)).toBeNull();
        await Promise.resolve();
        expect(getUnifiedTableState("travel_info").filters).toEqual({ status: "open" });
        expect(getParams("travel_info").row_group).toBeUndefined();
        expect(new URLSearchParams(location.search).has("row_group")).toBe(false);
        expect(selectedTags()).toEqual([]);
        expect(refreshMock).not.toHaveBeenCalled();
        expect(searchMock).not.toHaveBeenCalled();
    });

    test.each([
        ["omitted", undefined, authoritative],
        ["null", null, authoritative],
        ["later page", [], { authoritative: false }],
        ["failed request", [], { authoritative: false }],
        ["stale request", [], { authoritative: true, isCurrent: () => false }],
    ])("%s payload leaves selection, cached parameters and address alone", async (_reason, payload, context) => {
        seedURL("still_selected");
        const state = getUnifiedTableState("travel_info");
        const params = getParams("travel_info");
        const url = location.href;
        renderRowGroupFacets("travel_info", payload, context);
        await Promise.resolve();
        expect(getUnifiedTableState("travel_info")).toEqual(state);
        expect(getParams("travel_info")).toEqual(params);
        expect(location.href).toBe(url);
        expect(selectedTags()).toEqual(["still_selected"]);
        expect(refreshMock).not.toHaveBeenCalled();
        expect(searchMock).not.toHaveBeenCalled();
    });

    test("a filter edit before the next refresh starts makes the previous answer stale", async () => {
        seedURL("old_selection");
        const requestFilters = { ...getUnifiedTableState("travel_info").filters };
        setUnifiedTableState("travel_info", { filters: { row_group: "new_selection", status: "open" } });
        setParams("travel_info", { ...getParams("travel_info"), row_group: "new_selection" });
        renderActiveFilters("travel_info");
        const state = getUnifiedTableState("travel_info");
        const params = getParams("travel_info");
        const url = location.href;
        renderRowGroupFacets("travel_info", [], { ...authoritative, requestFilters });
        await Promise.resolve();
        expect(getUnifiedTableState("travel_info")).toEqual(state);
        expect(getParams("travel_info")).toEqual(params);
        expect(location.href).toBe(url);
        expect(selectedTags()).toEqual(["new_selection"]);
        expect(refreshMock).not.toHaveBeenCalled();
        expect(searchMock).not.toHaveBeenCalled();
    });
});
