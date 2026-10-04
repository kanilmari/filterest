// @vitest-environment jsdom
// tab_session_storage.test.js
// Verifies this tab's own values -- chosen views and open rows -- in its session storage, and in
// this page's memory while the browser refuses that storage.
// Bridges the helper with the real stores, the startup loader, the view selector and the real
// table refresh; only the network and the drawing are stubbed.
// Exists because a refusing browser lost every choice at once: a deep-linked article never opened
// and a chosen view never reached the redraw (WL137 re-check).

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const flow = vi.hoisted(() => ({
    endpointRouter: vi.fn(),
    openNavTab: vi.fn(),
    fetchDatasetData: vi.fn(),
    generateTable: vi.fn(),
    openRowArticleView: vi.fn(),
}));

// The network.
vi.mock("../endpoints/endpoint_router.js", () => ({ endpoint_router: (...args) => flow.endpointRouter(...args) }));
vi.mock("../endpoints/endpoint_data_fetcher.js", () => ({ fetchDatasetData: (...args) => flow.fetchDatasetData(...args) }));
// The drawing, and the shell around it.
vi.mock("../table_views/dataset_view_printer.js", () => ({ generate_table: (...args) => flow.generateTable(...args) }));
vi.mock("../table_views/card_view/row_article_opener.js", () => ({ openRowArticleView: (...args) => flow.openRowArticleView(...args) }));
vi.mock("../table_views/card_view/row_article_ui_handler.js", () => ({ closeRowArticle: vi.fn() }));
vi.mock("../navigation/main_tabs/main_tab_printer.js", () => ({
    openNavTab: (...args) => flow.openNavTab(...args),
    updateTabPathsForView: vi.fn(),
}));
vi.mock("../navigation/database_tree/nav_builder.js", () => ({ create_navigation_buttons: vi.fn() }));
vi.mock("../navigation/admin_and_user_tools/custom_view_reader.js", () => ({
    custom_views: [],
    ensure_private_custom_views_loaded: vi.fn(async () => {}),
}));
vi.mock("../navigation/menu_button/navbar_visibility_handler.js", () => ({ updateShowMenuButtonPosition: vi.fn() }));
vi.mock("../navigation/nav_engine/browser_tab_title_writer.js", () => ({ updateBrowserTabTitle: vi.fn(async () => true) }));
vi.mock("../navigation/nav_engine/image_first_view_history.js", () => ({
    isImageFirstViewURL: () => false,
    getImageFirstViewBackingView: () => "card",
    handleImageFirstViewHistory: vi.fn(async () => false),
}));
vi.mock("../navigation/nav_engine/card_article_return_state.js", () => ({
    getCardArticleReturnToken: () => null,
    invalidateCardArticleReturn: vi.fn(),
}));
vi.mock("../navigation/nav_engine/dataset_access_registry.js", () => ({
    primeDatasetAccessRegistry: () => true,
    beginDatasetAccessRefresh: () => 1,
    isCurrentDatasetAccessRefresh: () => true,
    subscribeDatasetAccessRegistry: () => () => {},
    hasDatasetAccessSnapshot: () => true,
    canReadDatasetFromRegistry: () => true,
}));
vi.mock("../infinite_scroll/infinite_scroll_handler.js", () => ({
    resetOffset: vi.fn(), updateOffset: vi.fn(), disconnectInfiniteScroll: vi.fn(),
}));
vi.mock("../filterbar/filter_list/column_visibility_handler.js", () => ({ applyColumnVisibility: vi.fn() }));
vi.mock("../navigation/root_redirect_handler.js", () => ({ redirectToRootInSpa: vi.fn() }));
vi.mock("../route_permission_checker.js", () => ({
    primeDatasetPermissions: vi.fn(), hasRoutePermission: () => true, applyPermission: vi.fn(),
}));
vi.mock("../config_fetcher.js", () => ({
    getDefaultDatasetSortSync: () => ({ column: "__newest", direction: "DESC" }),
    getDefaultViewSync: () => "table",
}));
vi.mock("../dev_tools/function_counter.js", () => ({ count_this_function: vi.fn() }));

/** A browser whose session storage refuses every read and write. */
function refuseSessionStorage() {
    const refuse = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
    vi.stubGlobal("sessionStorage", { getItem: refuse, setItem: refuse, removeItem: refuse, clear: refuse, key: refuse, length: 0 });
}

/** A freshly loaded page at an address: new module instances, so its memory starts empty. */
async function loadPage(address) {
    vi.resetModules();
    history.replaceState({}, "", address);
    const page = {
        tab: await import("./tab_session_storage.js"),
        views: await import("./dataset_view_choice_saver.js"),
        loader: await import("../admin_tools/main/table_loader_handler.js"),
        refresh: await import("../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js"),
        selector: await import("../table_views/view_selector_printer.js"),
    };
    // Opening a dataset tab redraws it through the real refresh.
    flow.openNavTab.mockImplementation(async (datasetName) => {
        await page.refresh.refreshTableUnified(datasetName);
        return {};
    });
    return page;
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    flow.generateTable.mockImplementation(async () => document.createElement("div"));
    flow.fetchDatasetData.mockImplementation(async ({ filters }) => (filters?.id
        ? { data: [{ id: Number(filters.id), title: "Component inventory" }] }
        : { data: [{ id: 1, title: "First listed" }], columns: ["id", "title"], types: {}, row_count: 1 }));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("tab_session_storage", () => {
    test("keeps a value in session storage while the browser allows it", async () => {
        const { tab } = await loadPage("/");
        tab.writeTabSessionValue("travel_deals_view", "card");
        expect(sessionStorage.getItem("travel_deals_view")).toBe("card");
        expect(tab.readTabSessionValue("travel_deals_view")).toBe("card");
        tab.removeTabSessionValue("travel_deals_view");
        expect(tab.readTabSessionValue("travel_deals_view")).toBeNull();
        expect(console.warn).not.toHaveBeenCalled();
    });

    test("keeps a refused write in page memory, reads it first, and drops it once a write succeeds", async () => {
        const { tab } = await loadPage("/");
        tab.writeTabSessionValue("travel_deals_view", "card");
        const refuse = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        });
        tab.writeTabSessionValue("travel_deals_view", "table");
        tab.writeTabSessionValue("events_view", "calendar");
        refuse.mockRestore();

        expect(tab.readTabSessionValue("travel_deals_view")).toBe("table");
        expect(sessionStorage.getItem("travel_deals_view")).toBe("card");
        expect(console.warn).toHaveBeenCalledTimes(1);

        tab.writeTabSessionValue("travel_deals_view", "article_view");
        sessionStorage.setItem("travel_deals_view", "map"); // the storage is the only copy again
        expect(tab.readTabSessionValue("travel_deals_view")).toBe("map");
    });

    test("a browser that refuses all of session storage keeps this page's values in memory until sign-out forgets them", async () => {
        refuseSessionStorage();
        const { tab } = await loadPage("/");
        expect(tab.readTabSessionValue("travel_deals_view")).toBeNull();
        tab.writeTabSessionValue("travel_deals_view", "card");
        tab.writeTabSessionValue("events_view", "calendar");
        expect(tab.readTabSessionValue("travel_deals_view")).toBe("card");
        tab.removeTabSessionValue("travel_deals_view");
        expect(tab.readTabSessionValue("travel_deals_view")).toBeNull();

        tab.forgetTabSessionFallback();
        expect(tab.readTabSessionValue("events_view")).toBeNull();
    });
});

// The re-check of WL137 found that with refused session storage the real
// refresh never opened a deep-linked article and never drew a chosen view.
describe("in a browser that refuses session storage, through the real stores and refresh", () => {
    test("a deep link opens the article of its row", async () => {
        refuseSessionStorage();
        const page = await loadPage("/dev_agent_tasks/853-component-inventory?view=article_view");
        flow.endpointRouter.mockResolvedValue({ datasets: [{ dataset_name: "dev_agent_tasks" }], tab_order: [] });

        await page.loader.load_tables();

        expect(flow.fetchDatasetData).toHaveBeenCalledWith(expect.objectContaining({
            dataset_name: "dev_agent_tasks", view_key: "article_view",
        }));
        expect(flow.openRowArticleView).toHaveBeenCalledTimes(1);
        expect(flow.openRowArticleView).toHaveBeenCalledWith(
            expect.objectContaining({ id: 853 }), "dev_agent_tasks", null, expect.any(Object),
        );
    });

    test("a chosen view reaches its redraw and the next one", async () => {
        refuseSessionStorage();
        const page = await loadPage("/travel_deals");

        page.selector.selectDatasetView("travel_deals", "card", "table");
        await vi.waitFor(() => expect(flow.generateTable).toHaveBeenCalledTimes(1));
        await page.refresh.refreshTableUnified("travel_deals", { skipUrlParams: true });

        expect(flow.fetchDatasetData.mock.calls.map(([request]) => request.view_key)).toEqual(["card", "card"]);
        expect(page.views.getChosenDatasetView("travel_deals")).toBe("card");
        expect(location.search).toBe("?view=card");
    });
});
