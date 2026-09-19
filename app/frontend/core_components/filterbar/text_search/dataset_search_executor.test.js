// dataset_search_executor.test.js
// Verifies that a dataset search browses the dataset: its own matches come from
// the ordinary listing with endless scrolling connected, the streamed answer
// contributes only its AI group, and the counter reports the true match count.
// Operates with mocked listing/stream/render dependencies so the executor can be
// verified in isolation under jsdom.
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

/** One answer of the dataset's ordinary listing, as the search now reads it. */
function listingAnswer({ data = [], row_count = data.length, columns = [], types = {} } = {}) {
    return { data, row_count, columns, types };
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
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer());
        endpointRouterMock.mockResolvedValue(createNdjsonStreamResponse([]));
        createTableViewDom("dev_agent_tasks");
    });

    test("routes an explicitly registered surface without listing, stream or cache side effects", async () => {
        const { do_intelligent_search } = await import('./dataset_search_executor.js');
        const { registerDatasetQueryAdapter } = await import('../dataset_surface_provider/dataset_query_adapter_registry.js');
        const refresh = vi.fn(async () => 'board');
        const release = registerDatasetQueryAdapter('extension', { refresh });
        try {
            expect(await do_intelligent_search('extension', ' words ')).toBe('board');
            expect(refresh).toHaveBeenCalledWith({ search: 'words' });
            expect(endpointRouterMock).not.toHaveBeenCalled();
            expect(reloadDatasetRowsFromListingMock).not.toHaveBeenCalled();
            expect(clearRowGroupFacetsMock).not.toHaveBeenCalled();
        } finally { release(); }
    });

    test("takes the dataset's own matches from its listing and leaves endless scrolling connected", async () => {
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ header: "Direct cloud match", id: 14 }, { header: "Second match", id: 15 }],
            row_count: 251,
            columns: ["header", "id"],
        }));

        const { do_intelligent_search, ongoingSearchResults } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "cloud");

        expect(clearRowGroupFacetsMock).toHaveBeenCalledWith("dev_agent_tasks");
        expect(reloadDatasetRowsFromListingMock).toHaveBeenCalledWith(
            "dev_agent_tasks",
            expect.objectContaining({ isCurrent: expect.any(Function) })
        );
        // Switching endless scrolling off was the reason a search could not be
        // browsed past its first rows; nothing may switch it off any more.
        expect(disconnectInfiniteScrollMock).not.toHaveBeenCalled();
        // The listing rendered its own rows, so the search does not print them again.
        expect(appendDataToViewMock).not.toHaveBeenCalled();
        expect(ongoingSearchResults.dev_agent_tasks.data).toEqual([
            { header: "Direct cloud match", id: 14 },
            { header: "Second match", id: 15 },
        ]);
    });

    test("reports the dataset's true number of matches, not the rows that are loaded", async () => {
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: Array.from({ length: 10 }, (_value, index) => ({ id: index + 1 })),
            row_count: 251,
            columns: ["id"],
        }));

        const { do_intelligent_search } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "api");

        expect(setResultsCountMock).toHaveBeenCalledWith("dev_agent_tasks", 251);
        expect(setResultsCountMock).not.toHaveBeenCalledWith("dev_agent_tasks", 10);
    });

    test("keeps only the AI stage of the streamed answer, and shows it after the dataset's rows", async () => {
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ header: "Direct cloud match", id: 14 }],
            row_count: 251,
            columns: ["header", "id"],
        }));
        endpointRouterMock.mockResolvedValue(createNdjsonStreamResponse([
            {
                stage: "text",
                columns: ["header", "id"],
                data: [{ header: "Streamed top-ten repeat", id: 77 }],
                types: {},
            },
            {
                stage: "ai",
                columns: ["header", "id"],
                data: [{ header: "AI-related cloud row", id: 99 }],
                types: {},
            },
        ]));

        const { do_intelligent_search, ongoingSearchResults } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "cloud");

        const cache = ongoingSearchResults.dev_agent_tasks;
        expect(cache.data).toEqual([{ header: "Direct cloud match", id: 14 }]);
        expect(cache.aiData).toEqual([{ header: "AI-related cloud row", id: 99 }]);
        const aiTable = document.getElementById("dev_agent_tasks_search_ai_table");
        expect(aiTable).not.toBeNull();
        expect(appendDataToTableMock).toHaveBeenCalledWith(
            aiTable,
            [{ header: "AI-related cloud row", id: 99 }],
            ["header", "id"],
            {},
            "dev_agent_tasks"
        );
        const seeAlso = document.querySelector('.search-stage-notice[data-lang-key="see_also"]');
        expect(seeAlso).not.toBeNull();
        expect(seeAlso.nextElementSibling).toBe(aiTable);
        expect(document.querySelector('[data-lang-key="text_search_no_results"]')).toBeNull();
    });

    test("counts the AI group beside the dataset's matches instead of replacing them", async () => {
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ id: 14 }], row_count: 251, columns: ["id"],
        }));
        endpointRouterMock.mockResolvedValue(createNdjsonStreamResponse([
            { stage: "ai", columns: ["id"], data: [{ id: 99 }, { id: 100 }], types: {} },
        ]));

        const { do_intelligent_search } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "cloud");

        expect(setSearchAiResultsCountMock).toHaveBeenLastCalledWith("dev_agent_tasks", 2);
        expect(setResultsCountMock).toHaveBeenLastCalledWith("dev_agent_tasks", 251);
    });

    test("says so in the reader's language when the dataset has no matching rows", async () => {
        localStorage.setItem("chosen_language", "fi");
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({ row_count: 0 }));

        const { do_intelligent_search } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "nonsense");

        const notice = document.querySelector('[data-lang-key="text_search_no_results"]');
        expect(notice?.textContent).toBe("Tekstihaku ei löytänyt tuloksia");
        expect(setResultsCountMock).toHaveBeenCalledWith("dev_agent_tasks", 0);
    });

    test("a search with selected filters answers only about rows that match both", async () => {
        getActiveFiltersSnapshotMock.mockReturnValue({ status: "closed" });
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({ row_count: 0 }));

        const { do_intelligent_search } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "shared");

        // One listing question and one streamed question: the selected filters
        // are never quietly dropped to manufacture results the reader did not ask for.
        expect(reloadDatasetRowsFromListingMock).toHaveBeenCalledTimes(1);
        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
        expect(new URLSearchParams(endpointRouterMock.mock.calls[0][1].url_params).get("filters"))
            .toBe('{"status":"closed"}');
        expect(document.querySelector('[data-lang-key="text_search_no_results"]')).not.toBeNull();
    });

    test("requests card support fields for the AI group in card view", async () => {
        createCardViewDom("app_service_catalog");
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ header: "Wikipedia", id: 394 }], row_count: 1, columns: ["header", "id"],
        }));

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
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ header: "Authorized group result", id: 14 }], row_count: 1, columns: ["header", "id"],
        }));

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
            value: new TextEncoder().encode('{"stage":"ai","columns":["id"],"data":[{"id":1}]}\n'),
            done: false,
        });
        await oldSearch;

        expect(oldReader.cancel).toHaveBeenCalledOnce();
        expect(ongoingSearchResults.dev_agent_tasks).toBe(newestCache);
        expect(newestCache.aiData).toEqual([]);
    });

    test("a listing answer that arrives after a newer search never reaches the screen", async () => {
        let releaseOldListing;
        reloadDatasetRowsFromListingMock
            .mockImplementationOnce(() => new Promise((resolve) => { releaseOldListing = resolve; }))
            .mockResolvedValue(listingAnswer({ data: [{ id: 2 }], row_count: 2, columns: ["id"] }));

        const { do_intelligent_search, ongoingSearchResults } = await import("./dataset_search_executor.js");
        const oldSearch = do_intelligent_search("dev_agent_tasks", "old");
        await vi.waitFor(() => expect(releaseOldListing).toBeTypeOf("function"));
        await do_intelligent_search("dev_agent_tasks", "new");
        const newestCache = ongoingSearchResults.dev_agent_tasks;
        releaseOldListing(listingAnswer({ data: [{ id: 1 }], row_count: 999, columns: ["id"] }));
        await oldSearch;

        expect(ongoingSearchResults.dev_agent_tasks).toBe(newestCache);
        expect(newestCache.data).toEqual([{ id: 2 }]);
        expect(setResultsCountMock).not.toHaveBeenCalledWith("dev_agent_tasks", 999);
    });

    test('preserves the renderer and stream metadata for the AI group in article and card view', async () => {
        const tableName = 'app_service_catalog';
        const types = { type_of_operation: { data_type: 'text', is_multilingual: true, card_element: 'description' } };
        const showView = (viewKey) => {
            createCardViewDom(tableName);
            if (viewKey === 'article_view') {
                document.getElementById(tableName + '_card_view_container').id = tableName + '_article_view_container';
            }
            localStorage.setItem(tableName + '_view', viewKey);
        };
        getUnifiedTableStateMock.mockReturnValue({
            cardView: { collapsed: false }, articleView: { collapsed: false },
        });
        appendDataToCardViewMock.mockResolvedValue(undefined);
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ id: 1, type_of_operation: '{"fi":"Ohjelmisto","en":"Software"}' }],
            row_count: 1, columns: ['id', 'type_of_operation'], types,
        }));
        // Each search reads its own stream, so a fresh one is produced per call.
        endpointRouterMock.mockImplementation(() => Promise.resolve(createNdjsonStreamResponse([
            { stage: 'ai', columns: ['id', 'type_of_operation'], types, data: [{ id: 2, type_of_operation: '{"fi":"Peli","en":"Game"}' }] },
        ])));
        const { do_intelligent_search } = await import('./dataset_search_executor.js');

        for (const viewKey of ['article_view', 'card']) {
            appendDataToCardViewMock.mockClear();
            showView(viewKey);
            await do_intelligent_search(tableName, 'kanto');
            expect(appendDataToCardViewMock).toHaveBeenCalled();
            for (const call of appendDataToCardViewMock.mock.calls) {
                expect(call[4]).toEqual({ viewKey, dataTypes: types });
            }
        }
    });

    test("does not commit AI cards built by a search replaced during asynchronous rendering", async () => {
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
                    { stage: "ai", columns: ["id", "title"], data: [{ id: 7, title: "Old result" }], types: {} },
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

    test("exposes the search's rows and its true match count as one renderable dataset result", async () => {
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ id: 7, title: "Firefox" }], row_count: 251, columns: ["id", "title"],
            types: { id: "integer", title: "text" },
        }));
        endpointRouterMock.mockResolvedValue(createNdjsonStreamResponse([
            { stage: "ai", columns: ["id", "title"], data: [{ id: 9, title: "Fennec" }], types: {} },
        ]));

        const { do_intelligent_search, getCachedSearchResultForRender } = await import("./dataset_search_executor.js");
        await do_intelligent_search("app_service_catalog", "browser");

        expect(getCachedSearchResultForRender("app_service_catalog")).toMatchObject({
            columns: ["id", "title"],
            data: [
                { id: 7, title: "Firefox" },
                { id: 9, title: "Fennec" },
            ],
            types: { id: "integer", title: "text" },
            row_count: 251,
            complete: true,
        });
    });

    test("asks the listing again when the selected filters change during a search", async () => {
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ id: 1, status: "open" }], row_count: 1, columns: ["id", "status"],
        }));
        const { do_intelligent_search, rerenderCachedSearchResults } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "cloud");
        expect(reloadDatasetRowsFromListingMock).toHaveBeenCalledTimes(1);

        getActiveFiltersSnapshotMock.mockReturnValue({ status: "closed" });
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ id: 2, status: "closed" }], row_count: 1, columns: ["id", "status"],
        }));
        await rerenderCachedSearchResults("dev_agent_tasks");

        expect(reloadDatasetRowsFromListingMock).toHaveBeenCalledTimes(2);
        const { ongoingSearchResults } = await import("./dataset_search_executor.js");
        expect(ongoingSearchResults.dev_agent_tasks.data).toEqual([{ id: 2, status: "closed" }]);
    });

    test("a changed sort order asks the server to order every match, not the loaded page", async () => {
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ id: 9 }, { id: 2 }], row_count: 2, columns: ["id"], types: { id: "integer" },
        }));
        const { do_intelligent_search, sortCachedSearchResults } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "ranked");
        expect(reloadDatasetRowsFromListingMock).toHaveBeenCalledTimes(1);

        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ id: 2 }, { id: 9 }], row_count: 2, columns: ["id"], types: { id: "integer" },
        }));
        expect(await sortCachedSearchResults("dev_agent_tasks", { sortColumn: "id", sortOrder: "ASC" })).toBe(true);

        expect(reloadDatasetRowsFromListingMock).toHaveBeenCalledTimes(2);
        const { ongoingSearchResults } = await import("./dataset_search_executor.js");
        expect(ongoingSearchResults.dev_agent_tasks.data.map((row) => row.id)).toEqual([2, 9]);
    });

    test("opens the dataset's first matching row when the article view is waiting for it", async () => {
        createCardViewDom("app_service_catalog");
        getUnifiedTableStateMock.mockReturnValue({
            cardView: {
                collapsed: true,
                expandedId: null,
                pendingAutoOpenFirstSearchResult: true,
            },
        });
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ id: 7, title: "Firefox" }], row_count: 3, columns: ["id", "title"],
        }));

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

    test("asking the same question again leaves an open article where the reader left it", async () => {
        createCardViewDom("app_service_catalog");
        getUnifiedTableStateMock.mockReturnValue({
            cardView: { collapsed: true, expandedId: 12 },
        });
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ id: 7 }], row_count: 5, columns: ["id"],
        }));

        const { do_intelligent_search, rerenderCachedSearchResults } = await import("./dataset_search_executor.js");
        await do_intelligent_search("app_service_catalog", "firefox");
        setUnifiedTableStateMock.mockClear();

        // A changed filter or sort asks the same question again; only a new
        // question sends the reader back to the first result.
        await rerenderCachedSearchResults("app_service_catalog");

        expect(reloadDatasetRowsFromListingMock).toHaveBeenCalledTimes(2);
        expect(setUnifiedTableStateMock).not.toHaveBeenCalled();
        expect(openRowArticleViewMock).not.toHaveBeenCalled();
    });

    test("does not open an article when the dataset itself has no matching row", async () => {
        createCardViewDom("app_service_catalog");
        getUnifiedTableStateMock.mockReturnValue({
            cardView: { collapsed: true, expandedId: null, pendingAutoOpenFirstSearchResult: true },
        });
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({ row_count: 0 }));
        endpointRouterMock.mockResolvedValue(createNdjsonStreamResponse([
            { stage: "ai", columns: ["id"], data: [{ id: 77 }], types: {} },
        ]));

        const { do_intelligent_search } = await import("./dataset_search_executor.js");
        await do_intelligent_search("app_service_catalog", "absent");

        expect(openRowArticleViewMock).not.toHaveBeenCalled();
        expect(document.querySelector('[data-lang-key="text_search_no_results"]')).not.toBeNull();
    });

    test("a failing AI stream leaves the dataset's own matches on screen", async () => {
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ id: 11 }], row_count: 251, columns: ["id"],
        }));
        endpointRouterMock.mockRejectedValueOnce(new Error("HTTP500 embedding service unavailable"));

        const { do_intelligent_search, ongoingSearchResults } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "shared");

        expect(ongoingSearchResults.dev_agent_tasks.data).toEqual([{ id: 11 }]);
        expect(setResultsCountMock).toHaveBeenCalledWith("dev_agent_tasks", 251);
        expect(document.querySelector('[data-lang-key="text_search_no_results"]')).toBeNull();
    });
});


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
            stage.append(aiHost);

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
