// row_article_permission_checker.js
// Names the site-wide permissions for shared article disclosures and row actions.
// Connects startup-reconciled UI routes to the current session's route grants.
// Keeps presentation decisions independent of dataset and server-side row rights.

import { hasCachedRouteRights } from '../../permission_cache_reader.js';

export const ROW_ARTICLE_PERMISSION_ROUTES = Object.freeze({
    details: '/ui/article/section/details',
    images: '/ui/article/section/images',
    attachments: '/ui/article/section/attachments',
    related_rows: '/ui/article/section/related_rows',
    task_progress: '/ui/article/section/task_progress',
    edit: '/ui/article/action/edit',
    edit_language_versions: '/ui/article/action/edit_language_versions',
    delete: '/ui/article/action/delete',
});

/** Checks before constructing a configurable element; absent grants fail closed. */
export function hasRowArticlePermission(elementKey) {
    const route = ROW_ARTICLE_PERMISSION_ROUTES[elementKey];
    return Boolean(route && hasCachedRouteRights(route));
}
