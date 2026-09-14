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
    primeDatasetAccessRegistry: vi.fn(() => true),
    beginDatasetAccessRefresh: vi.fn(() => 1),
    isCurrentDatasetAccessRefresh: vi.fn(() => true),
    setUnifiedTableState: vi.fn(),
    setRedirectNotice: vi.fn(),
    clearDatasetSelectionState: vi.fn(),
    setSelectedDataset: vi.fn(),
    getSelectedDataset: vi.fn(() => null),
    setInitialQueryParams: vi.fn(),
}));

const ifav = vi.hoisted(() => ({ restore: vi.fn(async () => true) }));
vi.mock("../../navigation/nav_engine/image_first_view_history.js", () => ({
    isImageFirstViewURL: () => new URL(location.href).searchParams.get("view") === "image_first_view",
    getImageFirstViewBackingView: () => "card",
    handleImageFirstViewHistory: ifav.restore,
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
    beginDatasetAccessRefresh: mocks.beginDatasetAccessRefresh,
    isCurrentDatasetAccessRefresh: mocks.isCurrentDatasetAccessRefresh,
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
        mocks.primeDatasetAccessRegistry.mockReturnValue(true);
        mocks.isCurrentDatasetAccessRefresh.mockReturnValue(true);
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
            articleView: { collapsed: true, expandedId: "853", returnView: "card" },
        });
        expect(mocks.setInitialQueryParams).toHaveBeenCalledWith("?view=article");
        expect(mocks.openNavTab).toHaveBeenCalledWith("dev_agent_tasks", {
            skipUrlUpdate: true,
            forceReload: false,
        });
    });

    test("discards a stale metadata response before navigation or dataset state changes", async () => {
        mocks.primeDatasetAccessRegistry.mockReturnValue(false);
        expect(await load_tables()).toBeNull();
        expect(mocks.createNavigationButtons).not.toHaveBeenCalled();
        expect(mocks.setSelectedDataset).not.toHaveBeenCalled();
        expect(mocks.openNavTab).not.toHaveBeenCalled();
    });

    test("stops a superseded refresh after private view loading", async () => {
        mocks.isCurrentDatasetAccessRefresh.mockReturnValue(false);
        expect(await load_tables()).toBeNull();
        expect(mocks.createNavigationButtons).not.toHaveBeenCalled();
        expect(mocks.openNavTab).not.toHaveBeenCalled();
    });


    test("explicit initial view overrides only this dataset's stored view", async () => {
        localStorage.setItem("dev_agent_tasks_view", "table");
        localStorage.setItem("other_view", "calendar");
        history.replaceState({}, "", "/dev_agent_tasks?view=article_view&search=test");
        await load_tables();
        expect(localStorage.getItem("dev_agent_tasks_view")).toBe("article_view");
        expect(localStorage.getItem("other_view")).toBe("calendar");
    });


    test.each(["", "?view=unknown"])("keeps the chosen view for an absent or unknown explicit view %s", async (query) => {
        localStorage.setItem("dev_agent_tasks_view", "card");
        history.replaceState({}, "", "/dev_agent_tasks" + query);
        await load_tables();
        expect(localStorage.getItem("dev_agent_tasks_view")).toBe("card");
    });

    test("resolves the supported article alias before the initial render", async () => {
        localStorage.setItem("dev_agent_tasks_view", "table");
        history.replaceState({}, "", "/dev_agent_tasks?view=article");
        await load_tables();
        expect(localStorage.getItem("dev_agent_tasks_view")).toBe("article_view");
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

test("IFAV bookmark prepares its backing dataset without opening a classic article", async () => {
    vi.clearAllMocks();
    mocks.endpointRouter.mockResolvedValue({ datasets: [{ dataset_name: "dev_agent_tasks" }] });
    history.replaceState({}, "", "/dev_agent_tasks/853?search=test&view=image_first_view#image=one.jpg");
    await load_tables();
    expect(mocks.setUnifiedTableState).not.toHaveBeenCalled();
    expect(mocks.openNavTab).toHaveBeenCalledWith("dev_agent_tasks", {
        skipUrlUpdate: true, forceReload: false, replacementParams: { search: "test", view: "card" },
    });
    expect(ifav.restore).toHaveBeenCalledWith(expect.objectContaining({ tableName: "dev_agent_tasks", rowId: "853" }));
    expect(location.search).toContain("view=image_first_view");
});
