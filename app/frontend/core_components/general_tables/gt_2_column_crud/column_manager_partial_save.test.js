// column_manager_partial_save.test.js
// Verifies what a retry sends after a partly saved dataset definition.
// Exists so a retry never repeats column changes the server already made, and
// never loses the ones it refused.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
    answerEveryDatasetDimension,
    endpointRouterMock,
    hideModalMock,
    loadModule,
    refreshTableUnifiedMock,
    showWarningToastMock,
    resetColumnManagerTest,
} from './column_manager_test_setup.js';

describe('open_column_management_modal: retry after a partial save', () => {
    beforeEach(resetColumnManagerTest);

    // The columns are saved first; a later setting can still be refused, which
    // keeps the dialog open for a retry. The retry must not repeat column
    // changes the server already made — it would be refused for them, and take
    // the settings still waiting to be saved down with it.
    test('a retry after a refused setting does not repeat column changes already saved', async () => {
        let folderAttempts = 0;
        answerEveryDatasetDimension({
            updateTableFolder: () => {
                folderAttempts += 1;
                if (folderAttempts === 1) throw new Error('refused');
                return { message: 'ok' };
            },
        });
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');

        const folder = document.querySelector('[data-testid="dataset-folder-select"]');
        await vi.waitFor(() => expect(folder.disabled).toBe(false));
        folder.value = '4';

        const rows = document.querySelectorAll('.dataset-column-table__row');
        rows[0].querySelector('[name="column_name"]').value = 'modern_col';
        rows[0].querySelector('[name="card_role"]').value = 'header';
        rows[1].querySelector('.dataset-column-table__remove').click();
        const newRow = rows[2];
        newRow.querySelector('[name="column_name"]').value = 'fresh_col';
        const newType = newRow.querySelector('[name="data_type"]');
        newType.value = 'VARCHAR';
        newType.dispatchEvent(new Event('change'));
        newRow.querySelector('[name="length"]').value = '40';
        document.querySelector('[data-testid="manage-table-multilingual-default"]').click();

        const form = document.querySelector('form');
        const schemaRequests = () => endpointRouterMock.mock.calls
            .filter(([route, options]) => route === 'modifyColumns' && options?.method === 'POST')
            .map(([, options]) => options.body_data);

        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(refreshTableUnifiedMock).toHaveBeenCalledTimes(1));
        expect(hideModalMock).not.toHaveBeenCalled();
        expect(schemaRequests()[0]).toEqual({
            dataset_name: 'demo_table',
            modified_columns: [{ original_name: 'legacy_col', new_name: 'modern_col', data_type: 'TEXT', length: null }],
            added_columns: [{
                original_name: '', new_name: 'fresh_col', data_type: 'VARCHAR', length: 40, is_multilingual: true,
            }],
            removed_columns: ['gone_col'],
            column_card_roles: { modern_col: 'header', fresh_col: 'details' },
            new_columns_multilingual: true,
        });

        // The saved new column is now an existing one, and is shown as such.
        expect(newRow.querySelector('[name="column_name"]').dataset.originalName).toBe('fresh_col');
        expect(newRow.dataset.rowState).toBe('existing');
        expect(newRow.querySelector('[name="is_multilingual"]')).toBeNull();

        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(refreshTableUnifiedMock).toHaveBeenCalledTimes(2));

        expect(schemaRequests()[1]).toEqual({
            dataset_name: 'demo_table', modified_columns: [], added_columns: [], removed_columns: [],
        });
        expect(folderAttempts).toBe(2);
        expect(hideModalMock).toHaveBeenCalledTimes(1);
    });

    test('after a partial save, a further change is made to the column as it is now named', async () => {
        answerEveryDatasetDimension({
            updateTableFolder: () => { throw new Error('refused'); },
        });
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');

        const folder = document.querySelector('[data-testid="dataset-folder-select"]');
        await vi.waitFor(() => expect(folder.disabled).toBe(false));
        folder.value = '4';
        const nameInput = document.querySelector('.dataset-column-table__row [name="column_name"]');
        nameInput.value = 'modern_col';

        const form = document.querySelector('form');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(refreshTableUnifiedMock).toHaveBeenCalledTimes(1));

        nameInput.value = 'newest_col';
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(refreshTableUnifiedMock).toHaveBeenCalledTimes(2));

        const [, second] = endpointRouterMock.mock.calls
            .filter(([route, options]) => route === 'modifyColumns' && options?.method === 'POST');
        expect(second[1].body_data.modified_columns).toEqual([
            { original_name: 'modern_col', new_name: 'newest_col', data_type: 'TEXT', length: null },
        ]);
    });

    test('a refused schema change keeps every column change for the retry', async () => {
        let schemaAttempts = 0;
        answerEveryDatasetDimension({
            modifyColumns: (options) => {
                if (options?.method !== 'POST') return { dataset_name: 'demo_table', prevent_deletion: false };
                schemaAttempts += 1;
                if (schemaAttempts === 1) throw new Error('refused');
                return { message: 'ok' };
            },
        });
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');
        document.querySelector('.dataset-column-table__row [name="column_name"]').value = 'modern_col';

        const form = document.querySelector('form');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(showWarningToastMock).toHaveBeenCalledWith(
            'Could not save changes. Check the values and try again.'
        ));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(refreshTableUnifiedMock).toHaveBeenCalledTimes(1));

        const requests = endpointRouterMock.mock.calls
            .filter(([route, options]) => route === 'modifyColumns' && options?.method === 'POST')
            .map(([, options]) => options.body_data.modified_columns);
        const rename = [{ original_name: 'legacy_col', new_name: 'modern_col', data_type: 'TEXT', length: null }];
        expect(requests).toEqual([rename, rename]);
    });
});
