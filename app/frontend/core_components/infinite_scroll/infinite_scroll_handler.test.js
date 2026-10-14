// infinite_scroll_handler.test.js
// Verifies wide table infinite-scroll sentinels span the horizontal scroll range,
// and that a committed search is paged like any other condition of the listing.
// Uses jsdom with mocked render/fetch dependencies so sentinel layout can be tested in isolation.
// Exists to keep vertical infinite scroll working after users scroll wide tables horizontally.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setChosenDatasetView } from "../state_stores/dataset_view_choice_saver.js";

const {
    appendDataToCardViewMock,
    appendDataToTableMock,
    fetchDatasetDataMock,
    getUnifiedTableStateMock,
    intersectionObservers,
    setResultsCountMock,
    setUnifiedTableStateMock,
} = vi.hoisted(() => ({
    appendDataToCardViewMock: vi.fn(),
    appendDataToTableMock: vi.fn(),
    fetchDatasetDataMock: vi.fn(),
    getUnifiedTableStateMock: vi.fn(() => ({ offset: 0, filters: {} })),
    intersectionObservers: [],
    setResultsCountMock: vi.fn(),
    setUnifiedTableStateMock: vi.fn(),
}));

vi.mock("../endpoints/endpoint_data_fetcher.js", () => ({
    fetchDatasetData: fetchDatasetDataMock,
}));

vi.mock("../table_views/table_view/table_row_printer.js", () => ({
    appendDataToTable: appendDataToTableMock,
}));

vi.mock("../table_views/card_view/card_view_printer.js", () => ({
    appendDataToCardView: appendDataToCardViewMock,
}));

vi.mock("../../reusable_components/results_count/results_count_printer.js", () => ({
    setResultsCount: setResultsCountMock,
}));

vi.mock("../state_stores/table_state_store.js", () => ({
    getUnifiedTableState: getUnifiedTableStateMock,
    setUnifiedTableState: setUnifiedTableStateMock,
}));

class MockIntersectionObserver {
    constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        this.observe = vi.fn();
        this.disconnect = vi.fn();
        intersectionObservers.push(this);
    }
}

function setReadOnlyNumber(element, propertyName, getValue) {
    Object.defineProperty(element, propertyName, {
        configurable: true,
        get: getValue,
    });
}

function createWideTableView(tableName, widths) {
    document.body.innerHTML = `
        <div id="${tableName}_table_view_container">
            <table data-columns='["id"]' data-data-types='{"id":"integer"}'>
                <tbody></tbody>
            </table>
        </div>
    `;
    setChosenDatasetView(tableName, "table");

    const container = document.getElementById(`${tableName}_table_view_container`);
    const table = container.querySelector("table");
    setReadOnlyNumber(container, "clientWidth", () => widths.container);
    setReadOnlyNumber(table, "scrollWidth", () => widths.table);
    setReadOnlyNumber(table, "offsetWidth", () => widths.table);

    return { container, table };
}

/** Put a committed text search on a dataset, the way the search field does. */
function commitSearch(tableName, search) {
    localStorage.setItem(
        "dataset_query_params",
        JSON.stringify({ [tableName]: { search } })
    );
}

function createCardView(tableName, { collapsed = false } = {}) {
    document.body.innerHTML = `
        <div id="${tableName}_card_view_container">
            <div class="card_view_wrapper">
                <div class="card_container"></div>
            </div>
        </div>
    `;
    setChosenDatasetView(tableName, "card");
    getUnifiedTableStateMock.mockReturnValue({
        offset: 0,
        filters: {},
        cardView: { collapsed },
    });

    return {
        container: document.getElementById(`${tableName}_card_view_container`),
        cardContainer: document.querySelector(`#${tableName}_card_view_container .card_container`),
    };
}

describe("initializeInfiniteScroll", () => {
    test.each([0, 2])("does not page an already complete initial listing with %s rows", async rowCount => {
        createCardView("complete_cards");
        getUnifiedTableStateMock.mockReturnValue({ offset: rowCount, filters: {} });
        const scroll = await import("./infinite_scroll_handler.js");
        scroll.seedInfiniteScrollRowCount("complete_cards", rowCount);
        scroll.initializeInfiniteScroll("complete_cards");
        intersectionObservers.at(-1)?.callback([{ isIntersecting: true }]);
        await Promise.resolve();
        scroll.disconnectInfiniteScroll("complete_cards");
        expect(fetchDatasetDataMock).not.toHaveBeenCalled();
        expect(document.getElementById("complete_cards_infinite_scroll_sentinel")).toBeNull();
    });

    test("a queued observer notification cannot page past the total just loaded", async () => {
        createCardView("last_cards");
        let state = { offset: 1, filters: {} };
        getUnifiedTableStateMock.mockImplementation(() => state);
        setUnifiedTableStateMock.mockImplementation((_name, next) => { state = next; });
        fetchDatasetDataMock.mockResolvedValue({ data: [{ id: 2 }], row_count: 2 });
        const scroll = await import("./infinite_scroll_handler.js");
        scroll.seedInfiniteScrollRowCount("last_cards", 2);
        scroll.initializeInfiniteScroll("last_cards");
        const observer = intersectionObservers.at(-1);
        observer.callback([{ isIntersecting: true }]);
        await vi.waitFor(() => expect(state.offset).toBe(2));
        observer.callback([{ isIntersecting: true }]);
        await Promise.resolve();
        scroll.disconnectInfiniteScroll("last_cards");
        expect(fetchDatasetDataMock).toHaveBeenCalledTimes(1);
    });

    test.each(["search", "filter", "mode", "sort"])("an old completed count cannot close a changed %s listing", async change => {
        createCardView("changed_cards");
        const state = { offset: 2, filters: { row_group: "boat" }, sort: { column: "id", direction: "ASC" } };
        getUnifiedTableStateMock.mockReturnValue(state);
        const scroll = await import("./infinite_scroll_handler.js");
        scroll.seedInfiniteScrollRowCount("changed_cards", 2);
        if (change === "search") {
            const { setParams } = await import("../navigation/nav_engine/query_params.js");
            setParams("changed_cards", { search: "new question" });
        }
        else if (change === "filter") state.filters.row_group = "train";
        else if (change === "mode") state.filters.row_group_mode = "1:all";
        else state.sort.direction = "DESC";
        fetchDatasetDataMock.mockResolvedValue({ data: [], row_count: 0 });
        scroll.initializeInfiniteScroll("changed_cards");
        const observer = intersectionObservers.at(-1);
        expect(observer).toBeDefined();
        observer.callback([{ isIntersecting: true }]);
        await Promise.resolve();
        scroll.disconnectInfiniteScroll("changed_cards");
        expect(fetchDatasetDataMock).toHaveBeenCalledOnce();
        expect(fetchDatasetDataMock).toHaveBeenCalledWith(expect.objectContaining({ row_count: null }));
    });

    test('listing reload never appends replacement rows into a surface owned by the renamed UID', async () => {
        const { datasetAppearanceState } = await import('../table_views/dataset_appearance_state.js');
        const { setAllSpecs } = await import('../state_stores/table_specs_reader.js');
        const { DEFAULT_DATASET_APPEARANCE } = await import('../../shared/dataset_appearance/validator.js');
        const { reloadDatasetRowsFromListing, disconnectInfiniteScroll } = await import('./infinite_scroll_handler.js');
        const { container } = createWideTableView('former_orders', { container: 480, table: 900 });
        setAllSpecs({ former_orders: { table_uid: 22 }, renamed: { table_uid: 11 } });
        datasetAppearanceState.bind(container, 'renamed', 11);
        fetchDatasetDataMock.mockResolvedValue({ data: [{ id: 1 }], row_count: 1, types: {}, dataset_appearance:
            { dataset_uid: 22, schema_version: 1, version: '1', overrides: {}, effective: DEFAULT_DATASET_APPEARANCE } });
        expect(await reloadDatasetRowsFromListing('former_orders')).toBeNull();
        expect(appendDataToTableMock).not.toHaveBeenCalled();
        expect(container.dataset.datasetAppearanceUid).toBe('11');
        expect(datasetAppearanceState.savedSnapshot('former_orders')).toBeNull();
        disconnectInfiniteScroll('former_orders');
    });
    test.each(['ownership', 'mismatched snapshot'])('listing reload and infinite scroll discard a late %s snapshot', async reason => {
        const { datasetAppearanceState } = await import('../table_views/dataset_appearance_state.js');
        const { setAllSpecs } = await import('../state_stores/table_specs_reader.js');
        const { DEFAULT_DATASET_APPEARANCE } = await import('../../shared/dataset_appearance/validator.js');
        const { reloadDatasetRowsFromListing, disconnectInfiniteScroll } = await import('./infinite_scroll_handler.js');
        createWideTableView('private_orders', { container: 480, table: 900 });
        const snapshot = { dataset_uid: 11, schema_version: 1, version: '1', overrides: {}, effective: DEFAULT_DATASET_APPEARANCE };
        setAllSpecs({ private_orders: { table_uid: 11 } });
        datasetAppearanceState.accept('private_orders', snapshot);
        let complete;
        fetchDatasetDataMock.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
        const pending = reloadDatasetRowsFromListing('private_orders');
        await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
        if (reason === 'ownership') setAllSpecs({ private_orders: { table_uid: 22 }, renamed: { table_uid: 11 } });
        complete({ data: [{ id: 1 }], row_count: 1, types: {}, dataset_appearance:
            { ...snapshot, dataset_uid: reason === 'ownership' ? 11 : 22 } });
        expect(await pending).toBeNull();
        expect(appendDataToTableMock).not.toHaveBeenCalled();
        disconnectInfiniteScroll('private_orders');
    });
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.useFakeTimers();
        localStorage.clear();
        sessionStorage.clear();
        document.body.innerHTML = "";
        intersectionObservers.length = 0;
        globalThis.IntersectionObserver = MockIntersectionObserver;
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        delete globalThis.IntersectionObserver;
    });

    test("makes the table sentinel span a horizontally scrollable table", async () => {
        const { container } = createWideTableView("wide_orders", {
            container: 480,
            table: 1600,
        });

        const { disconnectInfiniteScroll, initializeInfiniteScroll } = await import(
            "./infinite_scroll_handler.js"
        );

        initializeInfiniteScroll("wide_orders");

        const sentinel = document.getElementById("wide_orders_infinite_scroll_sentinel");
        expect(sentinel.style.width).toBe("1600px");
        expect(sentinel.style.minWidth).toBe("100%");
        expect(intersectionObservers[0].options.root).toBe(container);
        expect(intersectionObservers[0].observe).toHaveBeenCalledWith(sentinel);

        disconnectInfiniteScroll("wide_orders");
    });

    test("resyncs the sentinel width when appended rows widen the table", async () => {
        const widths = { container: 520, table: 900 };
        createWideTableView("wide_orders", widths);

        const {
            appendDataToView,
            disconnectInfiniteScroll,
            initializeInfiniteScroll,
        } = await import("./infinite_scroll_handler.js");

        initializeInfiniteScroll("wide_orders");
        const sentinel = document.getElementById("wide_orders_infinite_scroll_sentinel");
        expect(sentinel.style.width).toBe("900px");

        widths.table = 2200;
        await appendDataToView("wide_orders", [{ id: 2 }]);

        expect(appendDataToTableMock).toHaveBeenCalled();
        expect(sentinel.style.width).toBe("2200px");

        disconnectInfiniteScroll("wide_orders");
    });

    test("uses the visible card view container as the observer root before article mode", async () => {
        const { container, cardContainer } = createCardView("task_cards");

        const { disconnectInfiniteScroll, initializeInfiniteScroll } = await import(
            "./infinite_scroll_handler.js"
        );

        initializeInfiniteScroll("task_cards");

        const sentinel = document.getElementById("task_cards_infinite_scroll_sentinel");
        expect(sentinel.parentElement).toBe(cardContainer);
        expect(intersectionObservers[0].options.root).toBe(container);
        expect(intersectionObservers[0].observe).toHaveBeenCalledWith(sentinel);

        disconnectInfiniteScroll("task_cards");
    });

    test("keeps first-page facet controls while later pages append rows", async () => {
        createWideTableView("grouped_orders", {
            container: 520,
            table: 900,
        });
        document.body.insertAdjacentHTML(
            "afterbegin",
            `<div id="grouped_orders_row_group_facets">Security 8</div>`
        );
        const facetHost = document.getElementById("grouped_orders_row_group_facets");
        getUnifiedTableStateMock.mockReturnValue({
            offset: 20,
            filters: { row_group: "boat,security" },
            sort: { column: "created", direction: "DESC" },
        });
        fetchDatasetDataMock.mockResolvedValue({
            data: [{ id: 21 }],
            row_count: 31,
            // A later page must not replace the first-page metadata even if a
            // future backend happens to include this field.
            row_group_facets: [],
        });

        const {
            disconnectInfiniteScroll,
            initializeInfiniteScroll,
            seedInfiniteScrollRowCount,
        } = await import("./infinite_scroll_handler.js");
        seedInfiniteScrollRowCount("grouped_orders", 31);
        initializeInfiniteScroll("grouped_orders");

        intersectionObservers[0].callback([{ isIntersecting: true }]);
        await vi.waitFor(() => expect(fetchDatasetDataMock).toHaveBeenCalledTimes(1));

        expect(fetchDatasetDataMock).toHaveBeenCalledWith(expect.objectContaining({
            dataset_name: "grouped_orders",
            offset: 20,
            filters: { row_group: "boat,security" },
            row_count: 31,
        }));
        expect(document.getElementById("grouped_orders_row_group_facets")).toBe(facetHost);
        expect(document.getElementById("grouped_orders_row_group_facets")?.textContent)
            .toBe("Security 8");

        disconnectInfiniteScroll("grouped_orders");
    });

    test("article result navigation uses its independent container and state", async () => {
        document.body.innerHTML = `<div id="articles_article_view_container"><div class="article_view_wrapper card_view_wrapper"><div class="card_container"></div></div></div>`;
        setChosenDatasetView("articles", "article_view");
        localStorage.setItem("articles_columns", JSON.stringify(["title"]));
        getUnifiedTableStateMock.mockReturnValue({ offset: 0, filters: {}, articleView: { collapsed: true }, cardView: { collapsed: false } });
        const { appendDataToView, initializeInfiniteScroll, disconnectInfiniteScroll } = await import("./infinite_scroll_handler.js");
        initializeInfiniteScroll("articles");
        const list = document.querySelector(".card_container");
        expect(intersectionObservers[0].options.root).toBe(list);
        await appendDataToView("articles", [{ id: 1, title: "One" }]);
        expect(appendDataToCardViewMock).toHaveBeenCalledWith(list, ["title"], [{ id: 1, title: "One" }], "articles",
            expect.objectContaining({ isCurrent: expect.any(Function) }));
        disconnectInfiniteScroll("articles");
    });

    test("late pagination cannot change count, offset or another renderer after disconnect", async () => {
        createCardView("return_cards");
        let resolveOld;
        fetchDatasetDataMock.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
        const scroll = await import("./infinite_scroll_handler.js");
        scroll.initializeInfiniteScroll("return_cards");
        intersectionObservers[0].callback([{ isIntersecting: true }]);
        expect(fetchDatasetDataMock).toHaveBeenCalledOnce();
        scroll.disconnectInfiniteScroll("return_cards");
        setChosenDatasetView("return_cards", "article_view");
        resolveOld({ data: [{ id: 9 }], row_count: 999 });
        await Promise.resolve(); await Promise.resolve();
        expect(appendDataToCardViewMock).not.toHaveBeenCalled();
        expect(setResultsCountMock).not.toHaveBeenCalled();
        expect(setUnifiedTableStateMock).not.toHaveBeenCalled();
    });

    test("an old request's finally does not release the newer request's loading lock", async () => {
        createCardView("return_cards");
        let resolveOld, resolveNew;
        fetchDatasetDataMock
            .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
            .mockReturnValueOnce(new Promise(resolve => { resolveNew = resolve; }));
        const scroll = await import("./infinite_scroll_handler.js");
        scroll.initializeInfiniteScroll("return_cards");
        intersectionObservers[0].callback([{ isIntersecting: true }]);
        scroll.disconnectInfiniteScroll("return_cards");
        scroll.initializeInfiniteScroll("return_cards");
        intersectionObservers[1].callback([{ isIntersecting: true }]);
        resolveOld({ data: [{ id: 9 }], row_count: 999 });
        await Promise.resolve(); await Promise.resolve();
        intersectionObservers[1].callback([{ isIntersecting: true }]);
        expect(fetchDatasetDataMock).toHaveBeenCalledTimes(2);
        expect(scroll.captureInfiniteScrollState("return_cards").isLoading).toBe(true);
        resolveNew({ data: [], row_count: 0 });
        await Promise.resolve(); await Promise.resolve();
        scroll.disconnectInfiniteScroll("return_cards");
    });

    test.each(["article_view", "card", "table"])("article pages retain the list's %s projection and selected row", async projection => {
        document.body.innerHTML = '<div id="paged_article_view_container"><div class="card_view_wrapper big-card-open"><div class="card_container"><div class="card small-card active_card" data-id="3"></div></div></div></div>';
        setChosenDatasetView("paged", "article_view");
        localStorage.setItem("paged_columns", '["id","title"]');
        getUnifiedTableStateMock.mockReturnValue({
            offset: 40, filters: { category: "one" }, sort: { column: "id", direction: "ASC" },
            articleView: { collapsed: true, expandedId: 3 },
        });
        fetchDatasetDataMock.mockResolvedValue({ data: [{ id: 41, title: "Next" }], row_count: 80 });
        const scroll = await import("./infinite_scroll_handler.js");
        const loaded = await import("../table_views/dataset_loaded_rows.js");
        loaded.rememberLoadedDatasetRows(document.getElementById("paged_article_view_container"), "paged", {
            data: Array.from({ length: 40 }, (_, index) => ({ id: index + 1 })), columns: ["id", "title"], types: {},
        }, projection);
        scroll.initializeInfiniteScroll("paged");
        const selected = document.querySelector(".active_card");
        const observer = intersectionObservers.at(-1);
        expect(observer.options.root).toBe(document.querySelector(".card_container"));
        observer.callback([{ isIntersecting: true }]);
        await vi.waitFor(() => expect(fetchDatasetDataMock).toHaveBeenCalledTimes(1));
        expect(fetchDatasetDataMock).toHaveBeenCalledWith({ dataset_name: "paged", offset: 40,
            sort_column: "id", sort_order: "ASC", filters: { category: "one" }, row_count: null,
            callerName: "fetchMoreData (infinite scroll)", view_key: projection });
        await vi.waitFor(() => expect(appendDataToCardViewMock).toHaveBeenCalled());
        expect(document.querySelector(".active_card")).toBe(selected);
        scroll.disconnectInfiniteScroll("paged");
    });

    test.each(["table", "card", "article_view", "product_card", "map"].flatMap(view => [[view, true], [view, false]]))(
        "%s listing transports its projection for replacement=%s", async (viewKey, replace) => {
            const tableName = "projection_rows";
            commitSearch(tableName, "api");
            createWideTableView(tableName, { container: 480, table: 900 });
            const container = document.querySelector("div");
            container.id = tableName + "_" + (viewKey === "article_view" ? "article" : viewKey) + "_view_container";
            if (["card", "article_view"].includes(viewKey)) container.innerHTML = '<div class="card_container"></div>';
            setChosenDatasetView(tableName, viewKey);
            getUnifiedTableStateMock.mockReturnValue({ offset: 20, filters: { status: "open", row_group: "boat" },
                sort: { column: "title", direction: "DESC" } });
            fetchDatasetDataMock.mockResolvedValue({ data: [], row_count: 251 });
            const scroll = await import("./infinite_scroll_handler.js");
            scroll.seedInfiniteScrollRowCount(tableName, 251);
            if (replace) await scroll.reloadDatasetRowsFromListing(tableName);
            else {
                scroll.initializeInfiniteScroll(tableName);
                intersectionObservers.at(-1).callback([{ isIntersecting: true }]);
                await vi.waitFor(() => expect(fetchDatasetDataMock).toHaveBeenCalledOnce());
            }
            expect(fetchDatasetDataMock).toHaveBeenCalledWith({ dataset_name: tableName, offset: replace ? 0 : 20,
                sort_column: "title", sort_order: "DESC", filters: { status: "open", row_group: "boat", search: "api" },
                row_count: replace ? null : 251, view_key: viewKey,
                callerName: `fetchMoreData (${replace ? "reload" : "infinite scroll"})` });
            scroll.disconnectInfiniteScroll(tableName);
        },
    );

    test.each(["table", "card"])("article reload retains the %s navigation projection", async projection => {
        const tableName = "retained";
        createCardView(tableName);
        const container = document.querySelector("div");
        container.id = "retained_article_view_container";
        setChosenDatasetView(tableName, "article_view");
        getUnifiedTableStateMock.mockReturnValue({ offset: 20, filters: {}, sort: {} });
        const loaded = await import("../table_views/dataset_loaded_rows.js");
        loaded.rememberLoadedDatasetRows(container, tableName, { data: [{ id: 1 }] }, projection);
        fetchDatasetDataMock.mockResolvedValue({ data: [{ id: 2 }], columns: ["id"], row_count: 80 });
        const scroll = await import("./infinite_scroll_handler.js");
        await scroll.reloadDatasetRowsFromListing(tableName);
        expect(fetchDatasetDataMock.mock.calls[0][0]).toMatchObject({ offset: 0, view_key: projection });
        expect(fetchDatasetDataMock.mock.calls[0][0]).not.toHaveProperty("include_card_support");
        expect(fetchDatasetDataMock.mock.calls[0][0]).not.toHaveProperty("include_map_support");
        expect(loaded.getLoadedDatasetProjection(container, tableName)).toBe(projection);
        scroll.disconnectInfiniteScroll(tableName);
    });

    test("does not release page loading or advance the offset before async cards commit", async () => {
        createCardView("async_cards");
        getUnifiedTableStateMock.mockReturnValue({ offset: 20, filters: {}, cardView: {} });
        fetchDatasetDataMock.mockResolvedValue({ data: [{ id: 21 }], row_count: 50 });
        let release;
        appendDataToCardViewMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const scroll = await import("./infinite_scroll_handler.js");
        scroll.initializeInfiniteScroll("async_cards");
        const observer = intersectionObservers.at(-1);
        observer.callback([{ isIntersecting: true }]);
        await vi.waitFor(() => expect(appendDataToCardViewMock).toHaveBeenCalled());
        expect(setUnifiedTableStateMock).not.toHaveBeenCalled();
        observer.callback([{ isIntersecting: true }]);
        expect(fetchDatasetDataMock).toHaveBeenCalledTimes(1);
        release();
        await vi.waitFor(() => expect(setUnifiedTableStateMock).toHaveBeenCalledWith("async_cards", expect.objectContaining({ offset: 21 })));
        scroll.disconnectInfiniteScroll("async_cards");
    });

    test("keeps paging a dataset that is showing a search", async () => {
        // A committed search used to switch endless scrolling off, which left
        // every match after the first batch unreachable.
        commitSearch("searched_orders", "api");
        createWideTableView("searched_orders", { container: 480, table: 900 });
        getUnifiedTableStateMock.mockReturnValue({
            offset: 20,
            filters: { status: "open" },
            sort: { column: "id", direction: "ASC" },
        });
        fetchDatasetDataMock.mockResolvedValue({ data: [{ id: 21 }], row_count: 251 });

        const { disconnectInfiniteScroll, initializeInfiniteScroll } = await import(
            "./infinite_scroll_handler.js"
        );
        initializeInfiniteScroll("searched_orders");

        const sentinel = document.getElementById("searched_orders_infinite_scroll_sentinel");
        expect(sentinel).not.toBeNull();
        intersectionObservers.at(-1).callback([{ isIntersecting: true }]);
        await vi.waitFor(() => expect(fetchDatasetDataMock).toHaveBeenCalled());

        expect(fetchDatasetDataMock).toHaveBeenCalledWith(expect.objectContaining({
            dataset_name: "searched_orders",
            offset: 20,
            filters: { status: "open", search: "api" },
        }));
        expect(setResultsCountMock).toHaveBeenCalledWith("searched_orders", 251);

        disconnectInfiniteScroll("searched_orders");
    });

    test("reloads a searched dataset from its listing and reconnects endless scrolling", async () => {
        commitSearch("reloaded_orders", "api");
        createWideTableView("reloaded_orders", { container: 480, table: 900 });
        getUnifiedTableStateMock.mockReturnValue({ offset: 40, filters: {}, sort: {} });
        fetchDatasetDataMock.mockResolvedValue({
            data: [{ id: 1 }, { id: 2 }], row_count: 251, types: {},
        });

        const { disconnectInfiniteScroll, reloadDatasetRowsFromListing } = await import(
            "./infinite_scroll_handler.js"
        );
        const result = await reloadDatasetRowsFromListing("reloaded_orders");

        // The listing starts again from the first match and reports how many
        // matches there are in total, not how many are on screen.
        expect(fetchDatasetDataMock).toHaveBeenCalledWith(expect.objectContaining({
            offset: 0, filters: { search: "api" }, row_count: null,
        }));
        expect(result.row_count).toBe(251);
        expect(setResultsCountMock).toHaveBeenCalledWith("reloaded_orders", 251);
        expect(appendDataToTableMock).toHaveBeenCalledWith(
            document.querySelector("#reloaded_orders_table_view_container table"),
            [{ id: 1 }, { id: 2 }],
            ["id"],
            { id: "integer" },
            "reloaded_orders"
        );
        expect(setUnifiedTableStateMock).toHaveBeenCalledWith(
            "reloaded_orders",
            expect.objectContaining({ offset: 2 })
        );
        expect(document.getElementById("reloaded_orders_infinite_scroll_sentinel")).not.toBeNull();

        disconnectInfiniteScroll("reloaded_orders");
    });

    test("a search reload remembers its rows, so the next page leaves out rows already on screen", async () => {
        // The reloaded rows are the start of the searched list, exactly as a
        // view build's first page is, so an article can carry them over too.
        commitSearch("remembered_orders", "api");
        createWideTableView("remembered_orders", { container: 480, table: 900 });
        getUnifiedTableStateMock.mockReturnValue({ offset: 2, filters: {}, sort: {} });
        fetchDatasetDataMock
            .mockResolvedValueOnce({ data: [{ id: 1 }, { id: 2 }], row_count: 251, types: {} })
            .mockResolvedValueOnce({ data: [{ id: "2" }, { id: 3 }, { id: "3" }], row_count: 251, types: {} });

        const { disconnectInfiniteScroll, reloadDatasetRowsFromListing } = await import(
            "./infinite_scroll_handler.js"
        );
        await reloadDatasetRowsFromListing("remembered_orders");
        appendDataToTableMock.mockClear();
        intersectionObservers.at(-1).callback([{ isIntersecting: true }]);
        await vi.waitFor(() => expect(appendDataToTableMock).toHaveBeenCalled());

        expect(fetchDatasetDataMock).toHaveBeenLastCalledWith(expect.objectContaining({
            offset: 2, filters: { search: "api" },
        }));
        expect(appendDataToTableMock.mock.calls[0][1]).toEqual([{ id: 3 }]);
        // Offset counts all server rows, including repeated IDs within a page.
        await vi.waitFor(() => expect(setUnifiedTableStateMock).toHaveBeenLastCalledWith(
            "remembered_orders", expect.objectContaining({ offset: 5 })));

        disconnectInfiniteScroll("remembered_orders");
    });

    test("a reload with no matching rows empties the list instead of keeping the old rows", async () => {
        commitSearch("empty_orders", "nonsense");
        createWideTableView("empty_orders", { container: 480, table: 900 });
        document.querySelector("#empty_orders_table_view_container tbody")
            .innerHTML = "<tr><td>Stale row</td></tr>";
        getUnifiedTableStateMock.mockReturnValue({ offset: 0, filters: {}, sort: {} });
        fetchDatasetDataMock.mockResolvedValue({ data: [], row_count: 0 });

        const { disconnectInfiniteScroll, reloadDatasetRowsFromListing } = await import(
            "./infinite_scroll_handler.js"
        );
        const loaded = await import("../table_views/dataset_loaded_rows.js");
        const container = document.getElementById("empty_orders_table_view_container");
        loaded.rememberLoadedDatasetRows(container, "empty_orders", { data: [{ id: 9 }] }, "table");
        await reloadDatasetRowsFromListing("empty_orders");

        expect(document.querySelector("#empty_orders_table_view_container tbody").innerHTML).toBe("");
        // The rows that were on screen are gone, so they are no longer remembered.
        expect(loaded.filterLoadedDatasetDuplicates(container, "empty_orders", [{ id: 9 }])).toEqual([{ id: 9 }]);
        expect(setResultsCountMock).toHaveBeenCalledWith("empty_orders", 0);
        expect(getUnifiedTableStateMock().offset).toBe(0);

        disconnectInfiniteScroll("empty_orders");
    });

    test("a stale async append cannot advance the restored list offset", async () => {
        createCardView("pending");
        getUnifiedTableStateMock.mockReturnValue({ offset: 20, filters: {} });
        fetchDatasetDataMock.mockResolvedValue({ data: [{ id: 21 }], row_count: 50 });
        let release;
        let guard;
        appendDataToCardViewMock.mockImplementationOnce((_host, _columns, _rows, _table, options) => {
            guard = options.isCurrent;
            return new Promise(resolve => { release = resolve; });
        });
        const scroll = await import("./infinite_scroll_handler.js");
        scroll.initializeInfiniteScroll("pending");
        intersectionObservers.at(-1).callback([{ isIntersecting: true }]);
        await vi.waitFor(() => expect(release).toBeTypeOf("function"));
        scroll.disconnectInfiniteScroll("pending");
        expect(guard()).toBe(false);
        release();
        // Flush the entire commit chain, including its facade and loader await.
        // Two microtasks can assert too early after an interface adds an await.
        await vi.advanceTimersByTimeAsync(0);
        expect(setUnifiedTableStateMock).not.toHaveBeenCalled();
    });

    test("mode changes reject old pages and never reuse another mode's cached count", async () => {
        createCardView("mode_offers");
        let state = { offset: 2, filters: { row_group: "boat,train" } };
        getUnifiedTableStateMock.mockImplementation(() => state);
        let resolveOld;
        fetchDatasetDataMock.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
        const scroll = await import("./infinite_scroll_handler.js");
        scroll.seedInfiniteScrollRowCount("mode_offers", 50);
        scroll.initializeInfiniteScroll("mode_offers");
        intersectionObservers[0].callback([{ isIntersecting: true }]);
        expect(fetchDatasetDataMock.mock.calls.at(-1)[0].row_count).toBe(50);
        state = { ...state, filters: { ...state.filters, row_group_mode: "1:all" } };
        resolveOld({ data: [{ id: 9 }], row_count: 50 });
        await Promise.resolve(); await Promise.resolve();
        expect(appendDataToCardViewMock).not.toHaveBeenCalled();
        expect(setResultsCountMock).not.toHaveBeenCalled();
        fetchDatasetDataMock.mockResolvedValueOnce({ data: [], row_count: 0 });
        intersectionObservers[0].callback([{ isIntersecting: true }]);
        expect(fetchDatasetDataMock.mock.calls.at(-1)[0]).toMatchObject({ filters: { row_group: "boat,train", row_group_mode: "1:all" }, row_count: null });
        await Promise.resolve(); await Promise.resolve();
        scroll.disconnectInfiniteScroll("mode_offers");
    });

    test("the row-commit boundary rejects a stale direct table append or replacement", async () => {
        createWideTableView("guarded", { container: 400, table: 800 });
        document.querySelector('tbody').innerHTML = '<tr><td>Current row</td></tr>';
        const scroll = await import('./infinite_scroll_handler.js');
        for (const append of [true, false]) {
            await scroll.appendDataToView('guarded', [{ id: 9 }], append, { isCurrent: () => false });
            expect(appendDataToTableMock).not.toHaveBeenCalled();
            expect(document.querySelector('tbody').textContent).toBe('Current row');
        }
    });

    test("a missing renderer cannot advance offsets or remember an unshown replacement", async () => {
        createWideTableView('missing', { container: 400, table: 800 });
        document.querySelector('table').remove();
        fetchDatasetDataMock.mockResolvedValue({ data: [{ id: 1 }], row_count: 20 });
        const scroll = await import('./infinite_scroll_handler.js');
        expect(await scroll.reloadDatasetRowsFromListing('missing')).toBeNull();
        expect(setUnifiedTableStateMock.mock.calls.every(([, state]) => state.offset === 0)).toBe(true);
        const loaded = await import('../table_views/dataset_loaded_rows.js');
        expect(loaded.getLoadedDatasetProjection(document.getElementById('missing_table_view_container'), 'missing')).toBeNull();
        scroll.disconnectInfiniteScroll('missing');
    });

    test.each([false, true])('hidden-name cleanup during search=%s rebuilds instead of committing the old count', async search => {
        createWideTableView('hidden_names', { container: 400, table: 800 });
        let state = { offset: 0, filters: { hidden_names_owner_name: 'Old' }, sort: {} };
        getUnifiedTableStateMock.mockImplementation(() => state);
        setUnifiedTableStateMock.mockImplementation((_name, patch) => { state = { ...state, ...patch }; });
        const { setParams, getParams } = await import('../navigation/nav_engine/query_params.js');
        setParams('hidden_names', { ...state.filters, ...(search ? { search: 'travel' } : {}) });
        fetchDatasetDataMock.mockResolvedValue({ data: [], row_count: 0, columns: ['title'], types: { title: 'text' } });
        const repaired = { data: [{ id: 1 }], row_count: 1 };
        const refresh = vi.fn(async () => repaired);
        vi.doMock('../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', () => ({ refreshTableUnified: refresh }));
        const scroll = await import('./infinite_scroll_handler.js');
        try {
            expect(await scroll.reloadDatasetRowsFromListing('hidden_names')).toBe(repaired);
            expect(refresh).toHaveBeenCalledWith('hidden_names', expect.objectContaining({ skipUrlParams: true }));
            expect(state.filters).toEqual({});
            expect(getParams('hidden_names')).toEqual(search ? { search: 'travel' } : {});
            expect(setResultsCountMock).not.toHaveBeenCalled();
            expect(appendDataToTableMock).not.toHaveBeenCalled();
        } finally { scroll.disconnectInfiniteScroll('hidden_names'); vi.doUnmock('../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js'); }
    });
});
