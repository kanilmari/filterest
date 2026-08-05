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
        vi.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
        document.body.innerHTML = '';

        fetchColumnsMock.mockResolvedValue([
            { column_name: 'legacy_col', data_type: 'TEXT', character_maximum_length: null },
            { column_name: 'gone_col', data_type: 'TEXT', character_maximum_length: null },
        ]);
        endpointRouterMock.mockResolvedValue({ message: 'ok' });
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
        });
        expect(JSON.parse(localStorage.getItem('demo_table_hide_columns'))).toEqual({
            modern_col: true,
            untouched: true,
        });
        expect(JSON.parse(localStorage.getItem('demo_table_open_filters'))).toEqual([
            'modern_col',
        ]);
    });
});
