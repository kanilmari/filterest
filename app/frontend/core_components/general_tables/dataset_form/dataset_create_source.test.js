// dataset_create_source.test.js
// Verifies the dataset form's creation adapter: what a new dataset starts from,
// and how its draft is sent — the create request first, then the symbol and
// pictures, which need the dataset to exist.
// Exists so a created dataset is acknowledged before anything later can fail,
// and a refused later step never repeats or undoes the creation.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: (...args) => endpointRouterMock(...args),
}));
vi.mock('../../endpoints/endpoint_column_fetcher.js', () => ({ fetch_columns_for_table: vi.fn() }));

const { createDatasetCreateSource, describeCreatedDataset, readNewDatasetFolderChoices } =
    await import('./dataset_create_source.js');

const nodes = [
    { id: 'f_1', db_id: 1, name: 'database', parent_id: 'null' },
    { id: 'f_14', db_id: 14, name: 'other_tables', parent_id: 'f_1' },
    { id: 'f_10000', db_id: 10000, name: 'fintravel', parent_id: 'f_1', is_current_project: true },
];
const created = {
    message: 'Dataset created.', dataset_name: 'blogs', table_uid: 10044,
    folder_id: 10000, folder_path: 'database / fintravel', in_site_navigation: true,
};

function answer(overrides = {}) {
    endpointRouterMock.mockImplementation(async (route, options) => {
        if (overrides[route]) return overrides[route](options);
        if (route === 'fetchTreeData') return { nodes };
        if (route === 'createDataset') return created;
        if (route === 'adminSymbols') return { symbols: [], datasets: [{ dataset_name: 'blogs', table_uid: 10044 }] };
        return { message: 'ok' };
    });
}
const posts = () => endpointRouterMock.mock.calls
    .filter(([, options]) => options?.method === 'POST').map(([route]) => route);
const draft = (overrides = {}) => ({
    name: 'blogs',
    columns: [{ name: 'id', dataType: 'SERIAL' }, { name: 'title', dataType: 'TEXT' }],
    links: [], readers: {}, symbol: '', images: false,
    folder: { folderId: '10000', newFolder: null, label: 'database / fintravel', isCurrentProject: true },
    ...overrides,
});

beforeEach(() => {
    endpointRouterMock.mockReset();
    answer();
});

describe('dataset creation adapter', () => {
    test('a new dataset starts from the automatic columns, one blank row and the project folder', async () => {
        const source = createDatasetCreateSource();
        expect(source.initialColumns.map((column) => column.name ?? '')).toEqual(['id', 'created', 'updated', '']);
        expect(await readNewDatasetFolderChoices()).toMatchObject({ selected: '10000' });
    });

    test('an invalid draft sends nothing', async () => {
        const outcome = await createDatasetCreateSource().save(draft({
            folder: { folderId: '', newFolder: { name: '', parentId: '10000' } },
        }));
        expect(outcome).toEqual({ status: 'invalid', warningKey: 'dataset_new_folder_name_required', field: 'folder' });
        expect(posts()).toEqual([]);
    });

    test('the dataset is created, then given its symbol and pictures, and says where it went', async () => {
        const outcome = await createDatasetCreateSource().save(draft({ symbol: 'article', images: true }));
        expect(posts()).toEqual(['createDataset', 'adminSymbols', 'enableImageAssetLinking']);
        // The server named the new dataset, so its identity needs no lookup.
        expect(endpointRouterMock.mock.calls.filter(([route, options]) => route === 'adminSymbols' && !options?.method))
            .toHaveLength(0);
        expect(outcome).toEqual({
            status: 'created',
            dataset: {
                name: 'blogs', tableUID: 10044, folderId: '10000', folderPath: 'database / fintravel', inSiteNavigation: true,
            },
            settings: { symbol: 'saved', images: 'saved' },
        });
    });

    test('a refused creation stops there, with nothing set up for a dataset that does not exist', async () => {
        answer({ createDataset: () => { throw new Error('route taken'); } });
        const outcome = await createDatasetCreateSource().save(draft({ symbol: 'article', images: true }));
        expect(outcome.status).toBe('failed');
        expect(posts()).toEqual(['createDataset']);
    });

    test('a refused symbol or picture setting is reported without repeating the creation', async () => {
        answer({
            adminSymbols: (options) => { if (options?.method === 'POST') throw new Error('refused'); return {}; },
            enableImageAssetLinking: () => { throw new Error('refused'); },
        });
        const outcome = await createDatasetCreateSource().save(draft({ symbol: 'article', images: true }));
        expect(outcome.status).toBe('created');
        expect(outcome.settings).toEqual({ symbol: 'failed', images: 'failed' });
        expect(posts().filter((route) => route === 'createDataset')).toHaveLength(1);
    });

    test('an older server that answers with a sentence still names the chosen folder', async () => {
        answer({ createDataset: () => 'Taulu luotu onnistuneesti' });
        const outcome = await createDatasetCreateSource().save(draft({ symbol: 'article' }));
        expect(outcome.dataset).toEqual({
            name: 'blogs', tableUID: 0, folderId: '10000', folderPath: 'database / fintravel', inSiteNavigation: true,
        });
        // Without the identity in the answer, the new dataset is looked up once.
        expect(outcome.settings.symbol).toBe('saved');
        expect(endpointRouterMock).toHaveBeenCalledWith('adminSymbols', expect.objectContaining({
            body_data: { target_type: 'dataset', target_uid: 10044, icon_key: 'article' },
        }));
    });

    test('the server’s own report of the folder wins over the form’s choice', () => {
        expect(describeCreatedDataset(
            { dataset_name: 'blogs', folder_id: 14, folder_path: 'database / other_tables', in_site_navigation: false },
            'blogs', { folderId: '10000', label: 'database / fintravel', isCurrentProject: true },
        )).toMatchObject({ folderId: '14', folderPath: 'database / other_tables', inSiteNavigation: false });
    });
});
