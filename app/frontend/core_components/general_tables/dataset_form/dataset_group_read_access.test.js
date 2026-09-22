// @vitest-environment jsdom
// dataset_group_read_access.test.js
// Verifies the dataset form's reading rights in both modes, and their routes.
// Bridges the permission catalogue, one dataset's current rights and the change request.
// Exists so a right is granted or withdrawn whole, and never left half-applied.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
const fetchAllFunctionsMock = vi.fn();
const fetchUserGroupsMock = vi.fn();

vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: (...args) => endpointRouterMock(...args),
}));
vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback } = {}) => fallback,
}));
vi.mock('../../admin_tools/permission_checker.js', () => ({
    fetch_all_functions: (...args) => fetchAllFunctionsMock(...args),
    fetch_user_groups: (...args) => fetchUserGroupsMock(...args),
}));

const {
    DATASET_READ_FUNCTION_NAMES,
    buildGroupReadPermissionChanges,
    createDatasetGroupReadControl,
    readGroupReadState,
    resolveGroupReadState,
    saveGroupReadPermissionChanges,
} = await import('./dataset_group_read_access.js');

const functions = DATASET_READ_FUNCTION_NAMES.map((name, index) => ({ id: index + 1, name }))
    .concat([{ id: 99, name: 'dtt_1_row_delete.DeleteRowsHandlerWrapper' }]);
const groups = [{ id: 2, name: 'admins' }, { id: 3, name: 'users' }, { id: 4, name: 'guests' }];

function rightsFor(groupId, functionIds, tableUID = 3470) {
    return functionIds.map((function_id) => ({
        user_group_id: groupId, function_id, target_table_uid: tableUID,
    }));
}

function mount(settings) {
    const control = createDatasetGroupReadControl(settings);
    document.body.appendChild(control.element);
    return control;
}
const status = (control) => control.element.querySelector('.dataset-group-read-status');

beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.lang = 'en';
    endpointRouterMock.mockReset();
    fetchAllFunctionsMock.mockReset().mockResolvedValue(functions);
    fetchUserGroupsMock.mockReset().mockResolvedValue(groups);
    endpointRouterMock.mockResolvedValue(rightsFor(3, [1, 2, 3, 4, 5, 6, 7, 8]));
});

describe('dataset reading rights', () => {
    test('a group counts as a reader only when it holds every reading capability', () => {
        const complete = resolveGroupReadState({
            functions, groups, permissions: rightsFor(3, [1, 2, 3, 4, 5, 6, 7, 8]), tableUID: 3470,
        });
        expect(complete.state.users.granted).toBe(true);
        expect(complete.state.guests.granted).toBe(false);
        expect(complete.readFunctionIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

        const partial = resolveGroupReadState({
            functions, groups, permissions: rightsFor(3, [1, 2]), tableUID: 3470,
        });
        expect(partial.state.users.granted).toBe(false);
    });

    test('rights held on another dataset never count for this one', () => {
        const elsewhere = resolveGroupReadState({
            functions, groups, permissions: rightsFor(3, [1, 2, 3, 4, 5, 6, 7, 8], 9999), tableUID: 3470,
        });
        expect(elsewhere.state.users.granted).toBe(false);
    });

    test('only a changed group is added or removed, and always as a whole right', () => {
        const resolved = resolveGroupReadState({
            functions, groups, permissions: rightsFor(3, [1, 2, 3, 4, 5, 6, 7, 8]), tableUID: 3470,
        });
        const changes = buildGroupReadPermissionChanges({
            ...resolved, chosen: { users: true, guests: true }, datasetName: 'subscriptions', tableUID: 3470,
        });
        expect(changes.remove).toEqual([]);
        expect(changes.add).toHaveLength(DATASET_READ_FUNCTION_NAMES.length);
        expect(changes.add.every((row) => row.user_group_id === 4)).toBe(true);
        expect(changes.add[0]).toEqual({
            user_group_id: 4,
            function_id: 1,
            target_schema_name: 'public',
            target_dataset_name: 'subscriptions',
            target_table_uid: 3470,
        });

        const withdrawal = buildGroupReadPermissionChanges({
            ...resolved, chosen: { users: false, guests: false }, datasetName: 'subscriptions', tableUID: 3470,
        });
        expect(withdrawal.add).toEqual([]);
        expect(withdrawal.remove.every((row) => row.user_group_id === 3)).toBe(true);
    });

    test('a new dataset is read by nobody but administrators unless chosen', async () => {
        const control = mount();
        await control.ready;
        expect(control.checkboxes.users.disabled).toBe(false);
        expect(control.value()).toEqual({ users: false, guests: false });
        control.checkboxes.guests.checked = true;
        expect(control.value()).toEqual({ users: false, guests: true });
        expect(status(control).hidden).toBe(true);
    });

    test('an existing dataset shows its current rights and reports only a change', async () => {
        const control = mount({ stored: readGroupReadState(Promise.resolve(3470)) });
        expect(status(control).textContent).toBe('Reading the rights…');
        await control.ready;
        expect(control.checkboxes.users.checked).toBe(true);
        expect(control.checkboxes.guests.checked).toBe(false);
        expect(control.changed()).toBe(false);
        control.checkboxes.guests.checked = true;
        expect(control.changed()).toBe(true);
        control.accept();
        expect(control.changed()).toBe(false);
    });

    test('a dataset without a known identity offers no right to change', async () => {
        const control = mount({ stored: readGroupReadState(Promise.resolve(0)) });
        await control.ready;
        expect(control.checkboxes.users.disabled).toBe(true);
        expect(control.value()).toEqual({});
        expect(status(control).textContent).toBe('The rights could not be read.');
    });

    test('an unreadable permission catalogue says so instead of showing a wrong right', async () => {
        fetchAllFunctionsMock.mockRejectedValue(new Error('network'));
        const control = mount({ stored: readGroupReadState(3470) });
        await control.ready;
        expect(status(control).textContent).toBe('The rights could not be read.');
        expect(control.checkboxes.guests.disabled).toBe(true);
    });

    test('a refused save reports beside the control and keeps the change', async () => {
        const control = mount({ stored: readGroupReadState(3470) });
        await control.ready;
        control.checkboxes.guests.checked = true;
        control.reportFailure();
        expect(status(control).textContent).toBe('The rights could not be saved.');
        expect(control.changed()).toBe(true);
    });

    test('changed rights travel through the permission editor’s own route', async () => {
        await saveGroupReadPermissionChanges({ add: [{ user_group_id: 4 }], remove: [] });
        expect(endpointRouterMock).toHaveBeenLastCalledWith('datasetPermissions', {
            method: 'PATCH', body_data: { add: [{ user_group_id: 4 }], remove: [] }, suppressErrorToast: true,
        });
        expect((await readGroupReadState(3470)).tableUID).toBe(3470);
    });
});
