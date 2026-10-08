// active_filter_tag_printer.test.js
// Verifies the active-filter renderer targets the correct host in normal and big-card card layouts.
// Bridges unified filter state, URL params, and card-view DOM shells inside jsdom.
// Exists to prevent regressions where active filters render above the layout instead of inside the card sidebar.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

import { applyActiveFilterRemoveSide } from "./active_filter_chip_builder.js";

const clearAllFiltersMock = vi.fn();
const languageRenderers = new Map();
let interfaceLanguage = "fi";
const getUnifiedTableStateMock = vi.fn();
const setUnifiedTableStateMock = vi.fn();
const refreshTableUnifiedMock = vi.fn();
const getParamsMock = vi.fn();
const setParamsMock = vi.fn();
const updateURLMock = vi.fn();
const appendDataToViewMock = vi.fn();
const setResultsCountMock = vi.fn();
const doIntelligentSearchMock = vi.fn();
const rerenderCachedSearchResultsMock = vi.fn();
const clearCommittedDatasetSearchMock = vi.fn();
const ongoingSearchResultsMock = {};
const groupFiltersMock = vi.fn(() => ({
    status: {
        baseKey: "status",
        keys: ["status"],
        value: "done",
        exclude: false,
        type: "single",
    },
}));

vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    getUnifiedTableState: getUnifiedTableStateMock,
    setUnifiedTableState: setUnifiedTableStateMock,
    refreshTableUnified: refreshTableUnifiedMock,
    invalidateTableRefresh: vi.fn(),
}));

vi.mock("../../state_stores/table_state_store.js", () => ({
    getUnifiedTableState: getUnifiedTableStateMock,
    setUnifiedTableState: setUnifiedTableStateMock,
}));
vi.mock("../text_search/dataset_search_executor.js", () => ({ do_intelligent_search: doIntelligentSearchMock }));
vi.mock("../top_row_buttons/top_row_builder.js", () => ({ clearAllFilters: clearAllFiltersMock }));
vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: key => ({
    fi: { selected_filters: "Valitut:", clear_all: "Tyhjennä kaikki", search: "Haku", remove: "Poista" },
    en: { selected_filters: "Selected:", clear_all: "Clear all", search: "Search", remove: "Remove" },
})[interfaceLanguage][key] || key }));
vi.mock("../../table_views/dataset_value_localizer.js", () => ({
    bindDatasetLanguageRenderer: (element, render) => {
        languageRenderers.set(element, language => { interfaceLanguage = language; render(language); });
        render(interfaceLanguage);
    },
    resolveDatasetDisplayValue: (value, _metadata, language) => value?.[language] || "",
}));

vi.mock("../../navigation/nav_engine/query_params.js", () => ({
    getParams: getParamsMock,
    setParams: setParamsMock,
    updateURL: updateURLMock,
}));

vi.mock("../../infinite_scroll/infinite_scroll_handler.js", () => ({
    appendDataToView: appendDataToViewMock,
    resetOffset: vi.fn(),
    disconnectInfiniteScroll: vi.fn(),
}));

vi.mock("../../../reusable_components/results_count/results_count_printer.js", () => ({
    setResultsCount: setResultsCountMock,
}));

vi.mock("../text_search/create_text_search_panel.js", () => ({
    ongoingSearchResults: ongoingSearchResultsMock,
    do_intelligent_search: doIntelligentSearchMock,
    rerenderCachedSearchResults: rerenderCachedSearchResultsMock,
}));

vi.mock("../text_search/dataset_search_clearer.js", () => ({
    clearCommittedDatasetSearch: clearCommittedDatasetSearchMock,
}));

vi.mock("./row_filter_checker.js", () => ({
    rowMatchesFilters: vi.fn(() => true),
}));

vi.mock("./active_filter_tag_printer_helpers.js", () => ({
    groupFilters: groupFiltersMock,
    buildFilterLabel: vi.fn((baseKey) => baseKey),
    buildDisplayValue: vi.fn(() => "done"),
    buildDedupeKey: vi.fn((label, value) => `${label}::${value}`),
    isTranslatableValue: vi.fn(() => false),
    formatRangeLabel: vi.fn(() => ""),
}));

describe("renderActiveFilters", () => {
    beforeEach(() => {
        applyActiveFilterRemoveSide("start");
        interfaceLanguage = "fi";
        languageRenderers.clear();
        clearAllFiltersMock.mockReset();
        document.body.innerHTML = "";
        vi.clearAllMocks();
        clearCommittedDatasetSearchMock.mockReturnValue(true);
        setUnifiedTableStateMock.mockImplementation((_table, state) => getUnifiedTableStateMock.mockReturnValue(state));
        Object.keys(ongoingSearchResultsMock).forEach((key) => delete ongoingSearchResultsMock[key]);
        groupFiltersMock.mockImplementation(() => ({
            status: {
                baseKey: "status",
                keys: ["status"],
                value: "done",
                exclude: false,
                type: "single",
            },
        }));

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

    test("reruns backend search when the row-group tag is removed", async () => {
        document.body.innerHTML = `
            <div id="tasks_card_top_controls"></div>
            <div id="tasks_results_count"></div>
        `;
        getParamsMock.mockReturnValue({ search: "urgent", row_group: "security" });
        getUnifiedTableStateMock.mockReturnValue({ filters: { row_group: "security" } });
        groupFiltersMock.mockReturnValue({
            row_group: {
                baseKey: "row_group",
                keys: ["row_group"],
                value: "security",
                exclude: false,
                type: "single",
            },
        });
        ongoingSearchResultsMock.tasks = { filters: { row_group: "security" } };

        const { renderActiveFilters } = await import("./active_filter_tag_printer.js");
        renderActiveFilters("tasks");
        const filterItems = document.querySelectorAll(".active-filter-item");
        filterItems[filterItems.length - 1].querySelector(".remove-active-filter").click();

        await vi.waitFor(() => {
            expect(doIntelligentSearchMock).toHaveBeenCalledWith("tasks", "urgent");
        });
        expect(rerenderCachedSearchResultsMock).not.toHaveBeenCalled();
        expect(setUnifiedTableStateMock).toHaveBeenCalledWith("tasks", { filters: {}, offset: 0 });
    });

    test("search chip uses the same narrow committed-search clear command as the field X", async () => {
        document.body.innerHTML = `
            <div id="tasks_card_top_controls"></div>
            <div id="tasks_results_count"></div>
        `;
        const { renderActiveFilters } = await import("./active_filter_tag_printer.js");

        renderActiveFilters("tasks");
        document.querySelector(".active-filter-item .remove-active-filter").click();

        expect(clearCommittedDatasetSearchMock).toHaveBeenCalledWith("tasks");
        expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
    });
    test("renders one tag per value and relabels them after each facet payload", async () => {
        document.body.innerHTML = '<div id="tasks_card_top_controls"></div>';
        getParamsMock.mockReturnValue({ row_group: "boat,train" });
        getUnifiedTableStateMock.mockReturnValue({ filters: { row_group: "boat,train" } });
        groupFiltersMock.mockReturnValue({ row_group: { baseKey: "row_group", keys: ["row_group"], value: "boat,train", type: "single" } });
        const { renderActiveFilters } = await import("./active_filter_tag_printer.js");
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        renderActiveFilters("tasks");
        expect(document.querySelectorAll('.active-filter-item')).toHaveLength(2);
        const tags = [...document.querySelectorAll('.row-group-filter-label')];
        expect(tags.map(tag => tag.textContent)).toEqual(["filters: boat", "filters: train"]);
        renderRowGroupFacets("tasks", [
            { id: 1, slug: "boat", title: { fi: "Laiva" }, row_count: 2, selected: true },
            { id: 2, slug: "train", title: { fi: "Juna" }, row_count: 0, selected: true },
        ]);
        expect(tags.map(tag => tag.textContent)).toEqual(["filters: Laiva", "filters: Juna"]);
        renderRowGroupFacets("tasks", [{ id: 1, slug: "boat", title: { fi: "Laivamatka" }, row_count: 1, selected: true }]);
        expect(tags.map(tag => tag.textContent)).toEqual(["filters: Laivamatka", "filters: train"]);
        tags[0].parentElement.querySelector("button").click();
        await vi.waitFor(() => expect(setUnifiedTableStateMock).toHaveBeenCalledWith("tasks", { filters: { row_group: "train" }, offset: 0 }));
        expect(updateURLMock).toHaveBeenCalledWith("tasks", { row_group: "train" });
        await vi.waitFor(() => expect(document.querySelectorAll('.active-filter-item')).toHaveLength(1));
        expect(document.querySelector('.active-filter-item').dataset.rowGroupSlug).toBe("train");
    });

    test.each(["start", "end"])("all three chip types use %s order and keep translated labels during previews and sidebar moves", async side => {
        document.body.innerHTML = '<div id="tasks_card_top_controls"></div><div id="tasks_card_view_container"><div class="card_view_wrapper"><div class="card_sidebar_active_filters"></div></div></div>';
        getUnifiedTableStateMock.mockReturnValue({ filters: { status: "done", row_group: "boat" } });
        groupFiltersMock.mockReturnValue({ status: { keys: ["status"], value: "done", type: "single" },
            row_group: { keys: ["row_group"], value: "boat", type: "single" } });
        const { renderActiveFilters } = await import("./active_filter_tag_printer.js");
        applyActiveFilterRemoveSide(side);
        renderActiveFilters("tasks");
        const row = document.querySelector(".active_filters");
        const chips = [...row.querySelectorAll(".active-filter-item")];
        expect(chips).toHaveLength(3);
        for (const chip of chips) {
            const button = chip.querySelector("button");
            const label = chip.querySelector(".active-filter-label");
            expect([...chip.children]).toEqual(side === "start" ? [button, label] : [label, button]);
            expect(button.getAttribute("aria-label")).toMatch(/^Poista: /);
            languageRenderers.get(chip)("en");
            expect(button.getAttribute("aria-label")).toMatch(/^Remove: /);
        }
        chips[1].querySelector("button").focus();
        const state = getUnifiedTableStateMock();
        applyActiveFilterRemoveSide(side === "start" ? "end" : "start");
        expect(document.activeElement).toBe(chips[1].querySelector("button"));
        expect([...row.querySelectorAll(".active-filter-item")]).toEqual(chips);
        expect(getUnifiedTableStateMock()).toBe(state);
        expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
        expect(doIntelligentSearchMock).not.toHaveBeenCalled();
        document.querySelector(".card_view_wrapper").classList.add("big-card-open");
        renderActiveFilters("tasks");
        expect(document.querySelectorAll(".active_filters")).toHaveLength(1);
        expect(row.parentElement.className).toBe("card_sidebar_active_filters");
        document.querySelector(".card_view_wrapper").classList.remove("big-card-open");
        renderActiveFilters("tasks");
        expect(row.parentElement.id).toBe("tasks_card_top_controls");
    });

    test.each(["start", "end"])("%s exclusion and range removal preserve cached search and remove every owned key", async side => {
        document.body.innerHTML = '<div id="tasks_card_top_controls"></div>';
        applyActiveFilterRemoveSide(side);
        const params = { search: "urgent", status_exclude: "done", price_min: "1", price_max: "9" };
        getParamsMock.mockReturnValue(params);
        const filters = { status_exclude: "done", price_min: "1", price_max: "9" };
        getUnifiedTableStateMock.mockReturnValue({ filters });
        groupFiltersMock.mockImplementation(current => ({
            ...(current.status_exclude ? { status: { keys: ["status_exclude"], value: "done", exclude: true, type: "single" } } : {}),
            ...(current.price_min ? { price: { keys: ["price_min", "price_max"], type: "range", values: ["1", "9"] } } : {}),
        }));
        ongoingSearchResultsMock.tasks = { filters: { ...filters } };
        const { renderActiveFilters } = await import("./active_filter_tag_printer.js");
        renderActiveFilters("tasks");
        document.querySelector(".active-filter-item--exclude button").click();
        await vi.waitFor(() => expect(getUnifiedTableStateMock().filters).toEqual({ price_min: "1", price_max: "9" }));
        await vi.waitFor(() => expect(document.querySelectorAll(".active-filter-item")).toHaveLength(2));
        document.querySelectorAll(".active-filter-item button")[1].click();
        await vi.waitFor(() => expect(getUnifiedTableStateMock().filters).toEqual({}));
        expect(params).toEqual({ search: "urgent" });
        expect(rerenderCachedSearchResultsMock).toHaveBeenCalledTimes(2);
        expect(doIntelligentSearchMock).not.toHaveBeenCalled();
        expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
        document.querySelector(".active-filter-item button").click();
        expect(clearCommittedDatasetSearchMock).toHaveBeenCalledExactlyOnceWith("tasks");
    });

    test("adds the translated lead and whole-reset button, hides both without selections", async () => {
        document.body.innerHTML = '<div id="tasks_card_top_controls"></div><div id="tasks_filterBar_panel"></div>';
        const { renderActiveFilters } = await import("./active_filter_tag_printer.js");
        renderActiveFilters("tasks");
        const lead = document.querySelector(".active-filters-lead");
        const clear = document.querySelector('[data-testid="active-filters-clear-all"]');
        expect(lead.textContent).toBe("Valitut:");
        expect(clear.textContent).toBe("Tyhjennä kaikki");
        expect(document.querySelector(".active_filters").firstElementChild).toBe(lead);
        expect(document.querySelector(".active_filters").lastElementChild).toBe(clear);
        expect(document.querySelector(".active-filter-item").firstElementChild.className).toBe("remove-active-filter");
        const searchTag = document.querySelector(".active-filter-item");
        expect(searchTag.querySelector("button").getAttribute("aria-label")).toBe("Poista: Haku: urgent");
        languageRenderers.get(searchTag)("en");
        expect(searchTag.querySelector("button").getAttribute("aria-label")).toBe("Remove: Search: urgent");
        languageRenderers.get(lead)("en");
        languageRenderers.get(clear)("en");
        expect(lead.textContent).toBe("Selected:");
        expect(clear.textContent).toBe("Clear all");
        clearAllFiltersMock.mockImplementation(() => {
            getParamsMock.mockReturnValue({});
            getUnifiedTableStateMock.mockReturnValue({ filters: {} });
            groupFiltersMock.mockReturnValue({});
        });
        clear.click();
        await vi.waitFor(() => expect(clearAllFiltersMock).toHaveBeenCalledExactlyOnceWith("tasks", document.getElementById("tasks_filterBar_panel")));
        expect(document.querySelectorAll(".active-filter-item")).toHaveLength(0);
        expect(document.querySelector(".active_filters").style.display).toBe("none");
        expect(document.querySelector(".active-filters-lead")).toBeNull();
        expect(document.querySelector(".active-filters-clear-all")).toBeNull();
    });

    test("keeps lead and clear-all in the article sidebar and restores tags before the result count", async () => {
        document.body.innerHTML = '<div id="tasks_card_top_controls"></div><div id="tasks_results_count">4 results</div><div id="tasks_card_view_container"><div class="card_view_wrapper big-card-open"><div class="card_sidebar_active_filters"></div></div></div>';
        const { renderActiveFilters } = await import("./active_filter_tag_printer.js");
        renderActiveFilters("tasks");
        expect(document.querySelector('.card_sidebar_active_filters .active-filters-lead').textContent).toBe("Valitut:");
        expect(document.querySelector('.card_sidebar_active_filters .active-filters-clear-all')).not.toBeNull();
        document.querySelector(".card_view_wrapper").classList.remove("big-card-open");
        renderActiveFilters("tasks");
        const tags = document.querySelector('#tasks_card_top_controls .active_filters');
        expect(tags.nextElementSibling.className).toContain("active_filters_results_count");
        expect(document.querySelectorAll('.active-filters-clear-all')).toHaveLength(1);
    });

});
