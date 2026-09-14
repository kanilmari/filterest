// @vitest-environment jsdom
// card_article_return_state.test.js
// Verifies retained card metadata, viewport and invalidation.
// Bridges mounted DOM, history identity, pagination and access events.
// Exists to prevent stale rows and lost scroll during article return.
import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
    accessListener: null, cache: {}, pagination: { lastRowCount: 100, orientation: "vertical", isLoading: false },
    resume: vi.fn(), disconnect: vi.fn(), count: vi.fn(),
}));
vi.mock("./dataset_access_registry.js", () => ({
    subscribeDatasetAccessRegistry: listener => { mocks.accessListener = listener; return () => {}; },
}));
import * as retained from "./card_article_return_state.js";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { HISTORY_ENTRY_ID, writeHistoryEntry } from "./history_entry_state.js";

const adapter = {
    listPath: "/catalog",
    readSearchCache: () => mocks.cache.catalog,
    readPagination: () => ({ ...mocks.pagination }),
    resumePagination: snapshot => mocks.resume("catalog", snapshot),
    disconnectPagination: () => mocks.disconnect("catalog"),
    syncResultsCount: (_query, _cache, count) => mocks.count("catalog", count),
};

function fixture(search = "") {
    history.replaceState({}, "", "/catalog?view=card" + search);
    document.documentElement.lang = "fi";
    document.body.innerHTML = `<div id="catalog_container"><div class="tab_parts_container" data-view="card">
      <div id="catalog_filterBar_panel"></div>
      <div id="catalog_card_view_container" class="scrollable_content" style="display:block"><div class="dataset-results-surface">
        <div id="catalog_card_top_controls"></div><div class="card_view_wrapper"><div class="card_container"><div class="card" data-id="3">Harbour</div></div></div>
      </div></div><div id="catalog_article_view_container" class="scrollable_content" style="display:none"></div>
    </div></div>`;
    localStorage.setItem("catalog_view", "card");
    localStorage.setItem("catalog_columns", '["title"]');
    localStorage.setItem("catalog_dataTypes", '{"title":{"is_multilingual":true}}');
    localStorage.setItem("catalog_tableMeta", '{"fieldset":"card"}');
    setUnifiedTableState("catalog", { offset: 80, filters: { category: "port" }, sort: { column: "id", direction: "DESC" }, cardView: { collapsed: false } });
    const host = document.getElementById("catalog_card_view_container");
    host.scrollTop = 4600; host.scrollLeft = 12;
    return host;
}
function openArticle(host) {
    const originState = { ...history.state };
    const articleParams = new URLSearchParams(location.search);
    articleParams.set("view", "article_view");
    writeHistoryEntry("/catalog/3?" + articleParams.toString(), {
        bigCard: true, articleOriginEntry: originState[HISTORY_ENTRY_ID],
    });
    localStorage.setItem("catalog_view", "article_view");
    host.style.display = "none"; host.scrollTop = 0;
    localStorage.setItem("catalog_columns", '["article_only"]');
    localStorage.setItem("catalog_dataTypes", '{"article_only":{}}');
    localStorage.setItem("catalog_tableMeta", '{"fieldset":"article"}');
    setUnifiedTableState("catalog", { offset: 20, articleView: { collapsed: true, expandedId: 3 } });
    return originState;
}
beforeEach(() => {
    retained.invalidateCardArticleReturn(); localStorage.clear(); vi.clearAllMocks();
    for (const key of Object.keys(mocks.cache)) delete mocks.cache[key];
    mocks.pagination.isLoading = false;
});

test("Back restores the same card nodes, metadata, filters, offset and inner viewport without data loading", () => {
    const host = fixture(); const row = host.querySelector(".card");
    const token = retained.captureCardArticleReturn("catalog", adapter);
    const original = openArticle(host);
    expect(retained.shouldPreserveCardReturnHost("catalog", token, host)).toBe(true);
    const panel = document.getElementById("catalog_filterBar_panel");
    panel.__syncActiveView = vi.fn(() => { expect(host.style.display).toBe("block"); });
    history.replaceState(original, "", "/catalog?view=card");
    expect(retained.restoreCardArticleReturn("catalog")).toBe(true);
    expect(host.querySelector(".card")).toBe(row);
    expect(host.scrollTop).toBe(4600); expect(host.scrollLeft).toBe(12);
    expect(JSON.parse(localStorage.getItem("catalog_dataTypes")).title.is_multilingual).toBe(true);
    expect(JSON.parse(localStorage.getItem("catalog_tableMeta")).fieldset).toBe("card");
    expect(getUnifiedTableState("catalog")).toMatchObject({ offset: 80, filters: { category: "port" }, cardView: { collapsed: false } });
    expect(panel.__syncActiveView).toHaveBeenCalledOnce();
    expect(mocks.resume).toHaveBeenCalledWith("catalog", expect.objectContaining({ lastRowCount: 100 }));
    // Further scrolling/pagination before Forward becomes the next return point.
    host.scrollTop = 5200;
    setUnifiedTableState("catalog", { offset: 100 });
    // Forward's article entry can preserve the same card pair for another Back.
    writeHistoryEntry("/catalog/3?view=article_view", { bigCard: true, articleOriginEntry: original[HISTORY_ENTRY_ID] });
    retained.refreshCardArticleReturnViewport("catalog");
    expect(retained.getCardArticleReturnToken("catalog")).toBe(token);
    host.scrollTop = 0;
    localStorage.setItem("catalog_view", "article_view");
    history.replaceState(original, "", "/catalog?view=card");
    expect(retained.restoreCardArticleReturn("catalog")).toBe(true);
    expect(host.scrollTop).toBe(5200);
    expect(getUnifiedTableState("catalog").offset).toBe(100);
});

test.each(["query", "language", "detached", "refresh", "unknown entry"])("%s invalidates a return before commit", reason => {
    const host = fixture(); retained.captureCardArticleReturn("catalog", adapter);
    const original = openArticle(host);
    history.replaceState(original, "", "/catalog?view=card");
    if (reason === "query") history.replaceState(original, "", "/catalog?view=card&status=new");
    if (reason === "language") document.documentElement.lang = "en";
    if (reason === "detached") host.querySelector(".card_view_wrapper").remove();
    if (reason === "refresh") retained.invalidateCardArticleReturn("catalog");
    if (reason === "unknown entry") history.replaceState({}, "", "/catalog?view=card");
    expect(retained.restoreCardArticleReturn("catalog")).toBe(false);
    expect(mocks.resume).not.toHaveBeenCalled();
});

test("permission reset releases hidden protected rows and denies the cached return", () => {
    const host = fixture(); retained.captureCardArticleReturn("catalog", adapter); const original = openArticle(host);
    mocks.accessListener();
    expect(host.childElementCount).toBe(0);
    history.replaceState(original, "", "/catalog?view=card");
    expect(retained.canRestoreCardArticleReturn("catalog")).toBe(false);
});

test("only the completed original search can return; a replaced stream cache cannot resurrect rows", () => {
    const host = fixture("&search=harbour");
    mocks.cache.catalog = { query: "harbour", complete: false };
    expect(retained.captureCardArticleReturn("catalog", adapter)).toBeNull();
    mocks.cache.catalog.complete = true;
    expect(retained.captureCardArticleReturn("catalog", adapter)).not.toBeNull();
    const original = openArticle(host);
    mocks.cache.catalog = { query: "harbour", complete: true };
    history.replaceState(original, "", "/catalog?view=card&search=harbour");
    expect(retained.restoreCardArticleReturn("catalog")).toBe(false);
});

test("pending ordinary pagination retains committed cards and resumes at their offset on the no-view URL", () => {
    const host = fixture(), card = host.querySelector(".card");
    const returnURL = "/catalog?sort_column=__newest&sort_order=DESC";
    history.replaceState({}, "", returnURL);
    mocks.pagination.isLoading = true;
    const token = retained.captureCardArticleReturn("catalog", adapter);
    expect(token).not.toBeNull();
    const origin = openArticle(host);
    expect(retained.shouldPreserveCardReturnHost("catalog", token, host)).toBe(true);
    history.replaceState(origin, "", returnURL);
    expect(retained.restoreCardArticleReturn("catalog")).toBe(true);
    expect(host.querySelector(".card")).toBe(card);
    expect(host.scrollTop).toBe(4600);
    expect(getUnifiedTableState("catalog").offset).toBe(80);
    expect(mocks.disconnect).toHaveBeenCalledWith("catalog");
    expect(mocks.resume).toHaveBeenCalledWith("catalog", {
        lastRowCount: 100, orientation: "vertical", isLoading: false,
    });
});

test("Forward during the next page retains the latest committed offset and viewport", () => {
    const host = fixture();
    const token = retained.captureCardArticleReturn("catalog", adapter);
    const origin = openArticle(host);
    history.replaceState(origin, "", "/catalog?view=card");
    expect(retained.restoreCardArticleReturn("catalog")).toBe(true);
    host.scrollTop = 5300;
    setUnifiedTableState("catalog", { offset: 100 });
    mocks.pagination.isLoading = true;
    writeHistoryEntry("/catalog/3?view=article_view", {
        bigCard: true, articleOriginEntry: origin[HISTORY_ENTRY_ID],
    });
    retained.refreshCardArticleReturnViewport("catalog");
    expect(retained.getCardArticleReturnToken("catalog")).toBe(token);
    host.style.display = "none"; host.scrollTop = 0;
    localStorage.setItem("catalog_view", "article_view");
    history.replaceState(origin, "", "/catalog?view=card");
    expect(retained.restoreCardArticleReturn("catalog")).toBe(true);
    expect(host.scrollTop).toBe(5300);
    expect(getUnifiedTableState("catalog").offset).toBe(100);
    expect(mocks.resume).toHaveBeenLastCalledWith("catalog", {
        lastRowCount: 100, orientation: "vertical", isLoading: false,
    });
});

test("return-state initialization does not initialize the search/renderer graph", async () => {
    vi.resetModules();
    vi.doMock("../../filterbar/text_search/dataset_search_runtime_state.js", () => {
        throw new Error("eager search initialization");
    });
    vi.doMock("../../infinite_scroll/infinite_scroll_handler.js", () => {
        throw new Error("eager renderer initialization");
    });
    try {
        const module = await import("./card_article_return_state.js");
        expect(module.canRestoreCardArticleReturn("catalog")).toBe(false);
    } finally {
        vi.doUnmock("../../filterbar/text_search/dataset_search_runtime_state.js");
        vi.doUnmock("../../infinite_scroll/infinite_scroll_handler.js");
    }
});


test("cards repair only their inconsistent row origin before capture", () => {
    const host = fixture(), card = host.querySelector(".card");
    const entryId = "owner-card-entry";
    history.replaceState({ [HISTORY_ENTRY_ID]: entryId, bigCard: true, dataset: "catalog", rowId: "64", articleOriginEntry: "old", articleReturnAvailable: true, otherOwner: { keep: 7 } }, "", "/catalog/64-old?sort_column=__newest&sort_order=DESC&view=article_view#section");
    const token = retained.captureCardArticleReturn("catalog", adapter);
    expect(token).not.toBeNull();
    expect(location.pathname + location.search + location.hash).toBe("/catalog?sort_column=__newest&sort_order=DESC&view=card#section");
    expect(history.state).toEqual({ [HISTORY_ENTRY_ID]: entryId, otherOwner: { keep: 7 } });
    const origin = openArticle(host);
    history.replaceState(origin, "", "/catalog?sort_column=__newest&sort_order=DESC&view=card#section");
    expect(retained.restoreCardArticleReturn("catalog")).toBe(true);
    expect(host.querySelector(".card")).toBe(card);
    expect(host.scrollTop).toBe(4600);
    expect(getUnifiedTableState("catalog").offset).toBe(80);
});

test("a correct no-view list entry and unrelated state are untouched", () => {
    fixture();
    const url = "/catalog?sort_column=__newest&sort_order=DESC#rows";
    const state = { [HISTORY_ENTRY_ID]: "correct-list", otherOwner: 3 };
    history.replaceState(state, "", url);
    const replacing = vi.spyOn(history, "replaceState");
    try {
        expect(retained.captureCardArticleReturn("catalog", adapter)).not.toBeNull();
        expect(location.pathname + location.search + location.hash).toBe(url);
        expect(history.state).toEqual(state);
        expect(replacing).not.toHaveBeenCalled();
    } finally { replacing.mockRestore(); }
});

test.each(["hidden host", "different active view", "other dataset", "different prefix", "incomplete search"])("%s cannot rewrite history or retain a stale card origin", reason => {
    const host = fixture();
    let url = "/catalog/64-old?view=article_view";
    if (reason === "hidden host") host.style.display = "none";
    if (reason === "different active view") document.querySelector(".tab_parts_container").dataset.view = "article_view";
    if (reason === "other dataset") url = "/other_catalog/64-old?view=article_view";
    if (reason === "different prefix") url = "/admin/catalog/64-old?view=article_view";
    if (reason === "incomplete search") {
        url += "&search=harbour";
        mocks.cache.catalog = { query: "harbour", complete: false };
    }
    const state = { [HISTORY_ENTRY_ID]: "untouched", bigCard: true, rowId: "64" };
    history.replaceState(state, "", url);
    expect(retained.captureCardArticleReturn("catalog", adapter)).toBeNull();
    expect(location.pathname + location.search).toBe(url);
    expect(history.state).toEqual(state);
});

test.each([
    { url: "/catalog?view=article_view", state: {} },
    { url: "/catalog?view=card", state: { bigCard: true, rowId: "64" } },
])("a visible card list replaces stale view or article state without adding a history entry: $url", ({ url, state }) => {
    fixture();
    history.replaceState({ ...state, [HISTORY_ENTRY_ID]: "same-entry", otherOwner: true }, "", url);
    const length = history.length;
    expect(retained.captureCardArticleReturn("catalog", adapter)).not.toBeNull();
    expect(location.pathname + location.search).toBe("/catalog?view=card");
    expect(history.state).toEqual({ [HISTORY_ENTRY_ID]: "same-entry", otherOwner: true });
    expect(history.length).toBe(length);
});
