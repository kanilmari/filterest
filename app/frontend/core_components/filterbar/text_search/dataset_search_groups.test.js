// dataset_search_groups.test.js
// Verifies where a search puts what it alone owns: the AI group under its notice,
// the notice for a search without matches, and the other datasets last, both on
// the first run and when a view is rebuilt around the searched listing.
// Operates with the shared mocked listing/stream/render setup under jsdom.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
    appendDataToCardViewMock,
    appendDataToTableMock,
    appendDataToViewMock,
    createCardViewDom,
    createNdjsonStreamResponse,
    createTableViewDom,
    endpointRouterMock,
    getUnifiedTableStateMock,
    listingAnswer,
    reloadDatasetRowsFromListingMock,
    setResultsCountMock,
    setSearchAiResultsCountMock,
    resetDatasetSearchTest,
} from "./dataset_search_executor_test_setup.js";

describe("dataset search groups", () => {
    beforeEach(() => {
        resetDatasetSearchTest();
    });

    test("keeps an article-view dataset match before other datasets in the same scroll flow", async () => {
        const tableName = "subscriptions";
        createCardViewDom(tableName, "article_view");
        getUnifiedTableStateMock.mockReturnValue({
            articleView: { collapsed: false, expandedId: 1 },
        });
        reloadDatasetRowsFromListingMock.mockImplementation(async () => {
            const card = document.createElement("article");
            card.className = "card small-card";
            card.dataset.id = "1";
            card.textContent = "Claude.ai Max 5x monthly";
            document.querySelector(`#${tableName}_article_view_container .card_container`)
                .replaceChildren(card);
            return listingAnswer({ data: [{ id: 1 }], row_count: 1, columns: ["id"] });
        });

        const { do_intelligent_search } = await import("./dataset_search_executor.js");
        await do_intelligent_search(tableName, "claude");

        const resultsFlow = document.querySelector(
            `#${tableName}_article_view_container .card_container`
        );
        const match = resultsFlow.querySelector('.card[data-id="1"]');
        const supplemental = resultsFlow.querySelector('.supplemental-dataset-results');
        expect(match?.textContent).toContain("Claude.ai Max 5x monthly");
        expect(supplemental?.parentElement).toBe(resultsFlow);
        expect(match.compareDocumentPosition(supplemental) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
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

    test("keeps an AI row that only shares a title with one of the dataset's matches", async () => {
        // The server leaves out every row the listing shows, so the browser no
        // longer compares titles, which hid different rows that shared one.
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ header: "Weekly report", id: 14 }], row_count: 1, columns: ["header", "id"],
        }));
        endpointRouterMock.mockResolvedValue(createNdjsonStreamResponse([
            { stage: "ai", columns: ["header", "id"], data: [
                { header: "Weekly report", id: 99 },
                { header: "Weekly report", id: 99 },
            ], types: {} },
        ]));

        const { do_intelligent_search, ongoingSearchResults } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "report");

        // The same row twice in one answer is still one suggestion.
        expect(ongoingSearchResults.dev_agent_tasks.aiData).toEqual([{ header: "Weekly report", id: 99 }]);
        expect(appendDataToTableMock).toHaveBeenCalledWith(
            document.getElementById("dev_agent_tasks_search_ai_table"),
            [{ header: "Weekly report", id: 99 }],
            ["header", "id"],
            {},
            "dev_agent_tasks"
        );
    });

    test("a view with no place for a separate group never mixes AI rows into the dataset's own list", async () => {
        document.body.innerHTML = '<div id="dev_agent_tasks_normal_view_container"></div>';
        localStorage.setItem("dev_agent_tasks_view", "normal");
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ id: 14 }], row_count: 1, columns: ["id"],
        }));
        endpointRouterMock.mockResolvedValue(createNdjsonStreamResponse([
            { stage: "ai", columns: ["id"], data: [{ id: 99 }], types: {} },
        ]));

        const { do_intelligent_search } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "cloud");

        expect(appendDataToViewMock).not.toHaveBeenCalled();
        expect(appendDataToTableMock).not.toHaveBeenCalled();
        expect(appendDataToCardViewMock).not.toHaveBeenCalled();
        expect(document.querySelector('[data-lang-key="see_also"]')).toBeNull();
        // The counter never mentions AI rows the page does not show.
        expect(setSearchAiResultsCountMock.mock.calls.filter(([, count]) => count > 0)).toEqual([]);
        expect(setResultsCountMock).toHaveBeenLastCalledWith("dev_agent_tasks", 1);
    });

    test("a view switch places the AI group again from the answer the search already has", async () => {
        const tableName = "dev_agent_tasks";
        appendDataToCardViewMock.mockImplementationOnce(async (host, _columns, rows) => {
            rows.forEach((row) => {
                const card = document.createElement("article");
                card.className = "card";
                card.dataset.id = String(row.id);
                host.appendChild(card);
            });
        });
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({
            data: [{ header: "Direct cloud match", id: 14 }], row_count: 251, columns: ["header", "id"],
        }));
        endpointRouterMock.mockResolvedValue(createNdjsonStreamResponse([
            { stage: "ai", columns: ["header", "id"], data: [{ header: "AI-related cloud row", id: 99 }], types: {} },
        ]));
        const { do_intelligent_search, getSearchGroupsForViewRebuild } = await import("./dataset_search_executor.js");
        await do_intelligent_search(tableName, "cloud");
        reloadDatasetRowsFromListingMock.mockClear();
        endpointRouterMock.mockClear();

        // The reader switches from the table to cards: the rebuild replaces every
        // view container and the listing has already shown the dataset's rows.
        createCardViewDom(tableName);
        const groups = getSearchGroupsForViewRebuild(tableName, { query: "cloud" });
        expect(groups.isCurrent()).toBe(true);
        expect(await groups.place()).toBe(true);

        const resultsFlow = document.querySelector(`#${tableName}_card_view_container .card_container`);
        const aiHost = resultsFlow.querySelector(`#${tableName}_search_ai_cards`);
        expect(aiHost?.querySelector('.card[data-id="99"]')).not.toBeNull();
        const seeAlso = resultsFlow.querySelector('.search-stage-notice[data-lang-key="see_also"]');
        expect(seeAlso?.nextElementSibling).toBe(aiHost);
        // The other datasets stay last in the same scroll flow.
        expect(resultsFlow.lastElementChild?.classList.contains("supplemental-dataset-results")).toBe(true);
        expect(setSearchAiResultsCountMock).toHaveBeenLastCalledWith(tableName, 1);
        // Nothing is asked again: the listing pages the dataset's rows and the
        // AI answer is the one the search already received.
        expect(reloadDatasetRowsFromListingMock).not.toHaveBeenCalled();
        expect(endpointRouterMock).not.toHaveBeenCalled();
    });

    test("a view switch keeps saying so when the dataset has no matching rows", async () => {
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({ row_count: 0 }));
        const { do_intelligent_search, getSearchGroupsForViewRebuild } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "absent");

        createTableViewDom("dev_agent_tasks");
        expect(document.querySelector('[data-lang-key="text_search_no_results"]')).toBeNull();
        await getSearchGroupsForViewRebuild("dev_agent_tasks", { query: "absent" }).place();

        expect(document.querySelector('[data-lang-key="text_search_no_results"]')).not.toBeNull();
    });

    test("a replaced search's view-rebuild handle is inert", async () => {
        reloadDatasetRowsFromListingMock.mockResolvedValue(listingAnswer({ data: [{ id: 1 }], row_count: 1, columns: ["id"] }));
        endpointRouterMock.mockImplementation(() => Promise.resolve(createNdjsonStreamResponse([
            { stage: "ai", columns: ["id"], data: [{ id: 99 }], types: {} },
        ])));
        const { do_intelligent_search, getSearchGroupsForViewRebuild } = await import("./dataset_search_executor.js");
        await do_intelligent_search("dev_agent_tasks", "old");
        const oldGroups = getSearchGroupsForViewRebuild("dev_agent_tasks", { query: "old" });
        await do_intelligent_search("dev_agent_tasks", "new");

        createTableViewDom("dev_agent_tasks");
        expect(oldGroups.isCurrent()).toBe(false);
        expect(await oldGroups.place()).toBe(false);
        expect(document.getElementById("dev_agent_tasks_search_ai_table")).toBeNull();
        expect(getSearchGroupsForViewRebuild("dev_agent_tasks", { query: "old" })).toBeNull();
    });
});
