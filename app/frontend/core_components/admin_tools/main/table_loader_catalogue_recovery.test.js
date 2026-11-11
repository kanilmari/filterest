// @vitest-environment jsdom
// Verifies startup routing after rate-limited dataset catalogue reads.
// Keeps the real retry and registry lifecycle behind the loader’s existing test doubles.

import { beforeEach, describe, expect, onTestFinished, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createNavigationButtons: vi.fn(),
    ensurePrivateCustomViewsLoaded: vi.fn(() => Promise.resolve()),
    endpointRouter: vi.fn(),
    openNavTab: vi.fn(() => Promise.resolve()),
    initTabs: vi.fn(() => Promise.resolve()),
    openFrontPage: vi.fn(() => Promise.resolve()),
    countThisFunction: vi.fn(),
    primeDatasetAccessRegistry: vi.fn(() => true),
    beginDatasetAccessRefresh: vi.fn(() => 1),
    isCurrentDatasetAccessRefresh: vi.fn(() => true),
    setUnifiedTableState: vi.fn(),
    setRedirectNotice: vi.fn(),
    clearDatasetSelectionState: vi.fn(),
    setSelectedDataset: vi.fn(),
    getSelectedDataset: vi.fn(() => null),
}));

vi.mock("../../front_page/front_page_navigation.js", () => ({
    isSeparateFrontPageEnabled: () => localStorage.getItem('separate_front_page') === 'true',
    openFrontPage: mocks.openFrontPage,
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
    custom_views: [{ name: "front_page", navigationHidden: true }],
    ensure_private_custom_views_loaded: mocks.ensurePrivateCustomViewsLoaded,
}));

vi.mock("../../navigation/main_tabs/main_tab_printer.js", () => ({
    openNavTab: mocks.openNavTab,
    initTabs: mocks.initTabs,
}));

vi.mock("../../dev_tools/function_counter.js", () => ({
    count_this_function: mocks.countThisFunction,
}));

vi.mock("../../endpoints/endpoint_router.js", () => ({
    endpoint_router: mocks.endpointRouter,
}));

vi.mock("../../navigation/nav_engine/dataset_access_registry.js", async importOriginal => {
    const registry = await importOriginal();
    return {
        ...registry,
        primeDatasetAccessRegistry: (response, generation) => mocks.primeDatasetAccessRegistry(response, generation)
            && registry.primeDatasetAccessRegistry(response, generation),
        beginDatasetAccessRefresh: () => { mocks.beginDatasetAccessRefresh(); return registry.beginDatasetAccessRefresh(); },
        isCurrentDatasetAccessRefresh: generation => mocks.isCurrentDatasetAccessRefresh(generation)
            && registry.isCurrentDatasetAccessRefresh(generation),
    };
});

vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    setUnifiedTableState: mocks.setUnifiedTableState,
}));

vi.mock("../../state_stores/dataset_selection_saver.js", () => ({
    setRedirectNotice: mocks.setRedirectNotice,
    clearDatasetSelectionState: mocks.clearDatasetSelectionState,
    setSelectedDataset: mocks.setSelectedDataset,
    getSelectedDataset: mocks.getSelectedDataset,
}));

import { load_tables, resetEarlierVisitForgettingForTests } from "./table_loader_handler.js";
import { primeDatasetAccessRegistry } from "../../navigation/nav_engine/dataset_access_registry.js";
import { readDatasetCatalogue } from '../../pipeline/dataset_catalogue_transport.js';
import { createRateLimitError } from '../../pipeline/api_pipeline_helpers.js';
import { invalidateSessionGeneration } from "../../auth/session_generation_store.js";

// Keep the transport's real retry lifecycle even when the router's other calls are mocked.
function refuseInitialCatalogue() {
    mocks.endpointRouter.mockImplementationOnce(async () => {
        await readDatasetCatalogue(async () => new Response(null, { status: 429 }));
        throw createRateLimitError('fetchContentTables');
    });
    onTestFinished(() => invalidateSessionGeneration({ reason: 'logout' }));
}

describe("load_tables deep-link startup routing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetEarlierVisitForgettingForTests();
        localStorage.clear();
        sessionStorage.clear();
    sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/article_view']));
        window.history.replaceState({}, "", "/");
        mocks.getSelectedDataset.mockReturnValue(null);
        mocks.primeDatasetAccessRegistry.mockReturnValue(true);
        mocks.isCurrentDatasetAccessRefresh.mockReturnValue(true);
        mocks.endpointRouter.mockResolvedValue({
            datasets: [{ dataset_name: "dev_agent_tasks" }],
            tab_order: [],
        });
    });

    test.each(['/', '/dev_agent_tasks?view=card'])("recovers the original view %s and tabs from a 200 without refetching", async address => {
        history.replaceState({}, '', address);
        localStorage.setItem('separate_front_page', 'true');
        refuseInitialCatalogue();
        expect(await load_tables({ forceReload: true })).toBeNull();
        const recovered = { datasets: [{ dataset_name: 'dev_agent_tasks' }] };
        primeDatasetAccessRegistry(recovered);
        await vi.waitFor(() => expect(mocks.initTabs).toHaveBeenCalledExactlyOnceWith({
            dataAlreadyLoaded: true, preloadedContentTablesResponse: recovered,
        }));
        expect(address === '/' ? mocks.openFrontPage : mocks.openNavTab).toHaveBeenCalledTimes(1);
        expect(mocks.endpointRouter).toHaveBeenCalledTimes(1);
    });

    test.each(['navigate', 'logout'])("a delayed catalogue cannot navigate back after %s", async action => {
        refuseInitialCatalogue();
        await load_tables();
        if (action === 'navigate') history.replaceState({}, '', '/other');
        else invalidateSessionGeneration({ reason: 'logout' });
        primeDatasetAccessRegistry({ datasets: [{ dataset_name: 'dev_agent_tasks' }] });
        await Promise.resolve();
        expect(mocks.initTabs).not.toHaveBeenCalled();
        expect(mocks.openNavTab).not.toHaveBeenCalled();
        expect(mocks.endpointRouter).toHaveBeenCalledTimes(1);
    });
});
