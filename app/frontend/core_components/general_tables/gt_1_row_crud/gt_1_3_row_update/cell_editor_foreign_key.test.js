// @vitest-environment jsdom
// cell_editor_foreign_key.test.js
// Exercises referenced-value writes and remote search through the real inline picker.
// Bridges cell metadata, the shared value-column loader and multiselect lifecycle.
// Exists to prevent id/UID confusion, lost current values and late search updates.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { editCell } from './cell_editor.js';
import { fetchFilterOptions } from '../../../endpoints/endpoint_data_fetcher.js';
import { endpoint_router } from '../../../endpoints/endpoint_router.js';

vi.mock('../../../endpoints/endpoint_data_fetcher.js', () => ({ fetchFilterOptions: vi.fn() }));
vi.mock('../../../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
vi.mock('../../../table_views/table_view/table_cell_handler.js', () => ({ selectCell: vi.fn() }));
vi.mock('../../../../reusable_components/notifications/toast_notification_printer.js', () => ({ showWarningToast: vi.fn() }));
vi.mock('../../../service_catalog/service_catalog_moderation.js', () => ({
    readCachedUserPermissions: () => ({}), canEditServiceCatalogColumn: () => true,
}));
vi.mock('../../../lang/translation_handler.js', () => ({ getTranslationForKey: (key) => `translated:${key}` }));

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

async function openEditor({ key = 'dataset_uid', value = 111, foreignColumn = 'table_uid',
    foreignTable = 'system_db_tables', dataType = 'integer', editName = false, label = 'Current dataset' } = {}) {
    const cell = document.createElement('td');
    cell.dataset.rowIndex = '0';
    cell.dataset.colIndex = editName ? '2' : '1';
    cell.textContent = editName ? label : String(value ?? '');
    cell.title = label;
    document.body.append(cell);
    const data = [{ id: 844, [key]: value, [`${key}_name`]: label }];
    await editCell(cell, ['id', key, `${key}_name`], data, {
        [key]: { foreign_table: foreignTable, foreign_column: foreignColumn, data_type: dataType },
    }, 'tickets');
    await vi.advanceTimersByTimeAsync(0);
    return { cell, data, input: cell.querySelector('.msd-dropdown-search-input'),
        trigger: cell.querySelector('.msd-dropdown-input'), instance: cell.querySelector('.msd-dropdown').__dropdown };
}

function option(cell, value) {
    return [...cell.querySelectorAll('.msd-option')].find((item) => item.dataset.optionValue === String(value));
}
function typeSearch(input, text) {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}
function keydown(element, key) {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    vi.useFakeTimers();
    fetchFilterOptions.mockReset().mockResolvedValue([]);
    endpoint_router.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
    for (const container of document.querySelectorAll('[data-testid="inline-fk-dropdown"]')) {
        keydown(container, 'Escape');
    }
    vi.useRealTimers();
});

describe('inline referenced values', () => {
    test.each([
        ['table UID distinct from row id', 'dataset_uid', 'table_uid', 'system_db_tables', 'integer', 9001],
        ['column UID without an id column', 'column_uid', 'column_uid', 'system_column_details', 'bigint', 9102],
        ['text slug', 'category', 'slug', 'categories', 'text', 'customer-portal'],
        ['language code', 'language', 'language_code', 'languages', 'text', 'fi'],
        ['legacy id fallback', 'service_id', undefined, 'services', 'integer', 12],
    ])('saves option.value for %s', async (_name, key, foreignColumn, foreignTable, dataType, value) => {
        // The registry's physical id deliberately differs from its reference key.
        const loaded = { value, label: 'Chosen value', ...(foreignColumn === 'table_uid' ? { id: 7 } : {}) };
        fetchFilterOptions.mockResolvedValue([loaded]);
        const { cell, data } = await openEditor({ key, foreignColumn: foreignColumn ?? '', foreignTable, dataType });
        expect(fetchFilterOptions.mock.calls).toEqual([[{
            dataset_name: foreignTable, value_column: foreignColumn || 'id', search: '', limit: 100,
        }]]);
        option(cell, value).click();
        await vi.advanceTimersByTimeAsync(0);
        expect(endpoint_router.mock.calls).toEqual([['updateRow', {
            method: 'POST', url_params: '?dataset=tickets',
            body_data: { id: 844, column: key, value },
        }]]);
        expect(data[0][key]).toBe(value);
        expect(cell.title).toBe('Chosen value');
        expect(cell.textContent).toBe(String(value));
        expect(cell.querySelector('.msd-dropdown')).toBeNull();
    });

    test('shows a localized label and saves the raw value from a name cell', async () => {
        localStorage.setItem('chosen_language', 'fi');
        fetchFilterOptions.mockResolvedValue([{ value: 9001, label: { en: 'Customer portal', fi: 'Asiakasportaali' } }]);
        const { cell, data, input } = await openEditor({ editName: true });
        expect(input.placeholder).toBe('translated:search_by_name_or_id');
        expect(cell.querySelector('.msd-option-action')).toBeNull();
        expect(cell.querySelector('[role="listbox"]').getAttribute('aria-multiselectable')).toBe('false');
        expect(option(cell, 9001).textContent).toBe('Asiakasportaali');
        option(cell, 9001).click();
        await vi.advanceTimersByTimeAsync(0);
        expect(data[0].dataset_uid).toBe(9001);
        expect(cell.textContent).toBe('Asiakasportaali');
    });

    test('keeps the current value beyond the first 100 and selecting it performs no write', async () => {
        fetchFilterOptions.mockResolvedValue(Array.from({ length: 100 }, (_, index) => ({ value: index + 1, label: `Dataset ${index + 1}` })));
        const { cell, data, trigger } = await openEditor({ value: 9001 });
        expect(cell.querySelectorAll('.msd-option')).toHaveLength(101);
        expect(trigger.value).toBe('Current dataset');
        expect(option(cell, 9001).getAttribute('aria-selected')).toBe('true');
        option(cell, 9001).click();
        await vi.advanceTimersByTimeAsync(0);
        expect(data[0].dataset_uid).toBe(9001);
        expect(endpoint_router).not.toHaveBeenCalled();
        expect(cell.querySelector('.msd-dropdown')).toBeNull();
    });

    test('keeps the current value when unlabelled rows are absent from options', async () => {
        const { cell, data, trigger } = await openEditor({ value: 'unlabelled', label: '', dataType: 'text', foreignColumn: 'slug' });
        expect(trigger.value).toBe('unlabelled');
        expect(option(cell, 'unlabelled').getAttribute('aria-selected')).toBe('true');
        option(cell, 'unlabelled').click();
        expect(data[0].dataset_uid).toBe('unlabelled');
        expect(endpoint_router).not.toHaveBeenCalled();
    });

    test('searches on the server after debounce and ignores an older answer', async () => {
        const older = deferred(), newer = deferred();
        fetchFilterOptions.mockImplementation(({ search }) => search === 'portal' ? newer.promise : search === 'port' ? older.promise : Promise.resolve([]));
        const { cell, input } = await openEditor();
        typeSearch(input, 'po');
        await vi.advanceTimersByTimeAsync(100);
        typeSearch(input, 'port');
        await vi.advanceTimersByTimeAsync(199);
        expect(fetchFilterOptions).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        typeSearch(input, 'portal');
        await vi.advanceTimersByTimeAsync(200);
        expect(fetchFilterOptions.mock.calls.map(([request]) => request.search)).toEqual(['', 'port', 'portal']);
        newer.resolve([{ value: 9001, label: 'Newest portal' }]);
        await vi.advanceTimersByTimeAsync(0);
        older.resolve([{ value: 9002, label: 'Old portal' }]);
        await vi.advanceTimersByTimeAsync(0);
        expect(option(cell, 9002)).toBeUndefined();
        option(cell, 9001).click();
        await vi.advanceTimersByTimeAsync(0);
        expect(endpoint_router.mock.calls[0][1].body_data.value).toBe(9001);
    });

    test('ignores an older failure while a newer search is still debouncing', async () => {
        const initial = deferred();
        fetchFilterOptions.mockImplementation(({ search }) => search ? Promise.resolve([{ value: 9, label: 'New' }]) : initial.promise);
        const { cell, input } = await openEditor();
        typeSearch(input, 'New');
        initial.reject(new Error('Old failure'));
        await vi.advanceTimersByTimeAsync(0);
        expect(cell.querySelector('[role="alert"]').hidden).toBe(true);
        await vi.advanceTimersByTimeAsync(200);
        expect(option(cell, 9)).toBeDefined();
    });

    test.each([403, 500])('shows a %s load failure and keeps the current value', async (status) => {
        fetchFilterOptions.mockRejectedValue(Object.assign(new Error('technical detail'), { status }));
        const { cell, data, input, trigger } = await openEditor();
        const alert = cell.querySelector('[role="alert"]');
        expect(alert.hidden).toBe(false);
        expect(alert.textContent).toBe('translated:failed_to_load');
        expect(trigger.value).toBe('Current dataset');
        expect(option(cell, 111)).toBeDefined();
        expect(data[0].dataset_uid).toBe(111);
        fetchFilterOptions.mockResolvedValue([{ value: 2, label: 'Recovered' }]);
        typeSearch(input, 'Recovered');
        await vi.advanceTimersByTimeAsync(200);
        expect(alert.hidden).toBe(true);
        expect(option(cell, 2)).toBeDefined();
    });

    test('shows a failed search without reporting an empty successful result', async () => {
        const { cell, input } = await openEditor({ value: null, label: '' });
        fetchFilterOptions.mockRejectedValue(new Error('Network lost'));
        typeSearch(input, 'unknown');
        await vi.advanceTimersByTimeAsync(200);
        expect(cell.querySelector('[role="alert"]').hidden).toBe(false);
        expect(cell.querySelector('.msd-no-results').textContent).toBe('translated:failed_to_load');
        expect(endpoint_router).not.toHaveBeenCalled();
    });

    test.each(['resolve', 'reject'])('destroys the editor during a load and ignores its later %s', async (completion) => {
        const pending = deferred();
        fetchFilterOptions.mockReturnValue(pending.promise);
        const { cell, input, instance } = await openEditor();
        const destroy = vi.spyOn(instance, 'destroy');
        keydown(input, 'Escape');
        expect(destroy).toHaveBeenCalledTimes(1);
        pending[completion](completion === 'resolve' ? [{ value: 9, label: 'Late' }] : new Error('Late failure'));
        await vi.advanceTimersByTimeAsync(0);
        expect(cell.textContent).toBe('111');
        expect(document.querySelector('.msd-dropdown-list')).toBeNull();
        expect(endpoint_router).not.toHaveBeenCalled();
    });

    test('cancels a queued search when focus leaves the editor', async () => {
        const { cell, input } = await openEditor();
        typeSearch(input, 'pending');
        input.blur();
        await vi.advanceTimersByTimeAsync(300);
        expect(fetchFilterOptions).toHaveBeenCalledTimes(1);
        expect(cell.querySelector('.msd-dropdown')).toBeNull();
        expect(endpoint_router).not.toHaveBeenCalled();
    });

    test('lets focus move to options and saves with ArrowDown and Enter', async () => {
        fetchFilterOptions.mockResolvedValue([{ value: 9001, label: 'New portal' }]);
        const { cell, input } = await openEditor();
        typeSearch(input, 'portal');
        await vi.advanceTimersByTimeAsync(200);
        keydown(input, 'ArrowDown');
        expect(document.activeElement).toBe(option(cell, 9001));
        keydown(document.activeElement, 'Enter');
        await vi.advanceTimersByTimeAsync(0);
        expect(endpoint_router).toHaveBeenCalledTimes(1);
        expect(cell.textContent).toBe('9001');
    });

    test('does not save twice on rapid selection, blur or Enter during a save', async () => {
        const save = deferred();
        endpoint_router.mockReturnValue(save.promise);
        fetchFilterOptions.mockResolvedValue([{ value: 9001, label: 'New portal' }]);
        const { cell, input } = await openEditor();
        option(cell, 9001).click();
        option(cell, 9001).click();
        input.blur();
        keydown(input, 'Enter');
        expect(endpoint_router).toHaveBeenCalledTimes(1);
        expect(cell.dataset.inlineSaveState).toBe('saving');
        save.resolve({ ok: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(cell.textContent).toBe('9001');
        expect(document.querySelector('.msd-dropdown-list')).toBeNull();
    });

    test('cancels on outside click and performs no write', async () => {
        const { cell } = await openEditor();
        document.body.click();
        expect(cell.textContent).toBe('111');
        expect(endpoint_router).not.toHaveBeenCalled();
    });

    test('cancels a maintenance draft with the clear button without retrying it', async () => {
        endpoint_router.mockRejectedValueOnce(Object.assign(new Error('maintenance'), {
            status: 503, isServiceUnavailable: true,
        }));
        fetchFilterOptions.mockResolvedValue([{ value: 9001, label: 'New portal' }]);
        const { cell, data } = await openEditor();
        option(cell, 9001).click();
        await vi.advanceTimersByTimeAsync(0);
        expect(cell.dataset.inlineSaveState).toBe('retry');
        cell.querySelector('.msd-clear-btn').click();
        await vi.advanceTimersByTimeAsync(0);
        expect(endpoint_router).toHaveBeenCalledTimes(1);
        expect(data[0].dataset_uid).toBe(111);
        expect(cell.textContent).toBe('111');
    });
});
