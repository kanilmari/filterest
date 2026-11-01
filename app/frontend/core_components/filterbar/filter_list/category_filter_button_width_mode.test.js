// category_filter_button_width_mode.test.js
// Verifies site layout defaults, refresh hints and authoritative server answers.
// Connects guarded browser storage with the HTML attribute consumed by CSS.
// Keeps both modes usable when storage is missing, stale or denied.
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const KEY = 'category_filter_button_width_mode';
const DEFAULT = 'fill_row_with_centered_label';
beforeEach(() => { vi.resetModules(); localStorage.clear(); document.documentElement.removeAttribute('data-category-filter-button-width-mode'); });
afterEach(() => { vi.restoreAllMocks(); });

test.each([DEFAULT, 'fit_to_label', 'unknown', null])('normalises stored hint %s and lets the server replace it', async value => {
    if (value !== null) localStorage.setItem(KEY, value);
    const { setCategoryFilterButtonWidthMode } = await import('./category_filter_button_width_mode.js');
    expect(document.documentElement.dataset.categoryFilterButtonWidthMode).toBe(value === 'fit_to_label' ? value : DEFAULT);
    for (const answer of ['fit_to_label', DEFAULT, 'unknown', undefined, null]) {
        const expected = answer === 'fit_to_label' ? answer : DEFAULT;
        expect(setCategoryFilterButtonWidthMode(answer)).toBe(expected);
        expect(document.documentElement.dataset.categoryFilterButtonWidthMode).toBe(expected);
        expect(localStorage.getItem(KEY)).toBe(expected);
    }
});

test.each([undefined, 'unknown'])('server answer %s overrides a stale fit-to-label hint with the default', async answer => {
    localStorage.setItem(KEY, 'fit_to_label');
    const { setCategoryFilterButtonWidthMode } = await import('./category_filter_button_width_mode.js');
    expect(document.documentElement.dataset.categoryFilterButtonWidthMode).toBe('fit_to_label');
    expect(setCategoryFilterButtonWidthMode(answer)).toBe(DEFAULT);
    expect(document.documentElement.dataset.categoryFilterButtonWidthMode).toBe(DEFAULT);
    expect(localStorage.getItem(KEY)).toBe(DEFAULT);
});

test('denied reads and writes leave the default and both server modes usable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const { setCategoryFilterButtonWidthMode } = await import('./category_filter_button_width_mode.js');
    expect(document.documentElement.dataset.categoryFilterButtonWidthMode).toBe(DEFAULT);
    expect(setCategoryFilterButtonWidthMode('fit_to_label')).toBe('fit_to_label');
    expect(document.documentElement.dataset.categoryFilterButtonWidthMode).toBe('fit_to_label');
    expect(setCategoryFilterButtonWidthMode(undefined)).toBe(DEFAULT);
});
