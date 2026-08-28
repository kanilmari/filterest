// @vitest-environment jsdom
// history_navigation_handler.test.js
// Verifies browser-history restoration around row article URLs.
// Bridges mocked navigation state with the real popstate listener side effects.
// Exists to keep article-close history from losing the originating dataset view.

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    closeBigCardMock,
    handleAllNavigationMock,
    parseTableQueryStringMock,
    setParamsMock,
    setUnifiedTableStateMock,
    tableStates,
} = vi.hoisted(() => ({
    closeBigCardMock: vi.fn(),
    handleAllNavigationMock: vi.fn(),
    parseTableQueryStringMock: vi.fn(() => ({
        filters: {},
        sort: { column: null, direction: null },
        offset: 0,
    })),
    setParamsMock: vi.fn(),
    setUnifiedTableStateMock: vi.fn(),
    tableStates: new Map(),
}));

vi.mock("../admin_and_user_tools/custom_view_reader.js", () => ({
    custom_views: [],
}));

vi.mock("./query_params.js", () => ({
    DATASET_PREFIX: "/",
    parseTableQueryString: parseTableQueryStringMock,
    setParams: setParamsMock,
}));

vi.mock("./navigation_handler.js", () => ({
    handle_all_navigation: handleAllNavigationMock,
}));

vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    getUnifiedTableState: (tableName) => tableStates.get(tableName) || {
        cardView: {
            collapsed: false,
            expandedId: null,
        },
    },
    setUnifiedTableState: setUnifiedTableStateMock,
}));

vi.mock("../../table_views/card_view/row_article_ui_handler.js", () => ({
    closeBigCard: closeBigCardMock,
}));

vi.mock("../../table_views/dataset_view_registry.js", () => ({
    ARTICLE_VIEW_KEY: "article",
    resolveDatasetViewSelectionTarget: (viewKey) => (
        viewKey === "article" ? "card" : viewKey
    ),
}));

vi.mock("./history_navigation_handler_helpers.js", () => ({
    buildParamsFromParsed: (parsed) => ({
        ...(parsed.filters || {}),
        ...(parsed.search ? { search: parsed.search } : {}),
        ...(parsed.view ? { view: parsed.view } : {}),
    }),
    getPrefixFromPathname: (pathname, datasetPrefix) => (
        pathname === "/" || pathname.startsWith("/api/") || pathname.startsWith("/frontend/")
            ? null
            : datasetPrefix
    ),
    isDatasetBasePath: (pathname, datasetPrefix, expectedDatasetName) => (
        pathname === `${datasetPrefix}${expectedDatasetName}`
    ),
    parseDeepLink: (name) => {
        const [datasetName, rowPath] = name.split("/");
        return {
            name: datasetName,
            deepLinkedRowId: rowPath ? rowPath.split("-")[0] : null,
        };
    },
}));

await import("./history_navigation_handler.js");

describe("history_navigation_handler", () => {
    beforeEach(() => {
        closeBigCardMock.mockClear();
        handleAllNavigationMock.mockClear();
        parseTableQueryStringMock.mockClear();
        setParamsMock.mockClear();
        setUnifiedTableStateMock.mockClear();
        tableStates.clear();
        localStorage.clear();
        document.body.innerHTML = "";
        window.__bigCardClosing = false;
        window.history.replaceState({}, "", "/events");
    });

    test("restores calendar view when browser Back closes a calendar-opened article", async () => {
        tableStates.set("events", {
            cardView: {
                collapsed: true,
                expandedId: 7,
                returnView: "calendar",
            },
        });
        localStorage.setItem("events_view", "card");
        document.body.innerHTML = `
            <div class="card_view_wrapper big-card-open" data-table-name="events">
                <div class="card_container"></div>
                <article class="active_row_article"></article>
            </div>
        `;

        window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));

        await vi.waitFor(() => {
            expect(handleAllNavigationMock).toHaveBeenCalledWith("events", [], {
                skipUrlUpdate: true,
                forceReload: true,
            });
        });

        const wrapper = document.querySelector(".card_view_wrapper");
        const cardContainer = document.querySelector(".card_container");
        const activeArticle = document.querySelector(".active_row_article");
        expect(closeBigCardMock).toHaveBeenCalledWith(
            wrapper,
            cardContainer,
            activeArticle,
            null,
            "events",
            true
        );
        expect(localStorage.getItem("events_view")).toBe("calendar");
        expect(setUnifiedTableStateMock).toHaveBeenCalledWith("events", {
            cardView: {
                collapsed: false,
                expandedId: null,
                returnView: null,
            },
        });
    });

    test("browser Back from an article restores the previous URL view and search", async () => {
        parseTableQueryStringMock.mockReturnValue({
            filters: {},
            sort: { column: null, direction: null },
            offset: 0,
            search: "firefox",
            view: "table",
        });
        localStorage.setItem("events_view", "card");
        document.body.innerHTML = `
            <div class="card_view_wrapper big-card-open" data-table-name="events">
                <div class="card_container"></div>
                <article class="active_row_article"></article>
            </div>
        `;
        window.history.replaceState({}, "", "/events?search=firefox&view=table");

        window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));

        await vi.waitFor(() => {
            expect(handleAllNavigationMock).toHaveBeenCalledWith("events", [], {
                skipUrlUpdate: true,
                forceReload: true,
            });
        });

        expect(setParamsMock).toHaveBeenCalledWith("events", {
            search: "firefox",
            view: "table",
        });
        expect(localStorage.getItem("events_view")).toBe("table");
        expect(setUnifiedTableStateMock).toHaveBeenCalledWith("events", {
            cardView: {
                collapsed: false,
                expandedId: null,
                pendingAutoOpenFirstRenderedResult: false,
                pendingAutoOpenFirstSearchResult: false,
            },
        });
    });
});
