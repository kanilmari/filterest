// @vitest-environment jsdom
// admin_button_builder_layout.test.js
// Proves the dev layout selector follows its card-renderer consumers.
// Connects real admin controls, dropdowns, reused top rows and history restoration.
// Keeps browser-local layout choices intact across ordinary view switches.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    refresh: vi.fn(async () => {}),
    permission: vi.fn(async (route) => route === "/ui/table-view-style-buttons"),
    navigation: vi.fn(),
    params: new Map(),
}));

vi.mock("../general_tables/gt_toolbar/toolbar_button_creator.js", () => ({
    createAddRowButton: () => document.createElement("button"),
    createDeleteSelectedButton: () => document.createElement("button"),
    createColumnManagementButton: () => document.createElement("button"),
}));
vi.mock("../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", async () => ({
    ...await import("../state_stores/table_state_store.js"),
    refreshTableUnified: mocks.refresh,
    invalidateTableRefresh: vi.fn(),
}));
vi.mock("../navigation/main_tabs/main_tab_printer.js", () => ({ updateTabPathsForView: vi.fn() }));
vi.mock("../navigation/menu_button/navbar_visibility_handler.js", () => ({ updateShowMenuButtonPosition: vi.fn() }));
vi.mock("../route_permission_checker.js", () => ({
    hasDatasetPermission: mocks.permission,
    hasRoutePermission: () => true,
    applyPermission: vi.fn(),
}));
vi.mock("../config_fetcher.js", () => ({ getDefaultViewSync: () => "card" }));
vi.mock("../state_stores/dataset_selection_saver.js", () => ({ getSelectedDataset: () => "events" }));
vi.mock("../ai_features/table_chat/table_chat_printer.js", () => ({ create_chat_ui: vi.fn() }));
vi.mock("../ai_features/table_chat/table_chat_mode_resolver.js", () => ({ resolveAvailableFilterbarAIChatMode: () => null }));
vi.mock("../endpoints/endpoint_router.js", () => ({ get_endpoint_url: () => "/api/mock" }));
vi.mock("../lang/translation_handler.js", () => ({ getTranslationForKey: (_key, options = {}) => options.fallback || "" }));
vi.mock("./field_view_editor.js", () => ({ createFieldViewEditorButton: vi.fn() }));
vi.mock("./row_access_editor.js", () => ({ createEditRowPermissionsButton: vi.fn() }));
vi.mock("./row_group_assignment_editor.js", () => ({ createRowGroupAssignmentButton: vi.fn() }));
vi.mock("../table_views/card_view/row_article_ui_handler.js", () => ({ closeRowArticle: vi.fn() }));
vi.mock("../filterbar/text_search/create_text_search_panel.js", () => ({
    datasetSearchState: { set: vi.fn() },
    datasetSearchLocationState: { set: vi.fn() },
}));
vi.mock("../filterbar/text_search/dataset_search_executor.js", () => ({ ongoingSearchResults: {} }));
vi.mock("../filterbar/top_row_buttons/sort_dropdown_builder.js", () => ({ createSortDropdown: () => document.createElement("select") }));
vi.mock("../filterbar/top_row_buttons/sort_sync_state.js", () => ({ emitDatasetSortSelection: vi.fn() }));
vi.mock("../filterbar/filterbar_engine/filterbar_state_saver.js", () => ({ clearOpenedFilters: vi.fn() }));
vi.mock("../filterbar/filterbar_section_heading_builder.js", () => ({
    buildFilterbarDisclosureSection: ({ contentElement }) => {
        const section = document.createElement("section");
        section.appendChild(contentElement);
        return section;
    },
}));

// Exercise the real popstate controller and chosen-view saver. The navigation
// boundary calls the real styling helper, as the mounted-view path does.
vi.mock("../navigation/nav_engine/navigation_handler.js", () => ({ handle_all_navigation: mocks.navigation }));
vi.mock("../navigation/admin_and_user_tools/custom_view_reader.js", () => ({ custom_views: [] }));
vi.mock("../navigation/nav_engine/query_params.js", () => ({
    DATASET_PREFIX: "/",
    getParams: (dataset) => mocks.params.get(dataset) || {},
    setParams: (dataset, params) => mocks.params.set(dataset, params),
    updateURL: vi.fn(),
    parseTableQueryString: (query) => ({
        filters: {}, sort: {}, offset: 0,
        view: new URLSearchParams(query).get("view"),
    }),
}));
vi.mock("../navigation/nav_engine/dataset_aliases.js", () => ({ getInternalDatasetName: (name) => name }));
vi.mock("../navigation/nav_engine/dataset_access_registry.js", () => ({
    hasDatasetAccessSnapshot: () => true,
    subscribeDatasetAccessRegistry: vi.fn(),
}));
vi.mock("../navigation/nav_engine/image_first_view_history.js", () => ({ handleImageFirstViewHistory: async () => false }));
vi.mock("../navigation/nav_engine/card_article_return_state.js", () => ({
    canRestoreCardArticleReturn: () => false,
    restoreCardArticleReturn: vi.fn(),
    getCardArticleReturnToken: () => null,
    refreshCardArticleReturnViewport: vi.fn(),
}));
vi.mock("../navigation/nav_engine/dataset_address_writer.js", () => ({ updateDatasetAddress: async () => {} }));
vi.mock("../navigation/nav_engine/browser_tab_title_writer.js", () => ({ updateBrowserTabTitle: async () => {} }));
vi.mock("../front_page/front_page_navigation.js", () => ({ isSeparateFrontPageEnabled: () => false, openFrontPage: vi.fn() }));
vi.mock("../front_page/custom_root_navigation.js", () => ({ loadCustomRootFromHistory: async () => false }));

import { appendAdminFeatures } from "./admin_button_builder.js";
import { buildTopRow } from "../filterbar/top_row_buttons/top_row_builder.js";
import { applyViewStyling, selectDatasetView } from "../table_views/view_selector_printer.js";
import { getChosenDatasetView, setChosenDatasetView } from "../state_stores/dataset_view_choice_saver.js";
import { setUnifiedTableState } from "../state_stores/table_state_store.js";
import {
    buildCardStyleStorageKey,
    EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT,
    setCardStyleVariant,
} from "../table_views/experimental_free_layout_card/experimental_free_layout_card_store.js";
import "../navigation/nav_engine/history_navigation_handler.js";

let topRow;
const layoutControl = () => document.querySelector('[data-testid="card-style-dropdown"]');

async function mountTopRow(view) {
    setChosenDatasetView("events", view);
    topRow = buildTopRow(17, "events", view, ["id"], { id: "integer" }, document.body);
    document.body.appendChild(topRow);
    await topRow.ready;
    return topRow;
}

describe("dev-only layout selector", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.permission.mockImplementation(async (route) => route === "/ui/table-view-style-buttons");
        mocks.navigation.mockImplementation(async (dataset) => applyViewStyling(dataset));
        mocks.params.clear();
        localStorage.clear();
        sessionStorage.clear();
        document.head.innerHTML = '<meta name="app-env" content="dev">';
        document.body.innerHTML = '<div class="body_wrapper"><div class="body_content"></div></div>';
        setUnifiedTableState("events", { articleView: { collapsed: false, expandedId: null, returnView: null } });
        history.replaceState({}, "", "/events");
        window.__bigCardClosing = false;
    });

    afterEach(() => {
        topRow?.destroy();
        document.querySelectorAll(".vdw-dropdown").forEach((node) => node.__dropdown?.destroy());
        document.head.innerHTML = "";
        document.body.innerHTML = "";
        localStorage.clear();
        sessionStorage.clear();
        topRow = null;
    });

    test.each(["card", "article_view", "article", "big_card", "row_article"])("shows in card-renderer view %s", async (view) => {
        await mountTopRow(view);
        expect(layoutControl()?.querySelector("input").value).toBe("Locked layout");
    });

    test.each(["calendar", "table", "normal", "map", "settings", "ticket", "product_card", "tree", "transposed", "price_chart", "cloud_management", "image_first_view"])("does not show in %s", async (view) => {
        await mountTopRow(view);
        expect(layoutControl()).toBeNull();
    });

    test("follows clicks and reused top rows without changing the local style", async () => {
        setCardStyleVariant("events", EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT);
        const row = await mountTopRow("card");
        const menu = layoutControl().__dropdown;
        menu.open();
        selectDatasetView("events", "calendar");
        expect(layoutControl()).toBeNull();
        expect(document.querySelector('[data-testid="card-style-dropdown-list"]')).toBeNull();
        for (const view of ["article_view", "card", "table", "normal", "map", "settings", "card"]) {
            selectDatasetView("events", view);
            expect(buildTopRow(17, "events", view, [], {}, document.body)).toBe(row);
            expect(Boolean(layoutControl())).toBe(["card", "article_view"].includes(view));
        }
        expect(layoutControl().__dropdown.getValue()).toBe(EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT);
        expect(localStorage.getItem(buildCardStyleStorageKey("events"))).toBe(EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT);
    });

    test("reads the committed view after asynchronous permissions resolve", async () => {
        let release;
        mocks.permission.mockImplementation((route) => route === "/ui/table-view-style-buttons"
            ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(false));
        const selectors = document.createElement("div");
        const ready = appendAdminFeatures("events", document.createElement("div"), selectors, "card");
        setChosenDatasetView("events", "calendar");
        release(true);
        await ready;
        expect(selectors.querySelector(".card-style-dropdown")).toBeNull();
        selectors.querySelectorAll(".vdw-dropdown").forEach((node) => node.__dropdown.destroy());
    });

    test("follows restored view state even before the content shell mounts", async () => {
        await mountTopRow("calendar");
        document.querySelector(".body_wrapper").remove();
        setChosenDatasetView("events", "article_view");
        applyViewStyling("events");
        expect(layoutControl()).not.toBeNull();
        setChosenDatasetView("events", "calendar");
        applyViewStyling("events");
        expect(layoutControl()).toBeNull();
    });

    test("a retained hidden Article cannot expose layout tools in restored Calendar", async () => {
        await mountTopRow("article_view");
        const retainedArticle = document.createElement("div");
        retainedArticle.id = "events_article_view_container";
        retainedArticle.classList.add("hidden");
        retainedArticle.innerHTML = '<div class="card_view_wrapper big-card-open"></div>';
        document.body.appendChild(retainedArticle);
        setChosenDatasetView("events", "calendar");
        applyViewStyling("events");
        expect(layoutControl()).toBeNull();
    });

    test("Back/Forward restoration updates the same mounted top row", async () => {
        const row = await mountTopRow("card");
        // popstate sees the destination entry after Back/Forward has moved it.
        for (const view of ["calendar", "article_view", "card", "calendar", "card"]) {
            mocks.navigation.mockClear();
            history.replaceState({}, "", `/events?view=${view}`);
            window.dispatchEvent(new PopStateEvent("popstate"));
            await vi.waitFor(() => expect(mocks.navigation).toHaveBeenCalled());
            expect(getChosenDatasetView("events")).toBe(view);
            expect(Boolean(layoutControl())).toBe(["card", "article_view"].includes(view));
            expect(document.getElementById("17_filterBar_top_row")).toBe(row);
        }
    });

    test("Article layout changes still save the choice and refresh the view", async () => {
        await mountTopRow("article_view");
        layoutControl().__dropdown.setValue(EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT, true);
        expect(localStorage.getItem(buildCardStyleStorageKey("events"))).toBe(EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT);
        expect(mocks.refresh).toHaveBeenCalledWith("events", { skipUrlParams: true });
    });

    test.each(["card", "article_view"])("production never exposes %s layout tools even with a saved beta choice", async (view) => {
        document.querySelector('meta[name="app-env"]').content = "production";
        setCardStyleVariant("events", EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT);
        await mountTopRow(view);
        selectDatasetView("events", view === "card" ? "article_view" : "card");
        expect(layoutControl()).toBeNull();
    });
});
