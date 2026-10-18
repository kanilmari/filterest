// @vitest-environment jsdom
// dataset_edit_read_permissions.test.js
// Exercises the real editor adapter, read control and permission-diff builder.
// Connects loaded grants and checkbox choices to the outgoing save requests.
// Protects complete read withdrawal and untouched groups during an editor save.
import { beforeEach, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
const functions = [
    'dtt_1_row_read.GetResultsHandlerWrapper',
    'dtt_1_row_read.GetIntelligentResultsHandlerWrapper',
    'dtt_1_row_read.GetRowCountHandlerWrapper',
    'dtt_1_row_read.GetFilterOptionsHandler',
    'dtt_1_row_read.GetDynamicChildItemsHandler',
    'dtt_1_row_read.GetResultsVector',
    'dtt_2_column_crud.GetTableColumnsHandler',
    'dtt_3_table_read.GetTableViewHandlerWrapper',
].map((name, index) => ({ name, id: index + 1 }));
const ordinaryIds = [1, 3, 4, 5, 7, 8];
const allReadIds = [1, 2, 3, 4, 5, 6, 7, 8];
const tableUID = 3470;
let storedPermissions;

vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: (...args) => endpointRouterMock(...args),
}));
vi.mock('../../endpoints/endpoint_column_fetcher.js', () => ({
    fetch_columns_for_table: async () => [{ column_name: 'title', data_type: 'text', new_columns_multilingual: false }],
}));
vi.mock('../../admin_tools/permission_checker.js', () => ({
    fetch_all_functions: async () => functions,
    fetch_user_groups: async () => [{ id: 3, name: 'users' }, { id: 4, name: 'guests' }],
}));
vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback } = {}) => fallback,
}));
vi.mock('../../table_views/tree_view/tree_view_printer.js', () => ({ invalidateDatabaseCatalogTreeCache: vi.fn() }));
vi.mock('../gt_2_column_crud/dataset_ui_visibility.js', () => ({
    getDatasetUIVisibility: async () => false, setDatasetUIVisibility: vi.fn(),
}));
vi.mock('./dataset_folder_picker.js', () => ({
    readNavigationTreeNodes: async () => [], describeFolderConflict: vi.fn(), moveDatasetToFolder: vi.fn(),
}));
vi.mock('./dataset_symbol_picker.js', () => ({
    readDatasetSymbol: async () => ({ tableUID: 3470, iconKey: '' }), assignDatasetSymbol: vi.fn(),
}));
vi.mock('./dataset_image_attachments.js', () => ({
    readImageAttachmentState: async () => false, setImageAttachments: vi.fn(),
}));
vi.mock('./dataset_deletion_protection.js', () => ({ readDeletionProtection: async () => false }));
vi.mock('./dataset_foreign_keys_panel.js', () => ({
    readDatasetForeignKeys: async () => [], addDatasetForeignKey: vi.fn(),
}));

const { createDatasetEditSource } = await import('./dataset_edit_source.js');
const { createDatasetGroupReadControl } = await import('./dataset_group_read_access.js');

const rightsFor = (groupId, ids) => ids.map((function_id) => ({
    user_group_id: groupId, function_id, target_table_uid: tableUID,
    target_schema_name: 'public', target_dataset_name: 'subscriptions',
}));
const permissionWrites = () => endpointRouterMock.mock.calls
    .filter(([route, options]) => route === 'datasetPermissions' && options?.method === 'PATCH');
const permissionReads = () => endpointRouterMock.mock.calls
    .filter(([route, options]) => route === 'datasetPermissions' && !options?.method);

// permissions_handlers.go:231 compares group/function/UID and both sides of
// COALESCE(NULLIF(target_schema_name,''),'public'); names do not participate.
const deleteSchema = ({ target_schema_name: schema }) => schema == null || schema === '' ? 'public' : schema;

async function openEditor() {
    const source = await createDatasetEditSource('subscriptions');
    const reads = source.load();
    const readers = createDatasetGroupReadControl({ stored: reads.readers });
    document.body.appendChild(readers.element);
    await Promise.all([...Object.values(reads), readers.ready]);
    const unchanged = () => ({ changed: () => false, accept: vi.fn(), reportFailure: vi.fn() });
    const controls = {
        readers, deletion: unchanged(), symbol: unchanged(), folder: unchanged(), images: unchanged(), links: unchanged(),
    };
    const save = () => source.save({
        columns: [{ originalName: 'title', name: 'title', dataType: 'TEXT', role: '', roleChanged: false }],
        multilingualDefault: false, readers: readers.value(), links: [], images: false,
    }, controls);
    return { readers, save };
}

beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.lang = 'en';
    storedPermissions = rightsFor(3, allReadIds);
    endpointRouterMock.mockReset().mockImplementation(async (route, options) => {
        if (route === 'datasetPermissions' && !options?.method) return structuredClone(storedPermissions);
        if (route === 'datasetPermissions' && options?.method === 'PATCH') {
            const { add, remove } = options.body_data;
            storedPermissions = storedPermissions.filter((row) => !remove.some((removed) =>
                row.user_group_id === removed.user_group_id && row.function_id === removed.function_id
                && deleteSchema(row) === deleteSchema(removed)
                && row.target_table_uid === removed.target_table_uid));
            storedPermissions.push(...structuredClone(add));
        }
        return [];
    });
});

function choose(readers, groupName, checked) {
    readers.checkboxes[groupName].checked = checked;
    readers.checkboxes[groupName].dispatchEvent(new Event('change', { bubbles: true }));
}
const partialLabel = (readers, groupName) => readers.checkboxes[groupName].closest('label')
    .querySelector('.dataset-group-read-partial');

test.each([
    { label: 'none', ids: [], state: 'none' },
    { label: 'six ordinary', ids: ordinaryIds, state: 'full' },
    { label: 'all eight', ids: allReadIds, state: 'full' },
    { label: 'AI-only', ids: [2, 6], state: 'ai_only' },
    { label: 'one AI and three ordinary', ids: [1, 2, 3, 4], state: 'partial' },
    { label: 'three ordinary', ids: [1, 3, 4], state: 'partial' },
].flatMap((entry) => ['users', 'guests'].map((groupName) => ({
    ...entry, groupName, state: groupName === 'users' && entry.ids === ordinaryIds ? 'partial' : entry.state,
}))))('untouched $groupName ($label) saves without a permission request', async ({ ids, state, groupName }) => {
    const groupId = groupName === 'guests' ? 4 : 3;
    storedPermissions = rightsFor(groupId, ids);
    const before = structuredClone(storedPermissions);
    const { readers, save } = await openEditor();
    const mixed = state === 'partial' || state === 'ai_only';
    expect(readers.checkboxes[groupName].checked).toBe(state === 'full');
    expect(readers.checkboxes[groupName].indeterminate).toBe(mixed);
    expect(partialLabel(readers, groupName).hidden).toBe(!mixed);
    if (mixed) expect(partialLabel(readers, groupName).textContent)
        .toBe(state === 'ai_only' ? 'AI search only' : 'Partial reading right');
    expect(readers.changed()).toBe(false);
    expect(await save()).toMatchObject({ status: 'saved' });
    expect(endpointRouterMock).toHaveBeenCalledWith('modifyColumns', expect.objectContaining({
        body_data: {
            dataset_name: 'subscriptions', modified_columns: [], added_columns: [], removed_columns: [],
        },
    }));
    expect(permissionWrites()).toEqual([]);
    expect(storedPermissions).toEqual(before);
});

test.each([
    { groupName: 'guests', ids: allReadIds, checked: false, added: [], removed: allReadIds },
    { groupName: 'guests', ids: [2, 6], checked: false, added: [], removed: [2, 6] },
    { groupName: 'guests', ids: [], checked: true, added: ordinaryIds, removed: [] },
    { groupName: 'guests', ids: [1, 3, 4], checked: true, added: [5, 7, 8], removed: [] },
    { groupName: 'guests', ids: [2, 6], checked: true, added: ordinaryIds, removed: [] },
    { groupName: 'guests', ids: [1, 2, 3, 4], checked: true, added: [5, 7, 8], removed: [] },
    { groupName: 'guests', ids: [1, 2, 3, 4], checked: false, added: [], removed: [1, 2, 3, 4] },
    { groupName: 'users', ids: allReadIds, checked: false, added: [], removed: allReadIds },
    { groupName: 'users', ids: [], checked: true, added: allReadIds, removed: [] },
    { groupName: 'users', ids: [2, 6], checked: true, added: ordinaryIds, removed: [] },
    { groupName: 'users', ids: [2, 6], checked: false, added: [], removed: [2, 6] },
])('$groupName holding $ids, checked=$checked sends exactly the required grants', async ({ groupName, ids, checked, added, removed }) => {
    const groupId = groupName === 'guests' ? 4 : 3;
    const otherGroup = groupName === 'guests' ? 'users' : 'guests';
    const otherId = groupName === 'guests' ? 3 : 4;
    const unrelated = [...rightsFor(otherId, [2, 6]), ...rightsFor(groupId, [99]),
        ...rightsFor(groupId, allReadIds).map((row) => ({ ...row, target_table_uid: 9999 }))];
    storedPermissions = [...rightsFor(groupId, ids), ...unrelated];
    const { readers, save } = await openEditor();
    if (ids.length > 0 && ids.length < (groupName === 'guests' ? 6 : 8)) {
        expect(readers.checkboxes[groupName].indeterminate).toBe(true);
        expect(partialLabel(readers, groupName).textContent)
            .toBe(ids.some((id) => ordinaryIds.includes(id)) ? 'Partial reading right' : 'AI search only');
        expect(partialLabel(readers, groupName).hidden).toBe(false);
    }
    choose(readers, groupName, checked);
    expect(await save()).toMatchObject({ status: 'saved' });
    const [, { body_data: changes }] = permissionWrites()[0];
    const rows = (functionIds) => functionIds.map((function_id) => ({
        user_group_id: groupId, function_id, target_table_uid: tableUID,
        target_schema_name: 'public', target_dataset_name: 'subscriptions',
    }));
    expect(changes).toEqual({ add: rows(added), remove: rows(removed) });
    expect(storedPermissions).toEqual(expect.arrayContaining(unrelated));
    expect(storedPermissions.filter((row) => row.user_group_id === groupId && row.target_table_uid === tableUID
        && allReadIds.includes(row.function_id)).map((row) => row.function_id).sort())
        .toEqual(checked ? [...new Set([...ids, ...added])].sort() : []);
    expect(readers.checkboxes[otherGroup].indeterminate).toBe(true);
    expect(partialLabel(readers, otherGroup).hidden).toBe(false);
    expect(readers.touched()).toEqual({ users: false, guests: false });
    await save();
    expect(permissionWrites()).toHaveLength(1);
});

test('grant, withdraw and grant again use the accepted stored grants', async () => {
    storedPermissions = rightsFor(4, [2, 6]);
    const { readers, save } = await openEditor();
    for (const [checked, expectedIds] of [[true, ordinaryIds], [false, allReadIds], [true, ordinaryIds]]) {
        choose(readers, 'guests', checked);
        expect(await save()).toMatchObject({ status: 'saved' });
        const [, { body_data: changes }] = permissionWrites().at(-1);
        expect(changes[checked ? 'add' : 'remove'].map((row) => row.function_id).sort()).toEqual([...expectedIds].sort());
        expect(readers.changed()).toBe(false);
    }
    expect(permissionWrites()).toHaveLength(3);
});

test('a reverted full or none choice sends no PATCH and clears touched tracking', async () => {
    const { readers, save } = await openEditor();
    for (const groupName of ['users', 'guests']) {
        const original = readers.value()[groupName];
        choose(readers, groupName, !original);
        choose(readers, groupName, original);
        expect(readers.changed()).toBe(true);
        expect(await save()).toMatchObject({ status: 'saved' });
        expect(permissionWrites()).toHaveLength(0);
        expect(readers.changed()).toBe(false);
    }
});

test.each([
    { label: 'gate 283a: six public ordinary routes and archive vector',
        rows: [...ordinaryIds.map((id) => [id, 'public']), [6, 'archive']] },
    { label: 'one function with public and archive rows', rows: [[6, 'public'], [6, 'archive']] },
    { label: 'an empty stored schema', rows: [[6, '']] },
    { label: 'every route under multiple schemas',
        rows: allReadIds.flatMap((id) => ['public', 'archive', ''].map((schema) => [id, schema])) },
].flatMap((entry) => ['guests', 'users'].map((groupName) => ({ ...entry, groupName }))))(
    '$groupName withdrawal removes $label using the server delete predicate', async ({ groupName, rows }) => {
        const groupId = groupName === 'guests' ? 4 : 3;
        const held = rows.map(([id, target_schema_name]) => ({
            ...rightsFor(groupId, [id])[0], target_schema_name, target_dataset_name: 'stored_name',
        }));
        const unrelated = [...rightsFor(groupId === 4 ? 3 : 4, allReadIds), ...rightsFor(9, allReadIds),
            ...rightsFor(groupId, [99]),
            ...held.map((row) => ({ ...row, target_table_uid: 9999 }))];
        storedPermissions = [...held, ...unrelated];
        const { readers, save } = await openEditor();
        choose(readers, groupName, false);
        expect(await save()).toMatchObject({ status: 'saved' });
        expect(permissionWrites()[0][1].body_data).toEqual({ add: [], remove: held });
        expect(storedPermissions).toEqual(unrelated);
        expect(permissionReads()).toHaveLength(2);
        expect(readers.checkboxes[groupName].checked).toBe(false);
        expect(readers.checkboxes[groupName].indeterminate).toBe(false);
        expect(readers.changed()).toBe(false);
        await save();
        expect(permissionWrites()).toHaveLength(1);
    },
);

test('the post-save read shows a grant added during withdrawal and a later withdrawal removes it', async () => {
    storedPermissions = rightsFor(4, ordinaryIds);
    const { readers, save } = await openEditor();
    const normalEndpoint = endpointRouterMock.getMockImplementation();
    const concurrentGrant = { ...rightsFor(4, [6])[0], target_schema_name: 'archive' };
    endpointRouterMock.mockImplementation(async (route, options) => {
        const result = await normalEndpoint(route, options);
        if (route === 'datasetPermissions' && options?.method === 'PATCH') {
            storedPermissions.push(concurrentGrant);
            endpointRouterMock.mockImplementation(normalEndpoint);
        }
        return result;
    });
    choose(readers, 'guests', false);
    expect(await save()).toMatchObject({ status: 'saved' });
    expect(storedPermissions).toEqual([concurrentGrant]);
    expect(readers.checkboxes.guests.indeterminate).toBe(true);
    expect(partialLabel(readers, 'guests').hidden).toBe(false);
    expect(partialLabel(readers, 'guests').textContent).toBe('AI search only');
    await save();
    expect(permissionWrites()).toHaveLength(1);
    choose(readers, 'guests', false);
    expect(await save()).toMatchObject({ status: 'saved' });
    expect(permissionWrites()[1][1].body_data).toEqual({ add: [], remove: [concurrentGrant] });
    expect(storedPermissions).toEqual([]);
    expect(readers.checkboxes.guests.indeterminate).toBe(false);
});

test('a failed post-save read keeps the choice retryable instead of accepting an assumed none', async () => {
    storedPermissions = rightsFor(4, ordinaryIds);
    const { readers, save } = await openEditor();
    const normalEndpoint = endpointRouterMock.getMockImplementation();
    let failRead = true;
    endpointRouterMock.mockImplementation((route, options) => {
        if (route === 'datasetPermissions' && !options?.method && failRead) {
            return Promise.reject(new Error('permission refresh failed'));
        }
        return normalEndpoint(route, options);
    });
    choose(readers, 'guests', false);
    expect(await save()).toMatchObject({ status: 'attention' });
    expect(storedPermissions).toEqual([]);
    expect(readers.changed()).toBe(true);
    expect(readers.element.querySelector('.dataset-group-read-status').textContent).toBe('The rights could not be saved.');
    failRead = false;
    expect(await save()).toMatchObject({ status: 'saved' });
    expect(permissionWrites()).toHaveLength(2);
    expect(readers.changed()).toBe(false);
});
