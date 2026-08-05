// @vitest-environment jsdom
// top_row_builder.test.js
// Verifies dataset filterbar tool groups start closed without changing the shared disclosure default.
// Bridges the top-row assembly with mocked permissions, actions, and disclosure construction.
// Exists so every right-sidebar toolbox opens only after an explicit user action.

import { beforeEach, describe, expect, test, vi } from "vitest";

const disclosureBuilderMock = vi.fn((options) => {
    const section = document.createElement("section");
    section.appendChild(options.contentElement);
    section.destroy = vi.fn();
    return section;
});

vi.mock("../filterbar_section_heading_builder.js", () => ({
    buildFilterbarDisclosureSection: disclosureBuilderMock,
}));
vi.mock("../../general_tables/gt_toolbar/toolbar_button_creator.js", () => ({
    createAddRowButton: vi.fn(() => document.createElement("button")),
}));
vi.mock("../../admin_tools/admin_button_builder.js", () => ({
    appendAdminFeatures: vi.fn(() => Promise.resolve()),
}));
vi.mock("../text_search/create_text_search_panel.js", () => ({
    datasetSearchLocationState: { set: vi.fn() },
    datasetSearchState: { set: vi.fn() },
}));
vi.mock("./sort_dropdown_builder.js", () => ({
    createSortDropdown: vi.fn(() => document.createElement("select")),
}));
vi.mock("./sort_sync_state.js", () => ({ emitDatasetSortSelection: vi.fn() }));
vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    setUnifiedTableState: vi.fn(),
    refreshTableUnified: vi.fn(),
}));
vi.mock("../../navigation/nav_engine/query_params.js", () => ({
    setParams: vi.fn(),
    updateURL: vi.fn(),
}));
vi.mock("../filterbar_engine/filterbar_state_saver.js", () => ({
    clearOpenedFilters: vi.fn(),
}));
vi.mock("../../route_permission_checker.js", () => ({
    hasDatasetPermission: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("../../../ui_config.js", () => ({
    show_filterbar_search_basic_controls_section: true,
}));

describe("buildTopRow", () => {
    beforeEach(() => {
        disclosureBuilderMock.mockClear();
        document.body.innerHTML = "";
    });

    test("starts search, tools, and view groups closed", async () => {
        const { buildTopRow } = await import("./top_row_builder.js");

        buildTopRow("orders_uid", "orders", "card", ["id"], { id: "INTEGER" }, document.body);

        expect(disclosureBuilderMock).toHaveBeenCalledTimes(3);
        expect(disclosureBuilderMock.mock.calls.map(([options]) => [
            options.langKey,
            options.startOpen,
        ])).toEqual([
            ["search_and_basic_controls", false],
            ["tools", false],
            ["views_and_presentations", false],
        ]);
    });
});
