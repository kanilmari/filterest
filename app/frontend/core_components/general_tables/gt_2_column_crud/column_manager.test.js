// column_manager.test.js
// Verifies column-management saves stay inside the SPA shell and sanitize stale schema state.
// Bridges mocked modal/API dependencies with localStorage-backed dataset UI state.
// Exists to keep schema edits from falling back to a full reload or leaving broken filter state behind.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const createModalMock = vi.fn(({ contentElements }) => {
    document.body.append(...contentElements);
});
const showModalMock = vi.fn();
const hideModalMock = vi.fn();
const fetchColumnsMock = vi.fn();
const endpointRouterMock = vi.fn();
const showSuccessToastMock = vi.fn();
const showWarningToastMock = vi.fn();
const refreshTableUnifiedMock = vi.fn();
const getTranslationForKeyMock = vi.fn(key => key);
const reloadSpy = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock('../../../reusable_components/modal/modal_builder.js', () => ({
        createModal: createModalMock,
        showModal: showModalMock,
        hideModal: hideModalMock,
    }));
    vi.doMock('../../endpoints/endpoint_column_fetcher.js', () => ({
        fetch_columns_for_table: fetchColumnsMock,
    }));
    vi.doMock('../../endpoints/endpoint_router.js', () => ({
        endpoint_router: endpointRouterMock,
    }));
    vi.doMock('../../../reusable_components/dom_container_builder.js', () => ({
        isValidIdentifier: () => true,
    }));
    vi.doMock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({
        showSuccessToast: showSuccessToastMock,
        showWarningToast: showWarningToastMock,
    }));
    vi.doMock('../gt_3_table_crud/gt_3_2_table_delete/table_remover.js', () => ({
        drop_table: vi.fn(),
    }));
    vi.doMock('../../lang/translation_handler.js', () => ({
        getTranslationForKey: getTranslationForKeyMock,
    }));
    vi.doMock('../gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', () => ({
        refreshTableUnified: refreshTableUnifiedMock,
    }));

    return import('./column_manager.js');
}

describe('open_column_management_modal', () => {
    beforeEach(() => {
        for (const [options] of createModalMock.mock.calls) options.cleanupCallback?.();
        vi.clearAllMocks();
        document.documentElement.lang = 'en';
        localStorage.clear();
        sessionStorage.clear();
        document.body.innerHTML = '';

        fetchColumnsMock.mockResolvedValue([
            { column_name: 'legacy_col', data_type: 'TEXT', character_maximum_length: null },
            { column_name: 'gone_col', data_type: 'TEXT', character_maximum_length: null },
        ]);
        endpointRouterMock.mockImplementation(async (route) => route === 'adminDatasetUiVisibility'
            ? { dataset_name: 'demo_table', ui_hidden: false } : { message: 'ok' });
        refreshTableUnifiedMock.mockResolvedValue(undefined);

        localStorage.setItem('demo_table_sorting_and_filtering_specs', JSON.stringify({
            sort: { column: 'legacy_col', direction: 'ASC' },
            filters: {
                legacy_col: 'abc',
                legacy_col_from: '2026-01-01',
                legacy_col_to: '2026-12-31',
                gone_col: 'remove-me',
                untouched: 'keep-me',
            },
            offset: 12,
            cardView: { collapsed: false, expandedId: null },
        }));
        localStorage.setItem('demo_table_hide_columns', JSON.stringify({
            legacy_col: true,
            gone_col: true,
            untouched: true,
        }));
        localStorage.setItem('demo_table_open_filters', JSON.stringify([
            'legacy_col',
            'gone_col',
            'modern_col',
        ]));

        Object.defineProperty(window, 'location', {
            value: {
                ...window.location,
                reload: reloadSpy,
            },
            writable: true,
            configurable: true,
        });
    });

    test('refreshes in place and rewrites stale localStorage keys after rename/remove', async () => {
        const mod = await loadModule();

        await mod.open_column_management_modal('demo_table');

        const rows = document.querySelectorAll('.column-row');
        expect(rows).toHaveLength(3);

        const renamedRow = rows[0];
        renamedRow.querySelector('input[name="column_name"]').value = 'modern_col';

        const removedRow = rows[1];
        removedRow.querySelector('button').click();

        const form = document.querySelector('#column_management_form_demo_table');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();

        expect(endpointRouterMock).toHaveBeenCalledWith('modifyColumns', expect.objectContaining({
            method: 'POST',
            body_data: {
                dataset_name: 'demo_table',
                modified_columns: [
                    {
                        original_name: 'legacy_col',
                        new_name: 'modern_col',
                        data_type: 'TEXT',
                        length: null,
                    },
                ],
                added_columns: [],
                removed_columns: ['gone_col'],
            },
        }));
        expect(showSuccessToastMock).toHaveBeenCalledTimes(1);
        expect(hideModalMock).toHaveBeenCalledTimes(1);
        expect(refreshTableUnifiedMock).toHaveBeenCalledWith('demo_table', { skipUrlParams: true });
        expect(reloadSpy).not.toHaveBeenCalled();

        expect(JSON.parse(localStorage.getItem('demo_table_sorting_and_filtering_specs'))).toEqual({
            sort: { column: 'modern_col', direction: 'ASC' },
            filters: {
                modern_col: 'abc',
                modern_col_from: '2026-01-01',
                modern_col_to: '2026-12-31',
                untouched: 'keep-me',
            },
            offset: 0,
            cardView: { collapsed: false, expandedId: null },
            articleView: { collapsed: false, expandedId: null },
        });
        expect(JSON.parse(localStorage.getItem('demo_table_hide_columns'))).toEqual({
            modern_col: true,
            untouched: true,
        });
        expect(JSON.parse(localStorage.getItem('demo_table_open_filters'))).toEqual([
            'modern_col',
        ]);
    });

    test('translates open fields and actions without replacing controls or saving drafts', async () => {
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');
        const input = document.querySelector('input[name="column_name"]');
        input.value = 'unsaved_name';
        input.focus();
        input.setSelectionRange(2, 7);
        const actionButtons = document.querySelectorAll('.form-actions button');
        expect([...actionButtons].map(button => button.textContent)).toEqual(['Cancel', 'Delete', 'Save']);
        const type = document.querySelector('select[name="data_type"]');
        type.value = 'VARCHAR';
        type.dispatchEvent(new Event('change', { bubbles: true }));
        const length = document.querySelector('input[name="length"]');
        length.value = '77';
        endpointRouterMock.mockClear();
        for (const [lang, name, cancel, save] of [
            ['fi', 'Sarakkeen nimi', 'Peruuta', 'Tallenna'],
            ['en', 'Column name', 'Cancel', 'Save'],
            ['ch', '列名', '取消', '保存'],
            ['yue', '欄位名稱', '取消', '儲存'],
            ['fi', 'Sarakkeen nimi', 'Peruuta', 'Tallenna'],
        ]) {
            document.documentElement.lang = lang;
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(input.parentElement.querySelector('span').textContent).toBe(name);
            expect(actionButtons[0].textContent).toBe(cancel);
            expect(actionButtons[2].textContent).toBe(save);
            expect(document.activeElement).toBe(input);
            expect([input.selectionStart, input.selectionEnd]).toEqual([2, 7]);
            expect(input.value).toBe('unsaved_name');
            expect(type.value).toBe('VARCHAR');
            expect(length.value).toBe('77');
        }
        expect(endpointRouterMock).not.toHaveBeenCalled();
        const { cleanupCallback } = createModalMock.mock.calls.at(-1)[0];
        cleanupCallback();
        document.documentElement.lang = 'en';
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(actionButtons[2].textContent).toBe('Tallenna');
    });

    test.each([
        [{ new_columns_multilingual: true }, false, true],
        [{ new_columns_multilingual: false }, true, false],
        [{}, true, true],
        [{ new_columns_multilingual: null }, true, true],
        [{}, false, false],
    ])('resolves the table multilingual default from authoritative or legacy metadata (%j)', async (tableMetadata, existingMultilingual, expected) => {
        fetchColumnsMock.mockResolvedValue([
            { column_name: 'id', data_type: 'INTEGER', ...tableMetadata },
            { column_name: 'title', data_type: 'TEXT', is_multilingual: existingMultilingual },
        ]);
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');
        const defaultInput = document.querySelector('[data-testid="manage-table-multilingual-default"]');
        expect(defaultInput.checked).toBe(expected);
        const existingRows = [...document.querySelectorAll('.column-row')].filter(row =>
            row.querySelector('[name="column_name"]').dataset.originalName);
        expect(existingRows.every(row => !row.querySelector('[name="is_multilingual"]'))).toBe(true);
        const newRow = document.querySelector('[name="is_multilingual"]').closest('.column-row');
        const type = newRow.querySelector('[name="data_type"]');
        type.value = 'TEXT';
        type.dispatchEvent(new Event('change'));
        expect(newRow.querySelector('[name="is_multilingual"]').checked).toBe(expected);
    });

    test('empty metadata starts with a non-multilingual table default', async () => {
        fetchColumnsMock.mockResolvedValue([]);
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');
        expect(document.querySelector('[data-testid="manage-table-multilingual-default"]').checked).toBe(false);
    });

    test('table default updates untouched new rows while preserving an explicit row override', async () => {
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');
        const first = document.querySelector('[name="is_multilingual"]');
        first.closest('.column-row').querySelector('[name="data_type"]').value = 'TEXT';
        first.closest('.column-row').querySelector('[name="data_type"]').dispatchEvent(new Event('change'));
        first.click(); // User chooses a per-column exception.
        document.querySelector('[data-manage-table-key="manage_table_add_column"]').click();
        const second = [...document.querySelectorAll('[name="is_multilingual"]')].at(-1);
        const defaultInput = document.querySelector('[data-testid="manage-table-multilingual-default"]');
        defaultInput.click();
        expect([first.checked, second.checked]).toEqual([true, true]);
        defaultInput.click();
        expect([first.checked, second.checked]).toEqual([true, false]);
        document.querySelector('[data-manage-table-key="manage_table_add_column"]').click();
        expect([...document.querySelectorAll('[name="is_multilingual"]')].at(-1).checked).toBe(false);
    });

    test('saves only the changed table default and newly added text-column choices', async () => {
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');
        const defaultInput = document.querySelector('[data-testid="manage-table-multilingual-default"]');
        defaultInput.click();
        const add = document.querySelector('[data-manage-table-key="manage_table_add_column"]');
        const choices = [['title', 'TEXT', true], ['code', 'VARCHAR', false], ['when', 'DATE', true]];
        for (const [index, [name, type, multilingual]] of choices.entries()) {
            if (index) add.click();
            const input = [...document.querySelectorAll('[name="is_multilingual"]')].at(-1);
            const row = input.closest('.column-row');
            row.querySelector('[name="column_name"]').value = name;
            const typeSelect = row.querySelector('[name="data_type"]');
            typeSelect.value = 'TEXT';
            typeSelect.dispatchEvent(new Event('change'));
            input.checked = multilingual;
            input.dispatchEvent(new Event('change'));
            typeSelect.value = type;
            typeSelect.dispatchEvent(new Event('change'));
            if (type === 'VARCHAR') row.querySelector('[name="length"]').value = '30';
            if (type === 'DATE') {
                expect(input.disabled).toBe(true);
                expect(input.parentElement.style.display).toBe('none');
                typeSelect.value = 'TEXT';
                typeSelect.dispatchEvent(new Event('change'));
                expect(input.disabled).toBe(false);
                expect(input.checked).toBe(true);
                typeSelect.value = 'DATE';
                typeSelect.dispatchEvent(new Event('change'));
            }
        }
        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(refreshTableUnifiedMock).toHaveBeenCalledOnce());
        expect(endpointRouterMock).toHaveBeenCalledWith('modifyColumns', expect.objectContaining({
            body_data: {
                dataset_name: 'demo_table', new_columns_multilingual: true,
                modified_columns: [], removed_columns: [],
                added_columns: [
                    { original_name: '', new_name: 'title', data_type: 'TEXT', length: null, is_multilingual: true },
                    { original_name: '', new_name: 'code', data_type: 'VARCHAR', length: 30, is_multilingual: false },
                    { original_name: '', new_name: 'when', data_type: 'DATE', length: null },
                ],
                // A new column always carries its card role, as it does when a
                // dataset is created.
                column_card_roles: { title: 'details', code: 'details', when: 'details' },
            },
        }));
    });

    test('saves an explicit false table default without changing an existing multilingual column', async () => {
        fetchColumnsMock.mockResolvedValue([
            { column_name: 'title', data_type: 'TEXT', new_columns_multilingual: true, is_multilingual: true },
        ]);
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');
        document.querySelector('[data-testid="manage-table-multilingual-default"]').click();
        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(refreshTableUnifiedMock).toHaveBeenCalledOnce());
        expect(endpointRouterMock).toHaveBeenCalledWith('modifyColumns', expect.objectContaining({
            body_data: { dataset_name: 'demo_table', new_columns_multilingual: false,
                modified_columns: [], added_columns: [], removed_columns: [] },
        }));
    });

    test('language changes translate new multilingual controls without altering the draft choices', async () => {
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');
        const defaultInput = document.querySelector('[data-testid="manage-table-multilingual-default"]');
        const input = document.querySelector('[name="is_multilingual"]');
        const row = input.closest('.column-row');
        const type = row.querySelector('[name="data_type"]');
        type.value = 'TEXT';
        type.dispatchEvent(new Event('change'));
        input.click();
        input.focus();
        for (const [language, defaultLabel, rowLabel] of [
            ['fi', 'Uudet tekstisarakkeet ovat oletuksena monikielisiä', 'Monikielinen tekstisarake'],
            ['en', 'New text columns are multilingual by default', 'Multilingual text column'],
            ['ch', '新文本列默认支持多语言', '多语言文本列'],
            ['yue', '新文字欄位預設支援多語言', '多語言文字欄位'],
        ]) {
            document.documentElement.lang = language;
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(defaultInput.parentElement.querySelector('span').textContent).toBe(defaultLabel);
            expect(input.parentElement.querySelector('span').textContent).toBe(rowLabel);
            expect(defaultInput.checked).toBe(false);
            expect(input.checked).toBe(true);
            expect(document.activeElement).toBe(input);
        }
        expect(endpointRouterMock.mock.calls.filter(([route]) => route === 'modifyColumns')).toHaveLength(0);
    });

    test('restores only the exact hidden dataset and verifies readback', async () => {
        let hidden = true;
        endpointRouterMock.mockImplementation(async (route, options) => {
            // The dialog also reads the dataset's symbol; this test is about visibility.
            if (route === 'adminSymbols') return { symbols: [], datasets: [], fields: [] };
            if (route !== 'adminDatasetUiVisibility') throw new Error('unexpected route');
            if (options.method === 'POST') hidden = options.body_data.ui_hidden;
            return { dataset_name: 'demo_table', ui_hidden: hidden };
        });
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');
        const restore = document.querySelector('[data-testid="manage-table-restore"]');
        expect(restore.hidden).toBe(false);
        expect(endpointRouterMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
        restore.click();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(endpointRouterMock).toHaveBeenCalledWith('adminDatasetUiVisibility', expect.objectContaining({
            method: 'POST',
            body_data: { dataset_name: 'demo_table', ui_hidden: false },
        }));
        expect(restore.hidden).toBe(true);
        expect(document.querySelector('[data-testid="manage-table-visibility"]').hidden).toBe(true);
        expect(showSuccessToastMock).toHaveBeenCalledWith('Table restored to the interface.');
    });

    test('failed visibility lookup does not enable removal or claim a visible table', async () => {
        endpointRouterMock.mockResolvedValue({ dataset_name: 'demo_table' });
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');
        expect(document.querySelector('[data-testid="btn-delete-table"]').disabled).toBe(true);
        expect(document.querySelector('[data-testid="manage-table-restore"]').hidden).toBe(true);
        expect(document.querySelector('[role="status"]').textContent).toContain('Could not check visibility');
    });


    test('an existing column sends its card role only when the person changes it', async () => {
        fetchColumnsMock.mockResolvedValue([
            { column_name: 'title', data_type: 'TEXT', card_element: 'header' },
            { column_name: 'note', data_type: 'TEXT', card_element: 'details' },
        ]);
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');

        const rows = document.querySelectorAll('.column-row');
        expect(rows[0].querySelector('[name="card_role"]').value).toBe('header');
        rows[1].querySelector('[name="card_role"]').value = 'image';

        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 0));

        const body = endpointRouterMock.mock.calls
            .filter(([route]) => route === 'modifyColumns').at(-1)[1].body_data;
        expect(body.column_card_roles).toEqual({ note: 'image' });
    });

    test('a half-finished new row does not carry a role that would refuse the whole save', async () => {
        fetchColumnsMock.mockResolvedValue([
            { column_name: 'title', data_type: 'TEXT', card_element: 'header' },
        ]);
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');

        // The person names a new column but has not chosen its type yet.
        const newRow = document.querySelectorAll('.column-row')[1];
        newRow.querySelector('[name="column_name"]').value = 'not_finished_yet';
        // Meanwhile they do change an existing column's role, which must survive.
        document.querySelectorAll('.column-row')[0].querySelector('[name="card_role"]').value = 'image';

        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 0));

        const body = endpointRouterMock.mock.calls
            .filter(([route]) => route === 'modifyColumns').at(-1)[1].body_data;
        expect(body.added_columns).toEqual([]);
        expect(body.column_card_roles).toEqual({ title: 'image' });
    });

    test('a stored role variant is shown as itself, not flattened to the plain role', async () => {
        fetchColumnsMock.mockResolvedValue([
            { column_name: 'summary', data_type: 'TEXT', card_element: 'description1+lang_key' },
        ]);
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');

        const role = document.querySelector('.column-row [name="card_role"]');
        expect(role.value).toBe('description1+lang_key');

        // An untouched row still sends nothing.
        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 0));
        const body = endpointRouterMock.mock.calls
            .filter(([route]) => route === 'modifyColumns').at(-1)[1].body_data;
        expect(body.column_card_roles).toBeUndefined();
    });

    test('a saved schema change forgets the cached catalog so a new column is editable at once', async () => {
        localStorage.setItem('full_tree_data', JSON.stringify({ nodes: [], column_details: [] }));
        localStorage.setItem('full_tree_data_cached_at', String(Date.now()));
        fetchColumnsMock.mockResolvedValue([
            { column_name: 'title', data_type: 'TEXT', character_maximum_length: null },
        ]);
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');

        const newRow = document.querySelectorAll('.column-row')[1];
        newRow.querySelector('[name="column_name"]').value = 're_examine_date';
        const type = newRow.querySelector('[name="data_type"]');
        type.value = 'DATE';
        type.dispatchEvent(new Event('change'));

        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(localStorage.getItem('full_tree_data')).toBeNull();
        expect(localStorage.getItem('full_tree_data_cached_at')).toBeNull();
    });

    test('switching a column to a decimal type sends its two numbers', async () => {
        fetchColumnsMock.mockResolvedValue([
            { column_name: 'amount', data_type: 'TEXT', character_maximum_length: null },
        ]);
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');
        const row = document.querySelector('.column-row');
        const type = row.querySelector('[name="data_type"]');
        type.value = 'NUMERIC';
        type.dispatchEvent(new Event('change'));
        expect(row.querySelector('[name="precision"]').value).toBe('12');
        expect(row.querySelector('[name="scale"]').value).toBe('2');

        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(endpointRouterMock).toHaveBeenCalledWith('modifyColumns', expect.objectContaining({
            body_data: expect.objectContaining({
                modified_columns: [
                    { original_name: 'amount', new_name: 'amount', data_type: 'NUMERIC(12,2)', length: null },
                ],
            }),
        }));
    });

    test('preserves existing SQL types outside creation choices on an unchanged Save', async () => {
        fetchColumnsMock.mockResolvedValue([
            { column_name: 'created', data_type: 'timestamp without time zone', character_maximum_length: null },
            { column_name: 'amount', data_type: 'numeric', character_maximum_length: null },
        ]);
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');
        const choices = document.querySelectorAll('[name="data_type"]');
        expect(choices[0].value).toBe('TIMESTAMP WITHOUT TIME ZONE');
        expect(choices[1].value).toBe('NUMERIC');
        const form = document.querySelector('form');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(endpointRouterMock).toHaveBeenCalledWith('modifyColumns', expect.objectContaining({
            body_data: { dataset_name: 'demo_table', modified_columns: [], added_columns: [], removed_columns: [] },
        }));
    });

});
