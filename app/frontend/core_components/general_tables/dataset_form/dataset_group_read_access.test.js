// @vitest-environment jsdom
// dataset_group_read_access.test.js
// Verifies dataset read bundles, their four states and explicit checkbox choices.
// Connects the permission catalogue, one dataset's rights and the change request.
// Protects complete withdrawal and preserves every untouched group's grants.
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
    DATASET_GUEST_READ_FUNCTION_NAMES,
    DATASET_READ_FUNCTION_NAMES,
    buildGroupReadPermissionChanges,
    createDatasetGroupReadControl,
    readGroupReadState,
    resolveGroupReadState,
    saveGroupReadPermissionChanges,
} = await import('./dataset_group_read_access.js');
const { observeDatasetFormLanguage } = await import('./dataset_form_text.js');

const functions = DATASET_READ_FUNCTION_NAMES.map((name, index) => ({ id: index + 1, name }))
    .concat([{ id: 99, name: 'dtt_1_row_delete.DeleteRowsHandlerWrapper' }]);
const groups = [{ id: 2, name: 'admins' }, { id: 3, name: 'users' }, { id: 4, name: 'guests' }];
const ordinaryIds = [1, 3, 4, 5, 7, 8];
const allReadIds = [1, 2, 3, 4, 5, 6, 7, 8];

function rightsFor(groupId, functionIds, tableUID = 3470) {
    return functionIds.map((function_id) => ({
        user_group_id: groupId, function_id, target_table_uid: tableUID,
        target_schema_name: 'public', target_dataset_name: 'subscriptions',
    }));
}

function mount(settings) {
    const control = createDatasetGroupReadControl(settings);
    document.body.appendChild(control.element);
    return control;
}
const status = (control) => control.element.querySelector('.dataset-group-read-status');
const partialLabel = (control, groupName) => control.checkboxes[groupName].closest('label')
    .querySelector('.dataset-group-read-partial');
function choose(control, groupName, checked) {
    control.checkboxes[groupName].checked = checked;
    control.checkboxes[groupName].dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.lang = 'en';
    endpointRouterMock.mockReset().mockResolvedValue(rightsFor(3, allReadIds));
    fetchAllFunctionsMock.mockReset().mockResolvedValue(functions);
    fetchUserGroupsMock.mockReset().mockResolvedValue(groups);
});

describe('dataset reading rights', () => {
    test.each([
        ['guests', 4, [], 'none'],
        ['guests', 4, ordinaryIds, 'full'],
        ['guests', 4, allReadIds, 'full'],
        ['guests', 4, [2], 'ai_only'],
        ['guests', 4, [6], 'ai_only'],
        ['guests', 4, [2, 6], 'ai_only'],
        ['guests', 4, [1, 2, 3, 4], 'partial'],
        ['guests', 4, [1, 3, 4], 'partial'],
        ['users', 3, [], 'none'],
        ['users', 3, [2, 6], 'ai_only'],
        ['users', 3, ordinaryIds, 'partial'],
        ['users', 3, allReadIds, 'full'],
    ])('%s (group %i) holding %j resolves to %s', (groupName, groupId, ids, expected) => {
        const { state } = resolveGroupReadState({
            functions, groups, permissions: rightsFor(groupId, ids), tableUID: 3470,
        });
        expect(state[groupName].status).toBe(expected);
        expect(state[groupName].heldReadFunctionIds).toEqual(ids);
        expect(state[groupName].grantFunctionIds).toEqual(groupName === 'guests' ? ordinaryIds : allReadIds);
    });

    test('grants on another dataset and unrelated write grants never count', () => {
        const { state } = resolveGroupReadState({
            functions, groups, permissions: [...rightsFor(4, allReadIds, 9999), ...rightsFor(4, [99])], tableUID: 3470,
        });
        expect(state.guests.status).toBe('none');
        expect(state.guests.heldReadFunctionIds).toEqual([]);
    });

    test.each([['guests', 4], ['users', 3]])('%s retains each held row identity for withdrawal', (groupName, groupId) => {
        const held = ['public', 'archive', ''].map((target_schema_name) => ({
            ...rightsFor(groupId, [6])[0], target_schema_name, target_dataset_name: 'stored_name',
        }));
        const permissions = [...held, ...rightsFor(groupId, [99]), ...rightsFor(groupId, [6], 9999),
            ...rightsFor(9, [6])];
        const before = structuredClone(permissions);
        const resolved = resolveGroupReadState({ functions, groups, permissions, tableUID: 3470 });
        expect(resolved.state[groupName].heldReadPermissions).toEqual(held);
        expect(resolved.state[groupName].heldReadFunctionIds).toEqual([6]);
        expect(buildGroupReadPermissionChanges({
            ...resolved, chosen: { [groupName]: false }, touched: { [groupName]: true },
            datasetName: 'subscriptions', tableUID: 3470,
        })).toEqual({ add: [], remove: held });
        expect(permissions).toEqual(before);
    });

    test.each([
        ['guests', 4, allReadIds, false, [], allReadIds],
        ['guests', 4, [2, 6], false, [], [2, 6]],
        ['guests', 4, [], true, ordinaryIds, []],
        ['guests', 4, [1, 3, 4], true, [5, 7, 8], []],
        ['guests', 4, [2, 6], true, ordinaryIds, []],
        ['users', 3, allReadIds, false, [], allReadIds],
        ['users', 3, [], true, allReadIds, []],
        ['users', 3, ordinaryIds, true, [2, 6], []],
    ])('%s (group %i) holding %j: checked=%s', (groupName, groupId, ids, checked, added, removed) => {
        const resolved = resolveGroupReadState({
            functions, groups, permissions: [...rightsFor(groupId, ids), ...rightsFor(groupId, [99])], tableUID: 3470,
        });
        const changes = buildGroupReadPermissionChanges({
            ...resolved, chosen: { [groupName]: checked }, touched: { [groupName]: true },
            datasetName: 'subscriptions', tableUID: 3470,
        });
        const rows = (functionIds) => functionIds.map((function_id) => ({
            user_group_id: groupId, function_id, target_schema_name: 'public',
            target_dataset_name: 'subscriptions', target_table_uid: 3470,
        }));
        expect(changes).toEqual({ add: rows(added), remove: rows(removed) });
    });

    test.each(['users', 'guests'])('untouched %s sends no change in full, ai_only, partial or none', async (groupName) => {
        const groupId = groupName === 'guests' ? 4 : 3;
        for (const ids of [[], [1, 3], [2, 6], ordinaryIds, allReadIds]) {
            const stored = resolveGroupReadState({ functions, groups, permissions: rightsFor(groupId, ids), tableUID: 3470 });
            const control = mount({ stored });
            await control.ready;
            expect(control.changed()).toBe(false);
            expect(control.touched()).toEqual({ users: false, guests: false });
            expect(buildGroupReadPermissionChanges({ ...stored, chosen: control.value(), touched: control.touched() }))
                .toEqual({ add: [], remove: [] });
            // Even a chosen boolean that differs from the rendered state is inert without a touch.
            expect(buildGroupReadPermissionChanges({ ...stored, chosen: { [groupName]: true } }))
                .toEqual({ add: [], remove: [] });
        }
    });

    test('the six ordinary creation grants show as full guest read', async () => {
        expect(DATASET_GUEST_READ_FUNCTION_NAMES).toHaveLength(6);
        expect(DATASET_READ_FUNCTION_NAMES).toHaveLength(8);
        endpointRouterMock.mockResolvedValue(rightsFor(4, ordinaryIds));
        const stored = await readGroupReadState(3470);
        expect(stored.state.guests.status).toBe('full');
        const control = mount({ stored });
        await control.ready;
        expect(control.value()).toEqual({ users: false, guests: true });
        expect(control.checkboxes.guests.indeterminate).toBe(false);
        expect(partialLabel(control, 'guests').hidden).toBe(true);
    });

    test.each(['users', 'guests'].flatMap((groupName) => [
        [groupName, [2], 'AI search only'],
        [groupName, [6], 'AI search only'],
        [groupName, [2, 6], 'AI search only'],
        [groupName, [1, 2, 3, 4], 'Partial reading right'],
    ]))('%s holding %j shows "%s" mixed and supports both explicit choices', async (groupName, ids, copy) => {
        const groupId = groupName === 'guests' ? 4 : 3;
        const stored = resolveGroupReadState({ functions, groups, permissions: rightsFor(groupId, ids), tableUID: 3470 });
        const control = mount({ stored });
        await control.ready;
        const checkbox = control.checkboxes[groupName];
        expect(checkbox.checked).toBe(false);
        expect(checkbox.indeterminate).toBe(true);
        expect(partialLabel(control, groupName).hidden).toBe(false);
        expect(partialLabel(control, groupName).textContent).toBe(copy);
        checkbox.click();
        expect(control.value()[groupName]).toBe(true);
        expect(checkbox.indeterminate).toBe(false);
        expect(partialLabel(control, groupName).hidden).toBe(true);
        expect(control.touched()[groupName]).toBe(true);
        expect(buildGroupReadPermissionChanges({ ...stored, chosen: control.value(), touched: control.touched() })
            .add.map((row) => row.function_id)).toEqual(stored.state[groupName].grantFunctionIds.filter((id) => !ids.includes(id)));
        checkbox.click();
        expect(control.value()[groupName]).toBe(false);
        expect(buildGroupReadPermissionChanges({ ...stored, chosen: control.value(), touched: control.touched() })
            .remove.map((row) => row.function_id)).toEqual(ids);
    });

    test('all eight grants show as full guest read without a mixed label', async () => {
        const control = mount({ stored: resolveGroupReadState({ functions, groups, permissions: rightsFor(4, allReadIds), tableUID: 3470 }) });
        await control.ready;
        expect(control.checkboxes.guests.checked).toBe(true);
        expect(control.checkboxes.guests.indeterminate).toBe(false);
        expect(partialLabel(control, 'guests').hidden).toBe(true);
    });

    test.each([
        ['ai_only', [2, 6], ['Vain tekoälyhaku', 'AI search only', '仅限人工智能搜索', '只限人工智能搜尋']],
        ['partial', [1, 2, 3, 4], ['Osittainen lukuoikeus', 'Partial reading right', '部分读取权限', '部分讀取權限']],
    ])('the %s label retranslates in place in every form language', async (state, ids, copies) => {
        const control = mount({ stored: resolveGroupReadState({ functions, groups, permissions: rightsFor(4, ids), tableUID: 3470 }) });
        await control.ready;
        const checkbox = control.checkboxes.guests;
        checkbox.focus();
        const dispose = observeDatasetFormLanguage(control.element);
        try {
            for (const [index, lang] of ['fi', 'en', 'ch', 'yue'].entries()) {
                document.documentElement.lang = lang;
                await new Promise((resolve) => setTimeout(resolve, 0));
                expect(partialLabel(control, 'guests').textContent).toBe(copies[index]);
                expect(partialLabel(control, 'guests').hidden).toBe(false);
                expect(control.element.querySelector('[data-testid="dataset-group-read-guests"]')).toBe(checkbox);
                expect(checkbox.checked).toBe(false);
                expect(checkbox.indeterminate).toBe(true);
                expect(document.activeElement).toBe(checkbox);
                expect(control.changed()).toBe(false);
                expect(control.touched()).toEqual({ users: false, guests: false });
            }
        } finally { dispose(); }
    });

    test('a new dataset is read by nobody but administrators unless chosen', async () => {
        const control = mount();
        await control.ready;
        expect(control.checkboxes.users.disabled).toBe(false);
        expect(control.value()).toEqual({ users: false, guests: false });
        choose(control, 'guests', true);
        expect(control.value()).toEqual({ users: false, guests: true });
        expect(status(control).hidden).toBe(true);
    });

    test('only a change event marks a group touched and accept clears it', async () => {
        const control = mount({ stored: readGroupReadState(Promise.resolve(3470)) });
        expect(status(control).textContent).toBe('Reading the rights…');
        await control.ready;
        expect(control.checkboxes.users.checked).toBe(true);
        control.checkboxes.guests.checked = true;
        expect(control.changed()).toBe(false);
        choose(control, 'guests', true);
        expect(control.touched()).toEqual({ users: false, guests: true });
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

    test('a refused save reports beside the control and keeps the explicit choice', async () => {
        const control = mount({ stored: readGroupReadState(3470) });
        await control.ready;
        choose(control, 'guests', true);
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
