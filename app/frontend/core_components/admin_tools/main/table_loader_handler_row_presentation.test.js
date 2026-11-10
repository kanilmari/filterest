// @vitest-environment jsdom
// table_loader_handler_row_presentation.test.js
// Verifies WO153 startup resolution, unavailable rows and presentation denials.
// Connects authorized defaults and tab choices to the unchanged startup routing assertions.
// Keeps row-presentation regressions separate from the broader loader suite.

import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createNavigationButtons: vi.fn(),
    ensurePrivateCustomViewsLoaded: vi.fn(() => Promise.resolve()),
    endpointRouter: vi.fn(),
    openNavTab: vi.fn(() => Promise.resolve()),
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

// Startup routing fixtures use the ordinary site default unless a case sets a tab choice.
vi.mock("../../table_views/dataset_appearance_state.js", async importOriginal => {
    const actual = await importOriginal();
    return { ...actual, datasetAppearanceState: { ...actual.datasetAppearanceState,
        savedRowDefaults: () => ({ site: 'article_view' }),
    } };
});

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
import { setRowPresentationChoice } from "../../table_views/row_presentation/row_presentation_choice.js";

function resetLoaderMocks(datasets) {
    vi.clearAllMocks();
    resetEarlierVisitForgettingForTests();
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/article_view']));
    mocks.getSelectedDataset.mockReturnValue(null);
    mocks.primeDatasetAccessRegistry.mockReturnValue(true);
    mocks.isCurrentDatasetAccessRefresh.mockReturnValue(true);
    mocks.endpointRouter.mockResolvedValue({
        datasets: datasets.map((datasetName) => ({ dataset_name: datasetName })),
        tab_order: [],
    });
}

test.each(["failed", "stale"])("an unavailable bookmarked row (%s) preserves its address and loads the authorized collection without reopening it", async status => {
    resetLoaderMocks(['dev_agent_tasks']);
    const dispatcher = await import('../../table_views/row_presentation/row_presentation_dispatcher.js');
    const decision = vi.spyOn(dispatcher, 'resolveRowOpening').mockResolvedValueOnce({ status });
    history.replaceState({}, '', '/dev_agent_tasks/853?search=sky');
    try {
        await load_tables();
        expect(decision).toHaveBeenCalledTimes(1);
        expect(mocks.openNavTab).toHaveBeenCalledWith('dev_agent_tasks', expect.objectContaining({
            skipUrlUpdate: true, forceReload: true, replacementParams: { search: 'sky', view: 'card' },
        }));
        expect(mocks.setUnifiedTableState).toHaveBeenCalledWith('dev_agent_tasks', expect.objectContaining({
            articleView: expect.objectContaining({ collapsed: false, expandedId: null }),
        }));
        expect(location.pathname + location.search).toBe('/dev_agent_tasks/853?search=sky');
        expect(ifav.restore).not.toHaveBeenCalled();
    } finally { decision.mockRestore(); }
});
test("a superseding address while a row is resolving leaves the new landing entirely alone", async () => {
    resetLoaderMocks(['dev_agent_tasks']);
    const dispatcher = await import('../../table_views/row_presentation/row_presentation_dispatcher.js');
    let settle;
    const decision = vi.spyOn(dispatcher, 'resolveRowOpening').mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    history.replaceState({}, '', '/dev_agent_tasks/853');
    try {
        const pending = load_tables();
        await vi.waitFor(() => expect(settle).toBeTypeOf('function'));
        history.replaceState({}, '', '/dev_agent_tasks/29?view=article_view');
        settle({ status: 'stale' });
        await pending;
        expect(mocks.openNavTab).not.toHaveBeenCalled();
        expect(mocks.setUnifiedTableState).not.toHaveBeenCalled();
        expect(location.pathname).toBe('/dev_agent_tasks/29');
    } finally { decision.mockRestore(); }
});

test("a bare row URL opens its saved Page choice without preselecting the classic dataset view", async () => {
    resetLoaderMocks(['dev_agent_tasks']);
    sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/image_first_page_view']));
    setRowPresentationChoice('dev_agent_tasks', 'image_first_page_view');
    history.replaceState({}, '', '/dev_agent_tasks/853?view=calendar');
    await load_tables();
    expect(mocks.setUnifiedTableState).not.toHaveBeenCalled();
    expect(ifav.restore).toHaveBeenCalledWith(expect.objectContaining({ tableName: 'dev_agent_tasks', rowId: '853', viewKey: 'image_first_page_view' }));
});

test('a denied Page bookmark cannot auto-open a different row when the dataset defaults to Article', async () => {
    resetLoaderMocks(['dev_agent_tasks']);
    document.body.replaceChildren();
    localStorage.setItem('dev_agent_tasks_tableMeta', JSON.stringify({ default_view_name: 'article_view' }));
    sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/article_view', '/ui/view/table']));
    history.replaceState({}, '', '/dev_agent_tasks/853?view=image_first_page_view');
    await load_tables();
    expect(mocks.openNavTab).toHaveBeenCalledWith('dev_agent_tasks', expect.objectContaining({
        skipUrlUpdate: true, replacementParams: { view: 'table' },
    }));
    expect(mocks.setUnifiedTableState).toHaveBeenCalledWith('dev_agent_tasks', expect.objectContaining({
        articleView: expect.objectContaining({ expandedId: null, pendingAutoOpenFirstRenderedResult: false }),
    }));
    expect(location.search).toBe('?view=image_first_page_view');
});
