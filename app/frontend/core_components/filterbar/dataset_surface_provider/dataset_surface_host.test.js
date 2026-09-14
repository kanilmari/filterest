// @vitest-environment jsdom
// dataset_surface_host.test.js
// Exercises real shared query state around a mocked visual filterbar boundary.
// Connects request ordering, history/filter state and renderer lifecycle.
// Prevents stale or duplicate requests from replacing the current extension results.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ params: {}, unified: {}, build: vi.fn(), active: vi.fn(), count: vi.fn(), state: vi.fn() }));
vi.mock('../filter_bar_builder.js', () => ({ create_filter_bar: mocks.build }));
vi.mock('../../navigation/nav_engine/query_params.js', () => ({ getParams: () => mocks.params }));
vi.mock('../../state_stores/table_state_store.js', () => ({ getUnifiedTableState: () => mocks.unified, setUnifiedTableState: mocks.state }));
vi.mock('../filter_list/active_filter_tag_printer.js', () => ({ renderActiveFilters: mocks.active }));
vi.mock('../../../reusable_components/results_count/results_count_printer.js', () => ({ setResultsCount: mocks.count }));
import { mountDatasetSurface } from './dataset_surface_host.js';
import { getDatasetQueryAdapter } from './dataset_query_adapter_registry.js';
let host;
const make = (options = {}) => {
    const container = document.createElement('div'); document.body.append(container);
    host = mountDatasetSurface({ container, datasetName: 'extension', columns: ['priority'], dataTypes: {},
        loadSnapshot: async () => ({ worklines: [] }), renderSnapshot: vi.fn(), ...options });
    return host;
};
describe('shared data surface', () => {
    beforeEach(() => { vi.clearAllMocks(); mocks.params = {}; mocks.unified = {}; mocks.build.mockImplementation(() => ({ destroy: vi.fn() })); });
    afterEach(() => { host?.destroy(); host = null; document.body.replaceChildren(); });
    test('uses standard scaffold and controls, without SQL dataset administration', () => {
        make({ metadata: { display_name: 'Extension' } });
        expect(document.querySelector('#extension_tab_parts_container .tab-content-area .tab-content-body .scrollable_content')).toBeTruthy();
        expect(mocks.build).toHaveBeenCalledWith('extension', 'extension', ['priority'], {}, null, false, 'custom', {
            metadata: { display_name: 'Extension' }, allowDatasetManagement: false, sortOptions: undefined,
        });
        expect(getDatasetQueryAdapter('ordinary')).toBeNull();
        expect(getDatasetQueryAdapter('extension').refresh).toBe(host.refresh);
    });
    test('explicit virtual-surface heading and labels stay independent of SQL translation keys', () => {
        mocks.build.mockImplementationOnce((name) => {
            const panel = document.createElement('div');
            panel.innerHTML = `<h1 class="morphing-title">Localhost – <span data-lang-key="${name}_front_page">Fallback</span></h1><span data-lang-key="${name}">Fallback name</span><label data-lang-key="search_for_${name}">Fallback search</label>`;
            document.getElementById(`${name}_tab_parts_container`).append(panel);
            return { destroy: () => panel.remove() };
        });
        make({ metadata: { hero_heading: 'Worklines', display_name: 'Worklines', search_placeholder: 'Search worklines…' } });
        expect(document.querySelector('.morphing-title').textContent).toBe('Worklines');
        expect(document.querySelector('[data-lang-key="extension_front_page"]')).toBeNull();
        expect(document.querySelector('[data-lang-key="extension"]')).toBeNull();
        expect(document.querySelector('label').textContent).toBe('Search worklines…');
        expect(document.querySelector('label').hasAttribute('data-lang-key')).toBe(false);
    });
    test('deduplicates a commit and its URL sync while rejecting an older response', async () => {
        const pending = [];
        const load = vi.fn((params) => new Promise((resolve) => pending.push({ params, resolve })));
        const render = vi.fn(); make({ loadSnapshot: load, renderSnapshot: render });
        const old = host.refresh({ search: 'old' });
        await Promise.resolve();
        mocks.params = { search: 'new', extension_priority: 'high', sort_column: 'title', sort_order: 'ASC' };
        const current = host.refresh();
        const duplicate = host.refresh();
        await Promise.resolve();
        expect(load).toHaveBeenCalledTimes(2);
        pending[1].resolve({ worklines: [{ id: 2 }], filtered_count: 1 });
        await current; await duplicate;
        pending[0].resolve({ worklines: [{ id: 1 }] }); await old;
        expect(render).toHaveBeenCalledTimes(1);
        expect(render.mock.calls[0][1].worklines).toEqual([{ id: 2 }]);
        expect(mocks.state).toHaveBeenLastCalledWith('extension', {
            filters: { extension_priority: 'high' }, offset: 0, sort: { column: 'title', direction: 'ASC' },
        });
        expect(mocks.count).toHaveBeenCalledWith('extension', 1);
        await host.refresh(); expect(load).toHaveBeenCalledTimes(2);
    });
    test('a completed A cache hit invalidates delayed B before it can overwrite A', async () => {
        let finishB;
        const load = vi.fn((params) => params.search === 'B'
            ? new Promise((resolve) => { finishB = resolve; })
            : Promise.resolve({ worklines: [{ id: 1 }] }));
        const render = vi.fn(); make({ loadSnapshot: load, renderSnapshot: render });
        mocks.params = { search: 'A' }; await host.refresh();
        mocks.params = { search: 'B' }; const pendingB = host.refresh(); await Promise.resolve();
        mocks.params = { search: 'A' }; await host.refresh();
        finishB({ worklines: [{ id: 2 }] }); await pendingB;
        expect(render).toHaveBeenCalledTimes(2);
        expect(render.mock.calls.at(-1)[1].worklines).toEqual([{ id: 1 }]);
    });
    test('defers language rebuilding while hidden until the same container becomes active', async () => {
        make(); const container = host.results.closest('.tab_parts_container').parentElement;
        container.classList.add('hidden');
        document.documentElement.lang = document.documentElement.lang === 'fi' ? 'en' : 'fi';
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mocks.build).toHaveBeenCalledOnce();
        container.classList.remove('hidden');
        await vi.waitFor(() => expect(mocks.build).toHaveBeenCalledTimes(2));
    });
    test('a failed control mount releases query ownership and its DOM', () => {
        mocks.build.mockImplementationOnce(() => { throw new Error('mock mount failure'); });
        expect(() => make()).toThrow('mock mount failure');
        expect(getDatasetQueryAdapter('extension')).toBeNull();
        expect(document.querySelector('#extension_tab_parts_container')).toBeNull();
    });
    test('skipUrlParams honors a shared field-sort state change and explicit overrides without losing URL search', async () => {
        const load = vi.fn(async () => ({ filtered_count: 1 })); make({ loadSnapshot: load });
        mocks.params = { search: 'keep query', extension_priority: 'low', sort_column: 'title', sort_order: 'ASC' };
        mocks.unified = { filters: { extension_priority: 'high' }, sort: { column: 'priority', direction: 'DESC' } };
        await host.refresh({ skipUrlParams: true });
        expect(load).toHaveBeenLastCalledWith({ search: 'keep query', extension_priority: 'high', sort_column: 'priority', sort_order: 'DESC' });
        await host.refresh({ skipUrlParams: true, newSortColumn: 'id', newSortDirection: 'ASC', newFilters: { extension_status: 'paused' } });
        expect(load).toHaveBeenLastCalledWith({ search: 'keep query', extension_priority: 'high', extension_status: 'paused', sort_column: 'id', sort_order: 'ASC' });
        await host.refresh();
        expect(load).toHaveBeenLastCalledWith(mocks.params);
    });
    test('uses only the generic filtered_count contract for the shared result indicator', async () => {
        make({ loadSnapshot: async () => ({ worklines: [{ id: 1 }] }) });
        await host.refresh();
        expect(mocks.count).toHaveBeenLastCalledWith('extension', 0);
    });
    test('clear and history events use the current shared parameters', async () => {
        const load = vi.fn(async (params) => ({ params, worklines: [] })); make({ loadSnapshot: load });
        mocks.params = { search: 'draft', extension_status: 'paused' }; await host.refresh();
        mocks.params = {};
        window.dispatchEvent(new CustomEvent('dataset-query-params-changed', { detail: { dataset: 'extension' } }));
        await vi.waitFor(() => expect(load).toHaveBeenLastCalledWith({}));
        expect(mocks.state).toHaveBeenLastCalledWith('extension', {
            filters: {}, offset: 0, sort: { column: '__newest', direction: 'DESC' },
        });
    });
    test('destroy unregisters the adapter and prevents delayed renderer writes', async () => {
        let resolve; const render = vi.fn();
        make({ loadSnapshot: () => new Promise((done) => { resolve = done; }), renderSnapshot: render });
        const request = host.refresh(); await Promise.resolve();
        const panel = mocks.build.mock.results[0].value;
        host.destroy(); resolve({ worklines: [] }); await request;
        expect(getDatasetQueryAdapter('extension')).toBeNull();
        expect(panel.destroy).toHaveBeenCalledOnce();
        expect(render).not.toHaveBeenCalled();
    });
});
