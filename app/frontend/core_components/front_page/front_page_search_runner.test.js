// front_page_search_runner.test.js
// Proves request bounds and stable rendering with the real accepted viewer catalogue.
// Connects fake time and deferred transports to the shared queue and group renderer.
// No fixture dataset, account or language key is written to the application.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const endpoint = vi.hoisted(() => vi.fn());
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: endpoint }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: key => key }));
import { createFrontPageSearchRunner } from './front_page_search_runner.js';
import { acceptMainDatasetTabs, fetchProjectTabs } from '../navigation/main_tabs/main_dataset_tabs.js';
import { clearDatasetAccessRegistry } from '../navigation/nav_engine/dataset_access_registry.js';

let runner, input, groups, status;
let pending = [];
const rows = (id = 1) => ({ data: [1, 2, 3, 4].map(n => ({ id: id + n, title: `Harbour ${id + n}` })),
    columns: ['title'], types: { title: { card_element: 'header', show_value_on_card: true } } });
async function catalogue(isLoggedIn = true, names = ['app_beta', 'app_alpha', 'app_gamma']) {
    const response = { datasets: [
        ...names.map(dataset_name => ({ dataset_name, names: [dataset_name, `alias-${dataset_name}`],
            preferred_name: `alias-${dataset_name}`, is_top_level_in_current_project: true, can_read_rows: true })),
        { dataset_name: 'app_denied', is_top_level_in_current_project: true, can_read_rows: false },
        { dataset_name: 'app_nested', is_top_level_in_current_project: false, can_read_rows: true },
        { dataset_name: 'system_users' }, { dataset_name: 'system_about' },
    ], tab_order: names.map((dataset_name, sort_order) => ({ dataset_name, sort_order })) };
    acceptMainDatasetTabs(await fetchProjectTabs({ preloadedContentTablesResponse: response }), isLoggedIn);
}
function type(value) { input.value = value; input.dispatchEvent(new Event('input')); }
const flush = () => vi.advanceTimersByTimeAsync(0);
beforeEach(async () => {
    vi.useFakeTimers();
    clearDatasetAccessRegistry();
    endpoint.mockReset().mockResolvedValue(rows());
    await catalogue();
    document.body.innerHTML = '<input><div id="groups"></div><p role="status"></p>';
    input = document.querySelector('input'); groups = document.querySelector('#groups'); status = document.querySelector('p');
    runner = createFrontPageSearchRunner(input, groups, status);
});
afterEach(async () => {
    runner?.destroy();
    pending.forEach(resolve => resolve({ data: [] })); pending = [];
    await flush(); clearDatasetAccessRegistry();
    vi.useRealTimers(); document.body.replaceChildren();
});

test('two characters and 300ms after the last keystroke start one ordinary bounded round', async () => {
    type('h'); await vi.advanceTimersByTimeAsync(400); expect(endpoint).not.toHaveBeenCalled();
    type('ha'); await vi.advanceTimersByTimeAsync(299); expect(endpoint).not.toHaveBeenCalled();
    type('har'); await vi.advanceTimersByTimeAsync(299); expect(endpoint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(endpoint).toHaveBeenCalledTimes(3);
    for (const [route, options] of endpoint.mock.calls) {
        expect(route).toBe('getResults');
        const params = new URLSearchParams(options.url_params);
        expect(params.get('search')).toBe('har'); expect(params.get('limit')).toBe('3');
        expect(params.get('include_card_support')).toBe('1');
        expect(params.get('view_key')).toBe('card');
        expect(options).toMatchObject({ signal: expect.any(AbortSignal), suppressAuthRedirect: true, suppressErrorToast: true });
    }
    expect([...groups.querySelectorAll('ul')].map(list => list.children.length)).toEqual([3, 3, 3]);
});

test.each([true, false])('only this viewer’s readable app tabs are requested; signed in=%s', async isLoggedIn => {
    const names = isLoggedIn ? ['app_beta', 'app_alpha', 'app_gamma'] : ['app_guest'];
    await catalogue(isLoggedIn, names);
    type('harbour'); await vi.advanceTimersByTimeAsync(300);
    expect(endpoint.mock.calls.map(([, options]) => new URLSearchParams(options.url_params).get('dataset')))
        .toEqual(names);
});

test('placeholders retain tab order when the second reply arrives first; two actual requests at most', async () => {
    endpoint.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    type('harbour'); await vi.advanceTimersByTimeAsync(300);
    expect(endpoint).toHaveBeenCalledTimes(2);
    const slots = [...groups.children];
    expect([...groups.querySelectorAll('section')].map(group => group.dataset.dataset)).toEqual(['app_beta', 'app_alpha', 'app_gamma']);
    expect(status.textContent).toBe('front_page_search_searching');
    pending[1](rows(20)); await flush();
    expect(endpoint).toHaveBeenCalledTimes(3);
    expect([...groups.children]).toEqual(slots);
    expect(slots[0].getAttribute('aria-busy')).toBe('true');
    expect(slots[1].textContent).toContain('Harbour 21');
    pending[0](rows()); pending[2]({ data: [] }); await flush();
    expect([...groups.children]).toEqual(slots); expect(slots[2].hidden).toBe(true);
});

test('changed input aborts immediately; stale replies never draw or exceed two active transports', async () => {
    endpoint.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    type('old'); await vi.advanceTimersByTimeAsync(300);
    const oldSignals = endpoint.mock.calls.map(([, options]) => options.signal);
    type('new'); expect(oldSignals.every(signal => signal.aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(300); expect(endpoint).toHaveBeenCalledTimes(2);
    pending[0](rows(100)); pending[1](rows(100)); await flush();
    expect(endpoint).toHaveBeenCalledTimes(4);
    expect(groups.textContent).not.toContain('Harbour 101');
    pending[2](rows(200)); pending[3]({ data: [] }); await flush();
    pending[4]({ data: [] }); await flush();
    expect(groups.textContent).toContain('Harbour 201'); expect(groups.textContent).not.toContain('Harbour 101');
    type('x'); expect(groups.textContent).toBe(''); expect(status.textContent).toBe('');
});

test('all-zero and denied replies produce exactly one no-hit line without dataset labels', async () => {
    endpoint.mockResolvedValueOnce({ data: [] }).mockRejectedValueOnce({ status: 403 }).mockResolvedValueOnce({ data: [] });
    type('nothing'); await vi.advanceTimersByTimeAsync(300);
    expect(status.textContent).toBe('front_page_search_no_results');
    expect([...groups.children].every(slot => slot.hidden)).toBe(true);
});

test('transport failure reports failure rather than falsely claiming no matches', async () => {
    endpoint.mockRejectedValue(new Error('offline'));
    type('harbour'); await vi.advanceTimersByTimeAsync(300);
    expect(status.textContent).toBe('front_page_search_failed');
});

test('Show all uses the canonical dataset path and same encoded text search', async () => {
    type('sea & sun'); await vi.advanceTimersByTimeAsync(300);
    expect(groups.querySelector('.supplemental-dataset-show-all').getAttribute('href'))
        .toBe('/alias-app_beta?search=sea+%26+sun');
});

test('losing the accepted rights snapshot aborts the round and erases its rows', async () => {
    endpoint.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    type('harbour'); await vi.advanceTimersByTimeAsync(300);
    clearDatasetAccessRegistry();
    expect(endpoint.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
    pending.forEach(resolve => resolve(rows(100))); await vi.advanceTimersByTimeAsync(300);
    expect(groups.children).toHaveLength(0); expect(endpoint).toHaveBeenCalledTimes(2);
});
