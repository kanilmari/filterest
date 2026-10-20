// front_page_article_row_picker.test.js
// Regresses dataset changes during debounced searches and live popup translations.
// Connects the real picker/dropdown to deferred canonical reads and language refreshes.
// Keeps obsolete queries and responses from hiding another dataset's readable articles.
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createArticleRowPicker } from './front_page_article_row_picker.js';
import { ARTICLE_BUTTON_COPY } from './front_page_article_buttons_copy.js';
import { refreshLocalizedDatasetValues } from '../table_views/dataset_value_localizer.js';

const mocks = vi.hoisted(() => ({ request: vi.fn(), changed: vi.fn() }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: mocks.request }));
vi.mock('../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, options = {}) => options.fallback || key,
}));

const datasetA = { table_uid: 7, dataset_name: 'articles_a' };
const datasetB = { table_uid: 8, dataset_name: 'articles_b' };
const page = (id, heading) => ({ columns: ['id', 'heading'],
    types: { heading: { card_element: 'header' } },
    data: [{ id, heading }], resultsPerLoad: 20, row_count: 1 });
const pageA = page(1, 'Article A'), pageB = page(2, 'Readable article B');
let picker;

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function searchField() { return picker.element.querySelector('.msd-dropdown-search-input'); }
function optionLabels() {
    return [...picker.element.querySelectorAll('[role="option"]')].map(option => option.textContent);
}
function typeSearch(value, event = 'input') {
    searchField().value = value;
    searchField().dispatchEvent(new Event(event, { bubbles: true }));
}
function readsFor(dataset) {
    return mocks.request.mock.calls.map(([, options]) => new URLSearchParams(options.url_params))
        .filter(params => params.get('dataset') === dataset.dataset_name);
}
async function mountAndOpen() {
    picker = createArticleRowPicker({ onChange: mocks.changed });
    document.body.append(picker.element);
    await picker.setDataset(datasetA);
    picker.element.querySelector('[role="combobox"]').click();
    await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren(); localStorage.clear(); localStorage.setItem('chosen_language', 'fi');
    mocks.changed.mockReset();
    mocks.request.mockReset().mockImplementation(async (_route, options) => {
        const params = new URLSearchParams(options.url_params);
        if (params.get('dataset') === datasetA.dataset_name) return pageA;
        // An inherited query would hide B's otherwise readable article.
        return params.get('search') ? { ...pageB, data: [], row_count: 0 } : pageB;
    });
});
afterEach(() => {
    picker?.destroy(); picker = null;
    document.body.classList.remove('light-mode', 'dark-mode');
    vi.restoreAllMocks(); vi.useRealTimers();
});

test.each([0, 100, 199].flatMap(switchAfter => [false, true].map(slowB => ({ switchAfter, slowB }))))(
    'a search queued in A cannot search B (switch at $switchAfter ms, slow B: $slowB)',
    async ({ switchAfter, slowB }) => {
        const pendingB = deferred();
        const respond = mocks.request.getMockImplementation();
        if (slowB) mocks.request.mockImplementation((_route, options) => {
            const params = new URLSearchParams(options.url_params);
            return params.get('dataset') === datasetB.dataset_name && !params.get('search')
                ? pendingB.promise : respond(_route, options);
        });
        await mountAndOpen();
        typeSearch('  only-in-A  ');
        await vi.advanceTimersByTimeAsync(switchAfter);
        expect(readsFor(datasetA).every(params => !params.has('search'))).toBe(true);
        const changingDataset = picker.setDataset(datasetB);
        expect(searchField().value).toBe('');
        if (!slowB) await changingDataset;
        await vi.advanceTimersByTimeAsync(200 - switchAfter);
        expect(readsFor(datasetB).map(params => params.get('search'))).toEqual([null]);
        if (slowB) { pendingB.resolve(pageB); await changingDataset; }
        expect(optionLabels()).toEqual(['Readable article B']);
        picker.element.querySelector('[role="combobox"]').click();
        await vi.advanceTimersByTimeAsync(0);
        expect(readsFor(datasetB).every(params => !params.has('search'))).toBe(true);
        expect(optionLabels()).toEqual(['Readable article B']);
        picker.element.querySelector('[role="option"]').click();
        expect(mocks.changed).toHaveBeenLastCalledWith({ table_uid: 8, row_id: '2', label: 'Readable article B' });
    },
);

test.each(['input', 'search'])('a new B query works after switching with A debounce pending (%s)', async event => {
    await mountAndOpen();
    typeSearch('only-in-A'); await vi.advanceTimersByTimeAsync(100);
    await picker.setDataset(datasetB);
    typeSearch('  B query  ', event);
    mocks.request.mockResolvedValueOnce(page(3, 'B query result'));
    await vi.advanceTimersByTimeAsync(199);
    expect(readsFor(datasetB).map(params => params.get('search'))).toEqual([null]);
    await vi.advanceTimersByTimeAsync(1);
    expect(readsFor(datasetB).map(params => params.get('search'))).toEqual([null, 'B query']);
    expect(optionLabels()).toEqual(['B query result']);
});

test.each(['input', 'search'])('an empty search still reloads B after a dataset change (%s)', async event => {
    await mountAndOpen();
    typeSearch('only-in-A');
    await picker.setDataset(datasetB);
    typeSearch('', event);
    await vi.advanceTimersByTimeAsync(200);
    expect(readsFor(datasetB).map(params => params.get('search'))).toEqual([null, null]);
    expect(optionLabels()).toEqual(['Readable article B']);
});

test.each(['resolve', 'abort', 'reject'].flatMap(outcome =>
    ['A then B', 'B then A', 'A and B', 'B and A'].map(order => ({ outcome, order }))))(
    'an obsolete A search preserves B options and status (outcome: $outcome, order: $order)',
    async ({ outcome, order }) => {
        const pendingA = deferred(), pendingB = deferred();
        await mountAndOpen();
        mocks.request.mockImplementation((_route, options) => {
            const params = new URLSearchParams(options.url_params);
            if (params.get('dataset') === datasetA.dataset_name) return pendingA.promise;
            return pendingB.promise;
        });
        typeSearch('only-in-A'); await vi.advanceTimersByTimeAsync(200);
        expect(readsFor(datasetA).at(-1).get('search')).toBe('only-in-A');
        const oldSignal = mocks.request.mock.calls.at(-1)[1].signal;
        const changingDataset = picker.setDataset(datasetB);
        expect(oldSignal.aborted).toBe(true);
        const statusTexts = () => [...picker.element.querySelectorAll('[role="status"]')]
            .map(node => node.hidden ? '' : node.textContent);
        const loadingStatus = statusTexts();
        const finishA = () => {
            if (outcome === 'resolve') pendingA.resolve(pageA);
            else pendingA.reject(Object.assign(new Error('obsolete request'), { name: outcome === 'abort' ? 'AbortError' : 'Error' }));
        };
        if (order === 'A then B') {
            finishA(); await vi.advanceTimersByTimeAsync(0);
            expect(optionLabels()).toEqual([]);
            expect(statusTexts()).toEqual(loadingStatus);
            pendingB.resolve(pageB);
        } else if (order === 'B then A') {
            pendingB.resolve(pageB); await changingDataset; await vi.advanceTimersByTimeAsync(0);
            expect(optionLabels()).toEqual(['Readable article B']);
            expect(statusTexts()).toEqual(['', '']);
            finishA();
        } else if (order === 'A and B') {
            // Gate ordering: neither settlement may drain promises before the other.
            finishA(); pendingB.resolve(pageB);
        } else {
            pendingB.resolve(pageB); finishA();
        }
        await changingDataset; await vi.advanceTimersByTimeAsync(0);
        expect(optionLabels()).toEqual(['Readable article B']);
        expect(statusTexts()).toEqual(['', '']);
        expect(readsFor(datasetB).map(params => params.get('search'))).toEqual([null]);

        picker.element.querySelector('[role="combobox"]').click();
        await vi.advanceTimersByTimeAsync(0);
        picker.element.querySelector('[role="option"]').click();
        expect(mocks.changed).toHaveBeenLastCalledWith({ table_uid: 8, row_id: '2', label: 'Readable article B' });

        mocks.request.mockResolvedValueOnce(page(3, 'Fresh B query result'));
        typeSearch('fresh B query'); await vi.advanceTimersByTimeAsync(200);
        expect(optionLabels()).toEqual(['Fresh B query result']);
        expect(statusTexts()).toEqual(['', '']);
        mocks.request.mockResolvedValueOnce(pageB);
        typeSearch(''); await vi.advanceTimersByTimeAsync(200);
        expect(optionLabels()).toEqual(['Readable article B']);
        expect(statusTexts()).toEqual(['', '']);
        expect(readsFor(datasetB).map(params => params.get('search'))).toEqual([null, null, 'fresh B query', null]);
    },
);

test.each(['fi', 'en', 'ch', 'yue'].flatMap(language => ['light', 'dark'].map(theme => ({ language, theme }))))(
    'popup heading and dialog name follow $language in the $theme theme', async ({ language, theme }) => {
        localStorage.setItem('chosen_language', language === 'fi' ? 'en' : 'fi');
        document.body.classList.add(`${theme}-mode`);
        await mountAndOpen();
        const dialog = picker.element.querySelector('[role="dialog"]');
        const heading = dialog.querySelector('h3');
        const dropdown = picker.element.querySelector('.msd-dropdown').__dropdown;
        const labels = vi.spyOn(dropdown, 'setLabels');
        const oldTitle = heading.textContent;
        localStorage.setItem('chosen_language', language);
        await refreshLocalizedDatasetValues(language);
        const index = ['fi', 'en', 'ch', 'yue'].indexOf(language);
        const title = ARTICLE_BUTTON_COPY.chooseRow[index], search = ARTICLE_BUTTON_COPY.search[index];
        expect(title).not.toBe(oldTitle);
        expect(dialog.querySelector('h3')).toBe(heading);
        expect(heading.textContent).toBe(title);
        expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
        expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toBe(title);
        expect(dialog.hasAttribute('aria-label')).toBe(false);
        expect(labels).toHaveBeenLastCalledWith(expect.objectContaining({ popupTitle: title, closeLabel: title }));
        expect(searchField().placeholder).toBe(search);
        expect(searchField().getAttribute('aria-label')).toBe(search);
        expect(picker.element.querySelector('.msd-clear-btn').getAttribute('aria-label')).toBe(title);
        expect(dialog.style.display).toBe('flex');
        expect(optionLabels()).toEqual(['Article A']);
    },
);

test('Page selection requests the Page projection and returns its view; Article stays absent', async () => {
    await mountAndOpen();
    await picker.setView('image_first_page_view');
    expect(readsFor(datasetA).at(-1).get('view_key')).toBe('image_first_page_view');
    picker.element.querySelector('[role="combobox"]').click(); await vi.advanceTimersByTimeAsync(0);
    picker.element.querySelector('[role="option"]').click();
    expect(mocks.changed).toHaveBeenLastCalledWith({ table_uid: 7, row_id: '1', label: 'Article A', view: 'image_first_page_view' });
    await picker.setView('article_view');
    expect(readsFor(datasetA).at(-1).get('view_key')).toBe('article_view');
    picker.element.querySelector('[role="combobox"]').click(); await vi.advanceTimersByTimeAsync(0);
    picker.element.querySelector('[role="option"]').click();
    expect(mocks.changed).toHaveBeenLastCalledWith({ table_uid: 7, row_id: '1', label: 'Article A' });
});
