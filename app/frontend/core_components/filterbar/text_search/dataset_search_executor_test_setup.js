// dataset_search_executor_test_setup.js
// Shared Vitest/JSDOM setup for the dataset search executor's test suites.
// Keeps the dependency mocks, the listing and stream fixtures and the per-test
// reset in one place, so each suite covers one concern and stays readable.
// Every suite imports the executor inside its tests, after these mocks exist.

import { vi } from "vitest";

const {
    appendDataToCardViewMock,
    appendDataToTableMock,
    appendDataToViewMock,
    clearRowGroupFacetsMock,
    disconnectInfiniteScrollMock,
    endpointRouterMock,
    getActiveFiltersSnapshotMock,
    getUnifiedTableStateMock,
    openRowArticleViewMock,
    reloadDatasetRowsFromListingMock,
    setResultsCountMock,
    setSearchAiResultsCountMock,
    setUnifiedTableStateMock,
} = vi.hoisted(() => ({
    appendDataToCardViewMock: vi.fn(),
    appendDataToTableMock: vi.fn(),
    appendDataToViewMock: vi.fn(),
    clearRowGroupFacetsMock: vi.fn(),
    disconnectInfiniteScrollMock: vi.fn(),
    endpointRouterMock: vi.fn(),
    getActiveFiltersSnapshotMock: vi.fn(() => ({})),
    getUnifiedTableStateMock: vi.fn(() => ({
        cardView: { collapsed: false, expandedId: null },
    })),
    openRowArticleViewMock: vi.fn(),
    reloadDatasetRowsFromListingMock: vi.fn(),
    setResultsCountMock: vi.fn(),
    setSearchAiResultsCountMock: vi.fn(),
    setUnifiedTableStateMock: vi.fn(),
}));

vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: vi.fn((_key, { fallback }) => fallback) }));

vi.mock("../../infinite_scroll/infinite_scroll_handler.js", () => ({
    appendDataToView: appendDataToViewMock,
    disconnectInfiniteScroll: disconnectInfiniteScrollMock,
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

vi.mock("../../table_views/card_view/row_article_opener.js", () => ({
    openRowArticleView: openRowArticleViewMock,
}));

export {
    appendDataToCardViewMock,
    appendDataToTableMock,
    appendDataToViewMock,
    clearRowGroupFacetsMock,
    disconnectInfiniteScrollMock,
    endpointRouterMock,
    getActiveFiltersSnapshotMock,
    getUnifiedTableStateMock,
    openRowArticleViewMock,
    reloadDatasetRowsFromListingMock,
    setResultsCountMock,
    setSearchAiResultsCountMock,
    setUnifiedTableStateMock,
};

export function createNdjsonStreamResponse(rows) {
    const encoder = new TextEncoder();

    return {
        body: new ReadableStream({
            start(controller) {
                rows.forEach((row) => {
                    controller.enqueue(encoder.encode(`${JSON.stringify(row)}\n`));
                });
                controller.close();
            },
        }),
    };
}

/** One answer of the dataset's ordinary listing, as the search now reads it. */
export function listingAnswer({ data = [], row_count = data.length, columns = [], types = {} } = {}) {
    return { data, row_count, columns, types };
}

export function createTableViewDom(tableName) {
    document.body.innerHTML = `
        <div id="${tableName}_results_count"></div>
        <div id="${tableName}_table_view_container">
            <table data-columns='["header","id"]' data-data-types="{}">
                <tbody></tbody>
            </table>
        </div>
    `;
    localStorage.setItem(`${tableName}_view`, "table");
}

export function createCardViewDom(tableName, viewKey = "card") {
    const containerView = viewKey === "article_view" ? "article" : "card";
    document.body.innerHTML = `
        <div id="${tableName}_results_count"></div>
        <div id="${tableName}_${containerView}_view_container">
            <div class="card_sidebar_panel">
                <div class="card_container"></div>
            </div>
        </div>
    `;
    localStorage.setItem(`${tableName}_view`, viewKey);
}

/** Start each test from an empty table view with no search, filter or answer. */
export function resetDatasetSearchTest() {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    document.body.innerHTML = "";
    document.documentElement.lang = "fi";
    getActiveFiltersSnapshotMock.mockReturnValue({});
    getUnifiedTableStateMock.mockReturnValue({
        cardView: { collapsed: false, expandedId: null },
    });
    reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer());
    endpointRouterMock.mockResolvedValue(createNdjsonStreamResponse([]));
    createTableViewDom("dev_agent_tasks");
}
