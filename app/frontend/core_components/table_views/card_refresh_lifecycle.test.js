// card_refresh_lifecycle.test.js
// Exercises replacement and abandonment through the real card and keyword builders.
// Connects DOM swaps, measured keyword widths, shared observers and translated failure notices.
// Reproduces gate 65 without a server, database or mocked card construction.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { fetchRows, writeAddress } = vi.hoisted(() => ({ fetchRows: vi.fn(), writeAddress: vi.fn() }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn(async () => ({})) }));
vi.mock('../endpoints/endpoint_data_fetcher.js', () => ({ fetchDatasetData: fetchRows }));
vi.mock('../navigation/nav_engine/dataset_address_writer.js', async importOriginal => ({
    ...await importOriginal(), updateDatasetAddress: writeAddress,
}));
vi.mock('../route_permission_checker.js', () => ({
    hasRoutePermission: () => true, hasDatasetPermission: async () => false, applyPermission: vi.fn(),
    primeDatasetPermissions: vi.fn(),
}));
vi.mock('./card_view/row_article_presentation_settings.js', () => ({
    resolveSiteTimestampDisplayOptions: async () => ({}),
}));
vi.mock('../filterbar/filter_bar_builder.js', () => ({ create_filter_bar: vi.fn() }));
vi.mock('./view_selector_printer.js', () => ({ applyViewStyling: vi.fn() }));
vi.mock('../config_fetcher.js', () => ({
    getDefaultViewSync: () => 'card', getDefaultDatasetSortSync: () => ({ column: null, direction: null }),
}));

import { generate_table } from './dataset_view_printer.js';
import { appendDataToView, disconnectInfiniteScroll } from '../infinite_scroll/infinite_scroll_handler.js';
import { create_card_view } from './card_view/card_view_printer.js';
import { addKeywordsSection } from './card_view/card_keyword_builder.js';
import { disposeCardResources } from './card_view/card_resource_lifecycle.js';
import { datasetAppearanceState } from './dataset_appearance_state.js';
import { setAllSpecs } from '../state_stores/table_specs_reader.js';
import { setChosenDatasetView } from '../state_stores/dataset_view_choice_saver.js';
import { getUnifiedTableState, setUnifiedTableState } from '../state_stores/table_state_store.js';
import { getParams, setParams } from '../navigation/nav_engine/query_params.js';
import { renderActiveFilters } from '../filterbar/filter_list/active_filter_tag_printer.js';
import { toggleRowGroupFacet } from '../filterbar/filter_list/row_group_facet_printer.js';
import { clearAllFilters } from '../filterbar/top_row_buttons/top_row_builder.js';
import { refreshTableUnified } from '../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';

const dataset = 'lifecycle_cards';
const columns = ['id', 'keywords', 'detail'];
const types = {
    id: { data_type: 'integer' },
    keywords: { data_type: 'text', card_element: 'keywords', show_value_on_card: true },
    detail: { data_type: 'text', card_element: 'details', show_value_on_card: true },
};
const row = id => ({ id, keywords: 'alpha, beta, gamma', detail: 'Detail' });
const resizeTargets = new Set();
const builtCards = new Set();
let mounts, digest, rejectBuild, pauseBuild;

beforeEach(() => {
    vi.useFakeTimers();
    fetchRows.mockReset(); writeAddress.mockReset();
    localStorage.clear(); sessionStorage.clear(); datasetAppearanceState.clear();
    const appearance = datasetAppearanceState.effective(dataset);
    appearance.shared.card_style_variant = 'standard';
    datasetAppearanceState.updateSite(appearance);
    resizeTargets.clear(); builtCards.clear(); mounts = []; rejectBuild = false; pauseBuild = null;
    document.documentElement.lang = 'fi';
    document.body.innerHTML = '<div id="tabs_container"></div>';
    setAllSpecs({ [dataset]: { table_uid: 103 } });
    setChosenDatasetView(dataset, 'card');
    setUnifiedTableState(dataset, { filters: {}, sort: {}, offset: 0 });
    setParams(dataset, {});
    vi.stubGlobal('ResizeObserver', class {
        observe(target) { resizeTargets.add(target); }
        unobserve(target) { resizeTargets.delete(target); }
        disconnect() {}
    });
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    digest = vi.fn(async (_algorithm, bytes) => {
        const seed = new TextDecoder().decode(bytes);
        if (seed.startsWith('99_')) {
            if (pauseBuild) await pauseBuild;
            if (rejectBuild) throw new Error('Rejected avatar build');
        }
        return new ArrayBuffer(32);
    });
    vi.stubGlobal('crypto', { subtle: { digest } });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
        return this.isConnected && this.classList.contains('keyword_tag') ? 80 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
        return this.isConnected ? 100 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
    const dispatch = HTMLElement.prototype.dispatchEvent;
    vi.spyOn(HTMLElement.prototype, 'dispatchEvent').mockImplementation(function (event) {
        if (event.type === 'easelect:card-mounted') mounts.push({ card: this, connected: this.isConnected });
        return dispatch.call(this, event);
    });
    const bind = datasetAppearanceState.bind;
    vi.spyOn(datasetAppearanceState, 'bind').mockImplementation((node, ...args) => {
        if (node.classList.contains('card')) builtCards.add(node);
        return bind(node, ...args);
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
    disconnectInfiniteScroll(dataset);
    // Field presentation changes exercise the original child-removal cleanup too.
    builtCards.forEach(card => card.querySelectorAll('.card_keywords_container').forEach(element => element.remove()));
    builtCards.forEach(disposeCardResources);
    document.body.replaceChildren();
    await Promise.resolve();
    vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function refresh(rows = [row(1)], options = {}) {
    return generate_table(dataset, columns, rows, types, rows.length, false, null, null, [], options);
}

function finishCardAnimations() {
    document.querySelectorAll('.card').forEach(card => card.dispatchEvent(new Event('animationend')));
    vi.advanceTimersByTime(600);
}

test.each(['listing', 'full'])('%s replacement measures three 80 px keywords after the connected swap', async path => {
    await refresh();
    mounts = [];
    if (path === 'listing') await appendDataToView(dataset, [row(2)], false, { dataTypes: types });
    else await refresh([row(2)]);
    const tags = [...document.querySelectorAll('.keyword_tag')];
    expect(tags).toHaveLength(3);
    expect(tags.filter(tag => tag.style.display !== 'none')).toHaveLength(1);
    expect(mounts).toHaveLength(1);
    expect(mounts.every(mount => mount.connected)).toBe(true);
});

test.each(['listing', 'full'])('%s repeated refresh releases keyword and detail resize targets', async path => {
    await refresh(); finishCardAnimations();
    for (let id = 2; id <= 5; id += 1) {
        if (path === 'listing') await appendDataToView(dataset, [row(id)], false, { dataTypes: types });
        else await refresh([row(id)]);
        finishCardAnimations();
        await Promise.resolve();
    }
    expect([...resizeTargets].filter(target => !target.isConnected)).toEqual([]);
    expect([...resizeTargets].filter(target => target.classList.contains('card_keywords_container'))).toHaveLength(1);
    expect([...resizeTargets].filter(target => target.classList.contains('card_details_kv'))).toHaveLength(1);
});

test.each(['listing', 'full'])('%s rejected real build shows a Finnish failure notice and removes stale results', async path => {
    await refresh(); finishCardAnimations();
    setUnifiedTableState(dataset, { filters: { row_group: 'new-category' } });
    setParams(dataset, { row_group: 'new-category' });
    window.history.replaceState({}, '', `/${dataset}?row_group=new-category`);
    renderActiveFilters(dataset);
    expect(document.querySelector('[data-row-group-slug="new-category"]')).not.toBeNull();
    rejectBuild = true; mounts = [];
    const work = path === 'listing'
        ? appendDataToView(dataset, [row(2), row(99)], false, { dataTypes: types })
        : refresh([row(2), row(99)]);
    await Promise.resolve(work).catch(() => {});
    expect(document.querySelector('[data-testid="toast"] [data-lang-key="request_failed_notice"]')?.textContent)
        .toBe('Pyyntöä ei voitu suorittaa.');
    expect(document.querySelectorAll('.card')).toHaveLength(0);
    expect([...document.querySelectorAll('.results_count')].every(count => !count.textContent && !count.dataset.resultCount)).toBe(true);
    expect(document.querySelector('[data-row-group-slug="new-category"]')).not.toBeNull();
    expect(mounts).toEqual([]);
    await Promise.resolve();
    expect([...resizeTargets].filter(target => !target.isConnected)).toEqual([]);
    // A previously abandoned card must have no surviving mount/animation subscriptions.
    builtCards.forEach(card => {
        if (card.dataset.id === '1') return;
        document.body.append(card);
        card.dispatchEvent(new CustomEvent('easelect:card-mounted'));
        card.dispatchEvent(new Event('animationend'));
    });
    vi.advanceTimersByTime(600);
    expect(resizeTargets.size).toBe(0);
});

test.each(['listing', 'full'])('%s abandoned batch never mounts and releases waiting card listeners', async path => {
    await refresh(); finishCardAnimations();
    let release;
    pauseBuild = new Promise(resolve => { release = resolve; });
    let current = true;
    mounts = [];
    const options = { isCurrent: () => current, dataTypes: types };
    const pending = path === 'listing'
        ? appendDataToView(dataset, [row(2), row(99)], false, options)
        : refresh([row(2), row(99)], options);
    for (let turn = 0; turn < 100 && !digest.mock.calls.some(([, bytes]) => new TextDecoder().decode(bytes).startsWith('99_')); turn++) {
        await Promise.resolve();
    }
    expect([...builtCards].some(card => card.dataset.id === '2')).toBe(true);
    current = false; release(); await pending;
    expect(mounts).toEqual([]);
    expect(document.querySelector('.card')?.dataset.id).toBe('1');
    const committedCount = resizeTargets.size;
    builtCards.forEach(card => {
        if (card.dataset.id === '1') return;
        document.body.append(card);
        card.dispatchEvent(new CustomEvent('easelect:card-mounted'));
        card.dispatchEvent(new Event('animationend'));
    });
    vi.advanceTimersByTime(600);
    expect(resizeTargets.size).toBe(committedCount);
});

test('detached card construction never announces mounting', async () => {
    localStorage.setItem(`${dataset}_dataTypes`, JSON.stringify(types));
    await create_card_view(columns, [row(1)], dataset);
    expect(mounts).toEqual([]);
});

test('a live keyword section releases its shared observer when its whole card is replaced', async () => {
    await refresh(); finishCardAnimations();
    const card = document.querySelector('.card');
    addKeywordsSection([{ column: 'keywords', columnClass: 'live-keywords', rawValue: 'one, two, three' }],
        row(1), dataset, card.querySelector('.card_text_content'));
    const keyword = card.querySelector('.live-keywords').closest('.card_keywords_container');
    expect(resizeTargets.has(keyword)).toBe(true);
    await appendDataToView(dataset, [row(2)], false, { dataTypes: types });
    finishCardAnimations();
    expect(keyword.isConnected).toBe(false);
    expect(resizeTargets.has(keyword)).toBe(false);
});

test('repeated refresh also releases window-resize fallback listeners', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const listeners = new Set();
    const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((name, listener, options) => {
        if (name === 'resize') listeners.add(listener);
        return add(name, listener, options);
    });
    vi.spyOn(window, 'removeEventListener').mockImplementation((name, listener, options) => {
        if (name === 'resize') listeners.delete(listener);
        return remove(name, listener, options);
    });
    for (let id = 1; id <= 4; id += 1) { await refresh([row(id)]); finishCardAnimations(); }
    expect(listeners.size).toBe(2); // One keyword and one detail section on the current card.
    disposeCardResources(document.querySelector('.card'));
    expect(listeners.size).toBe(0);
});

test('unified refresh stops after a rejected card build and can recover with the same selection', async () => {
    await refresh(); finishCardAnimations();
    setUnifiedTableState(dataset, { filters: { row_group: 'new-category' } });
    setParams(dataset, { row_group: 'new-category' });
    renderActiveFilters(dataset);
    const listing = { columns, types, data: [row(2), row(99)], row_count: 2 };
    fetchRows.mockResolvedValue(listing);
    rejectBuild = true;
    expect(await refreshTableUnified(dataset, { skipUrlParams: true })).toBeNull();
    expect(writeAddress).not.toHaveBeenCalled();
    expect(document.querySelector('.dataset-results-error [data-lang-key="request_failed_notice"]')).not.toBeNull();
    expect(document.querySelector('.card')).toBeNull();
    rejectBuild = false;
    expect(await refreshTableUnified(dataset, { skipUrlParams: true })).toEqual(listing);
    expect(document.querySelectorAll('.card')).toHaveLength(2);
    expect(document.querySelector('.dataset-results-error')).toBeNull();
    expect(writeAddress).toHaveBeenCalledOnce();
});

function deferred() {
    let resolve, reject;
    const promise = new Promise((accept, refuse) => { resolve = accept; reject = refuse; });
    return { promise, resolve, reject };
}

// Use real selection, clear-all, refresh and card builders. Earlier builds are
// already awaiting their avatars when the next action commits its filters.
test.each(['resolve', 'reject', 'abort'])('select, select, clear-all ignores earlier builds that %s after the clear', async outcome => {
    await refresh(); finishCardAnimations();
    const first = deferred(), second = deferred(), latest = deferred();
    const enteredFirst = deferred(), enteredSecond = deferred(), enteredLatest = deferred();
    const gates = new Map([['99', [first, enteredFirst]], ['98', [second, enteredSecond]], ['3', [latest, enteredLatest]]]);
    digest.mockImplementation(async (_algorithm, bytes) => {
        const [gate, entered] = gates.get(new TextDecoder().decode(bytes).split('_')[0]) || [];
        entered?.resolve();
        if (gate) await gate.promise;
        return new ArrayBuffer(32);
    });
    fetchRows.mockImplementation(async ({ filters }) => {
        const id = filters.row_group === 'boat' ? 99 : filters.row_group === 'boat,train' ? 98 : 3;
        return { columns, types, data: [row(id)], row_count: 1 };
    });
    const firstAction = toggleRowGroupFacet(dataset, 'boat'); await enteredFirst.promise;
    const secondAction = toggleRowGroupFacet(dataset, 'train'); await enteredSecond.promise;
    clearAllFilters(dataset);
    renderActiveFilters(dataset);
    await enteredLatest.promise;
    // Both orders matter: stale work finishing before or after the newest build.
    if (outcome === 'resolve') second.resolve();
    else second.reject(outcome === 'abort' ? new DOMException('Superseded', 'AbortError') : new Error('Rejected stale build'));
    await secondAction;
    latest.resolve();
    for (let turn = 0; turn < 100 && document.querySelector('.card')?.dataset.id !== '3'; turn++) await Promise.resolve();
    expect(document.querySelector('.card')?.dataset.id).toBe('3');
    if (outcome === 'resolve') first.resolve();
    else first.reject(outcome === 'abort' ? new DOMException('Superseded', 'AbortError') : new Error('Rejected stale build'));
    await firstAction;
    expect(getUnifiedTableState(dataset).filters).toEqual({});
    expect(getParams(dataset).row_group).toBeUndefined();
    expect(document.querySelector('.active_filters').style.display).toBe('none');
    expect(document.querySelector('.dataset-results-error')).toBeNull();
    expect(document.querySelector('[data-testid="toast"]')).toBeNull();
    expect(document.querySelector('.card')?.dataset.id).toBe('3');
});

test('a pending chip-removal build keeps Clear all focused for the next Enter action', async () => {
    await refresh(); finishCardAnimations();
    // Settle another selection with real refreshes, then delay its removal build.
    fetchRows.mockResolvedValue({ columns, types, data: [row(1)], row_count: 1 });
    await toggleRowGroupFacet(dataset, 'boat');
    await toggleRowGroupFacet(dataset, 'train');
    const removed = deferred(), entered = deferred();
    digest.mockImplementation(async (_algorithm, bytes) => {
        if (new TextDecoder().decode(bytes).startsWith('99_')) { entered.resolve(); await removed.promise; }
        return new ArrayBuffer(32);
    });
    fetchRows.mockResolvedValue({ columns, types, data: [row(99)], row_count: 1 });
    const removal = toggleRowGroupFacet(dataset, 'train'); await entered.promise;
    const clear = document.querySelector('.active-filters-clear-all');
    clear.focus();
    expect(document.activeElement === clear).toBe(true);
    removed.resolve(); await removal;
    // Native Enter is delivered to the focused control. Losing it between the
    // automation's focus and key delivery also loses a real person's next key.
    expect.soft(document.activeElement === clear).toBe(true);
    fetchRows.mockResolvedValue({ columns, types, data: [row(3)], row_count: 1 });
    const requestCount = fetchRows.mock.calls.length;
    // jsdom has no native keyboard activation; activate its current focus target.
    document.activeElement.click();
    for (let turn = 0; turn < 100 && document.querySelector('.card')?.dataset.id !== '3'; turn++) await Promise.resolve();
    expect(getUnifiedTableState(dataset).filters).toEqual({});
    expect(getParams(dataset).row_group).toBeUndefined();
    expect(fetchRows).toHaveBeenCalledTimes(requestCount + 1);
    expect(document.querySelector('.card')?.dataset.id).toBe('3');
});
