// @vitest-environment jsdom
// table_loader_handler.test.js
// Verifies startup routing decisions around deep-linked dataset rows.
// Bridges URL parsing with tab opening so row links do not pollute browser history.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createNavigationButtons: vi.fn(),
    ensurePrivateCustomViewsLoaded: vi.fn(() => Promise.resolve()),
    endpointRouter: vi.fn(),
    openNavTab: vi.fn(() => Promise.resolve()),
    openFrontPage: vi.fn(() => Promise.resolve()),
    countThisFunction: vi.fn(),
    primeDatasetAccessRegistry: vi.fn(() => true),
    beginDatasetAccessRefresh: vi.fn(() => 1),
    isCurrentDatasetAccessRefresh: vi.fn(() => true),
    setUnifiedTableState: vi.fn(),
    setRedirectNotice: vi.fn(),
    clearDatasetSelectionState: vi.fn(),
    setSelectedDataset: vi.fn(),
    getSelectedDataset: vi.fn(() => null),
}));

vi.mock("../../front_page/front_page_navigation.js", () => ({
    isSeparateFrontPageEnabled: () => localStorage.getItem('separate_front_page') === 'true',
    openFrontPage: mocks.openFrontPage,
}));

const ifav = vi.hoisted(() => ({ restore: vi.fn(async () => true) }));
vi.mock("../../navigation/nav_engine/image_first_view_history.js", () => ({
    isImageFirstViewURL: () => new URL(location.href).searchParams.get("view") === "image_first_view",
    getImageFirstViewBackingView: () => "card",
    handleImageFirstViewHistory: ifav.restore,
}));

vi.mock("../../navigation/database_tree/nav_builder.js", () => ({
    create_navigation_buttons: mocks.createNavigationButtons,
}));

vi.mock("../../navigation/admin_and_user_tools/custom_view_reader.js", () => ({
    custom_views: [{ name: "front_page", navigationHidden: true }],
    ensure_private_custom_views_loaded: mocks.ensurePrivateCustomViewsLoaded,
}));

vi.mock("../../navigation/main_tabs/main_tab_printer.js", () => ({
    openNavTab: mocks.openNavTab,
}));

vi.mock("../../dev_tools/function_counter.js", () => ({
    count_this_function: mocks.countThisFunction,
}));

vi.mock("../../endpoints/endpoint_router.js", () => ({
    endpoint_router: mocks.endpointRouter,
}));

vi.mock("../../navigation/nav_engine/dataset_access_registry.js", () => ({
    primeDatasetAccessRegistry: mocks.primeDatasetAccessRegistry,
    beginDatasetAccessRefresh: mocks.beginDatasetAccessRefresh,
    isCurrentDatasetAccessRefresh: mocks.isCurrentDatasetAccessRefresh,
}));

vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    setUnifiedTableState: mocks.setUnifiedTableState,
}));

vi.mock("../../state_stores/dataset_selection_saver.js", () => ({
    setRedirectNotice: mocks.setRedirectNotice,
    clearDatasetSelectionState: mocks.clearDatasetSelectionState,
    setSelectedDataset: mocks.setSelectedDataset,
    getSelectedDataset: mocks.getSelectedDataset,
}));

import { load_tables, resetEarlierVisitForgettingForTests } from "./table_loader_handler.js";
import { getUnifiedTableState, setUnifiedTableState as setTableState } from "../../state_stores/table_state_store.js";
import { getChosenDatasetView, setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { readRowArticleViewRestoreState } from "../../table_views/card_view/row_article_view_restore_state.js";

/**
 * One browser tab's own session storage. Every tab of the site shares jsdom's
 * localStorage; switching the global session store switches the tab. A
 * duplicated tab starts from a copy of the original's entries.
 */
function createTabSessionStore(copiedEntries = {}) {
    const entries = new Map(Object.entries(copiedEntries));
    return {
        getItem: (key) => (entries.has(key) ? entries.get(key) : null),
        setItem: (key, value) => { entries.set(key, String(value)); },
        removeItem: (key) => { entries.delete(key); },
        clear: () => { entries.clear(); },
        key: (index) => [...entries.keys()][index] ?? null,
        get length() { return entries.size; },
        snapshot: () => Object.fromEntries(entries),
    };
}

function resetLoaderMocks(datasets) {
    vi.clearAllMocks();
    resetEarlierVisitForgettingForTests();
    localStorage.clear();
    sessionStorage.clear();
    mocks.getSelectedDataset.mockReturnValue(null);
    mocks.primeDatasetAccessRegistry.mockReturnValue(true);
    mocks.isCurrentDatasetAccessRefresh.mockReturnValue(true);
    mocks.endpointRouter.mockResolvedValue({
        datasets: datasets.map((datasetName) => ({ dataset_name: datasetName })),
        tab_order: [],
    });
}

describe("load_tables deep-link startup routing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetEarlierVisitForgettingForTests();
        localStorage.clear();
        sessionStorage.clear();
        window.history.replaceState({}, "", "/");
        mocks.getSelectedDataset.mockReturnValue(null);
        mocks.primeDatasetAccessRegistry.mockReturnValue(true);
        mocks.isCurrentDatasetAccessRefresh.mockReturnValue(true);
        mocks.endpointRouter.mockResolvedValue({
            datasets: [{ dataset_name: "dev_agent_tasks" }],
            tab_order: [],
        });
    });

    test("enabled cold root opens only Home without selecting or loading a dataset", async () => {
        localStorage.setItem('separate_front_page', 'true');
        await load_tables({ forceReload: true });
        expect(mocks.openFrontPage).toHaveBeenCalledExactlyOnceWith({
            replace: true, forceReload: true, isCurrentNavigation: expect.any(Function),
        });
        expect(mocks.openNavTab).not.toHaveBeenCalled();
        expect(mocks.setSelectedDataset).not.toHaveBeenCalled();
        expect(mocks.endpointRouter).toHaveBeenCalledExactlyOnceWith('fetchContentTables');
    });

    test("setting off keeps the existing cold root dataset load", async () => {
        await load_tables();
        expect(mocks.openFrontPage).not.toHaveBeenCalled();
        expect(mocks.setSelectedDataset).toHaveBeenCalledWith('dev_agent_tasks');
        expect(mocks.openNavTab).toHaveBeenCalledWith('dev_agent_tasks', {
            skipUrlUpdate: true, forceReload: false,
        });
    });

    test.each([true, false])("refuses /front_page even with a registered hidden view, enabled=%s", async enabled => {
        localStorage.setItem('separate_front_page', String(enabled));
        history.replaceState({}, '', '/front_page/42');
        await load_tables();
        expect(location.pathname).toBe('/');
        expect(mocks.openFrontPage).not.toHaveBeenCalled();
        expect(mocks.openNavTab).not.toHaveBeenCalled();
        expect(mocks.setSelectedDataset).not.toHaveBeenCalled();
    });

    test("Home mode preserves dataset deep links", async () => {
        localStorage.setItem('separate_front_page', 'true');
        history.replaceState({}, '', '/dev_agent_tasks/853');
        await load_tables();
        expect(mocks.openFrontPage).not.toHaveBeenCalled();
        expect(mocks.openNavTab).toHaveBeenCalledWith('dev_agent_tasks', { skipUrlUpdate: true, forceReload: false });
    });

    test("opens a deep-linked row without pushing the dataset base URL first", async () => {
        window.history.replaceState(
            {},
            "",
            "/dev_agent_tasks/853-filterest-application-platform-component-inventory?view=article",
        );

        await load_tables();

        expect(mocks.setUnifiedTableState).toHaveBeenCalledWith("dev_agent_tasks", {
            articleView: { collapsed: true, expandedId: "853", returnView: "card" },
        });
        expect(sessionStorage.getItem("dev_agent_tasks_view")).toBe("article_view");
        expect(mocks.openNavTab).toHaveBeenCalledWith("dev_agent_tasks", {
            skipUrlUpdate: true,
            forceReload: false,
        });
    });

    test("discards a stale metadata response before navigation or dataset state changes", async () => {
        mocks.primeDatasetAccessRegistry.mockReturnValue(false);
        expect(await load_tables()).toBeNull();
        expect(mocks.createNavigationButtons).not.toHaveBeenCalled();
        expect(mocks.setSelectedDataset).not.toHaveBeenCalled();
        expect(mocks.openNavTab).not.toHaveBeenCalled();
    });

    test("stops a superseded refresh after private view loading", async () => {
        mocks.isCurrentDatasetAccessRefresh.mockReturnValue(false);
        expect(await load_tables()).toBeNull();
        expect(mocks.createNavigationButtons).not.toHaveBeenCalled();
        expect(mocks.openNavTab).not.toHaveBeenCalled();
    });


    test("explicit initial view overrides only this dataset's stored view", async () => {
        setChosenDatasetView("dev_agent_tasks", "table");
        setChosenDatasetView("other", "calendar");
        history.replaceState({}, "", "/dev_agent_tasks?view=article_view&search=test");
        await load_tables();
        expect(sessionStorage.getItem("dev_agent_tasks_view")).toBe("article_view");
        expect(sessionStorage.getItem("other_view")).toBe("calendar");
    });


    // Owner decision K139 (3.10.2026): a fresh page shows what its address asks
    // for, otherwise the dataset default; nothing carries over between visits.
    test.each(["", "?view=unknown"])("forgets an earlier visit's view when the address names none or an unknown one %s", async (query) => {
        setChosenDatasetView("dev_agent_tasks", "article_view");
        history.replaceState({}, "", "/dev_agent_tasks" + query);
        await load_tables();
        expect(sessionStorage.getItem("dev_agent_tasks_view")).toBeNull();
    });

    test("forgets every dataset's view and open row from an earlier visit in this tab and keeps its sorting", async () => {
        mocks.endpointRouter.mockResolvedValue({
            datasets: [{ dataset_name: "dev_agent_tasks" }, { dataset_name: "travel_deals" }],
            tab_order: [],
        });
        setChosenDatasetView("travel_deals", "article_view");
        sessionStorage.setItem("travel_deals_open_row", JSON.stringify({
            articleView: { collapsed: true, expandedId: "5", returnView: "card" },
            cardView: { collapsed: true, expandedId: "5" },
        }));
        localStorage.setItem("travel_deals_sorting_and_filtering_specs", JSON.stringify({
            sort: { column: "__newest", direction: "DESC" },
        }));
        history.replaceState({}, "", "/dev_agent_tasks");

        await load_tables();

        expect(sessionStorage.getItem("travel_deals_view")).toBeNull();
        const state = getUnifiedTableState("travel_deals");
        expect(state.sort).toEqual({ column: "__newest", direction: "DESC" });
        expect(state.articleView).toEqual({ collapsed: false, expandedId: null });
        expect(state.cardView).toEqual({ collapsed: false, expandedId: null });
    });

    // (b) Owner decision K143 (3.10.2026): the view and the open row are each
    // tab's own. A tab that loads beside another forgets only its own; it never
    // removes or rewrites what every tab shares -- sorting, filters, paging --
    // and leaves alone whatever earlier versions kept there, view keys included.
    test("a page load forgets only this tab's state and writes nothing to the storage every tab shares", async () => {
        mocks.endpointRouter.mockResolvedValue({
            datasets: [{ dataset_name: "dev_agent_tasks" }, { dataset_name: "travel_deals" }],
            tab_order: [],
        });
        const shared = {
            travel_deals_sorting_and_filtering_specs: JSON.stringify({
                sort: { column: "__newest", direction: "DESC" }, filters: { country: "FI" }, offset: 40,
            }),
            dataset_query_params: JSON.stringify({ travel_deals: { search: "ferry" } }),
            travel_deals_view: "article_view",
            travel_deals_default_view_seen: "card",
        };
        for (const [key, value] of Object.entries(shared)) localStorage.setItem(key, value);
        sessionStorage.setItem("travel_deals_view", "table");
        sessionStorage.setItem("travel_deals_open_row", JSON.stringify({
            articleView: { collapsed: true, expandedId: "5" },
        }));
        history.replaceState({}, "", "/dev_agent_tasks");
        const writes = vi.spyOn(Storage.prototype, "setItem");
        const removals = vi.spyOn(Storage.prototype, "removeItem");

        try {
            await load_tables();
            expect(writes.mock.contexts).not.toContain(localStorage);
            expect(removals.mock.contexts).not.toContain(localStorage);
        } finally {
            writes.mockRestore();
            removals.mockRestore();
        }

        expect(Object.fromEntries(Object.keys(shared).map((key) => [key, localStorage.getItem(key)])))
            .toEqual(shared);
        expect(sessionStorage.getItem("travel_deals_view")).toBeNull();
        expect(getUnifiedTableState("travel_deals").articleView).toEqual({ collapsed: false, expandedId: null });
    });

    // (d) A second tab of the same site starts with its own empty session
    // storage: it sees the shared sorting, but neither the view nor the open
    // row the first tab chose.
    test("a second tab shares the sorting but not the first tab's view or open row", async () => {
        mocks.endpointRouter.mockResolvedValue({
            datasets: [{ dataset_name: "dev_agent_tasks" }, { dataset_name: "travel_deals" }],
            tab_order: [],
        });
        history.replaceState({}, "", "/dev_agent_tasks");
        await load_tables();
        setChosenDatasetView("travel_deals", "article_view");
        setTableState("travel_deals", {
            sort: { column: "name", direction: "ASC" },
            articleView: { collapsed: true, expandedId: "5", returnView: "card" },
        });

        sessionStorage.clear(); // the second tab's own session storage
        resetEarlierVisitForgettingForTests(); // and its own page
        await load_tables();

        expect(getChosenDatasetView("travel_deals")).toBeNull();
        const secondTab = getUnifiedTableState("travel_deals");
        expect(secondTab.sort).toEqual({ column: "name", direction: "ASC" });
        expect(secondTab.articleView).toEqual({ collapsed: false, expandedId: null });
    });

    // Signing in reloads the tables in the same page; what this visit chose stays.
    test("a later load in the same page keeps the views chosen in this visit", async () => {
        mocks.endpointRouter.mockResolvedValue({
            datasets: [{ dataset_name: "dev_agent_tasks" }, { dataset_name: "travel_deals" }],
            tab_order: [],
        });
        history.replaceState({}, "", "/dev_agent_tasks");
        await load_tables();
        setChosenDatasetView("travel_deals", "table");

        await load_tables({ forceReload: true });

        expect(sessionStorage.getItem("travel_deals_view")).toBe("table");
    });

    test("resolves the supported article alias before the initial render", async () => {
        setChosenDatasetView("dev_agent_tasks", "table");
        history.replaceState({}, "", "/dev_agent_tasks?view=article");
        await load_tables();
        expect(sessionStorage.getItem("dev_agent_tasks_view")).toBe("article_view");
    });

    test("keeps normal dataset routes on the regular URL update path", async () => {
        window.history.replaceState({}, "", "/dev_agent_tasks?view=card");

        await load_tables();

        expect(mocks.setUnifiedTableState).not.toHaveBeenCalled();
        expect(mocks.openNavTab).toHaveBeenCalledWith("dev_agent_tasks", {
            skipUrlUpdate: false,
            forceReload: false,
        });
    });
});

test("IFAV bookmark prepares its backing dataset without opening a classic article", async () => {
    vi.clearAllMocks();
    resetEarlierVisitForgettingForTests();
    mocks.endpointRouter.mockResolvedValue({ datasets: [{ dataset_name: "dev_agent_tasks" }] });
    history.replaceState({}, "", "/dev_agent_tasks/853?search=test&view=image_first_view#image=one.jpg");
    await load_tables();
    expect(mocks.setUnifiedTableState).not.toHaveBeenCalled();
    expect(mocks.openNavTab).toHaveBeenCalledWith("dev_agent_tasks", {
        skipUrlUpdate: true, forceReload: false, replacementParams: { search: "test", view: "card" },
    });
    expect(ifav.restore).toHaveBeenCalledWith(expect.objectContaining({ tableName: "dev_agent_tasks", rowId: "853" }));
    expect(location.search).toContain("view=image_first_view");
});

// Reloading an open article's own address (F5) continues the same reading, so
// its related tab and scroll position come back (row_article_view_restore_state.js).
// Any other page load forgets them with the rest of the earlier visit (K139).
describe("a reload of an open article's own address", () => {
    const READING_POSITION = {
        relatedTabKey: "dev_agent_task_todos__task_id__",
        relatedRowsOpen: true,
        scrollTop: 360,
    };
    const OPEN_ARTICLE = {
        articleView: { collapsed: true, expandedId: "853", returnView: "card", ...READING_POSITION },
    };

    beforeEach(() => {
        resetLoaderMocks(["dev_agent_tasks"]);
        sessionStorage.setItem("dev_agent_tasks_open_row", JSON.stringify(OPEN_ARTICLE));
        setChosenDatasetView("dev_agent_tasks", "article_view");
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    /** What the article opened from the address reads back once it is open. */
    function openTheAddressArticle(rowId) {
        // The page load asked the (mocked) shared store to open the address's row.
        setTableState("dev_agent_tasks", mocks.setUnifiedTableState.mock.calls[0][1]);
        return readRowArticleViewRestoreState("dev_agent_tasks", rowId);
    }

    // (a)
    test("keeps the related tab and scroll position when the address names the same row", async () => {
        history.replaceState({}, "", "/dev_agent_tasks/853-component-inventory?view=article_view");

        await load_tables();

        expect(getUnifiedTableState("dev_agent_tasks").articleView).toEqual({
            collapsed: false, expandedId: null, ...READING_POSITION,
        });
        expect(openTheAddressArticle("853")).toEqual(READING_POSITION);
    });

    // (b)
    test("forgets them when the address names another row", async () => {
        history.replaceState({}, "", "/dev_agent_tasks/854?view=article_view");

        await load_tables();

        expect(getUnifiedTableState("dev_agent_tasks").articleView).toEqual({ collapsed: false, expandedId: null });
        expect(openTheAddressArticle("854")).toEqual({ relatedTabKey: null, relatedRowsOpen: null, scrollTop: null });
    });

    // (c)
    test("forgets them when the address names no row", async () => {
        history.replaceState({}, "", "/dev_agent_tasks?view=article_view");

        await load_tables();

        expect(getUnifiedTableState("dev_agent_tasks").articleView).toEqual({ collapsed: false, expandedId: null });
        expect(mocks.setUnifiedTableState).not.toHaveBeenCalled();
    });

    // The image-first route owns its row and never restored the ordinary
    // article's reading position, before WL136 or since.
    test("forgets them for an image-first address of the same row", async () => {
        history.replaceState({}, "", "/dev_agent_tasks/853?view=image_first_view#image=one.jpg");

        await load_tables();

        expect(getUnifiedTableState("dev_agent_tasks").articleView).toEqual({ collapsed: false, expandedId: null });
    });

    // (d)
    test("a second tab reloading the same row neither inherits nor touches the first tab's reading position", async () => {
        const firstTab = createTabSessionStore();
        firstTab.setItem("dev_agent_tasks_open_row", JSON.stringify(OPEN_ARTICLE));
        firstTab.setItem("dev_agent_tasks_view", "article_view");
        const firstTabBefore = firstTab.snapshot();
        const secondTab = createTabSessionStore();
        vi.stubGlobal("sessionStorage", secondTab);
        history.replaceState({}, "", "/dev_agent_tasks/853-component-inventory?view=article_view");

        await load_tables();

        expect(getUnifiedTableState("dev_agent_tasks").articleView).toEqual({ collapsed: false, expandedId: null });
        expect(openTheAddressArticle("853")).toEqual({ relatedTabKey: null, relatedRowsOpen: null, scrollTop: null });
        expect(firstTab.snapshot()).toEqual(firstTabBefore);
    });

    test("forgets them in another dataset whose open row has the same id", async () => {
        resetLoaderMocks(["dev_agent_tasks", "travel_deals"]);
        sessionStorage.setItem("dev_agent_tasks_open_row", JSON.stringify(OPEN_ARTICLE));
        sessionStorage.setItem("travel_deals_open_row", JSON.stringify(OPEN_ARTICLE));
        history.replaceState({}, "", "/travel_deals/853?view=article_view");

        await load_tables();

        expect(getUnifiedTableState("dev_agent_tasks").articleView).toEqual({ collapsed: false, expandedId: null });
        expect(getUnifiedTableState("travel_deals").articleView).toEqual({
            collapsed: false, expandedId: null, ...READING_POSITION,
        });
    });
});

// The review of WL137 asked for tabs that really are separate: each has its own
// session storage and its own page (module instances), and only localStorage is
// shared. Tab A is checked again after tab B has loaded.
describe("two tabs, each with its own session storage and page", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    async function openTab(store, address) {
        vi.stubGlobal("sessionStorage", store);
        vi.resetModules();
        history.replaceState({}, "", address);
        const tab = {
            store,
            loader: await import("./table_loader_handler.js"),
            state: await import("../../state_stores/table_state_store.js"),
            views: await import("../../state_stores/dataset_view_choice_saver.js"),
            query: await import("../../navigation/nav_engine/query_params.js"),
            reading: await import("../../table_views/card_view/row_article_view_restore_state.js"),
        };
        await tab.loader.load_tables();
        return tab;
    }

    function inTab(tab) {
        vi.stubGlobal("sessionStorage", tab.store);
        return tab;
    }

    test("tab A keeps its view, open row and address view after tab B loads the same dataset", async () => {
        resetLoaderMocks(["dev_agent_tasks", "travel_deals"]);
        // Each tab's own address names the dataset's search, as two tabs of the
        // same search do; the address a page loads defines that dataset's
        // cached parameters, and only the view among them is the page's own.
        const tabA = await openTab(createTabSessionStore(), "/travel_deals?search=ferry");
        tabA.views.setChosenDatasetView("travel_deals", "article_view");
        tabA.state.setUnifiedTableState("travel_deals", {
            sort: { column: "name", direction: "ASC" },
            articleView: { collapsed: true, expandedId: "5", returnView: "card", scrollTop: 120 },
        });
        tabA.query.setParams("travel_deals", { search: "ferry", view: "article_view" });

        const tabB = await openTab(createTabSessionStore(), "/travel_deals?search=ferry");

        // Tab B shares the sorting and the search, nothing that is tab A's own.
        expect(tabB.views.getChosenDatasetView("travel_deals")).toBeNull();
        expect(tabB.state.getUnifiedTableState("travel_deals").sort).toEqual({ column: "name", direction: "ASC" });
        expect(tabB.state.getUnifiedTableState("travel_deals").articleView).toEqual({ collapsed: false, expandedId: null });
        tabB.query.useStorageParams();
        expect(tabB.query.getParams("travel_deals")).toEqual({ search: "ferry" });

        // Tab A, checked again after tab B's page load: all its own state is intact.
        inTab(tabA);
        expect(tabA.views.getChosenDatasetView("travel_deals")).toBe("article_view");
        expect(tabA.state.getUnifiedTableState("travel_deals").articleView)
            .toEqual({ collapsed: true, expandedId: "5", returnView: "card", scrollTop: 120 });
        tabA.query.useStorageParams();
        expect(tabA.query.getParams("travel_deals")).toEqual({ search: "ferry", view: "article_view" });
    });

    // Duplicating a browser tab copies its session storage. The copy loading the
    // same row's address is the same reading copied, so it keeps the position;
    // that is intended (WL137). From then on each tab's changes stay its own.
    test("a duplicated tab on the same row keeps the copied reading position, then each tab changes alone", async () => {
        resetLoaderMocks(["dev_agent_tasks"]);
        const address = "/dev_agent_tasks/853-component-inventory?view=article_view";
        const reading = { relatedTabKey: "dev_agent_task_todos__task_id__", relatedRowsOpen: true, scrollTop: 360 };
        const openTheAddressArticle = (tab) => {
            inTab(tab);
            tab.state.setUnifiedTableState("dev_agent_tasks", mocks.setUnifiedTableState.mock.calls.at(-1)[1]);
        };
        const readingIn = (tab) => {
            inTab(tab);
            return tab.reading.readRowArticleViewRestoreState("dev_agent_tasks", "853");
        };
        const tabA = await openTab(createTabSessionStore({
            dev_agent_tasks_view: "article_view",
            dev_agent_tasks_open_row: JSON.stringify({
                articleView: { collapsed: true, expandedId: "853", returnView: "card", ...reading },
            }),
        }), address);
        openTheAddressArticle(tabA);

        const tabB = await openTab(createTabSessionStore(tabA.store.snapshot()), address);
        openTheAddressArticle(tabB);
        expect(readingIn(tabB)).toEqual(reading);

        inTab(tabB);
        tabB.reading.persistRowArticleViewRestoreState("dev_agent_tasks", "853", { relatedTabKey: "__comments", scrollTop: 900 });
        expect(readingIn(tabA)).toEqual(reading);

        inTab(tabA);
        tabA.reading.persistRowArticleViewRestoreState("dev_agent_tasks", "853", { scrollTop: 40 });
        expect(readingIn(tabB)).toEqual({ ...reading, relatedTabKey: "__comments", scrollTop: 900 });
        expect(readingIn(tabA)).toEqual({ ...reading, scrollTop: 40 });
    });
});
