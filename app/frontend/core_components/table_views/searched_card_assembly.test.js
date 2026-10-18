// searched_card_assembly.test.js
// Reproduces URL-seeded searched listings through the real filterbar and renderer.
// Connects deferred public settings with refresh, listing reload and result controls.
// Protects mounted listing/AI cards, resource disposal and chips without a server or database.
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
import { forgetChosenDatasetView, setChosenDatasetView } from '../state_stores/dataset_view_choice_saver.js';
import { setAllSpecs } from '../state_stores/table_specs_reader.js';
import { setParams } from '../navigation/nav_engine/query_params.js';
import { getUnifiedTableState, setUnifiedTableState } from '../state_stores/table_state_store.js';
import { refreshTableUnified } from '../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';
import { disconnectInfiniteScroll } from '../infinite_scroll/infinite_scroll_handler.js';
import { datasetSearchRegistry } from '../filterbar/text_search/dataset_search_state_reader.js';
import { getSearchGroupsForViewRebuild, ongoingSearchResults } from '../filterbar/text_search/dataset_search_executor.js';
import { disposeCardResources } from './card_view/card_resource_lifecycle.js';
import { clearCommittedDatasetSearch } from '../filterbar/text_search/dataset_search_clearer.js';
import { toggleRowGroupFacet } from '../filterbar/filter_list/row_group_facet_printer.js';
import { primeDatasetAccessRegistry } from '../navigation/nav_engine/dataset_access_registry.js';

let datasetName, useSavedSort, datasetSequence = 0;
const lifecycleCards = new Set();
const lifecycleResizeTargets = new Set();
beforeEach(() => {
    lifecycleCards.clear();
    lifecycleResizeTargets.clear();
    datasetName = `demo_${++datasetSequence}`; useSavedSort = true;
    localStorage.clear(); sessionStorage.clear(); datasetAppearanceState.clear();
    sessionStorage.setItem('user_permissions', JSON.stringify(['/api/get-intelligent-results']));
    primeDatasetAccessRegistry({ datasets: [{ dataset_name: datasetName, table_uid: 104, can_read_rows: true }] });
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
    ongoingSearchResults[datasetName]?.abortController?.abort();
    delete ongoingSearchResults[datasetName];
    lifecycleCards.forEach(disposeCardResources);
    disposeCardResources(document.body);
    document.body.replaceChildren();
    if (vi.isFakeTimers()) { vi.clearAllTimers(); vi.useRealTimers(); }
    vi.restoreAllMocks(); vi.unstubAllGlobals();
});

// Keep the actual stream reader, search executor and card builders. Only transport,
// avatar hashing and measurable DOM sizes are fixtures in this server-free proof.
function prepareAiCardLifecycle() {
    vi.useFakeTimers();
    // The real keyword/detail builders share observer instances across cards
    // and tests, so every observer fixture must report to this same target set.
    const resizeTargets = lifecycleResizeTargets, mounts = [], measuredTags = [];
    const columns = ['id', 'title', 'keywords', 'detail'];
    const types = { id: { data_type: 'integer' }, title: { data_type: 'text' },
        keywords: { data_type: 'text', card_element: 'keywords', show_value_on_card: true },
        detail: { data_type: 'text', card_element: 'details', show_value_on_card: true } };
    const row = id => ({ id, title: 'filter-proof', keywords: 'alpha, beta, gamma', detail: 'Detail' });
    const appearance = paletteSnapshot(104, { 'shared.card_style_variant': 'standard' });
    fetchSettings.mockResolvedValue({ schema_version: 2, version: 'site-1',
        site_values: appearance.site_values, defaults: appearance.defaults });
    fetchRows.mockResolvedValue({ columns, types, data: [row(1)], row_count: 1, dataset_appearance: appearance });
    request.mockImplementation(async name => {
        if (name === 'getDatasetSortDefault') return { configured: true, value: '__newest:DESC' };
        if (name === 'getIntelligentResultsStream') return new Response(
            JSON.stringify({ stage: 'ai', columns, types, data: [row(22)] }) + '\n',
            { headers: { 'Content-Type': 'application/x-ndjson' } });
        return {};
    });
    vi.stubGlobal('crypto', { subtle: { digest: async () => new ArrayBuffer(32) } });
    vi.stubGlobal('ResizeObserver', class {
        observe(target) { resizeTargets.add(target); }
        unobserve(target) { resizeTargets.delete(target); }
        disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
        if (!this.classList.contains('keyword_tag')) return 0;
        measuredTags.push({ tag: this, connected: this.isConnected });
        return this.isConnected ? 80 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
        return this.isConnected ? 100 : 0;
    });
    const dispatch = HTMLElement.prototype.dispatchEvent;
    vi.spyOn(HTMLElement.prototype, 'dispatchEvent').mockImplementation(function (event) {
        if (event.type === 'easelect:card-mounted') mounts.push({ card: this, connected: this.isConnected });
        return dispatch.call(this, event);
    });
    const bind = datasetAppearanceState.bind;
    vi.spyOn(datasetAppearanceState, 'bind').mockImplementation((node, ...args) => {
        if (node.classList.contains('card')) lifecycleCards.add(node);
        return bind(node, ...args);
    });
    return { resizeTargets, mounts, measuredTags };
}

async function mountSearchedAiCards() {
    await refreshTableUnified(datasetName);
    await ongoingSearchResults[datasetName]?.executionPromise;
    return document.getElementById(`${datasetName}_search_ai_cards`);
}

function finishAiCardAnimations() {
    document.querySelectorAll('.card').forEach(card => card.dispatchEvent(new Event('animationend')));
    vi.advanceTimersByTime(600);
}

test('nonempty AI cards measure keywords only after their connected insertion', async () => {
    const { mounts, measuredTags } = prepareAiCardLifecycle();
    const host = await mountSearchedAiCards();
    const card = host.querySelector('.card');
    const tags = [...card.querySelectorAll('.keyword_tag')];
    expect(tags).toHaveLength(3);
    expect.soft(tags.filter(tag => tag.style.display !== 'none')).toHaveLength(1);
    expect.soft(mounts.filter(mount => mount.card === card).map(mount => mount.connected)).toEqual([true]);
    expect(measuredTags.filter(measurement => card.contains(measurement.tag))).toHaveLength(3);
    expect(measuredTags.every(measurement => measurement.connected)).toBe(true);
});

test('repeated nonempty AI group replacement retains only connected keyword and detail observers', async () => {
    const { resizeTargets, mounts } = prepareAiCardLifecycle();
    await mountSearchedAiCards(); finishAiCardAnimations();
    const listingCard = document.querySelector('.card_container > .card');
    const groups = getSearchGroupsForViewRebuild(datasetName);
    for (let replacement = 0; replacement < 4; replacement++) {
        expect(await groups.place()).toBe(true);
        finishAiCardAnimations();
        await Promise.resolve();
        expect.soft([...resizeTargets].filter(target => !target.isConnected)).toHaveLength(0);
    }
    const host = document.getElementById(`${datasetName}_search_ai_cards`);
    expect([...resizeTargets].filter(target => host.contains(target) && target.classList.contains('card_keywords_container'))).toHaveLength(1);
    expect([...resizeTargets].filter(target => host.contains(target) && target.classList.contains('card_details_kv'))).toHaveLength(1);
    expect(mounts.filter(mount => mount.card.dataset.id === '22')).toHaveLength(5);
    expect(document.querySelector('.card_container > .card')).toBe(listingCard);
});

test('clearing a nonempty AI search releases its group before the ordinary listing refresh', async () => {
    const { resizeTargets } = prepareAiCardLifecycle();
    const host = await mountSearchedAiCards(); finishAiCardAnimations();
    const outgoingTargets = [...resizeTargets].filter(target => host.contains(target));
    expect(outgoingTargets).toHaveLength(2);
    const listingCard = document.querySelector('.card_container > .card');
    expect(clearCommittedDatasetSearch(datasetName)).toBe(true);
    expect(host.isConnected).toBe(false);
    expect(outgoingTargets.filter(target => resizeTargets.has(target))).toHaveLength(0);
    await vi.waitFor(() => expect(document.querySelector('.card_container > .card')).not.toBe(listingCard));
});

test('cancellation after a nonempty AI staging build releases waiting mount and animation listeners', async () => {
    const { resizeTargets, mounts } = prepareAiCardLifecycle();
    let stagingHost;
    const append = HTMLElement.prototype.appendChild;
    vi.spyOn(HTMLElement.prototype, 'appendChild').mockImplementation(function (node) {
        const result = append.call(this, node);
        if (!this.isConnected && this.classList.contains('search-ai-results-card-container') && this.querySelector('.card')) {
            stagingHost = this;
            // Invalidate after the real builder has accepted its detached batch,
            // before the executor resumes to commit it into the connected host.
            queueMicrotask(() => {
                ongoingSearchResults[datasetName].abortController.abort();
                ongoingSearchResults[datasetName] = null;
            });
        }
        return result;
    });
    await refreshTableUnified(datasetName);
    const pendingSearch = ongoingSearchResults[datasetName]?.executionPromise;
    await pendingSearch;
    expect(stagingHost.querySelectorAll('.card')).toHaveLength(1);
    expect(mounts.filter(mount => mount.card.dataset.id === '22')).toEqual([]);
    expect(document.querySelector(`#${datasetName}_search_ai_cards .card`)).toBeNull();
    expect(document.querySelector('.card_container > .card').dataset.id).toBe('1');
    finishAiCardAnimations();
    const committedTargets = new Set(resizeTargets);
    // Probe abandoned listeners directly; jsdom cannot report retained callbacks.
    const abandoned = stagingHost.querySelector('.card');
    document.body.append(abandoned);
    abandoned.dispatchEvent(new CustomEvent('easelect:card-mounted'));
    abandoned.dispatchEvent(new Event('animationend'));
    vi.advanceTimersByTime(600);
    expect([...resizeTargets].filter(target => !committedTargets.has(target))).toHaveLength(0);
});

test.each([false, true])('category, rejected build and recovery each request and swap once (searched: %s)', async searched => {
    vi.useFakeTimers();
    let rejectAvatar = false;
    vi.stubGlobal('crypto', { subtle: { digest: async (_algorithm, bytes) => {
        if (rejectAvatar && new TextDecoder().decode(bytes).startsWith('99_')) {
            rejectAvatar = false;
            throw new Error('Fixture avatar build rejected');
        }
        return new ArrayBuffer(32);
    } } });
    const appearance = paletteSnapshot(104);
    fetchSettings.mockResolvedValue({ schema_version: 2, version: 'site-1',
        site_values: appearance.site_values, defaults: appearance.defaults });
    if (!searched) {
        setParams(datasetName, { title: 'filter-proof', view: 'card' });
        history.replaceState({}, '', `/${datasetName}?title=filter-proof&view=card`);
    }
    fetchRows.mockImplementation(async ({ filters }) => ({
        columns: ['id', 'title'], data: [1, 99].map(id => ({ id, title: 'Lifecycle fixture' })), row_count: 2,
        types: { id: { data_type: 'integer' }, title: { data_type: 'text' } }, dataset_appearance: appearance,
        row_group_facets: [{ id: 1, slug: 'boat', title: { en: 'Boat' }, row_count: 2,
            heading: { id: 1, slug: 'type', title: { en: 'Type' } } }],
        row_group_selection: { slugs: filters.row_group ? ['boat'] : [], modes: {} },
    }));
    await refreshTableUnified(datasetName);
    if (searched) await ongoingSearchResults[datasetName]?.executionPromise;
    const container = document.getElementById(`${datasetName}_card_view_container`);
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 2000 });
    let swaps = 0;
    const observer = new MutationObserver(records => {
        swaps += records.filter(record =>
            (record.target === container && [...record.addedNodes].some(node => node.classList?.contains('dataset-results-surface')))
            || (record.target.parentElement?.closest('.scrollable_content') === container
                && record.target.classList?.contains('card_container')
                && [...record.removedNodes].some(node => node.classList?.contains('card'))
                && [...record.addedNodes].some(node => node.classList?.contains('card')))).length;
    });
    observer.observe(container, { childList: true, subtree: true });
    const firstPages = () => fetchRows.mock.calls.filter(([request]) => Number(request.offset || 0) === 0).length;
    async function change(label) {
        const before = firstPages(), beforeSwaps = swaps;
        await toggleRowGroupFacet(datasetName, 'boat');
        await vi.advanceTimersByTimeAsync(200);
        expect.soft(firstPages() - before, `${label}: first-page requests`).toBe(1);
        expect.soft(swaps - beforeSwaps, `${label}: result swaps`).toBe(1);
    }
    try {
        for (let iteration = 0; iteration < 4; iteration++) await change(`category ${iteration + 1}`);
        rejectAvatar = true;
        await change('rejected build');
        expect.soft(container.querySelectorAll('.card')).toHaveLength(0);
        expect.soft(container.querySelector('.dataset-results-error [data-lang-key="request_failed_notice"]')).not.toBeNull();
        await change('recovery');
        expect(container.querySelectorAll('.card')).toHaveLength(2);
        expect(container.querySelector('.dataset-results-error')).toBeNull();
    } finally {
        observer.disconnect();
        vi.clearAllTimers(); vi.useRealTimers();
    }
});

test.each([375, 1280])('URL search alone retains its selected row at %s px after a late saved sort', async width => {
    vi.stubGlobal('innerWidth', width);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => setTimeout(() => callback(performance.now()), 16));
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(clearTimeout);
    forgetChosenDatasetView(datasetName);
    setParams(datasetName, { search: 'chip-proof' });
    history.replaceState({}, '', `/${datasetName}?search=chip-proof`);
    setUnifiedTableState(datasetName, { filters: {} });
    const appearance = paletteSnapshot(104);
    let completeSettings;
    fetchSettings.mockImplementation(() => new Promise(resolve => { completeSettings = resolve; }));
    let completeSort;
    request.mockImplementation(async name => {
        if (name === 'getDatasetSortDefault') return new Promise(resolve => { completeSort = resolve; });
        if (name === 'getIntelligentResultsStream') return new Response('', { headers: { 'Content-Type': 'application/x-ndjson' } });
        return {};
    });
    fetchRows.mockResolvedValue({ columns: ['id'], data: [], types: {}, row_count: 0, dataset_appearance: appearance });
    const pending = refreshTableUnified(datasetName);
    await vi.waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(2));
    completeSort({ configured: true, value: '__newest:DESC' });
    await vi.waitFor(() => expect(getUnifiedTableState(datasetName).sort.column).toBe('__newest'));
    completeSettings({ schema_version: 2, version: 'site-1',
        site_values: appearance.site_values, defaults: appearance.defaults });
    await pending;
    await ongoingSearchResults[datasetName]?.executionPromise;
    await vi.waitFor(() => expect(ongoingSearchResults[datasetName]?.executionPromise).toBeNull());
    const row = document.querySelector(`#${datasetName}_card_top_controls [data-testid="active-filters"]`);
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('chip-proof');
    expect(document.querySelectorAll('[data-testid="active-filters"]')).toHaveLength(1);
    expect(ongoingSearchResults[datasetName].complete).toBe(true);
    expect(fetchRows).toHaveBeenCalledTimes(3); // Initial listing, initial search, then the changed sort.
    expect(fetchRows).toHaveBeenLastCalledWith(expect.objectContaining({
        sort_column: '__newest', sort_order: 'DESC', filters: { search: 'chip-proof' },
    }));
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
