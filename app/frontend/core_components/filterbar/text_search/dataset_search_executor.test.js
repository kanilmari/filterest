// dataset_search_executor.test.js
// Verifies that a dataset search browses the dataset: its own matches come from
// the ordinary listing with endless scrolling connected, the counter reports the
// true match count, and a changed filter, sort or newer search asks again.
// Operates with the shared mocked listing/stream/render setup under jsdom.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
    appendDataToViewMock,
    clearRowGroupFacetsMock,
    disconnectInfiniteScrollMock,
    endpointRouterMock,
    getActiveFiltersSnapshotMock,
    listingAnswer,
    reloadDatasetRowsFromListingMock,
    setResultsCountMock,
    resetDatasetSearchTest,
} from "./dataset_search_executor_test_setup.js";

describe("do_intelligent_search browses the dataset", () => {
    beforeEach(() => {
        resetDatasetSearchTest();
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

    test("withdraws the old dataset total before other-dataset searches can appear", async () => {
        document.getElementById("dev_agent_tasks_results_count").textContent = "3 results";
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ id: 14 }], row_count: 1, columns: ["id"],
        }));

        const { do_intelligent_search } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "claude");

        expect(setResultsCountMock.mock.calls[0]).toEqual(["dev_agent_tasks", 0]);
        expect(setResultsCountMock).toHaveBeenLastCalledWith("dev_agent_tasks", 1);
    });

    test("coalesces identical URL searches from synchronized panel instances", async () => {
        let releaseListing;
        reloadDatasetRowsFromListingMock.mockImplementation(() => new Promise(resolve => {
            releaseListing = resolve;
        }));

        const { do_intelligent_search } = await import("./dataset_search_executor.js");
        const firstSearch = do_intelligent_search("dev_agent_tasks", "claude", { useLocation: false });
        const repeatedSearch = do_intelligent_search("dev_agent_tasks", "claude", { useLocation: false });
        await vi.waitFor(() => expect(releaseListing).toBeTypeOf("function"));

        expect(reloadDatasetRowsFromListingMock).toHaveBeenCalledTimes(1);
        releaseListing(listingAnswer({ data: [{ id: 14 }], row_count: 1, columns: ["id"] }));
        await Promise.all([firstSearch, repeatedSearch]);
        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
        expect(setResultsCountMock).toHaveBeenLastCalledWith("dev_agent_tasks", 1);
    });

    test("retries once when the route's first article build invalidates the listing reload", async () => {
        reloadDatasetRowsFromListingMock
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(listingAnswer({
                data: [{ id: 1, header: "Claude.ai Max 5x monthly" }],
                row_count: 1,
                columns: ["id", "header"],
            }));

        const { do_intelligent_search, ongoingSearchResults } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "claude");

        expect(reloadDatasetRowsFromListingMock).toHaveBeenCalledTimes(2);
        expect(ongoingSearchResults.dev_agent_tasks.data).toEqual([
            { id: 1, header: "Claude.ai Max 5x monthly" },
        ]);
        expect(setResultsCountMock).toHaveBeenLastCalledWith("dev_agent_tasks", 1);
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
