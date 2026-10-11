// infinite_scroll_tree_expansion.test.js
// Verifies tree expansion at the listing loader's accepted commit boundary.
// Connects real pagination, row rendering and the tree builder with synthetic endpoint answers.
// Prevents request retirement from losing expansion, while superseded surfaces stay untouched.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { fetchRows, waitForHost, observers } = vi.hoisted(() => ({
    fetchRows: vi.fn(), waitForHost: vi.fn(), observers: [],
}));
vi.mock('../endpoints/endpoint_data_fetcher.js', () => ({ fetchDatasetData: fetchRows }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn(async () => ({})) }));
vi.mock('../config_fetcher.js', () => ({ getDefaultViewSync: () => 'card' }));
vi.mock('../route_permission_checker.js', () => ({
    hasRoutePermission: () => true, hasDatasetPermission: async () => false, applyPermission: vi.fn(),
}));
vi.mock('../table_views/card_view/card_view_printer.js', () => ({
    create_card_view: vi.fn(), appendDataToCardView: vi.fn(),
}));
vi.mock('../../reusable_components/dom_element_checker.js', () => ({ wait_until_appears: waitForHost }));

import {
    disconnectInfiniteScroll, initializeInfiniteScroll, reloadDatasetRowsFromListing, seedInfiniteScrollRowCount,
} from './infinite_scroll_handler.js';
import { create_tree_view } from '../table_views/tree_view/tree_view_printer.js';
import { setChosenDatasetView } from '../state_stores/dataset_view_choice_saver.js';
import { getUnifiedTableState, setUnifiedTableState } from '../state_stores/table_state_store.js';
import { setAllSpecs } from '../state_stores/table_specs_reader.js';
import { rememberLoadedDatasetRows } from '../table_views/dataset_loaded_rows.js';

const dataset = 'paginated_tree';
const columns = ['id', 'parent_id', 'name'];
const types = { name: { is_multilingual: true }, parent_id: { foreign_table: dataset, foreign_column: 'id' } };
const row = (id, parent_id = null) => ({ id, parent_id, name: { fi: `Solmu ${id}`, en: `Node ${id}` } });
const initialRows = [row(1), row(2, 1), row(3), row(4, 3)];
const newRows = [row(5), row(6, 5), row(7, 6)];
const nodeId = id => `tree_node_${id}_${dataset}_tree`;
const savedExpansion = () => JSON.parse(localStorage.getItem(`expanded_nodes_${dataset}_tree`)).sort();

function expectExpansion(root, id, expanded) {
    const node = root.querySelector(`#${nodeId(id)}`);
    expect.soft(node.dataset.expanded === 'true', `node ${id} expansion`).toBe(expanded);
    expect.soft(node.querySelector(':scope > .children').hidden, `node ${id} children`).toBe(!expanded);
    expect.soft(node.querySelector(':scope > .node-row > .toggle').getAttribute('aria-expanded')).toBe(String(expanded));
}

async function mountTree() {
    setChosenDatasetView(dataset, 'tree');
    const container = document.createElement('div');
    container.id = `${dataset}_tree_view_container`;
    // Keep the loader's fill-screen interval from fetching beyond the supplied page.
    Object.defineProperty(container, 'scrollHeight', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 400 });
    document.body.append(container);
    const root = await create_tree_view(dataset, columns, initialRows, types);
    await vi.runAllTimersAsync();
    root.querySelector(`#${nodeId(3)} > .node-row > .toggle`).click();
    expectExpansion(root, 1, true);
    expectExpansion(root, 3, false);
    const saved = savedExpansion();
    setUnifiedTableState(dataset, { offset: initialRows.length });
    rememberLoadedDatasetRows(container, dataset, { data: initialRows, columns, types }, 'tree');
    return { container, root, saved };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    observers.length = 0;
    document.body.replaceChildren();
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('chosen_language', 'fi');
    setAllSpecs({ [dataset]: { table_uid: 162 } });
    waitForHost.mockImplementation(selector => Promise.resolve(document.querySelector(selector)));
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.stubGlobal('IntersectionObserver', class {
        constructor(callback) {
            this.callback = callback;
            this.disconnected = new Promise(resolve => { this.disconnect = vi.fn(resolve); });
            observers.push(this);
        }
        observe() {}
    });
});
afterEach(() => {
    disconnectInfiniteScroll(dataset);
    vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

test.each(['accepted reload', 'final-page append'])('%s restores expansion before request retirement', async path => {
    const { root, saved } = await mountTree();
    const allRows = [...initialRows, ...newRows];
    const result = { data: path === 'accepted reload' ? allRows : newRows,
        row_count: allRows.length + (path === 'accepted reload' ? 10 : 0), columns, types };
    fetchRows.mockResolvedValueOnce(result);
    seedInfiniteScrollRowCount(dataset, result.row_count);
    initializeInfiniteScroll(dataset);
    const observer = observers.at(-1);
    if (path === 'accepted reload') {
        expect(await reloadDatasetRowsFromListing(dataset)).toBe(result);
        expect(observer.disconnect).toHaveBeenCalledOnce();
        // Reconnecting accepted rows initializes another observer and retires the request.
        expect(observers).toHaveLength(2);
        expect(observers.at(-1)).not.toBe(observer);
    } else {
        observer.callback([{ isIntersecting: true }]);
        // Wait for retirement without advancing timers or flushing deferred work.
        await observer.disconnected;
        expect(observer.disconnect).toHaveBeenCalledOnce();
    }
    expect(fetchRows).toHaveBeenCalledOnce();
    expect(fetchRows).toHaveBeenCalledWith(expect.objectContaining({
        offset: path === 'accepted reload' ? 0 : initialRows.length, view_key: 'tree',
    }));
    expect(getUnifiedTableState(dataset).offset).toBe(allRows.length);
    expect(root.querySelectorAll('.node')).toHaveLength(allRows.length);
    const sentinel = document.getElementById(`${dataset}_infinite_scroll_sentinel`);
    if (path === 'accepted reload') expect(sentinel?.isConnected).toBe(true);
    else expect(sentinel).toBeNull();
    const savedAtAcceptance = savedExpansion();
    await vi.runAllTimersAsync();

    for (const [id, expanded] of [[1, true], [2, true], [3, false], [4, true], [5, true], [6, true], [7, false]]) {
        expectExpansion(root, id, expanded);
    }
    expect.soft(root.textContent).toContain('Solmu 7');
    // Reader choices stay exact; only genuinely new branches gain their defaults.
    expect.soft(savedExpansion().filter(id => initialRows.some(item => nodeId(item.id) === id))).toEqual(saved);
    expect.soft(savedExpansion()).toEqual([...saved, nodeId(5), nodeId(6)].sort());
    expect.soft(savedExpansion()).toEqual(savedAtAcceptance);
    expect(fetchRows).toHaveBeenCalledOnce();
});

test.each(['dataset', 'view', 'container', 'tree instance'])('a superseded %s receives no tree state from a waiting reload', async surface => {
    const { container, root, saved } = await mountTree();
    const originalTree = root.querySelector('.tree-container');
    const originalMarkup = root.innerHTML;
    let releaseRender, markRenderStarted;
    const renderStarted = new Promise(resolve => { markRenderStarted = resolve; });
    waitForHost.mockImplementationOnce(() => new Promise(resolve => {
        releaseRender = resolve; markRenderStarted();
    }));
    fetchRows.mockResolvedValueOnce({ data: [...initialRows, ...newRows], row_count: 7, columns, types });
    const pending = reloadDatasetRowsFromListing(dataset);
    await renderStarted;

    let replacement;
    if (surface === 'dataset') setAllSpecs({ [dataset]: { table_uid: 999 } });
    if (surface === 'view') setChosenDatasetView(dataset, 'table');
    if (surface === 'container' || surface === 'tree instance') {
        const original = surface === 'container' ? container : root;
        replacement = document.createElement('div'); replacement.id = original.id;
        replacement.textContent = 'New owner'; original.replaceWith(replacement);
    }
    releaseRender();
    expect(await pending).toBeNull();
    await vi.runAllTimersAsync();

    expect(root.querySelector('.tree-container')).toBe(originalTree);
    expect(root.innerHTML).toBe(originalMarkup);
    expectExpansion(root, 1, true); expectExpansion(root, 3, false);
    expect(root.querySelector(`#${nodeId(5)}`)).toBeNull();
    expect(savedExpansion()).toEqual(saved);
    expect(getUnifiedTableState(dataset).offset).toBe(0);
    if (replacement) expect(replacement.textContent).toBe('New owner');
});
