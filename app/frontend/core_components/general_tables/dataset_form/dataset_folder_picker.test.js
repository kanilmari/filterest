// @vitest-environment jsdom
// dataset_folder_picker.test.js
// Verifies the folder control the dataset forms share.
// Bridges the navigation tree, the chosen folder and the folder-move request.
// Exists so a dataset is moved deliberately, and never by a guessed identity.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: (...args) => endpointRouterMock(...args),
}));
vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback } = {}) => fallback,
}));

const { createDatasetFolderPicker, datasetFolderCopy, findDatasetPlacement } = await import(
    './dataset_folder_picker.js'
);

const nodes = [
    { id: 'f_4', name: 'database', parent_id: 'null', db_id: 4 },
    { id: 'f_7', name: 'other_tables', parent_id: 'f_4', db_id: 7 },
    { id: 't_subscriptions', name: 'subscriptions', parent_id: 'f_7', db_id: 91, table_uid: '3470' },
];

beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    endpointRouterMock.mockReset();
    endpointRouterMock.mockResolvedValue({ nodes });
});

describe('dataset folder picker', () => {
    test('reports where a dataset sits, and stays silent about one it cannot find', () => {
        expect(findDatasetPlacement(nodes, 'subscriptions'))
            .toEqual({ folderId: '7', itemId: 91, datasetUID: 3470 });
        expect(findDatasetPlacement(nodes, 'unknown_dataset'))
            .toEqual({ folderId: '', itemId: 0, datasetUID: 0 });
    });

    test('offers every folder and preselects the dataset’s own', async () => {
        const picker = createDatasetFolderPicker({ datasetName: 'subscriptions' });
        document.body.appendChild(picker.element);
        await picker.ready;

        expect(Array.from(picker.select.options).map((option) => option.textContent))
            .toEqual(['database', 'database / other_tables']);
        expect(picker.select.value).toBe('7');
        expect(picker.changed()).toBe(false);
        expect(picker.select.disabled).toBe(false);
    });

    test('a dataset the tree does not describe cannot be moved', async () => {
        const picker = createDatasetFolderPicker({ datasetName: 'unknown_dataset' });
        document.body.appendChild(picker.element);
        await picker.ready;

        expect(picker.select.disabled).toBe(true);
        expect(picker.element.querySelector('.dataset-folder-status').textContent)
            .toBe(datasetFolderCopy().unavailable);
        expect(await picker.save()).toBe('unchanged');
    });

    test('moving binds the request to both identities the dataset carries', async () => {
        const picker = createDatasetFolderPicker({ datasetName: 'subscriptions' });
        document.body.appendChild(picker.element);
        await picker.ready;

        expect(await picker.save()).toBe('unchanged');
        picker.select.value = '4';
        expect(picker.changed()).toBe(true);
        expect(await picker.save()).toBe('saved');
        expect(endpointRouterMock).toHaveBeenCalledWith('updateTableFolder', {
            method: 'POST',
            body_data: {
                item_id: 91,
                item_type: 'table',
                dataset_uid: 3470,
                new_folder_id: 4,
                confirm_cross_project_move: false,
                confirm_tab_visibility_change: false,
            },
            suppressErrorToast: true,
        });
        // Saving twice must not repeat the same move.
        expect(await picker.save()).toBe('unchanged');
    });

    test('a move the server questions is offered again with its own explanation', async () => {
        const picker = createDatasetFolderPicker({ datasetName: 'subscriptions' });
        document.body.appendChild(picker.element);
        await picker.ready;

        const conflict = new Error('Virhe pyynnössä (updateTableFolder): Move table "subscriptions" to the project root?');
        conflict.status = 409;
        endpointRouterMock.mockRejectedValueOnce(conflict);
        picker.select.value = '4';

        expect(await picker.save()).toBe('needs_confirmation');
        const confirmButton = picker.element.querySelector('[data-testid="dataset-folder-confirm"]');
        expect(confirmButton.hidden).toBe(false);
        expect(picker.element.querySelector('.dataset-folder-status').textContent)
            .toBe('Move table "subscriptions" to the project root?');

        endpointRouterMock.mockResolvedValueOnce({ message: 'ok' });
        confirmButton.click();
        await vi.waitFor(() => expect(confirmButton.hidden).toBe(true));
        expect(endpointRouterMock).toHaveBeenLastCalledWith('updateTableFolder', expect.objectContaining({
            body_data: expect.objectContaining({
                confirm_cross_project_move: true,
                confirm_tab_visibility_change: true,
            }),
        }));
    });

    test('an unreadable tree says so instead of offering a wrong placement', async () => {
        endpointRouterMock.mockRejectedValue(new Error('network'));
        const picker = createDatasetFolderPicker({ datasetName: 'subscriptions' });
        document.body.appendChild(picker.element);
        await picker.ready;

        expect(picker.select.disabled).toBe(true);
        expect(picker.element.querySelector('.dataset-folder-status').textContent)
            .toBe(datasetFolderCopy().unavailable);
    });

    test('a cached tree still names the folders when the server cannot answer', async () => {
        localStorage.setItem('full_tree_data', JSON.stringify({ nodes }));
        endpointRouterMock.mockRejectedValueOnce(new Error('network'));
        const picker = createDatasetFolderPicker({ datasetName: 'subscriptions' });
        document.body.appendChild(picker.element);
        await picker.ready;

        expect(picker.select.value).toBe('7');
        expect(picker.select.disabled).toBe(false);
    });
});
