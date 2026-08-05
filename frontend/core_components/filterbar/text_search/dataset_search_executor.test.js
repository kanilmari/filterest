// dataset_search_executor.test.js
// Tests streamed search notice behavior against the same cache-backed counts used by the split result counter.
// Operates with mocked stream/render dependencies so the executor can be verified in isolation under jsdom.
// Exists to prevent stale "no text results" notices from surviving after direct text matches appear later in the stream.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    appendDataToCardViewMock,
    appendDataToTableMock,
    appendDataToViewMock,
    disconnectInfiniteScrollMock,
    endpointRouterMock,
    getActiveFiltersSnapshotMock,
    getUnifiedTableStateMock,
    openRowArticleViewMock,
    setResultsCountMock,
    setUnifiedTableStateMock,
} = vi.hoisted(() => ({
    appendDataToCardViewMock: vi.fn(),
    appendDataToTableMock: vi.fn(),
    appendDataToViewMock: vi.fn(),
    disconnectInfiniteScrollMock: vi.fn(),
    endpointRouterMock: vi.fn(),
    getActiveFiltersSnapshotMock: vi.fn(() => ({})),
    getUnifiedTableStateMock: vi.fn(() => ({
        cardView: { collapsed: false, expandedId: null },
    })),
    openRowArticleViewMock: vi.fn(),
    setResultsCountMock: vi.fn(),
    setUnifiedTableStateMock: vi.fn(),
}));

vi.mock("../../infinite_scroll/infinite_scroll_handler.js", () => ({
    appendDataToView: appendDataToViewMock,
    disconnectInfiniteScroll: disconnectInfiniteScrollMock,
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
}));

vi.mock("./dataset_search_state_reader.js", () => ({
    getActiveFiltersSnapshot: getActiveFiltersSnapshotMock,
}));

vi.mock("../../state_stores/table_state_store.js", () => ({
    getUnifiedTableState: getUnifiedTableStateMock,
    setUnifiedTableState: setUnifiedTableStateMock,
}));

vi.mock("../../table_views/card_view/row_article_opener.js", () => ({
    openRowArticleView: openRowArticleViewMock,
}));

function createNdjsonStreamResponse(rows) {
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

function createTableViewDom(tableName) {
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

function createCardViewDom(tableName) {
    document.body.innerHTML = `
        <div id="${tableName}_results_count"></div>
        <div id="${tableName}_card_view_container">
            <div class="card_sidebar_panel">
                <div class="card_container"></div>
            </div>
        </div>
    `;
    localStorage.setItem(`${tableName}_view`, "card");
}

describe("do_intelligent_search", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        localStorage.clear();
        document.body.innerHTML = "";
        document.documentElement.lang = "fi";
        getUnifiedTableStateMock.mockReturnValue({
            cardView: { collapsed: false, expandedId: null },
        });
        createTableViewDom("dev_agent_tasks");
    });

    test("removes a stale no-results notice when text hits arrive after AI hits", async () => {
        endpointRouterMock.mockResolvedValue(
            createNdjsonStreamResponse([
                {
                    stage: "ai",
                    columns: ["header", "id"],
                    data: [{ header: "AI-related cloud row", id: 99 }],
                    types: {},
                },
                {
                    stage: "text",
                    columns: ["header", "id"],
                    data: [{ header: "Direct cloud match", id: 14 }],
                    types: {},
                },
            ])
        );

        const { do_intelligent_search, ongoingSearchResults } = await import("./dataset_search_executor.js");

        await do_intelligent_search("dev_agent_tasks", "cloud");

        expect(
            document.querySelector('.search-stage-notice[data-lang-key="text_search_no_results"]')
        ).toBeNull();
        expect(ongoingSearchResults.dev_agent_tasks.data).toEqual([
            { header: "Direct cloud match", id: 14 },
        ]);
        expect(ongoingSearchResults.dev_agent_tasks.aiData).toEqual([
            { header: "AI-related cloud row", id: 99 },
        ]);
    });

    test("requests card support fields for intelligent search in card view", async () => {
        createCardViewDom("app_service_catalog");
        endpointRouterMock.mockResolvedValue(
            createNdjsonStreamResponse([
                {
                    stage: "text",
                    columns: ["header", "id", "cached_image"],
                    data: [{ header: "Wikipedia", id: 394, cached_image: "104_394_16.svg" }],
                    types: {},
                },
            ])
        );

        const { do_intelligent_search } = await import("./dataset_search_executor.js");

        await do_intelligent_search("app_service_catalog", "wikipedia");

        expect(endpointRouterMock).toHaveBeenCalledWith(
            "getIntelligentResultsStream",
            expect.objectContaining({
                url_params: expect.stringContaining("include_card_support=1"),
            })
        );
    });

    test("exposes cached search rows as one renderable dataset result", async () => {
        getActiveFiltersSnapshotMock.mockReturnValue({});
        const {
            getCachedSearchResultForRender,
            ongoingSearchResults,
        } = await import("./dataset_search_executor.js");
        ongoingSearchResults.app_service_catalog = {
            columns: ["id", "title"],
            data: [{ id: 7, title: "Firefox" }],
            aiData: [{ id: 9, title: "Fennec" }],
            types: { id: "integer", title: "text" },
            filters: {},
            renderedOnce: true,
        };

        expect(getCachedSearchResultForRender("app_service_catalog")).toEqual({
            columns: ["id", "title"],
            data: [
                { id: 7, title: "Firefox" },
                { id: 9, title: "Fennec" },
            ],
            types: { id: "integer", title: "text" },
            row_count: 2,
        });
    });

    test("opens the first streamed search row when article view is waiting for it", async () => {
        createCardViewDom("app_service_catalog");
        getUnifiedTableStateMock.mockReturnValue({
            cardView: {
                collapsed: true,
                expandedId: null,
                pendingAutoOpenFirstSearchResult: true,
            },
        });
        endpointRouterMock.mockResolvedValue(
            createNdjsonStreamResponse([
                {
                    stage: "text",
                    columns: ["id", "title"],
                    data: [{ id: 7, title: "Firefox" }],
                    types: {},
                },
            ])
        );

        const { do_intelligent_search } = await import("./dataset_search_executor.js");

        await do_intelligent_search("app_service_catalog", "firefox");

        expect(setUnifiedTableStateMock).toHaveBeenCalledWith("app_service_catalog", {
            cardView: {
                collapsed: true,
                expandedId: 7,
                pendingAutoOpenFirstSearchResult: false,
            },
        });
        expect(openRowArticleViewMock).toHaveBeenCalledWith(
            { id: 7, title: "Firefox" },
            "app_service_catalog",
            null
        );
    });
});
