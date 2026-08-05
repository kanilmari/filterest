// @vitest-environment jsdom
// table_loader_handler.test.js
// Verifies startup routing decisions around deep-linked dataset rows.
// Bridges URL parsing with tab opening so row links do not pollute browser history.

import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createNavigationButtons: vi.fn(),
    ensurePrivateCustomViewsLoaded: vi.fn(() => Promise.resolve()),
    endpointRouter: vi.fn(),
    openNavTab: vi.fn(() => Promise.resolve()),
    countThisFunction: vi.fn(),
    primeDatasetAccessRegistry: vi.fn(),
    setUnifiedTableState: vi.fn(),
    setRedirectNotice: vi.fn(),
    clearDatasetSelectionState: vi.fn(),
    setSelectedDataset: vi.fn(),
    getSelectedDataset: vi.fn(() => null),
    setInitialQueryParams: vi.fn(),
}));

vi.mock("../../navigation/database_tree/nav_builder.js", () => ({
    create_navigation_buttons: mocks.createNavigationButtons,
}));

vi.mock("../../navigation/admin_and_user_tools/custom_view_reader.js", () => ({
    custom_views: [],
    ensure_private_custom_views_loaded: mocks.ensurePrivateCustomViewsLoaded,
}));

vi.mock("../../navigation/main_tabs/main_tab_printer.js", () => ({
    openNavTab: mocks.openNavTab,
}));

vi.mock("../../dev_tools/function_counter.js", () => ({
    count_this_function: mocks.countThisFunction,
}));

vi.mock("../../endpoints/endpoint_router.js", () => ({
    endpoint_router: mocks.endpointRouter,
}));

vi.mock("../../navigation/nav_engine/dataset_access_registry.js", () => ({
    primeDatasetAccessRegistry: mocks.primeDatasetAccessRegistry,
}));

vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    setUnifiedTableState: mocks.setUnifiedTableState,
}));

vi.mock("../../state_stores/dataset_selection_saver.js", () => ({
    setRedirectNotice: mocks.setRedirectNotice,
    clearDatasetSelectionState: mocks.clearDatasetSelectionState,
    setSelectedDataset: mocks.setSelectedDataset,
    getSelectedDataset: mocks.getSelectedDataset,
    setInitialQueryParams: mocks.setInitialQueryParams,
}));

import { load_tables } from "./table_loader_handler.js";

describe("load_tables deep-link startup routing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        window.history.replaceState({}, "", "/");
        mocks.getSelectedDataset.mockReturnValue(null);
        mocks.endpointRouter.mockResolvedValue({
            datasets: [{ dataset_name: "dev_agent_tasks" }],
            tab_order: [],
        });
    });

    test("opens a deep-linked row without pushing the dataset base URL first", async () => {
        window.history.replaceState(
            {},
            "",
            "/dev_agent_tasks/853-filterest-application-platform-component-inventory?view=article",
        );

        await load_tables();

        expect(mocks.setUnifiedTableState).toHaveBeenCalledWith("dev_agent_tasks", {
            cardView: { collapsed: true, expandedId: "853" },
        });
        expect(mocks.setInitialQueryParams).toHaveBeenCalledWith("?view=article");
        expect(mocks.openNavTab).toHaveBeenCalledWith("dev_agent_tasks", {
            skipUrlUpdate: true,
            forceReload: false,
        });
    });

    test("keeps normal dataset routes on the regular URL update path", async () => {
        window.history.replaceState({}, "", "/dev_agent_tasks?view=card");

        await load_tables();

        expect(mocks.setUnifiedTableState).not.toHaveBeenCalled();
        expect(mocks.openNavTab).toHaveBeenCalledWith("dev_agent_tasks", {
            skipUrlUpdate: false,
            forceReload: false,
        });
    });
});
