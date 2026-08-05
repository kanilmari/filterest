// service_catalog_moderation.js
// Defines the client-side moderation-field rules for the service catalog dataset.
// Bridges cached frontend permissions and dataset-specific edit restrictions for table/big-card editing.
// Exists so moderation flags stay visible to the right actors without becoming editable for non-admins.

export const SERVICE_CATALOG_DATASET = 'app_service_catalog';
export const SERVICE_CATALOG_MODERATION_COLUMNS = Object.freeze([
    'published',
    'enabled',
    'admin_reviewed',
    'admin_approved',
]);
export const SERVICE_CATALOG_OWNER_SELF_SERVICE_COLUMNS = Object.freeze([
    'published',
    'enabled',
]);

export function isServiceCatalogModerationColumn(tableName, columnName) {
    return tableName === SERVICE_CATALOG_DATASET
        && SERVICE_CATALOG_MODERATION_COLUMNS.includes(String(columnName || '').trim());
}

export function parseCachedUserPermissions(rawPermissions) {
    if (Array.isArray(rawPermissions)) {
        return rawPermissions.filter((value) => typeof value === 'string');
    }

    if (typeof rawPermissions !== 'string' || rawPermissions.trim() === '') {
        return [];
    }

    try {
        const parsed = JSON.parse(rawPermissions);
        return Array.isArray(parsed)
            ? parsed.filter((value) => typeof value === 'string')
            : [];
    } catch {
        return [];
    }
}

export function userHasAdminUiPermission(rawPermissions) {
    return parseCachedUserPermissions(rawPermissions)
        .some((permission) => permission.startsWith('/ui/admin/'));
}

export function readCachedUserPermissions() {
    try {
        return parseCachedUserPermissions(sessionStorage.getItem('user_permissions'));
    } catch {
        return [];
    }
}

export function canEditServiceCatalogColumn(tableName, columnName, rawPermissions = null) {
    if (!isServiceCatalogModerationColumn(tableName, columnName)) {
        return true;
    }

    const permissions = rawPermissions === null
        ? readCachedUserPermissions()
        : parseCachedUserPermissions(rawPermissions);

    if (userHasAdminUiPermission(permissions)) {
        return true;
    }

    // Owner self-service is intentionally narrow: backend only exposes these
    // moderation fields on the caller's own rows, so the frontend can allow
    // toggling them without widening admin-only review flags.
    return SERVICE_CATALOG_OWNER_SELF_SERVICE_COLUMNS.includes(String(columnName || '').trim());
}
