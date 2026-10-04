// @vitest-environment jsdom
// history_navigation_alias_round_trip.test.js
// Verifies a row link under a dataset's public alias, then browser Back and Forward, with
// the real alias registry, query cache, address owner, tab state and history handler.
// Bridges the address the article opener writes and the popstate restoration that reads it.
// Exists because the history and address tests replace alias resolution with an identity
// mock, so the public alias and the internal dataset name never met in a test (WL137 review).

import { expect, test, vi } from "vitest";

const shell = vi.hoisted(() => ({
    navigate: vi.fn(async () => ({})),
    // The real close takes the open article down; that is all Forward depends on.
    closeArticle: vi.fn((wrapper) => wrapper.classList.remove("big-card-open")),
}));

// Only drawing, the network and permissions are replaced.
vi.mock("./navigation_handler.js", () => ({ handle_all_navigation: shell.navigate }));
vi.mock("../../table_views/card_view/row_article_ui_handler.js", () => ({ closeRowArticle: shell.closeArticle }));
vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", async () => {
    const store = await import("../../state_stores/table_state_store.js");
    return {
        getUnifiedTableState: store.getUnifiedTableState,
        setUnifiedTableState: store.setUnifiedTableState,
        invalidateTableRefresh: vi.fn(),
    };
});
vi.mock("./card_article_return_state.js", () => ({
    canRestoreCardArticleReturn: () => false,
    restoreCardArticleReturn: () => false,
    getCardArticleReturnToken: () => null,
    refreshCardArticleReturnViewport: vi.fn(),
}));
vi.mock("./image_first_view_history.js", () => ({
    handleImageFirstViewHistory: async () => false,
    isImageFirstViewURL: () => false,
}));
vi.mock("./browser_tab_title_writer.js", () => ({ updateBrowserTabTitle: async () => true }));
vi.mock("../admin_and_user_tools/custom_view_reader.js", () => ({ custom_views: [] }));
// The registry's built-in alias names app_service_catalog "service_catalog"; no
// alias request runs, so its network and permission modules stay inert.
vi.mock("../../endpoints/endpoint_router.js", () => ({ endpoint_router: vi.fn() }));
vi.mock("../../route_permission_checker.js", () => ({ hasRoutePermission: () => false }));

const DATASET = "app_service_catalog";
const LIST_ADDRESS = "/service_catalog?search=ferry&view=card";
const ROW_ADDRESS = "/service_catalog/5-harbour-ferry?search=ferry&view=article_view";

const address = () => location.pathname + location.search;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const sharedParams = () => JSON.parse(localStorage.getItem("dataset_query_params"));

test("an alias row link, Back and Forward keep the internal dataset's state under the alias address", async () => {
    history.replaceState({}, "", LIST_ADDRESS);
    const query = await import("./query_params.js");
    const store = await import("../../state_stores/table_state_store.js");
    const views = await import("../../state_stores/dataset_view_choice_saver.js");
    const { writeHistoryEntry } = await import("./history_entry_state.js");
    const { updateDatasetAddress } = await import("./dataset_address_writer.js");
    const { buildCardUrl } = await import("../../table_views/card_view/row_article_opener_helpers.js");
    const { buildRowArticleQueryString } = await import("../../table_views/card_view/row_article_url_state.js");
    await import("./history_navigation_handler.js");
    views.setChosenDatasetView(DATASET, "card");
    expect(query.getParams(DATASET)).toEqual({ search: "ferry", view: "card" });

    // The row link, written the way openRowArticleView writes it.
    views.setChosenDatasetView(DATASET, "article_view");
    writeHistoryEntry(buildCardUrl("/", DATASET, 5, "harbour-ferry") + buildRowArticleQueryString(DATASET),
        { bigCard: true, dataset: DATASET, rowId: "5" });
    store.setUnifiedTableState(DATASET, { articleView: { collapsed: true, expandedId: 5 } });
    document.body.innerHTML = `<div id="${DATASET}_container">
        <div class="tab_parts_container" data-view="article_view"></div>
        <div class="card_view_wrapper big-card-open" data-table-name="${DATASET}">
            <div class="card_container"></div><article class="active_row_article"></article>
        </div></div>`;
    await updateDatasetAddress({ dataset: DATASET });
    expect(address()).toBe(ROW_ADDRESS);
    const entries = history.length;

    history.back();
    await vi.waitFor(() => expect(shell.navigate).toHaveBeenCalledTimes(1));
    await settle();
    expect(address()).toBe(LIST_ADDRESS);
    expect(shell.closeArticle).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), null, DATASET, true);
    expect(shell.navigate).toHaveBeenLastCalledWith(DATASET, [], expect.objectContaining({ skipUrlUpdate: true, forceReload: true }));
    expect(query.getParams(DATASET)).toEqual({ search: "ferry", view: "card" });
    expect(views.getChosenDatasetView(DATASET)).toBe("card");
    expect(store.getUnifiedTableState(DATASET).articleView.expandedId).toBeNull();

    history.forward();
    await vi.waitFor(() => expect(shell.navigate).toHaveBeenCalledTimes(2));
    await settle();
    expect(address()).toBe(ROW_ADDRESS);
    expect(shell.navigate).toHaveBeenLastCalledWith(DATASET, [], expect.objectContaining({ skipUrlUpdate: true, forceReload: true }));
    expect(query.getParams(DATASET)).toEqual({ search: "ferry", view: "article_view" });
    expect(views.getChosenDatasetView(DATASET)).toBe("article_view");
    expect(String(store.getUnifiedTableState(DATASET).articleView.expandedId)).toBe("5");

    // Neither step added a history entry, and every stored value sits under the
    // internal name: the view and open row in this tab, only the search shared.
    expect(history.length).toBe(entries);
    expect(sharedParams()).toEqual({ [DATASET]: { search: "ferry" } });
    expect(sessionStorage.getItem(`${DATASET}_open_row`)).not.toBeNull();
    for (const key of ["service_catalog_view", "service_catalog_open_row"]) {
        expect(sessionStorage.getItem(key)).toBeNull();
    }
    expect(localStorage.getItem(`${DATASET}_open_row`)).toBeNull();
});
