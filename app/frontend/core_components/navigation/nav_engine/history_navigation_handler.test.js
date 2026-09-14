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

const ifavHistory = vi.hoisted(() => ({ handle: vi.fn(async () => false) }));
vi.mock("./image_first_view_history.js", () => ({ handleImageFirstViewHistory: ifavHistory.handle }));

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
        articleView: {
            collapsed: false,
            expandedId: null,
        },
    },
    setUnifiedTableState: setUnifiedTableStateMock,
    invalidateTableRefresh: vi.fn(),
}));

vi.mock("../../table_views/card_view/row_article_ui_handler.js", () => ({
    closeBigCard: closeBigCardMock,
}));

vi.mock("../../table_views/dataset_view_registry.js", () => ({
    ARTICLE_VIEW_KEY: "article_view",
    resolveDatasetViewSelectionTarget: (viewKey) => (
        viewKey === "article" ? "article_view" : viewKey
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
        ifavHistory.handle.mockResolvedValue(false);
        closeBigCardMock.mockClear();
        vi.mocked(canRestoreCardArticleReturn).mockReturnValue(false);
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
            articleView: {
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
                isCurrentNavigation: expect.any(Function),
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
            articleView: {
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
                isCurrentNavigation: expect.any(Function),
            });
        });

        expect(setParamsMock).toHaveBeenCalledWith("events", {
            search: "firefox",
            view: "table",
        });
        expect(localStorage.getItem("events_view")).toBe("table");
        expect(setUnifiedTableStateMock).toHaveBeenCalledWith("events", {
            articleView: {
                collapsed: false,
                expandedId: null,
                pendingAutoOpenFirstRenderedResult: false,
                pendingAutoOpenFirstSearchResult: false,
            },
        });
    });
    test("Back defers article teardown until the permission-gated mounted commit", async () => {
        canRestoreCardArticleReturn.mockReturnValue(true);
        document.body.innerHTML = '<div id="events_article_view_container"><div class="card_view_wrapper big-card-open"><div class="card_container"></div><article class="active_row_article"></article></div></div>';
        window.dispatchEvent(new PopStateEvent("popstate"));
        await vi.waitFor(() => expect(handleAllNavigationMock).toHaveBeenCalledOnce());
        expect(closeBigCardMock).not.toHaveBeenCalled();
        const options = handleAllNavigationMock.mock.calls[0][2];
        expect(options.restoreMountedView.isCurrent()).toBe(true);
        options.restoreMountedView.commit();
        expect(closeBigCardMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), null, "events", true, { restoreScroll: false });
        expect(restoreCardArticleReturn).toHaveBeenCalledWith("events");
    });


    test.each(["card", "table", "calendar"])("repairs an old collection-article return to its recorded %s view", async (returnView) => {
        tableStates.set("events", { articleView: { collapsed: true, expandedId: 7, returnView } });
        parseTableQueryStringMock.mockReturnValue({ filters: {}, sort: {}, offset: 0, view: "article_view", search: "harbour" });
        document.body.innerHTML = '<div id="events_container"><div class="tab_parts_container" data-view="article_view"></div><div class="card_view_wrapper big-card-open" data-table-name="events"><div class="card_container"></div><article class="active_row_article"></article></div></div>';
        history.replaceState({ __filterestEntryId: "old-return", unrelated: "keep" }, "", "/events?view=article_view&search=harbour");
        window.dispatchEvent(new PopStateEvent("popstate"));
        await vi.waitFor(() => expect(handleAllNavigationMock).toHaveBeenCalledOnce());
        expect(localStorage.getItem("events_view")).toBe(returnView);
        expect(handleAllNavigationMock.mock.calls[0][2].forceReload).toBe(true);
        expect(new URL(location.href).searchParams.get("view")).toBe(returnView);
        expect(new URL(location.href).searchParams.get("search")).toBe("harbour");
        expect(history.state).toMatchObject({ __filterestEntryId: "old-return", unrelated: "keep" });
    });


    test("an old collection return records the effective permission fallback view", async () => {
        tableStates.set("events", { articleView: { collapsed: true, expandedId: 7, returnView: "calendar" } });
        parseTableQueryStringMock.mockReturnValue({ filters: {}, sort: {}, offset: 0, view: "article_view", search: "harbour" });
        document.body.innerHTML = '<div class="card_view_wrapper big-card-open" data-table-name="events"><div class="card_container"></div><article class="active_row_article"></article></div>';
        history.replaceState({}, "", "/events?view=article_view&search=harbour");
        handleAllNavigationMock.mockImplementationOnce(async () => {
            localStorage.setItem("events_view", "card");
            return {};
        });
        window.dispatchEvent(new PopStateEvent("popstate"));
        await vi.waitFor(() => expect(new URL(location.href).searchParams.get("view")).toBe("card"));
        expect(setParamsMock).toHaveBeenLastCalledWith("events", { view: "card", search: "harbour" });
    });

    test("a collection article without a recorded return stays an article, not an invented card default", async () => {
        tableStates.set("events", { articleView: { collapsed: true, expandedId: 7 } });
        parseTableQueryStringMock.mockReturnValue({ filters: {}, sort: {}, offset: 0, view: "article_view" });
        document.body.innerHTML = '<div class="card_view_wrapper big-card-open" data-table-name="events"><div class="card_container"></div><article class="active_row_article"></article></div>';
        history.replaceState({}, "", "/events?view=article_view");
        window.dispatchEvent(new PopStateEvent("popstate"));
        await vi.waitFor(() => expect(handleAllNavigationMock).toHaveBeenCalledOnce());
        expect(localStorage.getItem("events_view")).toBe("article_view");
        expect(location.search).toBe("?view=article_view");
        expect(handleAllNavigationMock.mock.calls[0][2].forceReload).toBe(true);
    });

    test("an old collection return cannot replace a newer Forward URL after navigation awaits", async () => {
        let resolve;
        handleAllNavigationMock.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        tableStates.set("events", { articleView: { collapsed: true, expandedId: 7, returnView: "card" } });
        parseTableQueryStringMock.mockReturnValue({ filters: {}, sort: {}, offset: 0, view: "article_view" });
        document.body.innerHTML = '<div class="card_view_wrapper big-card-open" data-table-name="events"><div class="card_container"></div><article class="active_row_article"></article></div>';
        history.replaceState({ __filterestEntryId: "old" }, "", "/events?view=article_view");
        window.dispatchEvent(new PopStateEvent("popstate"));
        await vi.waitFor(() => expect(handleAllNavigationMock).toHaveBeenCalledOnce());
        history.replaceState({ __filterestEntryId: "new" }, "", "/events/9?view=article_view");
        resolve({});
        await new Promise(done => setTimeout(done, 0));
        expect(location.pathname).toBe("/events/9");
        expect(history.state.__filterestEntryId).toBe("new");
    });

    test("history intent checks both entry identity and full URL independently of cache eligibility", async () => {
        canRestoreCardArticleReturn.mockReturnValue(true);
        history.replaceState({ __filterestEntryId: "back-entry" }, "", "/events?search=harbour&view=card");
        window.dispatchEvent(new PopStateEvent("popstate"));
        await vi.waitFor(() => expect(handleAllNavigationMock).toHaveBeenCalledOnce());
        const { isCurrentNavigation } = handleAllNavigationMock.mock.calls[0][2];
        expect(isCurrentNavigation()).toBe(true);
        history.replaceState({ __filterestEntryId: "forward-entry" }, "", "/events?search=harbour&view=card");
        expect(isCurrentNavigation()).toBe(false);
        history.replaceState({ __filterestEntryId: "back-entry" }, "", "/events/3?search=harbour&view=article_view");
        expect(isCurrentNavigation()).toBe(false);
    });

    test.each(["card", "table"])("Back to a no-view %s entry restores its own renderer, not the latest preference", async view => {
        parseTableQueryStringMock.mockReturnValue({ filters: {}, sort: {}, offset: 0 });
        document.body.innerHTML = '<div id="events_container"><div class="tab_parts_container" data-view="calendar"></div></div>';
        localStorage.setItem("events_view", "calendar");
        history.replaceState({ __filterestEntryId: "origin", __filterestDatasetView: { dataset: "events", path: "/events", view } }, "", "/events");
        window.dispatchEvent(new PopStateEvent("popstate"));
        await vi.waitFor(() => expect(handleAllNavigationMock).toHaveBeenCalledOnce());
        expect(localStorage.getItem("events_view")).toBe(view);
        expect(handleAllNavigationMock.mock.calls[0][2].forceReload).toBe(true);
        expect(location.pathname + location.search).toBe("/events");
    });

    test("explicit URL view takes precedence and Forward reloads a different rendered view", async () => {
        parseTableQueryStringMock.mockReturnValue({ filters: {}, sort: {}, offset: 0, view: "calendar" });
        document.body.innerHTML = '<div id="events_container"><div class="tab_parts_container" data-view="card"></div></div>';
        history.replaceState({ __filterestDatasetView: { dataset: "events", path: "/events", view: "table" } }, "", "/events?view=calendar");
        window.dispatchEvent(new PopStateEvent("popstate"));
        await vi.waitFor(() => expect(handleAllNavigationMock).toHaveBeenCalledOnce());
        expect(localStorage.getItem("events_view")).toBe("calendar");
        expect(handleAllNavigationMock.mock.calls[0][2].forceReload).toBe(true);
    });

    test.each(["other dataset", "other path", "same renderer"])("%s entry metadata does not force an unrelated reload or card default", async reason => {
        parseTableQueryStringMock.mockReturnValue({ filters: {}, sort: {}, offset: 0 });
        document.body.innerHTML = '<div id="events_container"><div class="tab_parts_container" data-view="table"></div></div>';
        localStorage.setItem("events_view", "table");
        history.replaceState({ __filterestDatasetView: { dataset: reason === "other dataset" ? "other" : "events", path: reason === "other path" ? "/admin/events" : "/events", view: "table" } }, "", "/events");
        window.dispatchEvent(new PopStateEvent("popstate"));
        await vi.waitFor(() => expect(handleAllNavigationMock).toHaveBeenCalledOnce());
        expect(localStorage.getItem("events_view")).toBe("table");
        expect(handleAllNavigationMock.mock.calls[0][2].forceReload).toBe(false);
    });

});

vi.mock("./card_article_return_state.js", () => ({ canRestoreCardArticleReturn: vi.fn(() => false), restoreCardArticleReturn: vi.fn(() => true), getCardArticleReturnToken: vi.fn(() => null), refreshCardArticleReturnViewport: vi.fn() }));

import { canRestoreCardArticleReturn, restoreCardArticleReturn } from "./card_article_return_state.js";

test("the shared history handler does not navigate the background when IFAV owns the transition", async () => {
    vi.clearAllMocks();
    ifavHistory.handle.mockResolvedValue(true);
    history.replaceState({}, "", "/events/5?view=image_first_view");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(ifavHistory.handle).toHaveBeenCalledWith(expect.objectContaining({ tableName: "events", rowId: "5" }));
    expect(handleAllNavigationMock).not.toHaveBeenCalled();
    ifavHistory.handle.mockResolvedValue(false);
});
