// @vitest-environment jsdom
// card_article_close_history.test.js
// Exercises Close, Back and Forward with the real retained list and address owners.
// Bridges a paged, selected DOM with the history handler; only navigation rendering is stubbed.
// Exists to catch a correct-looking Close that silently loses history or list state.
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    navigate: vi.fn(), refresh: vi.fn(), resume: vi.fn(), title: vi.fn(),
    pagination: { lastRowCount: 100, orientation: "vertical", isLoading: false },
}));
vi.mock("./navigation_handler.js", () => ({ handle_all_navigation: mocks.navigate }));
vi.mock("./browser_tab_title_writer.js", () => ({ updateBrowserTabTitle: mocks.title }));
vi.mock("./dataset_aliases.js", () => ({
    buildDatasetPath: (dataset, prefix = "/") => `${prefix}${dataset}`,
    getInternalDatasetName: dataset => dataset,
}));
vi.mock("../../dev_tools/function_counter.js", () => ({ count_this_function: () => {} }));
vi.mock("../../config_fetcher.js", () => ({ getDefaultViewSync: () => "card" }));
vi.mock("../../state_stores/table_specs_reader.js", () => ({ getAllSpecs: () => ({}) }));
vi.mock("../admin_and_user_tools/custom_view_reader.js", () => ({ custom_views: [] }));
vi.mock("../../front_page/custom_root_navigation.js", () => ({ loadCustomRootFromHistory: () => false }));
vi.mock("../../front_page/front_page_navigation.js", () => ({ isSeparateFrontPageEnabled: () => false, openFrontPage: vi.fn() }));
vi.mock("./image_first_view_history.js", () => ({ handleImageFirstViewHistory: () => false, isImageFirstViewURL: () => false }));
vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", async () => ({
    ...await import("../../state_stores/table_state_store.js"),
    refreshTableUnified: mocks.refresh, invalidateTableRefresh: vi.fn(),
}));

import { closeRowArticle } from "../../table_views/card_view/row_article_ui_handler.js";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { getChosenDatasetView, setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { primeDatasetAccessRegistry } from "./dataset_access_registry.js";
import { captureCardArticleReturn, getCardArticleOriginEntry, getCardArticleReturnToken, invalidateCardArticleReturn } from "./card_article_return_state.js";
import { ensureHistoryEntryId, HISTORY_ENTRY_ID, writeHistoryEntry } from "./history_entry_state.js";
import { useUrlParams } from "./query_params.js";
import { resetDatasetAddressOwnershipForTests } from "./dataset_address_writer.js";
import "./history_navigation_handler.js";

const adapter = {
    listPath: "/catalog", readSearchCache: () => undefined,
    readPagination: () => mocks.pagination, resumePagination: mocks.resume,
    disconnectPagination: vi.fn(), syncResultsCount: vi.fn(),
};

function renderArticle(rowId) {
    document.getElementById("catalog_card_view_container").style.display = "none";
    const host = document.getElementById("catalog_article_view_container");
    host.style.display = "block";
    host.innerHTML = `<div class="card_view_wrapper big-card-open" data-view-key="article_view" data-table-name="catalog">
        <div class="card_container"></div><article class="active_row_article" data-id="${rowId}"></article></div>`;
    document.querySelector(".tab_parts_container").dataset.view = "article_view";
    setChosenDatasetView("catalog", "article_view");
    setUnifiedTableState("catalog", { articleView: { collapsed: true, expandedId: rowId, returnView: "card" } });
}

function visitArticle(rowId, first = false) {
    const origin = getCardArticleOriginEntry("catalog");
    writeHistoryEntry(`/catalog/${rowId}?view=article_view`, {
        bigCard: true, dataset: "catalog", rowId, articleOriginEntry: origin, articleReturnAvailable: first,
    });
    useUrlParams();
    renderArticle(rowId);
    return history.state[HISTORY_ENTRY_ID];
}

function closeArticle() {
    const host = document.getElementById("catalog_article_view_container");
    closeRowArticle(host.querySelector(".card_view_wrapper"), host.querySelector(".card_container"),
        host.querySelector(".active_row_article"), null, "catalog", false, { restoreScroll: false });
}

async function traverse(direction, entryId) {
    const titles = mocks.title.mock.calls.length;
    history[direction]();
    await vi.waitFor(() => {
        expect(history.state[HISTORY_ENTRY_ID]).toBe(entryId);
        expect(mocks.title.mock.calls.length).toBeGreaterThan(titles);
    });
}

beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
    invalidateCardArticleReturn(); resetDatasetAddressOwnershipForTests();
    primeDatasetAccessRegistry({ datasets: [{ table_uid: 11, dataset_name: "catalog", names: ["catalog"], preferred_name: "catalog" }] });
    sessionStorage.setItem("user_permissions", JSON.stringify(["/ui/view/article_view"]));
    window.scrollTo = vi.fn(); window.__bigCardClosing = false;
    document.documentElement.lang = "fi";
    history.replaceState({}, "", "/catalog?view=card"); useUrlParams();
    document.body.innerHTML = `<div id="catalog_container"><div class="tab_parts_container" data-view="card">
        <div id="catalog_card_view_container" class="scrollable_content" style="display:block">
            <div class="card_view_wrapper"><div class="card_container"><div class="card" data-id="3">
                <input type="checkbox" checked></div><div class="card" data-id="4"></div></div></div>
        </div><div id="catalog_article_view_container" class="scrollable_content" style="display:none"></div>
    </div></div>`;
    setChosenDatasetView("catalog", "card");
    setUnifiedTableState("catalog", { offset: 80, cardView: { collapsed: false } });
    mocks.pagination = { lastRowCount: 100, orientation: "vertical", isLoading: false };
    // This is the navigation pipeline's rendering boundary. The actual Close,
    // popstate handler, retained snapshot, scroll and history writers run above.
    mocks.navigate.mockImplementation(async (_dataset, _views, options) => {
        if (!options.isCurrentNavigation()) return;
        if (options.restoreMountedView) {
            expect(options.restoreMountedView.isCurrent()).toBe(true);
            expect(options.restoreMountedView.commit()).toBe(true);
        } else {
            expect(options.preserveCardReturn).toBe(getCardArticleReturnToken("catalog"));
            renderArticle(location.pathname.split("/")[2]);
        }
    });
});

test("paged list → A → B → A → Close preserves every visit and returns the same selection and scroll", async () => {
    const host = document.getElementById("catalog_card_view_container");
    const firstCard = host.querySelector(".card");
    host.scrollTop = 4600;
    captureCardArticleReturn("catalog", adapter);
    const initialList = ensureHistoryEntryId();
    const firstA = visitArticle("3", true), b = visitArticle("4"), secondA = visitArticle("3");
    closeArticle();
    await vi.waitFor(() => expect(getChosenDatasetView("catalog")).toBe("card"));
    const closedList = history.state[HISTORY_ENTRY_ID];
    const assertList = (scroll = 4600, offset = 80) => {
        expect(location.pathname).toBe("/catalog");
        expect(host.style.display).toBe("block");
        expect(host.querySelector(".card")).toBe(firstCard);
        expect(firstCard.querySelector("input").checked).toBe(true);
        expect(host.scrollTop).toBe(scroll);
        expect(getUnifiedTableState("catalog").offset).toBe(offset);
        expect(mocks.refresh).not.toHaveBeenCalled();
    };
    assertList();
    expect(mocks.resume).toHaveBeenLastCalledWith(expect.objectContaining({ lastRowCount: 100 }));
    for (const [entry, row] of [[secondA, "3"], [b, "4"], [firstA, "3"]]) {
        await traverse("back", entry);
        expect(location.pathname).toBe(`/catalog/${row}`);
        expect(document.querySelector(".active_row_article").dataset.id).toBe(row);
    }
    await traverse("back", initialList); assertList();
    // Pagination and selection remain live, not just a picture of the old list.
    host.scrollTop = 5300; setUnifiedTableState("catalog", { offset: 100 });
    mocks.pagination.lastRowCount = 120;
    for (const entry of [firstA, b, secondA]) await traverse("forward", entry);
    await traverse("forward", closedList); assertList(5300, 100);
    expect(mocks.resume).toHaveBeenLastCalledWith(expect.objectContaining({ lastRowCount: 120 }));

    const token = getCardArticleReturnToken("catalog");
    expect(captureCardArticleReturn("catalog", adapter)).toBe(token);
    const c = visitArticle("5", true), d = visitArticle("6"); closeArticle();
    await vi.waitFor(() => expect(getChosenDatasetView("catalog")).toBe("card"));
    assertList(5300, 100);
    await traverse("back", d);
    await traverse("back", c);
    await traverse("back", closedList); assertList(5300, 100);
});

test("a delayed Close cannot restore its list over a newer navigation", async () => {
    const host = document.getElementById("catalog_card_view_container");
    captureCardArticleReturn("catalog", adapter);
    visitArticle("3", true); visitArticle("4"); closeArticle();
    writeHistoryEntry("/other?view=table", { dataset: "other" });
    const newerEntry = history.state[HISTORY_ENTRY_ID];
    await vi.dynamicImportSettled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(location.pathname).toBe("/other");
    expect(history.state[HISTORY_ENTRY_ID]).toBe(newerEntry);
    expect(host.style.display).toBe("none");
});
