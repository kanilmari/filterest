// column_manager_dataset_settings.test.js
// Verifies the dataset settings the Manage table dialog shares with dataset creation:
// deletion protection, folder, pictures, links to other datasets and the symbol.
// Exists so each setting is saved through its own route, and a refused one keeps the dialog open.
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

describe('open_column_management_modal: dataset settings', () => {
    beforeEach(resetColumnManagerTest);

    test('the deletion switch is shown and travels inside the schema request', async () => {
        answerEveryDatasetDimension();
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');

        const protection = document.querySelector('[data-testid="dataset-deletion-protection-input"]');
        await vi.waitFor(() => expect(protection.disabled).toBe(false));
        expect(protection.checked).toBe(false);
        protection.checked = true;

        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(refreshTableUnifiedMock).toHaveBeenCalledOnce());

        const [, saved] = endpointRouterMock.mock.calls
            .filter(([route, options]) => route === 'modifyColumns' && options?.method === 'POST').at(-1);
        expect(saved.body_data.prevent_deletion).toBe(true);
    });

    test('folder, pictures and a new link are saved through their own routes after the columns', async () => {
        answerEveryDatasetDimension();
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');

        const folder = document.querySelector('[data-testid="dataset-folder-select"]');
        await vi.waitFor(() => expect(folder.disabled).toBe(false));
        expect(folder.value).toBe('7');
        folder.value = '4';

        const pictures = document.querySelector('[data-testid="dataset-image-attachments-input"]');
        await vi.waitFor(() => expect(pictures.disabled).toBe(false));
        pictures.checked = true;

        const panel = document.querySelector('[data-testid="dataset-foreign-keys"]');
        panel.querySelector('[name="fk_referencing_column"]').value = 'legacy_col';
        const target = panel.querySelector('[name="fk_referenced_dataset"]');
        await vi.waitFor(() => expect(target.options.length).toBe(2));
        target.value = 'users';
        const targetColumn = panel.querySelector('[name="fk_referenced_column"]');
        targetColumn.appendChild(Object.assign(document.createElement('option'), { value: 'id' }));
        targetColumn.value = 'id';

        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(refreshTableUnifiedMock).toHaveBeenCalledOnce());

        const order = endpointRouterMock.mock.calls
            .filter(([, options]) => options?.method === 'POST')
            .map(([route]) => route);
        expect(order).toEqual(['modifyColumns', 'updateTableFolder', 'enableImageAssetLinking', 'addForeignKey']);
        expect(hideModalMock).toHaveBeenCalledTimes(1);
    });

    test('a setting the server refuses keeps the dialog open instead of hiding the problem', async () => {
        answerEveryDatasetDimension({
            updateTableFolder: () => { throw new Error('refused'); },
        });
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');

        const folder = document.querySelector('[data-testid="dataset-folder-select"]');
        await vi.waitFor(() => expect(folder.disabled).toBe(false));
        folder.value = '4';

        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(refreshTableUnifiedMock).toHaveBeenCalledOnce());

        expect(hideModalMock).not.toHaveBeenCalled();
        expect(showWarningToastMock).toHaveBeenCalledWith(
            'The columns were saved. One dataset setting still needs attention — see the message in the form.'
        );
        expect(document.querySelector('.dataset-folder-status').hidden).toBe(false);
    });


    // The dataset's symbol is read after the dialog opens. It must become what
    // a Save compares against, or "No symbol" looks like no change at all.
    const symbolRegistry = {
        symbols: [{ key: 'payments' }, { key: 'calendar' }],
        datasets: [{ dataset_name: 'demo_table', table_uid: 3470, icon_key: 'payments' }],
        fields: [],
    };
    const symbolWrites = () => endpointRouterMock.mock.calls
        .filter(([route, options]) => route === 'adminSymbols' && options?.method === 'POST')
        .map(([, options]) => options.body_data);

    async function openWithStoredSymbol(assign = () => ({ status: 'ok' })) {
        answerEveryDatasetDimension({
            adminSymbols: (options) => (options?.method === 'POST' ? assign(options) : symbolRegistry),
        });
        const mod = await loadModule();
        await mod.open_column_management_modal('demo_table');
        const select = document.querySelector('[data-testid="dataset-symbol-select"]');
        await vi.waitFor(() => expect(select.disabled).toBe(false));
        expect(select.value).toBe('payments');
        return select;
    }

    test('choosing No symbol removes the symbol the dataset had', async () => {
        const select = await openWithStoredSymbol();
        select.value = '';
        select.dispatchEvent(new Event('change'));

        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(refreshTableUnifiedMock).toHaveBeenCalledOnce());

        expect(symbolWrites()).toEqual([{ target_type: 'dataset', target_uid: 3470, icon_key: '' }]);
        expect(hideModalMock).toHaveBeenCalledTimes(1);
    });

    test('an untouched symbol is not written again on Save', async () => {
        await openWithStoredSymbol();
        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(refreshTableUnifiedMock).toHaveBeenCalledOnce());

        expect(symbolWrites()).toEqual([]);
        expect(hideModalMock).toHaveBeenCalledTimes(1);
    });

    test('a refused symbol keeps the dialog open and says so, instead of closing as saved', async () => {
        const select = await openWithStoredSymbol(() => { throw new Error('refused'); });
        select.value = 'calendar';
        select.dispatchEvent(new Event('change'));

        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(refreshTableUnifiedMock).toHaveBeenCalledOnce());

        expect(symbolWrites()).toEqual([{ target_type: 'dataset', target_uid: 3470, icon_key: 'calendar' }]);
        expect(hideModalMock).not.toHaveBeenCalled();
        expect(showWarningToastMock).toHaveBeenCalledWith(
            'The columns were saved. One dataset setting still needs attention — see the message in the form.'
        );
        const status = document.querySelector('.dataset-symbol-status');
        expect(status.hidden).toBe(false);
        // The message is the form's own copy for that language key.
        expect(status.textContent).toBe('The symbol could not be saved.');
    });
});
