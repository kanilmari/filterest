// @vitest-environment jsdom
// auth_broadcast_sign_out_cycle.test.js
// Verifies that a sign-out in another tab leaves nothing of this page's dataset state for the next
// session: the in-page sign-in and the navigation after it start from the address alone.
// Bridges the real broadcast handler, sign-out reset, post-sign-in bootstrap and startup loader with
// the real query cache and this tab's view and open-row stores.
// Exists because that state also lives in this page's memory -- the address view always, the view and
// open row when the browser refuses session storage -- which clearing the storage alone misses.

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const cycle = vi.hoisted(() => ({
    endpointRouter: vi.fn(),
    openNavTab: vi.fn(),
}));

vi.mock("../endpoints/endpoint_router.js", () => ({ endpoint_router: (...args) => cycle.endpointRouter(...args) }));
vi.mock("../navigation/main_tabs/main_tab_printer.js", () => ({
    initTabs: vi.fn(async () => {}),
    openNavTab: (...args) => cycle.openNavTab(...args),
}));
vi.mock("./auth_broadcast.js", () => ({ subscribeToAuthBroadcast: vi.fn(() => () => {}), publishAuthLogout: vi.fn() }));
// Signed in once the bootstrap runs: the shell's auth button offers "logout".
vi.mock("../admin_tools/auth_mode_handler.js", () => ({
    setAuthModes: vi.fn(async () => {}), hasRoutePermission: () => false, getButtonState: () => "logout",
}));
vi.mock("./login_shell_entry.js", () => ({ handleLoginShellEntry: vi.fn(async () => {}) }));
vi.mock("./session_access_prompt.js", () => ({ requestSessionAccessPrompt: vi.fn() }));
vi.mock("../../reusable_components/modal/modal_builder.js", () => ({ hideModal: vi.fn() }));
vi.mock("../config_fetcher.js", () => ({ isCrossTabLoginSyncEnabled: vi.fn(async () => false) }));
vi.mock("../pipeline/api_pipeline.js", () => ({ ensureCsrfToken: vi.fn() }));
vi.mock("../route_permission_checker.js", () => ({
    clearPermissionCache: vi.fn(), hasRoutePermission: () => false, primeDatasetPermissions: vi.fn(),
}));
vi.mock("../ai_features/table_chat/table_chat_printer.js", () => ({ destroy_chat: vi.fn() }));
vi.mock("../admin_tools/admin_update_notice_subscriber.js", () => ({
    stopAdminUpdateNoticeSubscriber: vi.fn(), syncAdminUpdateNoticeSubscriber: vi.fn(),
}));
vi.mock("../admin_tools/main/oid_updater.js", () => ({ update_oids_and_table_names: vi.fn() }));
vi.mock("../navigation/main_tabs/tab_reorder_handler.js", () => ({ enableTabDragAndDrop: vi.fn() }));
vi.mock("../vanilla_tree/van_tr_components/admin_tree_builder.js", () => ({ initializeTreeCallAdmin: vi.fn() }));
vi.mock("../navigation/database_tree/navbar_admin_tools_section.js", () => ({
    NAVBAR_ADMIN_TOOLS_SECTION_ID: "navbarAdminToolsSection", ensureNavbarAdminToolsSection: vi.fn(),
}));
vi.mock("../navigation/nav_engine/image_first_view_history.js", () => ({
    isImageFirstViewURL: () => false,
    getImageFirstViewBackingView: () => "card",
    handleImageFirstViewHistory: vi.fn(async () => false),
}));
vi.mock("../navigation/database_tree/nav_builder.js", () => ({ create_navigation_buttons: vi.fn() }));
vi.mock("../navigation/admin_and_user_tools/custom_view_reader.js", () => ({
    custom_views: [], ensure_private_custom_views_loaded: vi.fn(async () => {}),
}));
vi.mock("../dev_tools/function_counter.js", () => ({ count_this_function: vi.fn() }));
vi.mock("../navigation/nav_engine/dataset_access_registry.js", () => ({
    primeDatasetAccessRegistry: () => true, beginDatasetAccessRefresh: () => 1, isCurrentDatasetAccessRefresh: () => true,
}));
vi.mock("../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", async () => {
    const store = await import("../state_stores/table_state_store.js");
    return { setUnifiedTableState: store.setUnifiedTableState };
});

/** A session storage that still reads but refuses every write, as a full one does. */
function createWriteRefusingSessionStore() {
    const entries = new Map();
    return {
        getItem: (key) => (entries.has(key) ? entries.get(key) : null),
        setItem: () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); },
        removeItem: (key) => { entries.delete(key); },
        clear: () => { entries.clear(); },
        key: (index) => [...entries.keys()][index] ?? null,
        get length() { return entries.size; },
    };
}

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.innerHTML = '<div id="navbar"></div><div id="tabs_container"></div>';
    cycle.endpointRouter.mockImplementation(async (route) => (route === "fetchContentTables"
        ? { datasets: [{ dataset_name: "travel_deals" }], tab_order: [] }
        : {}));
    cycle.openNavTab.mockImplementation(async () => ({}));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

test.each([
    ["allows", () => {}],
    ["refuses writes to", () => vi.stubGlobal("sessionStorage", createWriteRefusingSessionStore())],
])("after another tab signs out and the person signs in here, the next navigation starts from the address (the browser %s session storage)", async (_label, prepareBrowser) => {
    prepareBrowser();
    history.replaceState({}, "", "/travel_deals");
    const loader = await import("../admin_tools/main/table_loader_handler.js");
    const sync = await import("./auth_broadcast_sync.js");
    const bootstrap = await import("./post_auth_bootstrap.js");
    const query = await import("../navigation/nav_engine/query_params.js");
    const views = await import("../state_stores/dataset_view_choice_saver.js");
    const state = await import("../state_stores/table_state_store.js");

    // This page's visit: an article open, with its view in the address.
    await loader.load_tables();
    views.setChosenDatasetView("travel_deals", "article_view");
    state.setUnifiedTableState("travel_deals", { articleView: { collapsed: true, expandedId: 5, scrollTop: 300 } });
    query.setParams("travel_deals", { search: "ferry", view: "article_view" });

    // Another tab signs out; on a public site this page resets in place.
    await sync.handleAuthBroadcastEvent({ type: "logout", detail: { reason: "logout", postLogoutPath: "/" } });

    // The person signs in again on the dataset's address and the page navigates there.
    history.replaceState({}, "", "/travel_deals");
    let shown = null;
    cycle.openNavTab.mockImplementation(async (datasetName) => {
        shown = {
            view: views.getChosenDatasetView(datasetName),
            openArticle: state.getUnifiedTableState(datasetName).articleView,
            params: query.getParams(datasetName),
        };
        return {};
    });
    await bootstrap.runPostAuthBootstrap();

    expect(cycle.openNavTab).toHaveBeenLastCalledWith("travel_deals", expect.any(Object));
    expect(shown).toEqual({ view: null, openArticle: { collapsed: false, expandedId: null }, params: {} });
});
