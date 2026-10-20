// view_group_permission_warnings.js
// Explains selected groups' missing view grants beside the field-settings picker.
// Connects the existing read-only permission snapshot with the canonical view registry.
// Keeps field selection and permission changes separate, without affecting save payloads.

import { ARTICLE_PRESENTATION_CONTRACT } from '../../shared/article_presentations/contract_reader.js';
import { getArticlePresentationsCopy } from './article_presentations_copy.js';
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { getDatasetViewPermissionRoute, getDatasetViewLabelForLanguage } from '../table_views/dataset_view_registry.js';
import { getViewFieldAssignmentsCopy } from './view_field_assignments_copy.js';

/** Mirrors route_table_checker.go's unscoped query: matching route, NULL dataset, any schema.
 * permissions_handlers.go filters disabled functions and encodes NULL scope as numeric 0.
 * Missing/malformed scope is not evidence of a global grant.
 */
export function groupsMissingViewPermission(groups, selectedGroupIDs, viewKey, permissions) {
    if (Array.isArray(viewKey)) {
        const selected = new Set(selectedGroupIDs.map(String));
        return groups.filter(group => selected.has(String(group.group_id))).flatMap(group => {
            const missingViews = viewKey.filter(key => {
                const route = ARTICLE_PRESENTATION_CONTRACT.presentations[key]?.permission_route || getDatasetViewPermissionRoute(key);
                return route && !(permissions || []).some(right => right.function_route === route
                    && String(right.user_group_id) === String(group.group_id)
                    && (right.target_table_uid === null || right.target_table_uid === 0));
            });
            return missingViews.length ? [{ ...group, missingViews }] : [];
        });
    }
    const route = getDatasetViewPermissionRoute(viewKey);
    if (!route) return [];
    const grantedGroups = new Set((permissions || []).filter(right => (
        right.function_route === route
        && (right.target_table_uid === null || right.target_table_uid === 0)
    )).map(right => String(right.user_group_id)));
    const selected = new Set(selectedGroupIDs.map(String));
    return groups.filter(group => selected.has(String(group.group_id)) && !grantedGroups.has(String(group.group_id)));
}

/** Loads one snapshot per editor/rights refresh and renders warnings without owning the draft. */
export function createViewGroupPermissionWarnings(host) {
    let context = { groups: [], selectedGroupIDs: [], viewKey: '' };
    let permissions = null;
    let unavailable = false;
    let generation = 0;
    let disposed = false;
    const events = new AbortController();
    const observer = new MutationObserver(render);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

    function render() {
        if (disposed) return;
        host.replaceChildren();
        const text = getViewFieldAssignmentsCopy();
        if (unavailable && context.selectedGroupIDs.length) {
            const notice = document.createElement('p');
            notice.dataset.langKey = 'view_group_permissions_unavailable';
            notice.textContent = text.permissionsUnavailable;
            host.append(notice);
        } else if (permissions !== null) {
            for (const group of groupsMissingViewPermission(context.groups, context.selectedGroupIDs, context.viewKey, permissions)) {
                const warning = document.createElement('p');
                warning.dataset.testid = 'view-group-permission-warning';
                warning.dataset.groupId = String(group.group_id);
                const name = document.createElement('strong');
                name.textContent = group.group_name;
                const reason = document.createElement('span');
                reason.dataset.langKey = 'view_group_permission_missing';
                reason.textContent = text.permissionMissing;
                const link = document.createElement('a');
                // The existing administrator tree entry is the custom view "permissions".
                link.href = '/permissions';
                link.dataset.langKey = 'view_group_open_permissions';
                link.textContent = text.openPermissions;
                warning.append(name, ': ', reason, ' ', link);
                if (group.missingViews) {
                    const views = document.createElement('span');
                    views.textContent = ' (' + group.missingViews.map(key => {
                        const family = getArticlePresentationsCopy();
                        return ({article_view:family.article,image_first_view:family.image,image_first_page_view:family.page})[key] || getDatasetViewLabelForLanguage(key);
                    }).join(', ') + ')';
                    warning.append(views);
                }
                host.append(warning);
            }
        }
        host.hidden = !host.childElementCount;
    }

    async function load() {
        const request = ++generation;
        try {
            const snapshot = await endpoint_router('datasetPermissions', { suppressErrorToast: true });
            if (disposed || request !== generation) return;
            if (snapshot !== null && !Array.isArray(snapshot)) throw new Error('Invalid permission snapshot');
            permissions = snapshot || [];
            unavailable = false;
        } catch {
            if (disposed || request !== generation) return;
            permissions = null;
            unavailable = true;
        }
        render();
    }

    window.addEventListener('routePermissionsRefreshed', () => { void load(); }, { signal: events.signal });
    void load();
    return {
        setContext(next) { context = next; render(); },
        destroy() { disposed = true; generation += 1; observer.disconnect(); events.abort(); },
    };
}
