// dataset_search_first_match.test.js
// Verifies which article a search opens: the first row of the searched listing
// when the card or article view is waiting for one, never an AI suggestion, and
// nothing when the reader already has an article open or there is no match.
// Operates with the shared mocked listing/stream/render setup under jsdom.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from "vitest";
import {
    createCardViewDom,
    createNdjsonStreamResponse,
    endpointRouterMock,
    getUnifiedTableStateMock,
    listingAnswer,
    openRowArticleViewMock,
    reloadDatasetRowsFromListingMock,
    setUnifiedTableStateMock,
    resetDatasetSearchTest,
} from "./dataset_search_executor_test_setup.js";

describe("dataset search first match", () => {
    beforeEach(() => {
        resetDatasetSearchTest();
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
                pendingAutoOpenFirstRenderedResult: false,
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

    test("the first match is the listing's first row, never an AI suggestion", async () => {
        createCardViewDom("app_service_catalog");
        getUnifiedTableStateMock.mockReturnValue({
            cardView: { collapsed: true, expandedId: null, pendingAutoOpenFirstSearchResult: true },
        });
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({ row_count: 0 }));
        endpointRouterMock.mockResolvedValue(createNdjsonStreamResponse([
            { stage: "ai", columns: ["id"], data: [{ id: 77 }], types: {} },
        ]));

        const { do_intelligent_search, getSearchGroupsForViewRebuild } = await import("./dataset_search_executor.js");
        await do_intelligent_search("app_service_catalog", "absent");
        createCardViewDom("app_service_catalog");
        await getSearchGroupsForViewRebuild("app_service_catalog", { query: "absent" }).place();

        expect(setUnifiedTableStateMock).not.toHaveBeenCalledWith("app_service_catalog", expect.objectContaining({
            cardView: expect.objectContaining({ expandedId: 77 }),
        }));
        expect(openRowArticleViewMock).not.toHaveBeenCalled();
    });
});
