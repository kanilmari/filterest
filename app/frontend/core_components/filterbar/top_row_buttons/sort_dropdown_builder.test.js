// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    dropdown: null,
    createVanillaDropdown: vi.fn(),
    getUnifiedTableState: vi.fn(),
    setUnifiedTableState: vi.fn(),
    refreshTableUnified: vi.fn(),
    getParams: vi.fn(),
    setParams: vi.fn(),
    updateURL: vi.fn(),
    getDatasetSortSelection: vi.fn(),
    emitDatasetSortSelection: vi.fn(),
    subscribeDatasetSortSelection: vi.fn(),
    applyDatasetSortDefault: vi.fn(),
}));

vi.mock("../../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js", () => ({
    createVanillaDropdown: mocks.createVanillaDropdown,
}));
vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    getUnifiedTableState: mocks.getUnifiedTableState,
    setUnifiedTableState: mocks.setUnifiedTableState,
    refreshTableUnified: mocks.refreshTableUnified,
}));
vi.mock("../../navigation/nav_engine/query_params.js", () => ({
    getParams: mocks.getParams,
    setParams: mocks.setParams,
    updateURL: mocks.updateURL,
}));
vi.mock("./sort_sync_state.js", () => ({
    getDatasetSortSelection: mocks.getDatasetSortSelection,
    emitDatasetSortSelection: mocks.emitDatasetSortSelection,
    subscribeDatasetSortSelection: mocks.subscribeDatasetSortSelection,
}));
vi.mock("../text_search/dataset_search_executor.js", () => ({
    hasCachedSearchResults: vi.fn(() => false),
    sortCachedSearchResults: vi.fn(),
}));
vi.mock("./dataset_sort_default_controller.js", () => ({
    applyDatasetSortDefault: mocks.applyDatasetSortDefault,
    createDatasetSortDefaultAction: vi.fn(() => null),
}));

import { createSortDropdown } from "./sort_dropdown_builder.js";

describe("sort_dropdown_builder", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = "";
        mocks.dropdown = {
            setValue: vi.fn(),
            setOptions: vi.fn(),
            destroy: vi.fn(),
        };
        mocks.createVanillaDropdown.mockReturnValue(mocks.dropdown);
        mocks.getUnifiedTableState.mockReturnValue({
            filters: {},
            sort: { column: "missing", direction: "ASC" },
        });
        mocks.getParams.mockReturnValue({ sort_column: "missing", sort_order: "ASC" });
        mocks.subscribeDatasetSortSelection.mockImplementation((_tableName, callback) => {
            callback(mocks.getDatasetSortSelection());
            return vi.fn();
        });
    });

    test("normalizes an unavailable URL sort and refreshes with the represented value", async () => {
        mocks.getDatasetSortSelection.mockReturnValue("missing:ASC");
        mocks.subscribeDatasetSortSelection.mockImplementation((_tableName, callback) => {
            callback("__newest:ASC");
            return vi.fn();
        });

        createSortDropdown("system_db_version", ["id", "applied_at"], {
            id: { data_type: "integer" },
            applied_at: { data_type: "timestamp" },
        });
        await Promise.resolve();

        expect(mocks.setUnifiedTableState).toHaveBeenCalledWith(
            "system_db_version",
            expect.objectContaining({ sort: { column: "__newest", direction: "ASC" } }),
        );
        expect(mocks.updateURL).toHaveBeenCalledWith(
            "system_db_version",
            { sort_column: "__newest", sort_order: "ASC" },
            undefined,
            { replace: true },
        );
        expect(mocks.dropdown.setValue).toHaveBeenCalledWith("__newest:ASC");
        expect(mocks.refreshTableUnified).toHaveBeenCalledWith(
            "system_db_version",
            { skipUrlParams: true },
        );
    });

    test("represents a valid header sort even when it is not a configured menu option", () => {
        mocks.getDatasetSortSelection.mockReturnValue("id:ASC");
        mocks.getUnifiedTableState.mockReturnValue({
            filters: {},
            sort: { column: "id", direction: "ASC" },
        });
        mocks.getParams.mockReturnValue({ sort_column: "id", sort_order: "ASC" });

        createSortDropdown("system_db_version", ["id", "applied_at"], {
            id: { data_type: "integer" },
            applied_at: { data_type: "timestamp" },
        });

        expect(mocks.dropdown.setOptions).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ value: "id:ASC", label: "id ↑" }),
        ]));
        expect(mocks.dropdown.setValue).toHaveBeenCalledWith("id:ASC");
        expect(mocks.setUnifiedTableState).not.toHaveBeenCalled();
    });
});
