// infinite_scroll_handler.test.js
// Verifies wide table infinite-scroll sentinels span the horizontal scroll range.
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
});
