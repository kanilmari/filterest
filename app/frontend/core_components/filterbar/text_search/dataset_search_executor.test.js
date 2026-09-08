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
    clearRowGroupFacetsMock,
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
    clearRowGroupFacetsMock: vi.fn(),
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

vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: vi.fn((_key, { fallback }) => fallback) }));

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
        getActiveFiltersSnapshotMock.mockReturnValue({});
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

        expect(clearRowGroupFacetsMock).toHaveBeenCalledWith("dev_agent_tasks");
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

    test("sends row-group metadata to the backend without filtering streamed row objects", async () => {
        getActiveFiltersSnapshotMock.mockReturnValue({ row_group: "security" });
        endpointRouterMock.mockResolvedValue(
            createNdjsonStreamResponse([
                {
                    stage: "text",
                    columns: ["header", "id"],
                    data: [{ header: "Authorized group result", id: 14 }],
                    types: {},
                },
            ])
        );

        const { do_intelligent_search, ongoingSearchResults } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "cloud");

        expect(endpointRouterMock).toHaveBeenCalledWith(
            "getIntelligentResultsStream",
            expect.objectContaining({
                url_params: expect.stringContaining("row_group=security"),
            })
        );
        expect(ongoingSearchResults.dev_agent_tasks.filters).toEqual({});
        expect(ongoingSearchResults.dev_agent_tasks.data).toEqual([
            { header: "Authorized group result", id: 14 },
        ]);
    });

    test("cancels an older stream when a newer search replaces its cache while read is pending", async () => {
        let releaseOldRead;
        const oldReader = {
            read: vi.fn(() => new Promise((resolve) => { releaseOldRead = resolve; })),
            cancel: vi.fn().mockResolvedValue(undefined),
        };
        const newReader = {
            read: vi.fn().mockResolvedValue({ value: undefined, done: true }),
            cancel: vi.fn().mockResolvedValue(undefined),
        };
        endpointRouterMock
            .mockResolvedValueOnce({ body: { getReader: () => oldReader } })
            .mockResolvedValueOnce({ body: { getReader: () => newReader } });

        const { do_intelligent_search, ongoingSearchResults } = await import("./dataset_search_executor.js");
        const oldSearch = do_intelligent_search("dev_agent_tasks", "old");
        await vi.waitFor(() => expect(oldReader.read).toHaveBeenCalled());
        await do_intelligent_search("dev_agent_tasks", "new");
        const newestCache = ongoingSearchResults.dev_agent_tasks;
        releaseOldRead({
            value: new TextEncoder().encode('{"stage":"text","columns":["id"],"data":[{"id":1}]}\n'),
            done: false,
        });
        await oldSearch;

        expect(oldReader.cancel).toHaveBeenCalledOnce();
        expect(ongoingSearchResults.dev_agent_tasks).toBe(newestCache);
        expect(newestCache.data).toEqual([]);
    });

    test("does not commit cards built by a search replaced during asynchronous rendering", async () => {
        createCardViewDom("app_service_catalog");
        let releaseOldCardRender;
        appendDataToCardViewMock.mockImplementationOnce(async (host) => {
            await new Promise((resolve) => { releaseOldCardRender = resolve; });
            const staleCard = document.createElement("article");
            staleCard.className = "card";
            staleCard.dataset.id = "7";
            host.appendChild(staleCard);
        });
        endpointRouterMock
            .mockResolvedValueOnce(
                createNdjsonStreamResponse([
                    {
                        stage: "text",
                        columns: ["id", "title"],
                        data: [{ id: 7, title: "Old result" }],
                        types: {},
                    },
                ])
            )
            .mockResolvedValueOnce(createNdjsonStreamResponse([]));

        const { do_intelligent_search } = await import("./dataset_search_executor.js");
        const oldSearch = do_intelligent_search("app_service_catalog", "old");
        await vi.waitFor(() => expect(releaseOldCardRender).toBeTypeOf("function"));
        await do_intelligent_search("app_service_catalog", "new");
        releaseOldCardRender();
        await oldSearch;

        expect(
            document.querySelector("#app_service_catalog_card_view_container .card")
        ).toBeNull();
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

        expect(getCachedSearchResultForRender("app_service_catalog")).toMatchObject({
            columns: ["id", "title"],
            data: [
                { id: 7, title: "Firefox" },
                { id: 9, title: "Fennec" },
            ],
            types: { id: "integer", title: "text" },
            row_count: 2,
        });
    });

    test("rerenders cached rows with the dataset name in the filter contract", async () => {
        getActiveFiltersSnapshotMock.mockReturnValue({
            dev_agent_tasks_status: "open",
        });
        const {
            ongoingSearchResults,
            rerenderCachedSearchResults,
        } = await import("./dataset_search_executor.js");
        ongoingSearchResults.dev_agent_tasks = {
            columns: ["id", "status"],
            data: [
                { id: 1, status: "open" },
                { id: 2, status: "closed" },
            ],
            aiData: [],
            types: { id: "integer", status: "text" },
            filters: {},
            renderedOnce: true,
        };

        await rerenderCachedSearchResults("dev_agent_tasks");

        expect(appendDataToViewMock).toHaveBeenCalledWith(
            "dev_agent_tasks",
            [{ id: 1, status: "open" }],
            false
        );
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
            null,
            expect.objectContaining({ isCurrent: expect.any(Function) }),
        );
    });
    test.each(["fi", "en"])("shows authorized results without filters in %s and retains selections for the next text", async (language) => {
        localStorage.setItem("chosen_language", language);
        const selected = { status: "closed" };
        getActiveFiltersSnapshotMock.mockReturnValue(selected);
        endpointRouterMock.mockImplementation(() => Promise.resolve(createNdjsonStreamResponse([
            { stage: "text", filters_applied: true, columns: ["id", "status"], data: [{ id: 1, status: "open" }], types: {} },
        ])));
        endpointRouterMock.mockResolvedValueOnce(createNdjsonStreamResponse([{ stage: "text", filters_applied: true, columns: ["id", "status"], data: [], types: {} }]));
        const { do_intelligent_search, ongoingSearchResults, getCachedSearchResultForRender } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "first");
        expect(getCachedSearchResultForRender("dev_agent_tasks", { query: "first" }).data).toEqual([{ id: 1, status: "open" }]);
        expect(selected).toEqual({ status: "closed" });
        const notice = document.querySelector('[data-lang-key="search_results_without_filters"]');
        expect(notice?.textContent).toContain(language === "fi" ? "Valinnat säilyvät" : "selections are kept");
        expect(document.querySelector('[data-lang-key="text_search_no_results"]')).toBeNull();

        endpointRouterMock.mockResolvedValueOnce(createNdjsonStreamResponse([
            { stage: "text", filters_applied: true, columns: ["id", "status"], data: [{ id: 2, status: "closed" }], types: {} },
        ]));
        await do_intelligent_search("dev_agent_tasks", "second");
        expect(ongoingSearchResults.dev_agent_tasks.fallbackWithoutFilters).toBe(false);
        expect(getCachedSearchResultForRender("dev_agent_tasks", { query: "second" }).data).toEqual([{ id: 2, status: "closed" }]);
        expect(getCachedSearchResultForRender("dev_agent_tasks", { query: "first" })).toBeNull();
        expect(document.querySelector('[data-lang-key="search_results_without_filters"]')).toBeNull();
    });

    test("removes only the optional row-group classification in the second authorized request", async () => {
        const selected = { row_group: "news", status: "closed" };
        getActiveFiltersSnapshotMock.mockReturnValue(selected);
        endpointRouterMock
            .mockResolvedValueOnce(createNdjsonStreamResponse([{ stage: "text", columns: ["id", "status"], data: [], types: {} }]))
            .mockResolvedValueOnce(createNdjsonStreamResponse([{ stage: "text", columns: ["id", "status"], data: [{ id: 8, status: "open" }], types: {} }]));
        const { do_intelligent_search, getCachedSearchResultForRender } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "hello", { useLocation: true, gps: { lat: 60, lon: 24 } });
        expect(endpointRouterMock).toHaveBeenCalledTimes(2);
        const [first, second] = endpointRouterMock.mock.calls;
        expect(first[0]).toBe("getIntelligentResultsStream");
        expect(second[0]).toBe(first[0]);
        expect(first[1].url_params).toContain("&row_group=news");
        const firstParams = new URLSearchParams(first[1].url_params);
        const secondParams = new URLSearchParams(second[1].url_params);
        firstParams.delete("row_group"); firstParams.delete("filters");
        expect(secondParams.toString()).toBe(firstParams.toString());
        expect(selected).toEqual({ row_group: "news", status: "closed" });
        expect(getCachedSearchResultForRender("dev_agent_tasks", { query: "hello" }).data[0].id).toBe(8);
    });

    test("does not claim a fallback or open a semantic row when neither text search has matches", async () => {
        getActiveFiltersSnapshotMock.mockReturnValue({ row_group: "news" });
        endpointRouterMock.mockImplementation(() => Promise.resolve(createNdjsonStreamResponse([
            { stage: "text", columns: ["id"], data: [], types: {} },
            { stage: "ai", columns: ["id"], data: [{ id: 77 }], types: {} },
        ])));
        const { do_intelligent_search } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "absent");
        expect(document.querySelector('[data-lang-key="search_results_without_filters"]')).toBeNull();
        expect(document.querySelector('[data-lang-key="text_search_no_results"]')).not.toBeNull();
        expect(openRowArticleViewMock).not.toHaveBeenCalled();
    });

    test("discards an obsolete unfiltered response when a new query completes first", async () => {
        getActiveFiltersSnapshotMock.mockReturnValue({ row_group: "news" });
        let releaseFallback;
        endpointRouterMock
            .mockResolvedValueOnce(createNdjsonStreamResponse([{ stage: "text", data: [], types: {} }]))
            .mockImplementationOnce(() => new Promise((resolve) => { releaseFallback = resolve; }))
            .mockResolvedValueOnce(createNdjsonStreamResponse([{ stage: "text", columns: ["id"], data: [{ id: 2 }], types: {} }]));
        const { do_intelligent_search, getCachedSearchResultForRender } = await import("./dataset_search_executor.js");
        const old = do_intelligent_search("dev_agent_tasks", "old");
        await vi.waitFor(() => expect(releaseFallback).toBeTypeOf("function"));
        await do_intelligent_search("dev_agent_tasks", "new");
        releaseFallback(createNdjsonStreamResponse([{ stage: "text", columns: ["id"], data: [{ id: 99 }], types: {} }]));
        await old;
        expect(getCachedSearchResultForRender("dev_agent_tasks", { query: "new" }).data).toEqual([{ id: 2 }]);
    });

    test("sorting the current results can return to their original relevance order", async () => {
        getUnifiedTableStateMock.mockReturnValue({ sort: { column: "id", direction: "ASC" } });
        endpointRouterMock.mockResolvedValueOnce(createNdjsonStreamResponse([
            { stage: "text", columns: ["id"], data: [{ id: 9 }, { id: 2 }], types: { id: "integer" } },
        ]));
        const { do_intelligent_search, getCachedSearchResultForRender, sortCachedSearchResults, ongoingSearchResults } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "ranked");
        expect(getCachedSearchResultForRender("dev_agent_tasks", { query: "ranked" }).data.map((row) => row.id)).toEqual([2, 9]);
        expect(ongoingSearchResults.dev_agent_tasks.data.map((row) => row.id)).toEqual([9, 2]);
        getUnifiedTableStateMock.mockReturnValue({ sort: { column: null, direction: null } });
        await sortCachedSearchResults("dev_agent_tasks");
        expect(getCachedSearchResultForRender("dev_agent_tasks", { query: "ranked" }).data.map((row) => row.id)).toEqual([9, 2]);
    });

    test("reserved query and view keys never trigger a filter fallback", async () => {
        getActiveFiltersSnapshotMock.mockReturnValue({ search: "word", view: "card", lang: "fi", sort_column: "id" });
        endpointRouterMock.mockResolvedValueOnce(createNdjsonStreamResponse([
            { stage: "text", columns: ["id"], data: [{ id: 7 }], types: {} },
        ]));
        const { do_intelligent_search, ongoingSearchResults } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "word");
        expect(ongoingSearchResults.dev_agent_tasks.fallbackWithoutFilters).toBe(false);
        expect(document.querySelector('[data-lang-key="search_results_without_filters"]')).toBeNull();
    });

    test("accepts a server-filtered rank-11 match and does not start a false fallback", async () => {
        getActiveFiltersSnapshotMock.mockReturnValue({ status: "closed" });
        endpointRouterMock.mockResolvedValueOnce(createNdjsonStreamResponse([
            { stage: "text", filters_applied: true, columns: ["id"], data: [{ id: 11 }], types: { id: "integer" } },
        ]));
        const { do_intelligent_search, getCachedSearchResultForRender } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "shared");
        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
        expect(new URLSearchParams(endpointRouterMock.mock.calls[0][1].url_params).get("filters")).toBe('{"status":"closed"}');
        expect(getCachedSearchResultForRender("dev_agent_tasks", { query: "shared" }).data).toEqual([{ id: 11 }]);
        expect(document.querySelector('[data-lang-key="search_results_without_filters"]')).toBeNull();
    });

    test("invalid or forbidden filters stop the search without an unfiltered retry", async () => {
        getActiveFiltersSnapshotMock.mockReturnValue({ password: "forbidden" });
        endpointRouterMock.mockRejectedValueOnce(new Error("HTTP400 invalid search filters"));
        const { do_intelligent_search } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "shared");
        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-lang-key="search_results_without_filters"]')).toBeNull();
    });

});


describe("filter fallback notice placement", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        localStorage.clear();
        document.body.replaceChildren();
    });

    test.each(["table", "card", "article_view"])(
        "explains broadened results before the first %s result in its real host",
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
            let sidebarCount;
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
                sidebarCount = document.createElement("div");
                sidebarCount.className = "results_count card_sidebar_results_count";
                sidebarCount.dataset.resultsCountFor = tableName;
                sidebarCount.textContent = "2 results";
                header.append(sidebarCount);
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
            stage.append(aiHost);

            const { insertNotice } = await import("./dataset_search_executor.js");
            const runtime = await import("./dataset_search_runtime_state.js");
            expect(runtime.getSearchViewContainer(tableName)).toBe(viewContainer);
            expect(runtime.getSearchStageContainer(tableName)).toBe(stage);
            if (view !== "table") expect(runtime.getPrimaryCardContainer(tableName)).toBe(primary);

            insertNotice(tableName, "search_results_without_filters", "Showing results without filters.");
            insertNotice(tableName, "search_results_without_filters", "Showing results without filters.");
            const explanation = stage.querySelector('[data-lang-key="search_results_without_filters"]');
            expect(explanation).not.toBeNull();
            expect(stage.firstElementChild).toBe(explanation);
            expect(explanation.getAttribute("role")).toBe("status");
            expect(explanation.compareDocumentPosition(firstResult) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            if (sidebarCount) {
                expect(explanation.compareDocumentPosition(sidebarCount) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            }
            expect(stage.querySelectorAll('[data-lang-key="search_results_without_filters"]')).toHaveLength(1);

            // Ordinary stage messages still divide text hits from AI hits.
            insertNotice(tableName, "ai_search_results", "AI results");
            const stageNotice = stage.querySelector('[data-lang-key="ai_search_results"]');
            expect(primary.compareDocumentPosition(stageNotice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(stageNotice.nextElementSibling).toBe(aiHost);
            expect(stage.firstElementChild).toBe(explanation);

            runtime.removeSearchNotice(tableName, "search_results_without_filters");
            expect(stage.querySelector('[data-lang-key="search_results_without_filters"]')).toBeNull();
            expect(stage.contains(firstResult)).toBe(true);
            expect(stage.contains(stageNotice)).toBe(true);
        },
    );
});
