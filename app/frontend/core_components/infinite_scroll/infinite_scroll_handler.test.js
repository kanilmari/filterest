// infinite_scroll_handler.test.js
// Verifies wide table infinite-scroll sentinels span the horizontal scroll range,
// and that a committed search is paged like any other condition of the listing.
// Uses jsdom with mocked render/fetch dependencies so sentinel layout can be tested in isolation.
// Exists to keep vertical infinite scroll working after users scroll wide tables horizontally.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
    localStorage.setItem(`${tableName}_view`, "table");

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
    localStorage.setItem(`${tableName}_view`, "card");
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
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.useFakeTimers();
        localStorage.clear();
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
        appendDataToView("wide_orders", [{ id: 2 }]);

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
        getUnifiedTableStateMock.mockReturnValue({
            offset: 20,
            filters: { row_group: "security" },
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
            filters: { row_group: "security" },
            row_count: 31,
        }));
        expect(document.getElementById("grouped_orders_row_group_facets")?.textContent)
            .toBe("Security 8");

        disconnectInfiniteScroll("grouped_orders");
    });

    test("article result navigation uses its independent container and state", async () => {
        document.body.innerHTML = `<div id="articles_article_view_container"><div class="article_view_wrapper card_view_wrapper"><div class="card_container"></div></div></div>`;
        localStorage.setItem("articles_view", "article_view");
        localStorage.setItem("articles_columns", JSON.stringify(["title"]));
        getUnifiedTableStateMock.mockReturnValue({ offset: 0, filters: {}, articleView: { collapsed: true }, cardView: { collapsed: false } });
        const { appendDataToView, initializeInfiniteScroll, disconnectInfiniteScroll } = await import("./infinite_scroll_handler.js");
        initializeInfiniteScroll("articles");
        const list = document.querySelector(".card_container");
        expect(intersectionObservers[0].options.root).toBe(list);
        appendDataToView("articles", [{ id: 1, title: "One" }]);
        expect(appendDataToCardViewMock).toHaveBeenCalledWith(list, ["title"], [{ id: 1, title: "One" }], "articles");
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
        localStorage.setItem("return_cards_view", "article_view");
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

    test("continues paging the open article's actual small-card scroll host", async () => {
        document.body.innerHTML = '<div id="paged_article_view_container"><div class="card_view_wrapper big-card-open"><div class="card_container"><div class="card small-card active_card" data-id="3"></div></div></div></div>';
        localStorage.setItem("paged_view", "article_view");
        localStorage.setItem("paged_columns", '["id","title"]');
        getUnifiedTableStateMock.mockReturnValue({
            offset: 40, filters: { category: "one" }, sort: { column: "id", direction: "ASC" },
            articleView: { collapsed: true, expandedId: 3 },
        });
        fetchDatasetDataMock.mockResolvedValue({ data: [{ id: 41, title: "Next" }], row_count: 80 });
        const scroll = await import("./infinite_scroll_handler.js");
        scroll.initializeInfiniteScroll("paged");
        const selected = document.querySelector(".active_card");
        const observer = intersectionObservers.at(-1);
        expect(observer.options.root).toBe(document.querySelector(".card_container"));
        observer.callback([{ isIntersecting: true }]);
        await vi.waitFor(() => expect(fetchDatasetDataMock).toHaveBeenCalledTimes(1));
        expect(fetchDatasetDataMock).toHaveBeenCalledWith(expect.objectContaining({ offset: 40, view_key: "article_view" }));
        await vi.waitFor(() => expect(appendDataToCardViewMock).toHaveBeenCalled());
        expect(document.querySelector(".active_card")).toBe(selected);
        scroll.disconnectInfiniteScroll("paged");
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
            .mockResolvedValueOnce({ data: [{ id: 2 }, { id: 3 }], row_count: 251, types: {} });

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
        await Promise.resolve();
        await Promise.resolve();
        expect(setUnifiedTableStateMock).not.toHaveBeenCalled();
    });

});
