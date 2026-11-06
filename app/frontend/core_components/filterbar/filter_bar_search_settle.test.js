// @vitest-environment jsdom
// filter_bar_search_settle.test.js
// Proves real dataset-search renders settle under the runtime's real observer.
// Connects the assembled inline-hero bar to a bounded, manually drained RAF queue.
// Prevents phone and wide searches from continuously resynchronizing themselves.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanupFilterBarBuilderTestDom, resetFilterBarBuilderTestDom } from './filter_bar_builder_test_setup.js';

const renders = vi.hoisted(() => vi.fn());
vi.mock('./mobile_topbar_search_controller.js', async importOriginal => {
    const real = await importOriginal();
    return { ...real, createMobileTopbarSearchController: bar => {
        const controller = real.createMobileTopbarSearchController(bar);
        return { ...controller, sync: state => { renders(); controller.sync(state); } };
    } };
});
vi.mock('./filter_list/active_filter_tag_printer.js', () => ({ renderActiveFilters: vi.fn() }));
vi.mock('../navigation/nav_engine/dataset_access_registry.js', () => ({
    canReadDatasetFromRegistry: () => true,
    hasDatasetAccessSnapshot: () => false,
    resolveDataset: ({ name }) => ({ status: 'found', dataset: { dataset_name: name } }),
    subscribeDatasetAccessRegistry: () => () => {},
}));
vi.mock('./text_search/dataset_search_executor.js', () => ({
    do_intelligent_search: vi.fn(), getSearchGroupsForViewRebuild: vi.fn(),
    ongoingSearchResults: new Map(),
}));
vi.mock('../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', () => ({
    getUnifiedTableState: () => ({}), setUnifiedTableState: vi.fn(), refreshTableUnified: vi.fn(),
}));

let frames;
let sequence;
beforeEach(() => {
    resetFilterBarBuilderTestDom();
    localStorage.clear();
    renders.mockClear();
    frames = new Map(); sequence = 0;
    vi.stubGlobal('requestAnimationFrame', callback => {
        frames.set(++sequence, callback);
        return sequence;
    });
    vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
    document.getElementById('navbar').classList.add('collapsed');
});
afterEach(() => {
    cleanupFilterBarBuilderTestDom();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function frame() {
    // Deliver native MutationObservers before and after each simulated frame.
    await Promise.resolve();
    const batch = [...frames.values()]; frames.clear();
    batch.forEach(callback => callback(0));
    await Promise.resolve();
}

test.each([390, 1200])('real search and inline-hero runtime settle at %ipx', async width => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width);
    const realSearch = await import('./text_search/dataset_search_component_builder.js');
    const searchEntry = await import('./text_search/create_text_search_panel.js');
    // Keep the shared test setup's unrelated mocks; mount the production search DOM.
    searchEntry.createDatasetSearchPanel.mockImplementation(realSearch.createDatasetSearchPanel);
    const { create_filter_bar } = await import('./filter_bar_builder.js');
    const panel = create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');
    const bar = document.querySelector('.dataset-shared-topbar');
    expect(document.querySelector('.filterbar-inline-hero')).not.toBeNull();
    expect(bar.querySelector('.dataset-search-clear-icon').textContent).toBe(width <= 700 ? '⊗' : '×');
    expect(bar.querySelector('.dataset-search-submit-icon')).not.toBeNull();
    for (let attempt = 0; attempt < 12; attempt++) await frame();
    expect(renders.mock.calls.length).toBeGreaterThan(0);
    expect(renders.mock.calls.length).toBeLessThanOrEqual(8);
    expect(frames.size).toBe(0);

    // Trigger the runtime observer, rather than calling the controller ourselves.
    const mutations = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(bar, { subtree: true, childList: true, characterData: true, attributes: true });
    try {
        const previousRenders = renders.mock.calls.length;
        bar.querySelector('.dataset-search-input-row').append(document.createElement('span'));
        await frame();
        expect(renders.mock.calls.length).toBeGreaterThan(previousRenders);
        expect(renders.mock.calls.length - previousRenders).toBeLessThanOrEqual(2);
        expect(mutations.length).toBeGreaterThan(0);
        mutations.length = 0;
        const syncedRenders = renders.mock.calls.length;
        for (let attempt = 0; attempt < 4; attempt++) await frame();
        expect(renders.mock.calls.length).toBe(syncedRenders);
        expect(mutations).toHaveLength(0);
        expect(frames.size).toBe(0);
    } finally {
        observer.disconnect();
        panel.destroy();
    }
});
