// active_filter_tag_printer.test.js
// Verifies the active-filter renderer targets the correct host in normal and big-card card layouts.
// Bridges unified filter state, URL params, and card-view DOM shells inside jsdom.
// Exists to prevent regressions where active filters render above the layout instead of inside the card sidebar.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const getUnifiedTableStateMock = vi.fn();
const setUnifiedTableStateMock = vi.fn();
const refreshTableUnifiedMock = vi.fn();
const getParamsMock = vi.fn();
const setParamsMock = vi.fn();
const updateURLMock = vi.fn();
const appendDataToViewMock = vi.fn();
const setResultsCountMock = vi.fn();

vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    getUnifiedTableState: getUnifiedTableStateMock,
    setUnifiedTableState: setUnifiedTableStateMock,
    refreshTableUnified: refreshTableUnifiedMock,
}));

vi.mock("../../navigation/nav_engine/query_params.js", () => ({
    getParams: getParamsMock,
    setParams: setParamsMock,
    updateURL: updateURLMock,
}));

vi.mock("../../infinite_scroll/infinite_scroll_handler.js", () => ({
    appendDataToView: appendDataToViewMock,
}));

vi.mock("../../../reusable_components/results_count/results_count_printer.js", () => ({
    setResultsCount: setResultsCountMock,
}));

vi.mock("../text_search/create_text_search_panel.js", () => ({
    ongoingSearchResults: {},
    getDatasetSearchInputs: () => [],
    rerenderCachedSearchResults: vi.fn(),
}));

vi.mock("./row_filter_checker.js", () => ({
    rowMatchesFilters: vi.fn(() => true),
}));

vi.mock("./active_filter_tag_printer_helpers.js", () => ({
    groupFilters: vi.fn(() => ({
        status: {
            baseKey: "status",
            keys: ["status"],
            value: "done",
            exclude: false,
            type: "single",
        },
    })),
    buildFilterLabel: vi.fn((baseKey) => baseKey),
    buildDisplayValue: vi.fn(() => "done"),
    buildDedupeKey: vi.fn((label, value) => `${label}::${value}`),
    isTranslatableValue: vi.fn(() => false),
    formatRangeLabel: vi.fn(() => ""),
}));

describe("renderActiveFilters", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();

        getParamsMock.mockReturnValue({ search: "urgent" });
        getUnifiedTableStateMock.mockReturnValue({
            filters: { status: "done" },
        });
    });

    test("renders active filters and a results mirror into top controls when big card is closed", async () => {
        document.body.innerHTML = `
            <div id="tasks_card_top_controls"></div>
            <div id="tasks_results_count">228 <span data-lang-key="results">results</span></div>
        `;

        const { renderActiveFilters } = await import("./active_filter_tag_printer.js");

        renderActiveFilters("tasks");

        const topControls = document.getElementById("tasks_card_top_controls");
        expect(topControls.querySelector(".active_filters")).not.toBeNull();
        expect(topControls.querySelectorAll(".active-filter-item")).toHaveLength(2);
        expect(topControls.querySelector(".active_filters_results_count")).not.toBeNull();
        expect(topControls.textContent).toContain("228");
    });

    test("moves active filters under the sidebar results count when big card is open", async () => {
        document.body.innerHTML = `
            <div id="tasks_card_top_controls"></div>
            <div id="tasks_results_count">228 <span data-lang-key="results">results</span></div>
            <div id="tasks_card_view_container">
                <div class="card_view_wrapper big-card-open">
                    <div class="card_sidebar_panel">
                        <div class="card_sidebar_header"></div>
                        <div class="card_sidebar_active_filters"></div>
                    </div>
                </div>
            </div>
        `;

        const { renderActiveFilters } = await import("./active_filter_tag_printer.js");

        renderActiveFilters("tasks");

        const topControls = document.getElementById("tasks_card_top_controls");
        const sidebarFiltersHost = document.querySelector(".card_sidebar_active_filters");

        expect(sidebarFiltersHost.querySelector(".active_filters")).not.toBeNull();
        expect(sidebarFiltersHost.querySelectorAll(".active-filter-item")).toHaveLength(2);
        expect(sidebarFiltersHost.style.display).not.toBe("none");
        expect(topControls.querySelector(".active_filters")).toBeNull();
        expect(topControls.querySelector(".active_filters_results_count")).toBeNull();
    });
});
