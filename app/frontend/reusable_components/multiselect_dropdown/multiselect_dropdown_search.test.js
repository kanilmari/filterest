// multiselect_dropdown_search.test.js
// Verifies opt-in cancellation of queued and already-running remote searches.
// Connects the public dropdown API to deferred callbacks and rendered option/status state.
// Prevents obsolete search installation while preserving selection and future searches.
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createMultiselectDropdown } from './multiselect_dropdown_builder.js';

const currentOptions = [{ value: '1', label: 'Current article' }];
const nextOptions = [{ value: '2', label: 'Readable article B' }];
let dropdown, container;

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function mount(onSearch) {
    container = document.createElement('div');
    document.body.append(container);
    dropdown = createMultiselectDropdown({ containerElement: container, options: currentOptions,
        initialState: { includeValues: ['1'] }, allowExclude: false, onSearch });
    dropdown.open();
}
function search(value) {
    const input = document.querySelector('.msd-dropdown-search-input');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}
function visibleLabels() {
    return [...document.querySelectorAll('.msd-option-label')].map(node => node.textContent);
}
function visibleStatus() {
    const status = document.querySelector('.msd-no-results');
    return status.hidden ? '' : status.textContent;
}

beforeEach(() => {
    document.body.replaceChildren();
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    dropdown?.destroy(); dropdown = null;
    vi.restoreAllMocks(); vi.useRealTimers();
});

test('cancels a queued debounce without changing options, query, selection or popup state', async () => {
    const onSearch = vi.fn().mockResolvedValue(currentOptions);
    mount(onSearch);
    await vi.advanceTimersByTimeAsync(0);
    onSearch.mockClear();
    search('current');
    const option = document.querySelector('[role="option"]');
    dropdown.cancelPendingSearch(); dropdown.cancelPendingSearch();
    await vi.advanceTimersByTimeAsync(200);
    expect(onSearch).not.toHaveBeenCalled();
    expect(document.querySelector('[role="option"]')).toBe(option);
    expect(visibleLabels()).toEqual(['Current article']);
    expect(visibleStatus()).toBe('');
    expect(document.querySelector('.msd-dropdown-search-input').value).toBe('current');
    expect(dropdown.getState()).toEqual({ includeValues: ['1'], excludeValues: [] });
    expect(container.querySelector('[role="combobox"]').getAttribute('aria-expanded')).toBe('true');

    dropdown.close(); dropdown.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(onSearch).toHaveBeenCalledExactlyOnceWith('');
    expect(visibleLabels()).toEqual(['Current article']);
});

test.each(['resolve', 'abort', 'reject'].flatMap(outcome => [false, true].map(settled => ({ outcome, settled }))))(
    'cancelled remote results cannot install options or status (outcome: $outcome, settled before cancellation: $settled)',
    async ({ outcome, settled }) => {
        const pending = deferred();
        const onSearch = vi.fn().mockReturnValue(pending.promise);
        mount(onSearch);
        expect(onSearch).toHaveBeenCalledExactlyOnceWith('');
        const finish = () => {
            if (outcome === 'resolve') pending.resolve([]);
            else pending.reject(Object.assign(new Error('obsolete'), { name: outcome === 'abort' ? 'AbortError' : 'Error' }));
        };
        // A settled promise still has an installation continuation that cancellation must invalidate.
        if (settled) finish();
        dropdown.cancelPendingSearch();
        dropdown.setOptions(nextOptions); dropdown.setValue({ includeValues: ['2'] });
        if (!settled) finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(visibleLabels()).toEqual(['Readable article B']);
        expect(visibleStatus()).toBe('');
        expect(dropdown.getValue()).toEqual(['2']);
        expect(container.querySelector('[role="combobox"]').value).toBe('Readable article B');

        onSearch.mockResolvedValueOnce([{ value: '3', label: 'Fresh B query' }]);
        search('fresh');
        await vi.advanceTimersByTimeAsync(199);
        expect(onSearch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(onSearch).toHaveBeenLastCalledWith('fresh');
        expect(visibleLabels()).toEqual(['Fresh B query']);
        expect(visibleStatus()).toBe('');
    },
);
