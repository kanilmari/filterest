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
        // B never reached the renderer, so the shown A stays as it is instead of being drawn again.
        expect(render).toHaveBeenCalledTimes(1);
        expect(render.mock.calls.at(-1)[1].worklines).toEqual([{ id: 1 }]);
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    test('a same-value lang rewrite neither rebuilds the controls nor replaces the results', async () => {
        const render = vi.fn(); make({ renderSnapshot: render }); await host.refresh();
        document.documentElement.setAttribute('lang', document.documentElement.lang);
        await settle();
        expect(mocks.build).toHaveBeenCalledOnce();
        expect(render).toHaveBeenCalledOnce();
    });
    test('a real language switch still rebuilds the controls and presents the results again', async () => {
        const load = vi.fn(async () => ({ worklines: [] })); const render = vi.fn();
        make({ loadSnapshot: load, renderSnapshot: render }); await host.refresh();
        document.documentElement.lang = document.documentElement.lang === 'fi' ? 'en' : 'fi';
        await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
        expect(mocks.build).toHaveBeenCalledTimes(2);
        expect(load).toHaveBeenCalledOnce();
    });
    test('a class write that keeps the surface visible is not an activation', async () => {
        const load = vi.fn(async () => ({ worklines: [] })); const render = vi.fn();
        make({ loadSnapshot: load, renderSnapshot: render }); await host.refresh();
        const container = host.results.closest('.tab_parts_container').parentElement;
        container.setAttribute('class', container.getAttribute('class') || '');
        container.classList.add('scrolled');
        await settle();
        expect(render).toHaveBeenCalledOnce();
        expect(load).toHaveBeenCalledOnce();
    });
    test('a hidden -> visible transition presents the shown query once more, without loading', async () => {
        const load = vi.fn(async () => ({ worklines: [] })); const render = vi.fn();
        make({ loadSnapshot: load, renderSnapshot: render }); await host.refresh();
        const container = host.results.closest('.tab_parts_container').parentElement;
        container.classList.add('hidden'); await settle();
        container.classList.add('still-hidden'); await settle();
        expect(render).toHaveBeenCalledOnce();
        container.classList.remove('hidden');
        await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
        container.classList.add('visible-again'); await settle();
        expect(render).toHaveBeenCalledTimes(2);
        expect(load).toHaveBeenCalledOnce();
    });
    test('an unchanged query event keeps the shown results; a changed one loads and presents', async () => {
        const load = vi.fn(async (params) => ({ params, worklines: [], filtered_count: 3 })); const render = vi.fn();
        make({ loadSnapshot: load, renderSnapshot: render });
        mocks.params = { extension_status: 'active' }; await host.refresh();
        for (let i = 0; i < 2; i += 1) {
            window.dispatchEvent(new CustomEvent('dataset-query-params-changed', { detail: { dataset: 'extension' } }));
        }
        await settle();
        expect(render).toHaveBeenCalledOnce();
        expect(mocks.count).toHaveBeenLastCalledWith('extension', 3);
        mocks.params = { extension_status: 'paused' };
        window.dispatchEvent(new CustomEvent('dataset-query-params-changed', { detail: { dataset: 'extension' } }));
        await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
        expect(load).toHaveBeenCalledTimes(2);
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
    test('a search without a chosen order is ranked by relevance where the surface offers it', async () => {
        const emitted = [];
        const listen = (event) => { if (event.detail?.dataset === 'extension') emitted.push(event.detail.value); };
        window.addEventListener('dataset-sort-sync-changed', listen);
        try {
            const load = vi.fn(async () => ({ worklines: [] }));
            make({ loadSnapshot: load, metadata: () => ({ sort_options: { allowedSortColumns: ['', '__newest', 'title'] } }) });
            await host.refresh({ search: '127' });
            expect(load).toHaveBeenLastCalledWith({ search: '127' });
            expect(mocks.state).toHaveBeenLastCalledWith('extension', { filters: {}, offset: 0, sort: { column: null, direction: null } });
            expect(emitted.at(-1)).toBe('');
            mocks.params = { search: '127', sort_column: '__newest', sort_order: 'DESC' };
            await host.refresh();
            expect(mocks.state).toHaveBeenLastCalledWith('extension', { filters: {}, offset: 0, sort: { column: '__newest', direction: 'DESC' } });
            expect(emitted.at(-1)).toBe('__newest:DESC');
            mocks.params = {};
            await host.refresh();
            expect(emitted.at(-1)).toBe('__newest:DESC');
        } finally {
            window.removeEventListener('dataset-sort-sync-changed', listen);
        }
    });
    test('a surface that does not offer relevance keeps newest during a search', async () => {
        make({ metadata: { sort_options: { allowedSortColumns: ['__newest', 'title'] } } });
        await host.refresh({ search: 'release' });
        expect(mocks.state).toHaveBeenLastCalledWith('extension', { filters: {}, offset: 0, sort: { column: '__newest', direction: 'DESC' } });
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
