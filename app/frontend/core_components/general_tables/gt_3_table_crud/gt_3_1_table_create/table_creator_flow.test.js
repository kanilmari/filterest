// @vitest-environment jsdom
// table_creator_flow.test.js
// Verifies the whole creation flow of the dataset form on the "Create table"
// page: where a new dataset goes, what the person is told, and what the page
// refreshes.
// Exists because a dataset created on fintravel.fi landed unnoticed in
// database / other_tables: the site navigation lists only the datasets directly
// in the current project's folder, and a new folder's parent was chosen with no
// name. The form now defaults to the project folder, refuses a nameless new
// folder, and says where every new dataset went.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
const showSuccessToastMock = vi.fn();
const showWarningToastMock = vi.fn();
const initializeTreeCallAdminMock = vi.fn();
const initTabsMock = vi.fn();
const openNavTabMock = vi.fn();

vi.mock('../../../endpoints/endpoint_router.js', () => ({
    endpoint_router: (...args) => endpointRouterMock(...args),
}));
vi.mock('../../../endpoints/endpoint_column_fetcher.js', () => ({ fetch_columns_for_table: vi.fn().mockResolvedValue([]) }));
vi.mock('../../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback } = {}) => fallback ?? key,
}));
vi.mock('../../../vanilla_tree/van_tr_components/admin_tree_builder.js', () => ({
    initializeTreeCallAdmin: (...args) => initializeTreeCallAdminMock(...args),
}));
vi.mock('../../../navigation/main_tabs/main_tab_printer.js', () => ({
    initTabs: (...args) => initTabsMock(...args),
    openNavTab: (...args) => openNavTabMock(...args),
}));
vi.mock('../../../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showToast: vi.fn(),
    showSuccessToast: (...args) => showSuccessToastMock(...args),
    showWarningToast: (...args) => showWarningToastMock(...args),
}));

const { generate_table_creation_view } = await import('./table_creator.js');

const nodes = [
    { id: 'f_1', db_id: 1, name: 'database', parent_id: 'null' },
    { id: 'f_4', db_id: 4, name: 'apps', parent_id: 'f_1' },
    { id: 'f_14', db_id: 14, name: 'other_tables', parent_id: 'f_1' },
    { id: 'f_10000', db_id: 10000, name: 'fintravel', parent_id: 'f_4', is_current_project: true },
];

let createAnswer;
function answer({ createDataset } = {}) {
    createAnswer = createDataset ?? ((options) => ({
        message: 'Dataset created.',
        dataset_name: options.body_data.dataset_name,
        table_uid: 10044,
        folder_id: options.body_data.folder_id ?? 10000,
        folder_path: options.body_data.folder_id === 14 ? 'database / other_tables' : 'database / apps / fintravel',
        in_site_navigation: options.body_data.folder_id !== 14,
    }));
    endpointRouterMock.mockImplementation(async (route, options) => {
        if (route === 'fetchTreeData') return { nodes };
        if (route === 'datasetNames') return ['users'];
        if (route === 'adminSymbols') return { symbols: [], datasets: [] };
        if (route === 'createDataset') return createAnswer(options);
        return { message: 'ok' };
    });
}
const createRequests = () => endpointRouterMock.mock.calls
    .filter(([route]) => route === 'createDataset').map(([, options]) => options.body_data);

async function openForm() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await generate_table_creation_view(host);
    const form = host.querySelector('form');
    const find = (testid) => form.querySelector(`[data-testid="${testid}"]`);
    return { form, find };
}
const send = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

beforeEach(() => {
    document.body.replaceChildren();
    document.documentElement.lang = 'en';
    localStorage.clear();
    for (const mock of [endpointRouterMock, showSuccessToastMock, showWarningToastMock, openNavTabMock]) mock.mockReset();
    initializeTreeCallAdminMock.mockReset().mockResolvedValue();
    initTabsMock.mockReset().mockResolvedValue();
    answer();
});

describe('creating a dataset: where it goes', () => {
    test('a new dataset goes into the current project folder, is announced there and appears in the tabs', async () => {
        const { form, find } = await openForm();
        expect(find('dataset-folder-select').value).toBe('10000');
        expect(find('dataset-folder-select').selectedOptions[0].textContent).toBe('database / apps / fintravel (current project)');

        find('dataset-name-input').value = 'blogs';
        send(form);
        await vi.waitFor(() => expect(find('dataset-name-input').value).toBe(''));

        expect(createRequests()[0]).toMatchObject({ dataset_name: 'blogs', folder_id: 10000, create_folder: null });
        const result = find('dataset-form-result');
        expect(result.hidden).toBe(false);
        expect(result.textContent).toContain('Dataset blogs was created in the folder database / apps / fintravel.');
        expect(result.querySelector('.dataset-form-result-warning')).toBeNull();
        expect(showSuccessToastMock).toHaveBeenCalledWith('Dataset blogs was created in the folder database / apps / fintravel.');

        // The admin tree and the main tabs both show it at once, and the person
        // stays on this page.
        expect(initializeTreeCallAdminMock).toHaveBeenCalledWith({ forceRefresh: true });
        expect(initTabsMock).toHaveBeenCalledWith({ dataAlreadyLoaded: true });

        find('dataset-form-open-dataset').click();
        expect(openNavTabMock).toHaveBeenCalledWith('blogs');

        // The form starts over for the next dataset.
        expect(find('dataset-folder-select').value).toBe('10000');
        expect(form.querySelectorAll('.dataset-column-table__row')).toHaveLength(4);
    });

    test('a dataset placed outside the project folder is created with a warning that the navigation will not list it', async () => {
        const { form, find } = await openForm();
        find('dataset-name-input').value = 'archive';
        find('dataset-folder-select').value = '14';
        send(form);
        await vi.waitFor(() => expect(find('dataset-form-result').hidden).toBe(false));

        expect(createRequests()[0].folder_id).toBe(14);
        const warning = find('dataset-form-result').querySelector('.dataset-form-result-warning');
        expect(warning.textContent).toContain('It will not appear in the site navigation');
        expect(find('dataset-form-result').textContent).toContain('database / other_tables');
    });
});

describe('creating a dataset: a new folder', () => {
    test('a parent chosen with no new folder name is refused before anything is sent', async () => {
        const { form, find } = await openForm();
        find('dataset-name-input').value = 'blogs';
        find('dataset-new-folder-toggle').click();
        find('dataset-new-folder-parent').value = '10000';
        send(form);
        await vi.waitFor(() => expect(showWarningToastMock).toHaveBeenCalledWith(
            'Name the new folder, or choose not to create one.'));

        expect(createRequests()).toEqual([]);
        expect(form.querySelector('.dataset-new-folder-status').hidden).toBe(false);

        find('dataset-new-folder-name').value = 'blog_posts';
        send(form);
        await vi.waitFor(() => expect(createRequests()).toHaveLength(1));
        expect(createRequests()[0]).toMatchObject({
            folder_id: null, create_folder: { folder_name: 'blog_posts', parent_id: 10000 },
        });
    });

    test('closing the new folder again leaves the folder choice in charge', async () => {
        const { form, find } = await openForm();
        find('dataset-name-input').value = 'blogs';
        find('dataset-new-folder-toggle').click();
        find('dataset-new-folder-toggle').click();
        send(form);
        await vi.waitFor(() => expect(createRequests()).toHaveLength(1));
        expect(createRequests()[0]).toMatchObject({ folder_id: 10000, create_folder: null });
    });
});

describe('creating a dataset: sending once', () => {
    test('a second Save while the first is under way sends nothing', async () => {
        let release;
        answer({ createDataset: () => new Promise((resolve) => { release = () => resolve({ dataset_name: 'blogs' }); }) });
        const { form, find } = await openForm();
        find('dataset-name-input').value = 'blogs';
        send(form);
        send(form);
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        expect(find('dataset-form-submit').disabled).toBe(true);
        release();
        await vi.waitFor(() => expect(find('dataset-form-submit').disabled).toBe(false));
        expect(createRequests()).toHaveLength(1);
    });

    test('after a created dataset whose symbol was refused, Save again creates no second dataset', async () => {
        endpointRouterMock.mockImplementation(async (route, options) => {
            if (route === 'fetchTreeData') return { nodes };
            if (route === 'adminSymbols' && options?.method === 'POST') throw new Error('refused');
            if (route === 'adminSymbols') return { symbols: [{ key: 'article' }], datasets: [] };
            if (route === 'createDataset') return createAnswer(options);
            return [];
        });
        const { form, find } = await openForm();
        await vi.waitFor(() => expect(find('dataset-symbol-select').options).toHaveLength(2));
        find('dataset-name-input').value = 'blogs';
        find('dataset-symbol-select').value = 'article';
        send(form);
        await vi.waitFor(() => expect(find('dataset-name-input').value).toBe(''));
        expect(showWarningToastMock).toHaveBeenCalledWith(
            "The dataset was created, but one of its settings was not saved — see the message in the form. You can save it in the dataset's Manage table dialog.");
        expect(form.querySelector('.dataset-symbol-status').textContent).toBe('The symbol could not be saved.');

        send(form);
        await vi.waitFor(() => expect(showWarningToastMock).toHaveBeenCalledWith('A dataset name is required.'));
        expect(createRequests()).toHaveLength(1);
    });
});
