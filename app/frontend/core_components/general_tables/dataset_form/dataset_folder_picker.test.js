// @vitest-environment jsdom
// dataset_folder_picker.test.js
// Verifies the dataset form's folder control in both modes, and its routes.
// Bridges the folder choices, the new-folder fields and the folder-move request.
// Exists so a dataset is placed deliberately: a new folder is made only when it
// is asked for and named, and a move is bound to the dataset's own identities.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: (...args) => endpointRouterMock(...args),
}));
vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback } = {}) => fallback,
}));

const {
    createDatasetFolderPicker, describeFolderConflict, moveDatasetToFolder, readNavigationTreeNodes,
} = await import('./dataset_folder_picker.js');

const options = [
    { value: '4', label: 'database', isCurrentProject: false },
    { value: '9', label: 'database / apps / fintravel', isCurrentProject: true },
    { value: '7', label: 'database / other_tables', isCurrentProject: false },
];

function mount(settings) {
    const picker = createDatasetFolderPicker(settings);
    document.body.appendChild(picker.element);
    return picker;
}
const byTestId = (picker, id) => picker.element.querySelector(`[data-testid="${id}"]`);

beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.lang = 'en';
    localStorage.clear();
    endpointRouterMock.mockReset();
});

describe('dataset folder control: creating', () => {
    test('offers every folder, names the current project and starts on the chosen default', async () => {
        const picker = mount({ allowNewFolder: true, choices: Promise.resolve({ options, selected: '9' }) });
        await picker.ready;

        expect(Array.from(picker.select.options).map((option) => option.textContent)).toEqual([
            'database', 'database / apps / fintravel (current project)', 'database / other_tables',
        ]);
        expect(picker.select.value).toBe('9');
        expect(picker.value()).toEqual({
            folderId: '9', newFolder: null, label: 'database / apps / fintravel', isCurrentProject: true,
        });
        expect(picker.element.textContent).toContain('Choose a folder for the new dataset');
    });

    test('the new folder fields stay out of sight until asked for, and then replace the choice', async () => {
        const picker = mount({ allowNewFolder: true, choices: Promise.resolve({ options, selected: '9' }) });
        await picker.ready;
        const toggle = byTestId(picker, 'dataset-new-folder-toggle');
        const name = byTestId(picker, 'dataset-new-folder-name');
        const parent = byTestId(picker, 'dataset-new-folder-parent');

        expect(name.closest('.dataset-new-folder').hidden).toBe(true);
        expect(toggle.textContent).toBe('New folder…');
        toggle.click();
        expect(name.closest('.dataset-new-folder').hidden).toBe(false);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(toggle.textContent).toBe("Don't create a new folder");
        expect(parent.value).toBe('9');
        expect(picker.select.disabled).toBe(true);
        expect(picker.element.textContent).toContain('Parent folder of the new folder');

        name.value = ' reports ';
        parent.value = '4';
        expect(picker.value()).toEqual({
            folderId: '', newFolder: { name: 'reports', parentId: '4' }, label: 'database / reports', isCurrentProject: false,
        });

        toggle.click();
        expect(picker.value()).toMatchObject({ folderId: '9', newFolder: null });
        expect(name.value).toBe('');
    });

    test('a parent chosen with no new folder name keeps the form from being sent', async () => {
        const picker = mount({ allowNewFolder: true, choices: Promise.resolve({ options, selected: '9' }) });
        await picker.ready;
        expect(picker.validate()).toBeNull();

        byTestId(picker, 'dataset-new-folder-toggle').click();
        const name = byTestId(picker, 'dataset-new-folder-name');
        byTestId(picker, 'dataset-new-folder-parent').value = '9';
        // Picking the parent first is fine; only sending the form asks for the name.
        expect(picker.element.querySelector('.dataset-new-folder-status').hidden).toBe(true);
        expect(name.required).toBe(true);
        // The browser's own reminder speaks the page's language, not the browser's.
        expect(name.validationMessage).toBe('Name the new folder, or choose not to create one.');

        expect(picker.validate()).toBe('dataset_new_folder_name_required');
        const status = picker.element.querySelector('.dataset-new-folder-status');
        expect(status.hidden).toBe(false);
        expect(status.textContent).toBe('Name the new folder, or choose not to create one.');
        expect(document.activeElement).toBe(name);

        name.value = 'reports';
        name.dispatchEvent(new Event('input'));
        expect(status.hidden).toBe(true);
        expect(name.validationMessage).toBe('');
        expect(picker.validate()).toBeNull();
    });

    test('an unreadable tree says so, and still lets the server choose the default', async () => {
        const picker = mount({ allowNewFolder: true, choices: Promise.reject(new Error('network')) });
        await picker.ready;
        expect(picker.select.disabled).toBe(true);
        expect(picker.element.querySelector('.dataset-folder-status').textContent).toBe('The folders could not be read.');
        expect(picker.value()).toEqual({ folderId: '', newFolder: null, label: '', isCurrentProject: false });
    });

    test('starting over closes the new folder and shows the folders as they are now', async () => {
        const picker = mount({ allowNewFolder: true, choices: Promise.resolve({ options, selected: '9' }) });
        await picker.ready;
        byTestId(picker, 'dataset-new-folder-toggle').click();
        byTestId(picker, 'dataset-new-folder-name').value = 'reports';

        const grown = [...options, { value: '12', label: 'database / apps / fintravel / reports', isCurrentProject: false }];
        await picker.reset(Promise.resolve({ options: grown, selected: '9' }));
        expect(picker.value()).toMatchObject({ folderId: '9', newFolder: null });
        expect(picker.select.options).toHaveLength(4);
    });
});

describe('dataset folder control: editing', () => {
    test('shows the dataset’s own folder and reports a move only when the choice changes', async () => {
        const picker = mount({ choices: Promise.resolve({ options, selected: '7' }) });
        await picker.ready;
        expect(byTestId(picker, 'dataset-new-folder-toggle')).toBeNull();
        expect(picker.select.value).toBe('7');
        expect(picker.changed()).toBe(false);
        picker.select.value = '9';
        expect(picker.changed()).toBe(true);
        picker.accept();
        expect(picker.changed()).toBe(false);
    });

    test('a dataset the tree does not place cannot be moved', async () => {
        const picker = mount({ choices: Promise.resolve({ options, selected: '' }) });
        await picker.ready;
        expect(picker.select.disabled).toBe(true);
        expect(picker.changed()).toBe(false);
        expect(picker.element.querySelector('.dataset-folder-status').textContent).toBe('The folders could not be read.');
    });

    test('a move the server questions is offered again with its own explanation', async () => {
        const picker = mount({ choices: Promise.resolve({ options, selected: '7' }) });
        await picker.ready;
        const confirm = vi.fn(async () => picker.accept());
        picker.offerConfirmation('Move table "blogs" to the project root?', confirm);
        const button = byTestId(picker, 'dataset-folder-confirm');
        expect(button.hidden).toBe(false);
        expect(picker.element.querySelector('.dataset-folder-status').textContent)
            .toBe('Move table "blogs" to the project root?');
        button.click();
        await vi.waitFor(() => expect(button.hidden).toBe(true));
        expect(confirm).toHaveBeenCalledOnce();
    });
});

describe('dataset folder routes', () => {
    test('a move is bound to both identities the dataset carries', async () => {
        endpointRouterMock.mockResolvedValue({ message: 'ok' });
        await moveDatasetToFolder({ itemId: 91, datasetUID: 3470 }, '4', { confirmed: true });
        expect(endpointRouterMock).toHaveBeenCalledWith('updateTableFolder', {
            method: 'POST',
            body_data: {
                item_id: 91, item_type: 'table', dataset_uid: 3470, new_folder_id: 4,
                confirm_cross_project_move: true, confirm_tab_visibility_change: true,
            },
            suppressErrorToast: true,
        });
    });

    test('the server’s question is read without the route noise', () => {
        expect(describeFolderConflict(new Error('Virhe pyynnössä (updateTableFolder): Move it?'))).toBe('Move it?');
    });

    test('a cached tree still names the folders when the server cannot answer', async () => {
        localStorage.setItem('full_tree_data', JSON.stringify({ nodes: [{ id: 'f_4' }] }));
        endpointRouterMock.mockRejectedValueOnce(new Error('network'));
        expect(await readNavigationTreeNodes()).toEqual([{ id: 'f_4' }]);
    });
});
