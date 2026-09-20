// dataset_search_notice_placement.test.js
// Verifies search-stage notice placement in each built-in dataset result view.
// Bridges executor notice insertion with the runtime view-container registry.
// Exists so result-group headings stay in the real scroll flow without disturbing rows.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    appendDataToCardViewMock,
    appendDataToTableMock,
    appendDataToViewMock,
    clearRowGroupFacetsMock,
    endpointRouterMock,
    getActiveFiltersSnapshotMock,
    getUnifiedTableStateMock,
    reloadDatasetRowsFromListingMock,
    setResultsCountMock,
    setSearchAiResultsCountMock,
    setUnifiedTableStateMock,
} = vi.hoisted(() => ({
    appendDataToCardViewMock: vi.fn(),
    appendDataToTableMock: vi.fn(),
    appendDataToViewMock: vi.fn(),
    clearRowGroupFacetsMock: vi.fn(),
    endpointRouterMock: vi.fn(),
    getActiveFiltersSnapshotMock: vi.fn(() => ({})),
    getUnifiedTableStateMock: vi.fn(() => ({
        cardView: { collapsed: false, expandedId: null },
    })),
    reloadDatasetRowsFromListingMock: vi.fn(),
    setResultsCountMock: vi.fn(),
    setSearchAiResultsCountMock: vi.fn(),
    setUnifiedTableStateMock: vi.fn(),
}));

vi.mock("../../lang/translation_handler.js", () => ({
    getTranslationForKey: vi.fn((_key, { fallback }) => fallback),
}));

vi.mock("../../infinite_scroll/infinite_scroll_handler.js", () => ({
    appendDataToView: appendDataToViewMock,
    reloadDatasetRowsFromListing: reloadDatasetRowsFromListingMock,
}));

vi.mock("../../table_views/table_view/table_row_printer.js", () => ({
    appendDataToTable: appendDataToTableMock,
}));

vi.mock("../../table_views/card_view/card_view_printer.js", () => ({
    appendDataToCardView: appendDataToCardViewMock,
}));

vi.mock("../../endpoints/endpoint_router.js", () => ({
    endpoint_router: endpointRouterMock,
}));

vi.mock("../../../reusable_components/results_count/results_count_printer.js", () => ({
    setResultsCount: setResultsCountMock,
    setSearchAiResultsCount: setSearchAiResultsCountMock,
}));

vi.mock("./dataset_search_state_reader.js", () => ({
    getActiveFiltersSnapshot: getActiveFiltersSnapshotMock,
    RESERVED_PARAM_KEYS: new Set(["search", "view", "sort_column", "sort_order", "offset", "lang"]),
}));

vi.mock("../filter_list/row_group_facet_printer.js", () => ({
    clearRowGroupFacets: clearRowGroupFacetsMock,
    ROW_GROUP_FILTER_KEY: "row_group",
}));

vi.mock("../../state_stores/table_state_store.js", () => ({
    getUnifiedTableState: getUnifiedTableStateMock,
    setUnifiedTableState: setUnifiedTableStateMock,
}));

describe("search stage notice placement", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        localStorage.clear();
        document.body.replaceChildren();
    });

    test.each(["table", "card", "article_view"])(
        "divides the dataset's own %s results from the AI group in its real host",
        async (view) => {
            const tableName = "app_service_catalog";
            localStorage.setItem(tableName + "_view", view);
            const primaryCount = document.createElement("div");
            primaryCount.id = tableName + "_results_count";
            primaryCount.textContent = "2 results";
            document.body.append(primaryCount);

            // These are the registry's real container IDs, including the
            // article_view key's single article_view_container suffix.
            const viewContainer = document.createElement("div");
            viewContainer.id = tableName + "_" + (view === "article_view" ? "article" : view) + "_view_container";
            document.body.append(viewContainer);
            let stage = viewContainer;
            let primary;
            let firstResult;
            if (view === "table") {
                primary = document.createElement("table");
                const body = document.createElement("tbody");
                firstResult = document.createElement("tr");
                const cell = document.createElement("td");
                cell.textContent = "Firefox";
                firstResult.append(cell);
                body.append(firstResult);
                primary.append(body);
            } else {
                stage = document.createElement("div");
                stage.className = "card_sidebar_panel";
                viewContainer.append(stage);
                const header = document.createElement("div");
                header.className = "card_sidebar_header";
                stage.append(header);
                primary = document.createElement("div");
                primary.className = "card_container";
                firstResult = document.createElement("article");
                firstResult.className = "card";
                firstResult.textContent = "Firefox";
                primary.append(firstResult);
            }
            stage.append(primary);
            const aiHost = document.createElement(view === "table" ? "table" : "div");
            aiHost.id = tableName + (view === "table" ? "_search_ai_table" : "_search_ai_cards");
            (view === "table" ? stage : primary).append(aiHost);

            const { insertNotice } = await import("./dataset_search_executor.js");
            const runtime = await import("./dataset_search_runtime_state.js");
            expect(runtime.getSearchViewContainer(tableName)).toBe(viewContainer);
            expect(runtime.getSearchStageContainer(tableName)).toBe(stage);
            if (view !== "table") expect(runtime.getPrimaryCardContainer(tableName)).toBe(primary);

            // The AI group's heading follows the dataset's own results and
            // introduces the AI host, twice inserted but shown only once.
            insertNotice(tableName, "see_also", "See also");
            insertNotice(tableName, "see_also", "See also");
            const seeAlso = stage.querySelector('[data-lang-key="see_also"]');
            expect(seeAlso).not.toBeNull();
            expect(seeAlso.getAttribute("role")).toBe("status");
            expect(stage.querySelectorAll('[data-lang-key="see_also"]')).toHaveLength(1);
            expect(primary.compareDocumentPosition(seeAlso) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(seeAlso.nextElementSibling).toBe(aiHost);

            insertNotice(tableName, "text_search_no_results", "Text search returned no results");
            const noResults = stage.querySelector('[data-lang-key="text_search_no_results"]');
            expect(primary.compareDocumentPosition(noResults) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(noResults.nextElementSibling).toBe(aiHost);

            runtime.removeSearchNotice(tableName, "see_also");
            expect(stage.querySelector('[data-lang-key="see_also"]')).toBeNull();
            expect(stage.contains(firstResult)).toBe(true);
            expect(stage.contains(noResults)).toBe(true);
        },
    );
});
