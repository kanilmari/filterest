// view_group_permission_warnings.test.js
// Checks per-group view warnings, the Permissions link and read failure handling.
// Connects real warning DOM with a read-only snapshot and translated field-settings copy.
// Protects grants, field drafts and saving from this informational surface.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createViewGroupPermissionWarnings, groupsMissingViewPermission } from './view_group_permission_warnings.js';
import { endpoint_router } from '../endpoints/endpoint_router.js';
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
const groups = [{ group_id: 2, group_name: 'Readers' }, { group_id: 3, group_name: 'Editors' }];
const grant = { user_group_id: 3, function_route: '/ui/view/article_view', target_table_uid: 0, target_schema_name: 'public' };
let controller;
beforeEach(() => { document.body.replaceChildren(); localStorage.setItem('chosen_language', 'fi'); vi.mocked(endpoint_router).mockReset(); });
afterEach(() => controller?.destroy());

test.each(['article_view', 'image_first_view'])('%s warns only for selected groups without the global right', view => {
    expect(groupsMissingViewPermission(groups, ['2', '3'], view, [grant])).toEqual([groups[0]]);
    expect(groupsMissingViewPermission(groups, ['3'], view, [grant])).toEqual([]);
    expect(groupsMissingViewPermission(groups, [], view, [grant])).toEqual([]);
    expect(groupsMissingViewPermission(groups, ['3'], view, [{ ...grant, target_table_uid: 8 }])).toEqual([groups[1]]);
    expect(groupsMissingViewPermission(groups, ['3'], view, [{ ...grant, function_route: '/ui/view/card' }])).toEqual([groups[1]]);
});

test.each(['project_data', 'public', '', null])('NULL dataset scope grants the route in schema %s', schema => {
    for (const target_table_uid of [null, 0]) {
        expect(groupsMissingViewPermission(groups, ['3'], 'article_view', [
            { ...grant, target_schema_name: schema, target_table_uid },
        ])).toEqual([]);
    }
});

test.each([undefined, '0', '8', 8, '', false])('missing or non-global dataset scope %s cannot hide a warning', scope => {
    const right = { ...grant, target_table_uid: scope };
    if (scope === undefined) delete right.target_table_uid;
    expect(groupsMissingViewPermission(groups, ['3'], 'article_view', [right])).toEqual([groups[1]]);
});

test('localized warnings identify each denied group and link to the existing Permissions view', async () => {
    vi.mocked(endpoint_router).mockResolvedValue([grant]);
    const host = document.createElement('div'); document.body.append(host);
    controller = createViewGroupPermissionWarnings(host);
    controller.setContext({ groups, selectedGroupIDs: ['2', '3'], viewKey: 'article_view' });
    await vi.waitFor(() => expect(host.querySelectorAll('[data-group-id]')).toHaveLength(1));
    expect(host.textContent).toContain('Readers');
    expect(host.textContent).toContain('Ryhmällä ei ole');
    expect(host.querySelector('a').getAttribute('href')).toBe('/permissions');
    expect(endpoint_router).toHaveBeenCalledExactlyOnceWith('datasetPermissions', { suppressErrorToast: true });
    controller.setContext({ groups, selectedGroupIDs: ['3'], viewKey: 'article_view' });
    expect(host.hidden).toBe(true);
    expect(endpoint_router).toHaveBeenCalledTimes(1);
});

test('a failed snapshot shows uncertainty rather than declaring a grant missing', async () => {
    vi.mocked(endpoint_router).mockRejectedValue(new Error('offline'));
    const host = document.createElement('div');
    controller = createViewGroupPermissionWarnings(host);
    controller.setContext({ groups, selectedGroupIDs: ['3'], viewKey: 'article_view' });
    await vi.waitFor(() => expect(host.querySelector('[data-lang-key="view_group_permissions_unavailable"]')).not.toBeNull());
    expect(host.querySelector('[data-group-id]')).toBeNull();
});

test('one family snapshot identifies missing canonical IFAV and Page grants without changing single-view behavior', async () => {
    const family = ['article_view','image_first_view','image_first_page_view'];
    expect(groupsMissingViewPermission(groups,['3'],family,[grant])).toEqual([{...groups[1],missingViews:['image_first_view','image_first_page_view']}]);
    const rights = family.map(key => ({...grant,function_route:`/ui/view/${key}`}));
    expect(groupsMissingViewPermission(groups,['3'],family,rights)).toEqual([]);
    vi.mocked(endpoint_router).mockResolvedValue([grant]);
    const host=document.body.appendChild(document.createElement('div'));
    controller=createViewGroupPermissionWarnings(host);controller.setContext({groups,selectedGroupIDs:['3'],viewKey:family});
    await vi.waitFor(()=>expect(host.textContent).toContain('IFAV'));
    expect(endpoint_router).toHaveBeenCalledTimes(1);
});
