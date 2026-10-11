// dataset_view_renderer.test.js
// Proves row replacement and append policies through the listing's public entry point.
// Connects real calendar/tree/chart/settings renderers with guarded row commits in jsdom.
// Keeps row prefixes, controls and language refresh working without a server or database.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn(async () => ({})) }));
vi.mock('../config_fetcher.js', () => ({ getDefaultViewSync: () => 'card' }));
vi.mock('../route_permission_checker.js', () => ({
    hasRoutePermission: () => true, hasDatasetPermission: async () => false, applyPermission: vi.fn(),
}));
const { appendCards } = vi.hoisted(() => ({ appendCards: vi.fn() }));
vi.mock('./card_view/card_view_printer.js', () => ({
    create_card_view: vi.fn(), appendDataToCardView: appendCards,
}));

import { appendDataToView } from '../infinite_scroll/infinite_scroll_handler.js';
import { commitDatasetViewRows } from './dataset_view_renderer.js';
import { setChosenDatasetView } from '../state_stores/dataset_view_choice_saver.js';
import { create_calendar_view, refreshCalendarLanguages } from './calendar_view/calendar_view_printer.js';
import { create_tree_view, refresh_mounted_tree_view_languages } from './tree_view/tree_view_printer.js';
import { create_price_chart_view } from './price_chart_view/price_chart_view_printer.js';
import { create_settings_view } from './settings_view/settings_view_printer.js';

const dataset = 'committed_rows';
function mount(viewKey, root = document.createElement('div')) {
    setChosenDatasetView(dataset, viewKey);
    const container = document.createElement('div');
    container.id = `${dataset}_${viewKey === 'article_view' ? 'article' : viewKey}_view_container`;
    const controls = document.createElement('div');
    controls.className = 'card_top_controls';
    controls.textContent = 'Categories';
    container.append(controls, root);
    document.body.append(container);
    return { container, controls };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('chosen_language', 'fi');
    document.body.replaceChildren();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

test.each(['normal', 'transposed', 'ticket'])('%s uses setData for empty replacement and appendData for pages', async view => {
    const root = document.createElement('div'); root.className = 'table-component-root';
    const instance = { setData: vi.fn(), appendData: vi.fn() }; root.tableComponentInstance = instance;
    const { controls } = mount(view, root);
    await appendDataToView(dataset, [{ id: 2 }]);
    expect(instance.appendData).toHaveBeenCalledWith([{ id: 2 }]);
    await appendDataToView(dataset, [], false);
    expect(instance.setData).toHaveBeenCalledWith([]);
    expect(controls.isConnected).toBe(true);
});

test.each(['product_card', 'map', 'cloud_management'])('%s explicitly retains current output for both modes', async view => {
    const root = document.createElement('div'); root.textContent = 'Original output';
    const { container } = mount(view, root);
    for (const mode of ['replace', 'append']) {
        expect(await commitDatasetViewRows(dataset, [], { mode })).toBe('retained');
        expect(container.lastChild).toBe(root);
        expect(root.textContent).toBe('Original output');
    }
});

test.each(['card', 'article_view'])('%s empty replacement swaps once and retains shared controls', async view => {
    const root = document.createElement('div'); root.className = 'card_container';
    root.innerHTML = '<div class="card_top_controls">Inner controls</div><div class="card">Old</div>';
    const innerControls = root.firstChild;
    mount(view, root);
    const swaps = vi.spyOn(root, 'replaceChildren');
    await appendDataToView(dataset, [], false);
    expect(appendCards).toHaveBeenCalledOnce();
    expect(appendCards.mock.calls[0][0]).not.toBe(root);
    expect(root.children).toHaveLength(1);
    expect(root.firstChild).toBe(innerControls);
    expect(swaps).toHaveBeenCalledOnce();
});

test.each(['replace', 'append'])('card row %s preserves the listing viewport', async mode => {
    const cards = document.createElement('div'); cards.className = 'card_container';
    cards.textContent = 'Existing rows';
    const { container } = mount('card', cards);
    container.scrollTop = 13000; container.scrollLeft = 45;
    appendCards.mockImplementationOnce(async host => {
        const card = document.createElement('div'); card.className = 'card';
        host.append(card);
    });
    expect(await commitDatasetViewRows(dataset, [{ id: 2 }], { mode })).toBe('committed');
    expect(cards.querySelector('.card')).not.toBeNull();
    expect(container.scrollTop).toBe(13000);
    expect(container.scrollLeft).toBe(45);
});

test('an abandoned card replacement leaves current rows and controls intact', async () => {
    const root = document.createElement('div'); root.className = 'card_container'; root.textContent = 'Current';
    mount('card', root);
    let current = true, release;
    appendCards.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = appendDataToView(dataset, [{ id: 9 }], false, { isCurrent: () => current });
    current = false; release(); await pending;
    expect(root.textContent).toBe('Current');
});

test('an async append loses ownership when its inner card host is replaced', async () => {
    const root = document.createElement('div'); root.className = 'card_container';
    mount('card', root);
    let guard, release;
    appendCards.mockImplementationOnce((_host, _columns, _rows, _dataset, options) => {
        guard = options.isCurrent;
        return new Promise(resolve => { release = resolve; });
    });
    const pending = appendDataToView(dataset, [{ id: 9 }]);
    const replacement = document.createElement('div'); replacement.className = 'card_container';
    root.replaceWith(replacement);
    expect(guard()).toBe(false);
    release();
    expect(await pending).toBeNull();
});

test('calendar append retains mode/date and raw rows for language refresh; empty replacement removes events', async () => {
    const columns = ['id', 'due_date', 'title'];
    const row = id => ({ id, due_date: '2026-10-11', title: { fi: `Tapahtuma ${id}`, en: `Event ${id}` } });
    const root = create_calendar_view(dataset, columns, [row(1)], { title: { is_multilingual: true } });
    const { controls } = mount('calendar', root);
    root.querySelector('[data-lang-key="calendar_agenda"]').click();
    await appendDataToView(dataset, [row(2)]);
    expect(root.querySelector('[data-testid="calendar-agenda-list"]')).not.toBeNull();
    expect(root.querySelectorAll('[data-testid="calendar-event-button"]')).toHaveLength(2);
    expect(root.textContent).toContain('Tapahtuma 2');
    await refreshCalendarLanguages('en');
    expect(root.textContent).toContain('Event 1'); expect(root.textContent).toContain('Event 2');
    await appendDataToView(dataset, [], false);
    expect(root.querySelectorAll('[data-testid="calendar-event-button"]')).toHaveLength(0);
    expect(controls.isConnected).toBe(true);
});

test('price chart appends points with retained zoom controls, clears, and can grow from empty', async () => {
    const columns = ['id', 'observed_at', 'close_price'];
    const row = id => ({ id, observed_at: `2026-10-${10 + id}`, close_price: 100 + id });
    const root = create_price_chart_view(dataset, columns, [row(1), row(2)]);
    mount('price_chart', root);
    const zoomButton = root.querySelector('[data-lang-key="price_chart_zoom_in"]');
    await appendDataToView(dataset, [row(3)]);
    expect(root.querySelectorAll('.price-chart-view__point')).toHaveLength(3);
    expect(root.querySelector('[data-lang-key="price_chart_zoom_in"]')).toBe(zoomButton);
    zoomButton.click();
    const range = root.querySelector('.price-chart-view__status-item:nth-child(2)').textContent;
    await appendDataToView(dataset, [row(4)]);
    expect(root.querySelector('.price-chart-view__status-item:nth-child(2)').textContent).toBe(range);
    await appendDataToView(dataset, [], false);
    expect(root.querySelectorAll('.price-chart-view__point')).toHaveLength(0);
    await appendDataToView(dataset, [row(1)], false);
    expect(root.querySelectorAll('.price-chart-view__point')).toHaveLength(1);
    const emptyRoot = create_price_chart_view(dataset, columns, []);
    root.replaceWith(emptyRoot);
    await appendDataToView(dataset, [], false);
    await appendDataToView(dataset, [row(1)]);
    await appendDataToView(dataset, [row(2)]);
    expect(emptyRoot.querySelectorAll('.price-chart-view__point')).toHaveLength(2);
});

test('settings append preserves edits and save ownership; replacement clears previous inputs', async () => {
    const columns = ['id', 'setting_key', 'value_type', 'value_text'];
    const row = id => ({ id, setting_key: `setting_${id}`, value_type: 0, value_text: `Value ${id}` });
    const root = create_settings_view(dataset, columns, [row(1)]);
    const { controls } = mount('settings', root);
    const input = root.querySelector('input'); const save = root.querySelector('button');
    input.value = 'Unsaved'; input.dispatchEvent(new Event('input'));
    await appendDataToView(dataset, [row(2)]);
    expect(root.querySelector('input')).toBe(input); expect(input.value).toBe('Unsaved');
    const second = root.querySelectorAll('input')[1];
    second.value = 'Later edit'; second.dispatchEvent(new Event('input'));
    expect(second.closest('.settings-row').classList.contains('settings-row-dirty')).toBe(true);
    expect(save.disabled).toBe(false);
    await appendDataToView(dataset, [], false);
    expect(root.querySelectorAll('input')).toHaveLength(0); expect(root.querySelector('button')).toBe(save);
    expect(save.disabled).toBe(true); expect(controls.isConnected).toBe(true);
});

test('row tree keeps its prefix, search/focus and language source; empty replacement clears nodes', async () => {
    const { container, controls } = mount('tree');
    const columns = ['id', 'parent_id', 'name'];
    const types = { name: { is_multilingual: true }, parent_id: { foreign_table: dataset, foreign_column: 'id' } };
    const row = id => ({ id, parent_id: id === 1 ? null : 1, name: { fi: `Solmu ${id}`, en: `Node ${id}` } });
    const root = await create_tree_view(dataset, columns, [row(1)], types);
    // Initial tree creation uses its live host; remount the shared controls it predates.
    container.prepend(controls);
    const search = root.querySelector('input'); search.value = 'Solmu'; search.focus();
    await appendDataToView(dataset, [row(2)]);
    expect(root.querySelectorAll('.node')).toHaveLength(2);
    expect(root.querySelector('input').value).toBe('Solmu');
    expect(document.activeElement).toBe(root.querySelector('input'));
    await refresh_mounted_tree_view_languages('en');
    expect(root.textContent).toContain('Node 1'); expect(root.textContent).toContain('Node 2');
    await appendDataToView(dataset, [], false);
    expect(root.querySelectorAll('.node')).toHaveLength(0); expect(controls.isConnected).toBe(true);
});

const treeColumns = ['id', 'parent_id', 'name'];
const treeTypes = { name: { is_multilingual: true }, parent_id: { foreign_table: dataset, foreign_column: 'id' } };
const treeRow = (id, parent_id = null, name = `Node ${id}`) => ({
    id, parent_id, name: { fi: `Solmu ${id}`, en: name },
});
const treeNode = id => document.getElementById(`tree_node_${id}_${dataset}_tree`);
const savedTreeExpansion = () => JSON.parse(localStorage.getItem(`expanded_nodes_${dataset}_tree`)).sort();
function expectTreeExpansion(id, expanded) {
    const node = treeNode(id);
    expect(node.dataset.expanded === 'true').toBe(expanded);
    expect(node.querySelector(':scope > .children').hidden).toBe(!expanded);
    expect(node.querySelector(':scope > .node-row > .toggle').getAttribute('aria-expanded')).toBe(String(expanded));
}

test.each(['append', 'replace'])('row tree %s keeps a collapsed parent out of saved expanded nodes', async mode => {
    mount('tree');
    const rows = [treeRow(1), treeRow(2, 1)];
    await create_tree_view(dataset, treeColumns, rows, treeTypes);
    await vi.runAllTimersAsync();
    expectTreeExpansion(1, true);
    treeNode(1).querySelector(':scope > .node-row > .toggle').click();
    expectTreeExpansion(1, false);
    const beforePage = savedTreeExpansion();

    const page = [treeRow(3, 1)];
    expect(await commitDatasetViewRows(dataset, mode === 'append' ? page : [...rows, ...page], { mode })).toBe('committed');
    await vi.runAllTimersAsync();

    expect.soft(savedTreeExpansion()).not.toContain(treeNode(1).id);
    expectTreeExpansion(1, false);
    expect(savedTreeExpansion()).toEqual([...beforePage, treeNode(3).id].sort());
    // A retained open child keeps its own state under the collapsed parent.
    expectTreeExpansion(2, true);
});

test('row tree opens only new branches within the initial level on a later page', async () => {
    mount('tree');
    await create_tree_view(dataset, treeColumns, [treeRow(1), treeRow(2, 1)], treeTypes);
    await vi.runAllTimersAsync();
    treeNode(1).querySelector(':scope > .node-row > .toggle').click();

    await appendDataToView(dataset, [treeRow(4), treeRow(5, 4), treeRow(6, 5)]);
    await vi.runAllTimersAsync();

    expectTreeExpansion(1, false);
    expectTreeExpansion(4, true);
    expectTreeExpansion(5, true);
    expectTreeExpansion(6, false);
    expect(savedTreeExpansion()).toContain(treeNode(4).id);
    expect(savedTreeExpansion()).toContain(treeNode(5).id);
    expect(savedTreeExpansion()).not.toContain(treeNode(6).id);
});

test('row tree search then clear restores the pre-search expansion after a page', async () => {
    localStorage.setItem('chosen_language', 'en');
    mount('tree');
    const root = await create_tree_view(dataset, treeColumns,
        [treeRow(1), treeRow(2, 1), treeRow(3, 2, 'Needle'), treeRow(4)], treeTypes);
    await vi.runAllTimersAsync();
    for (const id of [1, 4]) treeNode(id).querySelector(':scope > .node-row > .toggle').click();
    const beforeSearch = savedTreeExpansion();
    const search = root.querySelector('input');
    search.value = 'Needle'; search.focus(); search.dispatchEvent(new Event('input'));
    expectTreeExpansion(1, true);

    await appendDataToView(dataset, [treeRow(5, 2)]);
    await vi.runAllTimersAsync();
    const retainedSearch = root.querySelector('input');
    expect(retainedSearch.value).toBe('Needle');
    expect(document.activeElement).toBe(retainedSearch);
    expect(treeNode(4).classList.contains('hidden')).toBe(true);
    retainedSearch.value = ''; retainedSearch.dispatchEvent(new Event('input'));

    expect(savedTreeExpansion()).toEqual(beforeSearch);
    for (const id of [1, 3, 4, 5]) expectTreeExpansion(id, false);
    expectTreeExpansion(2, true);
    expect(root.querySelectorAll('.node.hidden')).toHaveLength(0);
});

test('row tree language refresh keeps the collapsed state and saved expansion', async () => {
    mount('tree');
    const root = await create_tree_view(dataset, treeColumns, [treeRow(1), treeRow(2, 1)], treeTypes);
    await vi.runAllTimersAsync();
    treeNode(1).querySelector(':scope > .node-row > .toggle').click();
    const beforeLanguage = savedTreeExpansion();

    await refresh_mounted_tree_view_languages('en');
    await vi.runAllTimersAsync();

    expectTreeExpansion(1, false);
    expectTreeExpansion(2, true);
    expect(savedTreeExpansion()).toEqual(beforeLanguage);
    expect(root.textContent).toContain('Node 1');
    expect(root.textContent).toContain('Node 2');
});

test('row tree preserves unapplied initial defaults across pages before deferred callbacks', async () => {
    mount('tree');
    await create_tree_view(dataset, treeColumns, [treeRow(1), treeRow(2, 1)], treeTypes);
    await appendDataToView(dataset, [treeRow(3, 1)]);
    await vi.runAllTimersAsync();
    for (const id of [1, 2, 3]) expectTreeExpansion(id, true);
});

test('row tree search clear retains initial defaults for branches first arriving during search', async () => {
    mount('tree');
    const root = await create_tree_view(dataset, treeColumns, [treeRow(1), treeRow(2, 1)], treeTypes);
    await vi.runAllTimersAsync();
    treeNode(1).querySelector(':scope > .node-row > .toggle').click();
    const search = root.querySelector('input');
    search.value = 'Solmu 2'; search.dispatchEvent(new Event('input'));
    await appendDataToView(dataset, [treeRow(4), treeRow(5, 4), treeRow(6, 5)]);
    await vi.runAllTimersAsync();
    const retainedSearch = root.querySelector('input');
    retainedSearch.value = ''; retainedSearch.dispatchEvent(new Event('input'));
    expectTreeExpansion(1, false);
    expectTreeExpansion(4, true);
    expectTreeExpansion(5, true);
    expectTreeExpansion(6, false);
    expect(savedTreeExpansion()).toEqual([treeNode(2).id, treeNode(4).id, treeNode(5).id].sort());
});

test('tree awaiting its renderer cannot overwrite a newer surface', async () => {
    const { container } = mount('tree');
    const root = await create_tree_view(dataset, ['id', 'parent_id', 'name'], [{ id: 1, name: 'Current' }],
        { parent_id: { foreign_table: dataset, foreign_column: 'id' } });
    const pending = appendDataToView(dataset, [{ id: 2, name: 'Stale' }]);
    container.remove();
    const replacement = mount('tree').container; replacement.textContent = 'New owner';
    await pending;
    expect(replacement.textContent).toBe('New owner'); expect(root.textContent).not.toContain('Stale');
});
