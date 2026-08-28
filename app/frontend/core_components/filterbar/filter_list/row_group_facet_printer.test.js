// row_group_facet_printer.test.js
// Verifies localized facet rendering, active state, validation, and route-backed toggling.
// Bridges first-page facet metadata with the common dataset controls in jsdom.
// Exists to keep row-group filters consistent across every view without stale unsafe chips.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    doIntelligentSearchMock,
    getParamsMock,
    getUnifiedTableStateMock,
    refreshTableUnifiedMock,
    setParamsMock,
    setUnifiedTableStateMock,
    updateURLMock,
} = vi.hoisted(() => ({
    doIntelligentSearchMock: vi.fn(),
    getParamsMock: vi.fn(),
    getUnifiedTableStateMock: vi.fn(),
    refreshTableUnifiedMock: vi.fn(),
    setParamsMock: vi.fn(),
    setUnifiedTableStateMock: vi.fn(),
    updateURLMock: vi.fn(),
}));

vi.mock("../../table_views/dataset_value_localizer.js", () => ({
    bindDatasetLanguageRenderer: (element, render) => render("fi"),
    resolveDatasetDisplayValue: (value, _metadata, language) => value?.[language] || "",
}));

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
        expect(host.getAttribute("aria-label")).toBe("Tulosjoukon ryhmät");
        const chips = host.querySelectorAll('[data-testid="row-group-facet-chip"]');
        expect(chips).toHaveLength(2);
        expect(chips[0].textContent).toBe("Turvallisuus5");
        expect(chips[0].getAttribute("aria-pressed")).toBe("true");
        expect(chips[1].getAttribute("aria-pressed")).toBe("false");

        chips[1].click();
        await vi.waitFor(() => expect(onToggle).toHaveBeenCalledWith("travel_info", "lappi"));
    });

    test("removes ordinary-universe facet metadata when cached search takes over", async () => {
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
        expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
    });
});
