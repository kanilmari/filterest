// searched_card_assembly.test.js
// Reproduces URL-seeded searched listings through the real filterbar and renderer.
// Connects deferred public settings with refresh, listing reload and result controls.
// Protects the mounted card host and chips without a server or database.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { paletteSnapshot } from '../admin_tools/dataset_appearance_palette_test_fixtures.js';

const { request, fetchRows, fetchSettings } = vi.hoisted(() => ({
    request: vi.fn(), fetchRows: vi.fn(), fetchSettings: vi.fn(),
}));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: request, get_endpoint_url: () => '/api/fixture' }));
vi.mock('../endpoints/endpoint_data_fetcher.js', () => ({ fetchDatasetData: fetchRows }));
vi.mock('../endpoints/stable_endpoint_router.js', async original => ({
    ...await original(), fetchSitePresentationSettings: fetchSettings,
    fetchAdminUIFeatureFlags: async () => ({}),
}));
vi.mock('../route_permission_checker.js', () => ({
    hasRoutePermission: () => true, hasDatasetPermission: async () => false, primeDatasetPermissions: vi.fn(),
    applyPermission: vi.fn(),
}));
vi.mock('../config_fetcher.js', async original => ({
    ...await original(), getDefaultViewSync: () => 'card',
    getDefaultDatasetSortSync: () => ({ column: '__newest', direction: 'DESC' }),
}));
vi.mock('../navigation/nav_engine/dataset_address_writer.js', async original => ({
    ...await original(), updateDatasetAddress: vi.fn(),
}));

import { datasetAppearanceState } from './dataset_appearance_state.js';
import { resetSitePresentationStatesForTests } from '../admin_tools/site_presentation_state.js';
import { setChosenDatasetView } from '../state_stores/dataset_view_choice_saver.js';
import { setAllSpecs } from '../state_stores/table_specs_reader.js';
import { setParams } from '../navigation/nav_engine/query_params.js';
import { setUnifiedTableState } from '../state_stores/table_state_store.js';
import { refreshTableUnified } from '../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';
import { disconnectInfiniteScroll } from '../infinite_scroll/infinite_scroll_handler.js';
import { datasetSearchRegistry } from '../filterbar/text_search/dataset_search_state_reader.js';
import { ongoingSearchResults } from '../filterbar/text_search/dataset_search_executor.js';

let datasetName, useSavedSort, datasetSequence = 0;
beforeEach(() => {
    datasetName = `demo_${++datasetSequence}`; useSavedSort = true;
    localStorage.clear(); sessionStorage.clear(); datasetAppearanceState.clear();
    resetSitePresentationStatesForTests(); setAllSpecs({ [datasetName]: { table_uid: 104 } });
    document.body.innerHTML = '<div id="tabs_container"></div>';
    window.history.replaceState({}, '', `/${datasetName}?search=chip-proof&title=filter-proof`);
    setParams(datasetName, { search: 'chip-proof', title: 'filter-proof' });
    setChosenDatasetView(datasetName, 'card');
    setUnifiedTableState(datasetName, { filters: { title: 'filter-proof' }, sort: { column: null, direction: null } });
    request.mockReset(); fetchRows.mockReset(); fetchSettings.mockReset();
    request.mockImplementation(async name => {
        if (name === 'getDatasetSortDefault') return { configured: useSavedSort, value: '__newest:DESC' };
        if (name === 'getIntelligentResultsStream') return new Response('', { headers: { 'Content-Type': 'application/x-ndjson' } });
        return {};
    });
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('innerWidth', 375);
});
afterEach(() => {
    disconnectInfiniteScroll(datasetName);
    datasetSearchRegistry.get(datasetName)?.forEach(component => component.destroy());
    vi.restoreAllMocks(); vi.unstubAllGlobals();
});

test.each([
    ['start', true, 0], ['end', true, 0], ['start', false, 0], ['end', false, 0], ['start', true, 1],
])('searched filtered cards mount with %s chips (saved sort: %s, rows: %s)', async (side, configured, rowCount) => {
    useSavedSort = configured;
    const appearance = paletteSnapshot(104);
    appearance.site_values['shared.active_filter_remove_side'] = side;
    const response = { columns: ['id', 'title'], data: rowCount ? [{ id: 1, title: 'filter-proof' }] : [], row_count: rowCount,
        types: { id: { data_type: 'integer' }, title: { data_type: 'text' } }, dataset_appearance: appearance };
    fetchRows.mockImplementation(async () => structuredClone(response));
    let completeSettings;
    fetchSettings.mockImplementation(() => new Promise(resolve => { completeSettings = resolve; }));
    const warning = vi.spyOn(console, 'warn');
    const pending = refreshTableUnified(datasetName);
    await vi.waitFor(() => expect(completeSettings).toBeTypeOf('function'));
    // The search component's URL auto-commit runs while card construction awaits settings.
    await vi.waitFor(() => expect(fetchRows.mock.calls.length).toBeGreaterThanOrEqual(2));
    completeSettings({ schema_version: 2, version: 'site-1',
        site_values: appearance.site_values, defaults: appearance.defaults });
    await pending;
    await vi.waitFor(() => expect(document.querySelector(`#${datasetName}_card_view_container .card_container`)).not.toBeNull());
    const row = document.querySelector(`#${datasetName}_card_top_controls [data-testid="active-filters"]`);
    expect(row).not.toBeNull(); expect(row.textContent).toContain('chip-proof');
    expect(row.textContent).toContain('filter-proof');
    expect(row.querySelector('[data-testid="active-filter-item"]').dataset.removeSide).toBe(side);
    expect(warning.mock.calls.some(([message]) => String(message).includes('kontainer puuttuu'))).toBe(false);
    expect(document.querySelectorAll(`#${datasetName}_card_view_container .card`)).toHaveLength(rowCount);
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(fetchRows.mock.calls[1][0].filters).toEqual({ search: 'chip-proof', title: 'filter-proof' });
});

test.each(['sign-out', 'deletion', 'ownership'])(
    'rebuilding an unfinished searched card host still rejects late work after %s', async reason => {
        const appearance = paletteSnapshot(104);
        fetchRows.mockResolvedValue({ columns: ['id'], data: [], types: {}, row_count: 0, dataset_appearance: appearance });
        let completeSettings;
        fetchSettings.mockImplementation(() => new Promise(resolve => { completeSettings = resolve; }));
        const pending = refreshTableUnified(datasetName);
        await vi.waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(2));
        const search = ongoingSearchResults[datasetName].executionPromise;
        if (reason === 'sign-out') datasetAppearanceState.clear();
        else if (reason === 'deletion') datasetAppearanceState.forget(datasetName);
        else setAllSpecs({ [datasetName]: { table_uid: 22 }, renamed: { table_uid: 104 } });
        completeSettings({ schema_version: 2, version: 'site-1',
            site_values: appearance.site_values, defaults: appearance.defaults });
        await pending; await search;
        expect(document.querySelector(`#${datasetName}_card_view_container .card_container`)).toBeNull();
        expect(document.getElementById(`${datasetName}_card_top_controls`)).toBeNull();
    },
);

test('a new search replaces a pending card rebuild without restoring the old chips', async () => {
    const appearance = paletteSnapshot(104);
    fetchRows.mockResolvedValue({ columns: ['id'], data: [], types: {}, row_count: 0, dataset_appearance: appearance });
    let completeSettings;
    fetchSettings.mockImplementation(() => new Promise(resolve => { completeSettings = resolve; }));
    const pending = refreshTableUnified(datasetName);
    await vi.waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(2));
    const oldSearch = ongoingSearchResults[datasetName].executionPromise;
    const component = [...datasetSearchRegistry.get(datasetName)][0];
    component.input.value = 'new query';
    component.input.dispatchEvent(new Event('input', { bubbles: true }));
    component.input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(3));
    const newSearch = ongoingSearchResults[datasetName].executionPromise;
    completeSettings({ schema_version: 2, version: 'site-1',
        site_values: appearance.site_values, defaults: appearance.defaults });
    await pending; await oldSearch; await newSearch;
    const row = document.querySelector(`#${datasetName}_card_top_controls [data-testid="active-filters"]`);
    expect(row.textContent).toContain('new query');
    expect(row.textContent).not.toContain('chip-proof');
});
