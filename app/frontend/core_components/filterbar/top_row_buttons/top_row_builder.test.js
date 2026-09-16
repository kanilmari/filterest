// @vitest-environment jsdom
// top_row_builder.test.js
// Verifies dataset filterbar tool groups start closed and stay permission-gated.
// Bridges the top-row assembly with mocked permissions, actions, and disclosure construction.
// Exists so unauthorized toolkit headings never paint, even before rights resolve.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { appendAdminFeatures } from "../../admin_tools/admin_button_builder.js";
import { createAddRowButton } from "../../general_tables/gt_toolbar/toolbar_button_creator.js";
import { hasDatasetPermission } from "../../route_permission_checker.js";

const disclosureBuilderMock = vi.fn((options) => {
    const section = document.createElement("section");
    const title = document.createElement("span");
    title.dataset.langKey = options.langKey;
    title.textContent = options.fallbackText;
    section.append(title, options.contentElement);
    section.destroy = vi.fn();
    return section;
});

vi.mock("../filterbar_section_heading_builder.js", () => ({
    buildFilterbarDisclosureSection: disclosureBuilderMock,
}));
vi.mock("../../general_tables/gt_toolbar/toolbar_button_creator.js", () => ({
    createAddRowButton: vi.fn(() => {
        const button = document.createElement("button");
        button.dataset.testid = "btn-add-row";
        return button;
    }),
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
    getUnifiedTableState: vi.fn(() => ({ sort: { column: "name", direction: "ASC" } })),
    setUnifiedTableState: vi.fn(),
    refreshTableUnified: vi.fn(),
}));
vi.mock("../../navigation/nav_engine/query_params.js", () => ({
    getParams: vi.fn(() => ({ search: "old", status: "open", view: "table" })),
    setParams: vi.fn(),
    updateURL: vi.fn(),
}));
vi.mock("../filterbar_engine/filterbar_state_saver.js", () => ({
    clearOpenedFilters: vi.fn(),
}));
vi.mock("../../route_permission_checker.js", () => ({
    hasDatasetPermission: vi.fn(() => Promise.resolve(false)),
}));
vi.mock("../../../ui_config.js", () => ({
    show_filterbar_search_basic_controls_section: true,
}));

vi.mock("../text_search/dataset_search_executor.js", () => ({ ongoingSearchResults: {} }));

const UNAUTHORIZED_TOOL_LABELS = [
    ["filterbar_add_manage_content", "Add & manage content"],
    ["filterbar_view_content_as", "View content as…"],
];

function unauthorizedToolLabels(root) {
    const text = root.textContent || "";
    return UNAUTHORIZED_TOOL_LABELS.filter(([langKey, fallbackText]) => (
        Boolean(root.querySelector(`[data-lang-key="${langKey}"]`))
        || text.includes(fallbackText)
    ));
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

describe("buildTopRow", () => {
    beforeEach(() => {
        disclosureBuilderMock.mockClear();
        vi.mocked(hasDatasetPermission).mockReset();
        vi.mocked(hasDatasetPermission).mockResolvedValue(false);
        vi.mocked(appendAdminFeatures).mockReset();
        vi.mocked(appendAdminFeatures).mockResolvedValue();
        vi.mocked(createAddRowButton).mockClear();
        document.body.innerHTML = "";
    });

    test("starts the search group closed without painting unauthorized tool labels", async () => {
        const { buildTopRow } = await import("./top_row_builder.js");

        const topRow = buildTopRow("orders_uid", "orders", "card", ["id"], { id: "INTEGER" }, document.body);
        document.body.appendChild(topRow);

        expect(disclosureBuilderMock).toHaveBeenCalledTimes(1);
        expect(disclosureBuilderMock.mock.calls[0][0]).toEqual(expect.objectContaining({
            langKey: "search_and_basic_controls",
            fallbackText: "Haku ja perustoiminnot",
            startOpen: false,
        }));
        expect(unauthorizedToolLabels(topRow)).toEqual([]);
        expect(topRow.querySelector('[data-filterbar-section-pending="true"]')).toBeTruthy();
        expect(
            topRow.querySelector("[data-temporary-filters-toggle-for]")
        ).toBeNull();
    });

    test("does not create unauthorized section labels while permissions are still unknown", async () => {
        vi.mocked(hasDatasetPermission).mockReturnValue(new Promise(() => {}));
        vi.mocked(appendAdminFeatures).mockReturnValue(new Promise(() => {}));
        const { buildTopRow } = await import("./top_row_builder.js");

        const topRow = buildTopRow("orders_uid", "orders", "card", ["id"], { id: "INTEGER" }, document.body);
        document.body.appendChild(topRow);
        await flushMicrotasks();

        expect(unauthorizedToolLabels(document)).toEqual([]);
        expect(document.querySelector('[data-lang-key="filterbar_add_manage_content"]')).toBeNull();
        expect(document.querySelector('[data-lang-key="filterbar_view_content_as"]')).toBeNull();
        expect(createAddRowButton).not.toHaveBeenCalled();
    });

    test("mounts tools without add-row when only management controls are allowed", async () => {
        vi.mocked(appendAdminFeatures).mockImplementation(async (_table, management) => {
            const button = document.createElement("button");
            button.dataset.testid = "btn-delete-row";
            management.appendChild(button);
        });
        const { buildTopRow } = await import("./top_row_builder.js");

        const topRow = buildTopRow("orders_uid", "orders", "card", ["id"], { id: "INTEGER" }, document.body);
        document.body.appendChild(topRow);
        await topRow.ready;

        expect(createAddRowButton).not.toHaveBeenCalled();
        expect(topRow.querySelector('[data-lang-key="filterbar_add_manage_content"]')).toBeTruthy();
        expect(topRow.querySelector('[data-testid="btn-delete-row"]')).toBeTruthy();
        expect(topRow.querySelector('[data-filterbar-section-key="views"]')).toBeNull();
    });

    test("never mounts denied tool sections after guest rights resolve", async () => {
        const { buildTopRow } = await import("./top_row_builder.js");

        const topRow = buildTopRow("orders_uid", "orders", "card", ["id"], { id: "INTEGER" }, document.body);
        document.body.appendChild(topRow);
        await topRow.ready;

        expect(unauthorizedToolLabels(document)).toEqual([]);
        expect(document.querySelector('[data-filterbar-section-key="tools"]')).toBeNull();
        expect(document.querySelector('[data-filterbar-section-key="views"]')).toBeNull();
        expect(document.querySelector("[data-filterbar-section-pending]")).toBeNull();
        expect(disclosureBuilderMock).toHaveBeenCalledTimes(1);
        expect(createAddRowButton).not.toHaveBeenCalled();
    });

    test("mounts allowed tools and views only after rights are known, starting closed", async () => {
        vi.mocked(hasDatasetPermission).mockResolvedValue(true);
        vi.mocked(appendAdminFeatures).mockImplementation(async (_table, _mgmt, viewSelector) => {
            viewSelector.appendChild(document.createElement("button"));
        });
        const { buildTopRow } = await import("./top_row_builder.js");

        const topRow = buildTopRow("orders_uid", "orders", "card", ["id"], { id: "INTEGER" }, document.body);
        document.body.appendChild(topRow);

        expect(disclosureBuilderMock).toHaveBeenCalledTimes(1);
        expect(unauthorizedToolLabels(topRow)).toEqual([]);

        await topRow.ready;

        expect(disclosureBuilderMock).toHaveBeenCalledTimes(3);
        expect(disclosureBuilderMock.mock.calls.map(([options]) => [
            options.langKey,
            options.fallbackText,
            options.startOpen,
        ])).toEqual([
            ["search_and_basic_controls", "Haku ja perustoiminnot", false],
            ["filterbar_add_manage_content", "Add & manage content", false],
            ["filterbar_view_content_as", "View content as…", false],
        ]);
        expect(topRow.querySelector('[data-filterbar-section-key="tools"]')).toBeTruthy();
        expect(topRow.querySelector('[data-filterbar-section-key="views"]')).toBeTruthy();
        expect(topRow.querySelector("[data-filterbar-section-pending]")).toBeNull();
        expect(createAddRowButton).toHaveBeenCalledWith("orders_uid", "orders");
        expect(topRow.querySelector('[data-testid="btn-add-row"]')).toBeTruthy();
    });

    test("keeps a moved pending mount in the live panel body until rights allow replacement", async () => {
        let resolvePermissions;
        vi.mocked(hasDatasetPermission).mockReturnValue(new Promise((resolve) => {
            resolvePermissions = resolve;
        }));
        vi.mocked(appendAdminFeatures).mockImplementation(async (_table, _mgmt, viewSelector) => {
            viewSelector.appendChild(document.createElement("button"));
        });
        const { buildTopRow } = await import("./top_row_builder.js");

        const topRow = buildTopRow("orders_uid", "orders", "card", ["id"], { id: "INTEGER" }, document.body);
        const panelBody = document.createElement("div");
        document.body.appendChild(panelBody);
        while (topRow.firstElementChild) {
            panelBody.appendChild(topRow.firstElementChild);
        }
        topRow.remove();

        expect(unauthorizedToolLabels(panelBody)).toEqual([]);
        resolvePermissions(true);
        await topRow.ready;

        expect(panelBody.querySelector('[data-lang-key="filterbar_add_manage_content"]')).toBeTruthy();
        expect(panelBody.querySelector('[data-lang-key="filterbar_view_content_as"]')).toBeTruthy();
        expect(panelBody.querySelector("[data-filterbar-section-pending]")).toBeNull();
    });
});

test("reset preserves explicit sorting and its control while clearing only query controls", async () => {
    const { clearAllFilters } = await import("./top_row_builder.js");
    const { setParams } = await import("../../navigation/nav_engine/query_params.js");
    document.body.innerHTML = '<div class="sort-dropdown-wrapper"><input value="Name"></div><input id="query" value="old">';
    clearAllFilters("orders", document.body);
    expect(setParams).toHaveBeenCalledWith("orders", { sort_column: "name", sort_order: "ASC", view: "table" });
    expect(document.querySelector(".sort-dropdown-wrapper input").value).toBe("Name");
    expect(document.querySelector("#query").value).toBe("");
});
