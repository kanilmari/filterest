// view_selector_printer.test.js
// Verifies immediate active-button syncing for dataset view switches in jsdom.
// Bridges localStorage-backed view changes, styling updates, and refresh calls through the shared selector helper.
// Exists to keep the filterbar/admin view highlight aligned with the actual active dataset view.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const refreshTableUnifiedMock = vi.fn();
const updateTabPathsForViewMock = vi.fn();
const updateShowMenuButtonPositionMock = vi.fn();
const applyPermissionMock = vi.fn();
const hasRoutePermissionMock = vi.fn(() => true);
const getDefaultViewSyncMock = vi.fn(() => "table");
const getSelectedDatasetMock = vi.fn(() => "demo_table");
const getParamsMock = vi.fn(() => ({}));
const setParamsMock = vi.fn();
const updateURLMock = vi.fn();
const getCachedSearchResultForRenderMock = vi.fn();

async function loadModule() {
    vi.resetModules();

    vi.doMock("../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
        refreshTableUnified: refreshTableUnifiedMock,
    }));
    vi.doMock("../navigation/main_tabs/main_tab_printer.js", () => ({
        updateTabPathsForView: updateTabPathsForViewMock,
    }));
    vi.doMock("../navigation/menu_button/navbar_visibility_handler.js", () => ({
        updateShowMenuButtonPosition: updateShowMenuButtonPositionMock,
    }));
    vi.doMock("../route_permission_checker.js", () => ({
        applyPermission: applyPermissionMock,
        hasRoutePermission: hasRoutePermissionMock,
    }));
    vi.doMock("../config_fetcher.js", () => ({
        getDefaultViewSync: getDefaultViewSyncMock,
    }));
    vi.doMock("../state_stores/dataset_selection_saver.js", () => ({
        getSelectedDataset: getSelectedDatasetMock,
    }));
    vi.doMock("../navigation/nav_engine/query_params.js", () => ({
        getParams: getParamsMock,
        setParams: setParamsMock,
        updateURL: updateURLMock,
    }));
    vi.doMock("../filterbar/text_search/dataset_search_executor.js", () => ({
        getCachedSearchResultForRender: getCachedSearchResultForRenderMock,
    }));

    return import("./view_selector_printer.js");
}

describe("view_selector_printer", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        document.body.innerHTML = `
            <div class="body_wrapper">
                <div class="body_content"></div>
            </div>
        `;
        hasRoutePermissionMock.mockReturnValue(true);
        getDefaultViewSyncMock.mockReturnValue("table");
        getSelectedDatasetMock.mockReturnValue("demo_table");
        getParamsMock.mockReturnValue({});
        setParamsMock.mockReset();
        updateURLMock.mockReset();
        getCachedSearchResultForRenderMock.mockReturnValue(null);
    });

    test("moves the active highlight immediately on direct view button click", async () => {
        const { createGenericViewSelector } = await loadModule();
        const selector = createGenericViewSelector("demo_table", "card", [
            { label: "Artikkeli", viewKey: "article" },
            { label: "Taulu", viewKey: "table" },
            { label: "Kortti", viewKey: "card" },
        ]);
        document.body.appendChild(selector);

        const tableButton = selector.querySelector('[data-testid="view-btn-table"]');
        const cardButton = selector.querySelector('[data-testid="view-btn-card"]');
        const articleButton = selector.querySelector('[data-testid="view-btn-article"]');

        expect(cardButton.classList.contains("active")).toBe(true);
        expect(tableButton.classList.contains("active")).toBe(false);
        expect(articleButton.classList.contains("active")).toBe(false);
        expect(selector.querySelector(".view-selector-heading")?.textContent).toBe("Näkymät ja esitystavat");

        tableButton.click();

        expect(localStorage.getItem("demo_table_view")).toBe("table");
        expect(tableButton.classList.contains("active")).toBe(true);
        expect(tableButton.getAttribute("aria-pressed")).toBe("true");
        expect(cardButton.classList.contains("active")).toBe(false);
        expect(cardButton.getAttribute("aria-pressed")).toBe("false");
        expect(updateURLMock).toHaveBeenCalledWith("demo_table", { view: "table" });
        expect(refreshTableUnifiedMock).toHaveBeenCalledWith("demo_table");
    });

    test("applyViewStyling re-syncs selector buttons from stored view state", async () => {
        const { createGenericViewSelector, applyViewStyling } = await loadModule();
        const selector = createGenericViewSelector("demo_table", "card", [
            { label: "Taulu", viewKey: "table" },
            { label: "Kortti", viewKey: "card" },
        ]);
        document.body.appendChild(selector);
        localStorage.setItem("demo_table_view", "table");

        applyViewStyling("demo_table");

        const tableButton = selector.querySelector('[data-testid="view-btn-table"]');
        const cardButton = selector.querySelector('[data-testid="view-btn-card"]');
        expect(tableButton.classList.contains("active")).toBe(true);
        expect(cardButton.classList.contains("active")).toBe(false);
        expect(updateTabPathsForViewMock).toHaveBeenCalledWith("demo_table");
        expect(updateShowMenuButtonPositionMock).toHaveBeenCalled();
    });

    test("marks article view active while the row article is open", async () => {
        const { createGenericViewSelector } = await loadModule();
        const selector = createGenericViewSelector("demo_table", "card", [
            { label: "Kortti", viewKey: "card" },
            { label: "Artikkeli", viewKey: "article" },
            { label: "Taulu", viewKey: "table" },
        ]);
        document.body.appendChild(selector);
        document.body.insertAdjacentHTML(
            "beforeend",
            `
            <div id="demo_table_card_view_container">
                <div class="card_view_wrapper big-card-open"></div>
            </div>
            `
        );
        localStorage.setItem("demo_table_view", "card");

        document.dispatchEvent(new CustomEvent("row-article-toggle", {
            detail: { tableName: "demo_table", isOpen: true },
        }));

        const cardButton = selector.querySelector('[data-testid="view-btn-card"]');
        const articleButton = selector.querySelector('[data-testid="view-btn-article"]');
        expect(articleButton.classList.contains("active")).toBe(true);
        expect(articleButton.getAttribute("aria-pressed")).toBe("true");
        expect(cardButton.classList.contains("active")).toBe(false);
    });

    test("article button targets the first active search result instead of the stale expanded row", async () => {
        getParamsMock.mockReturnValue({ search: "firefox" });
        getCachedSearchResultForRenderMock.mockReturnValue({
            data: [
                { id: 7, title: "Firefox" },
                { id: 9, title: "Fennec" },
            ],
        });
        localStorage.setItem(
            "demo_table_sorting_and_filtering_specs",
            JSON.stringify({
                sort: { column: null, direction: null },
                filters: {},
                offset: 0,
                cardView: { collapsed: true, expandedId: 133 },
            })
        );
        const { createGenericViewSelector } = await loadModule();
        const selector = createGenericViewSelector("demo_table", "table", [
            { label: "Artikkeli", viewKey: "article" },
            { label: "Taulu", viewKey: "table" },
        ]);
        document.body.appendChild(selector);

        selector.querySelector('[data-testid="view-btn-article"]').click();

        await vi.waitFor(() => {
            expect(refreshTableUnifiedMock).toHaveBeenCalledWith("demo_table");
        });
        const storedState = JSON.parse(
            localStorage.getItem("demo_table_sorting_and_filtering_specs")
        );
        expect(setParamsMock).toHaveBeenCalledWith("demo_table", {
            search: "firefox",
            view: "article",
        });
        expect(updateURLMock).toHaveBeenCalledWith("demo_table", {
            search: "firefox",
            view: "table",
        }, undefined, { replace: true });
        expect(storedState.cardView).toEqual({
            collapsed: true,
            expandedId: 7,
            pendingAutoOpenFirstSearchResult: false,
            pendingAutoOpenFirstRenderedResult: false,
        });
    });

    test("article button prepares the first rendered row when no active search exists", async () => {
        const { createGenericViewSelector } = await loadModule();
        const selector = createGenericViewSelector("demo_table", "table", [
            { label: "Artikkeli", viewKey: "article" },
            { label: "Taulu", viewKey: "table" },
        ]);
        document.body.appendChild(selector);

        selector.querySelector('[data-testid="view-btn-article"]').click();

        await vi.waitFor(() => {
            expect(refreshTableUnifiedMock).toHaveBeenCalledWith("demo_table");
        });
        const storedState = JSON.parse(
            localStorage.getItem("demo_table_sorting_and_filtering_specs")
        );
        expect(setParamsMock).toHaveBeenCalledWith("demo_table", {
            view: "article",
        });
        expect(updateURLMock).toHaveBeenCalledWith("demo_table", {
            view: "table",
        }, undefined, { replace: true });
        expect(storedState.cardView).toEqual({
            collapsed: true,
            expandedId: null,
            pendingAutoOpenFirstSearchResult: false,
            pendingAutoOpenFirstRenderedResult: true,
        });
    });
});
