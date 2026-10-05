// row_group_facet_printer.test.js
// Verifies localized facet rendering, active state, validation, and route-backed toggling.
// Bridges first-page facet metadata with the common dataset controls in jsdom.
// Exists to keep row-group filters consistent across every view without stale unsafe chips.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    languageRenderers,
    renderActiveFiltersMock,
    doIntelligentSearchMock,
    getParamsMock,
    getUnifiedTableStateMock,
    refreshTableUnifiedMock,
    setParamsMock,
    setUnifiedTableStateMock,
    updateURLMock,
} = vi.hoisted(() => ({
    languageRenderers: new Map(),
    renderActiveFiltersMock: vi.fn(),
    doIntelligentSearchMock: vi.fn(),
    getParamsMock: vi.fn(),
    getUnifiedTableStateMock: vi.fn(),
    refreshTableUnifiedMock: vi.fn(),
    setParamsMock: vi.fn(),
    setUnifiedTableStateMock: vi.fn(),
    updateURLMock: vi.fn(),
}));

vi.mock("../../table_views/dataset_value_localizer.js", () => ({
    bindDatasetLanguageRenderer: (element, render) => { languageRenderers.set(element, render); render("fi"); },
    resolveDatasetDisplayValue: (value, _metadata, language) => value?.[language] || "",
}));

vi.mock("../../lang/translation_handler.js", () => ({
    getTranslationForKey: key => ({ filters: "Suodattimet", show_more: "Näytä enemmän", show_less: "Näytä vähemmän", clear_selections: "Tyhjennä valinnat", remove: "Poista" })[key],
}));

vi.mock("./active_filter_tag_printer.js", () => ({ renderActiveFilters: renderActiveFiltersMock }));

vi.mock("../../state_stores/table_state_store.js", () => ({
    getUnifiedTableState: getUnifiedTableStateMock,
    setUnifiedTableState: setUnifiedTableStateMock,
}));

vi.mock("../../navigation/nav_engine/query_params.js", () => ({
    getParams: getParamsMock,
    setParams: setParamsMock,
    updateURL: updateURLMock,
}));

vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    refreshTableUnified: refreshTableUnifiedMock,
}));

vi.mock("../text_search/dataset_search_executor.js", () => ({
    do_intelligent_search: doIntelligentSearchMock,
}));

describe("row group facet controls", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = `
            <div id="travel_info_card_top_controls">
                <div class="results_count">8 results</div>
            </div>
        `;
        getUnifiedTableStateMock.mockReturnValue({
            filters: { row_group: "security" },
            offset: 0,
        });
        getParamsMock.mockReturnValue({ sort_column: "created", row_group: "security", offset: "20" });
        refreshTableUnifiedMock.mockResolvedValue(undefined);
    });

    test("renders safe localized counts after the common result count", async () => {
        const onToggle = vi.fn();
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");

        const host = renderRowGroupFacets(
            "travel_info",
            [
                { id: 4, slug: "security", title: { fi: "Turvallisuus", en: "Security" }, row_count: 5 },
                { id: 7, slug: "lappi", title: { fi: "Lappi", en: "Lapland" }, row_count: 3 },
                { id: 9, slug: "Unsafe value", title: { fi: "Ei tätä" }, row_count: 2 },
            ],
            { onToggle }
        );

        expect(host.previousElementSibling?.classList.contains("results_count")).toBe(true);
        expect(host.getAttribute("aria-label")).toBe("Suodattimet");
        const chips = host.querySelectorAll('[data-testid="row-group-facet-chip"]');
        expect(chips).toHaveLength(2);
        expect(chips[0].textContent).toBe("Turvallisuus5");
        expect(chips[0].getAttribute("aria-pressed")).toBe("true");
        expect(chips[1].getAttribute("aria-pressed")).toBe("false");

        chips[1].click();
        await vi.waitFor(() => expect(onToggle).toHaveBeenCalledWith("travel_info", "lappi"));
    });

    test("removes facet metadata when explicitly cleared", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        renderRowGroupFacets("travel_info", [
            { id: 4, slug: "security", title: { fi: "Turvallisuus" }, row_count: 5 },
        ]);

        expect(document.getElementById("travel_info_row_group_facets")).not.toBeNull();
        renderRowGroupFacets("travel_info", null);
        expect(document.getElementById("travel_info_row_group_facets")).toBeNull();
    });

    test("toggles the meta-filter in unified state and the visible URL", async () => {
        const { toggleRowGroupFacet } = await import("./row_group_facet_printer.js");

        await toggleRowGroupFacet("travel_info", "security");

        expect(setUnifiedTableStateMock).toHaveBeenCalledWith("travel_info", {
            filters: {},
            offset: 0,
        });
        expect(setParamsMock).toHaveBeenCalledWith("travel_info", {
            sort_column: "created",
        });
        expect(updateURLMock).toHaveBeenCalledWith("travel_info", {
            sort_column: "created",
        });
        expect(refreshTableUnifiedMock).toHaveBeenCalledWith("travel_info", {
            skipUrlParams: true,
        });
    });

    test("reruns backend intelligent search when a group changes during committed search", async () => {
        getParamsMock.mockReturnValue({ search: "safety", row_group: "security" });
        const { toggleRowGroupFacet } = await import("./row_group_facet_printer.js");

        await toggleRowGroupFacet("travel_info", "security");

        expect(doIntelligentSearchMock).toHaveBeenCalledWith("travel_info", "safety");
        expect(renderActiveFiltersMock).toHaveBeenCalledExactlyOnceWith("travel_info");
        expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
    });
    test("adds a value to a canonical comma list and removes only that value", async () => {
        const { toggleRowGroupFacet } = await import("./row_group_facet_printer.js");
        getUnifiedTableStateMock.mockReturnValue({ filters: { row_group: "security,boat,security", published: "true" } });
        await toggleRowGroupFacet("travel_info", "train");
        expect(setUnifiedTableStateMock).toHaveBeenLastCalledWith("travel_info", { filters: { row_group: "boat,security,train", published: "true" }, offset: 0 });
        expect(updateURLMock).toHaveBeenLastCalledWith("travel_info", { sort_column: "created", row_group: "boat,security,train" });
        await toggleRowGroupFacet("travel_info", "boat");
        expect(setUnifiedTableStateMock).toHaveBeenLastCalledWith("travel_info", { filters: { row_group: "security", published: "true" }, offset: 0 });
    });

    test("clears the entire selection once while preserving other filters and search", async () => {
        const { clearRowGroupSelection } = await import("./row_group_facet_printer.js");
        getUnifiedTableStateMock.mockReturnValue({ filters: { row_group: "boat,train", published: "true" } });
        getParamsMock.mockReturnValue({ row_group: "boat,train", published: "true", search: "matka", offset: "20" });
        await clearRowGroupSelection("travel_info");
        expect(setUnifiedTableStateMock).toHaveBeenCalledWith("travel_info", { filters: { published: "true" }, offset: 0 });
        expect(updateURLMock).toHaveBeenCalledWith("travel_info", { published: "true", search: "matka" });
        expect(doIntelligentSearchMock).toHaveBeenCalledExactlyOnceWith("travel_info", "matka");
    });

    test("shows 12 values, expands and collapses with keyboard focus retained", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        const facets = Array.from({ length: 14 }, (_, index) => ({ id: index + 1, slug: `group_${index}`, title: { fi: `Ryhmä ${index}` }, row_count: index + 1 }));
        const host = renderRowGroupFacets("travel_info", facets);
        expect(host.querySelectorAll('[data-row-group-slug]')).toHaveLength(12);
        host.querySelector('[data-lang-key="show_more"]').click();
        expect(host.querySelectorAll('[data-row-group-slug]')).toHaveLength(14);
        expect(document.activeElement.dataset.langKey).toBe("show_less");
        expect(document.activeElement.getAttribute("aria-expanded")).toBe("true");
        document.activeElement.click();
        expect(host.querySelectorAll('[data-row-group-slug]')).toHaveLength(12);
        expect(document.activeElement.dataset.langKey).toBe("show_more");
    });

    test("keeps selected zero counts beyond the collapsed list and translates accessible titles", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        const onClear = vi.fn();
        const facets = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, slug: `group_${i}`, row_count: 1 }));
        facets.push({ id: 20, slug: "security", title: { fi: "Turvallisuus", en: "Security" }, row_count: 0, selected: true });
        facets.push({ id: 21, slug: "empty", row_count: 0, selected: false });
        const host = renderRowGroupFacets("travel_info", facets, { onClear });
        const chip = host.querySelector('[data-row-group-slug="security"]');
        expect(chip.getAttribute("aria-pressed")).toBe("true");
        expect(chip.getAttribute("aria-label")).toBe("Turvallisuus: 0");
        expect(host.querySelector('[data-row-group-slug="empty"]')).toBeNull();
        expect(host.getAttribute("role")).toBe("group");
        languageRenderers.get(host)("en");
        expect(host.querySelector('[data-row-group-slug="security"]').getAttribute("aria-label")).toBe("Security: 0");
        host.querySelector('[data-lang-key="clear_selections"]').click();
        await vi.waitFor(() => expect(onClear).toHaveBeenCalledExactlyOnceWith("travel_info"));
    });

    test("refuses a twenty-first value and invalid slugs without changing state", async () => {
        const { toggleRowGroupFacet } = await import("./row_group_facet_printer.js");
        getUnifiedTableStateMock.mockReturnValue({ filters: { row_group: Array.from({ length: 20 }, (_, i) => `group_${i}`).join(",") } });
        expect(await toggleRowGroupFacet("travel_info", "extra")).toBe(false);
        expect(await toggleRowGroupFacet("travel_info", "bad value")).toBe(false);
        expect(setUnifiedTableStateMock).not.toHaveBeenCalled();
        expect(await toggleRowGroupFacet("travel_info", "group_0")).toBe(true);
    });

});
