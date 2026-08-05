import { describe, expect, test } from 'vitest';
import {
    isServiceCatalogModerationColumn,
    parseCachedUserPermissions,
    userHasAdminUiPermission,
    canEditServiceCatalogColumn,
    SERVICE_CATALOG_OWNER_SELF_SERVICE_COLUMNS,
} from './service_catalog_moderation.js';

describe('service_catalog_moderation', () => {
    test('recognizes protected moderation columns only on app_service_catalog', () => {
        expect(isServiceCatalogModerationColumn('app_service_catalog', 'admin_approved')).toBe(true);
        expect(isServiceCatalogModerationColumn('app_service_catalog', 'header')).toBe(false);
        expect(isServiceCatalogModerationColumn('users', 'admin_approved')).toBe(false);
    });

    test('parses cached permission payloads safely', () => {
        expect(parseCachedUserPermissions(JSON.stringify(['/ui/admin/permissions', 1, null]))).toEqual([
            '/ui/admin/permissions',
        ]);
        expect(parseCachedUserPermissions('{broken')).toEqual([]);
        expect(parseCachedUserPermissions(null)).toEqual([]);
    });

    test('detects admin UI access from cached route permissions', () => {
        expect(userHasAdminUiPermission(['/ui/admin/permissions'])).toBe(true);
        expect(userHasAdminUiPermission(['/ui/view/table'])).toBe(false);
    });

    test('allows moderation-field editing only for admin-capable actors', () => {
        expect(canEditServiceCatalogColumn('app_service_catalog', 'published', ['/ui/admin/service_catalog_moderation'])).toBe(true);
        expect(canEditServiceCatalogColumn('app_service_catalog', 'published', ['/ui/view/table'])).toBe(true);
        expect(canEditServiceCatalogColumn('app_service_catalog', 'enabled', ['/ui/view/table'])).toBe(true);
        expect(canEditServiceCatalogColumn('app_service_catalog', 'admin_reviewed', ['/ui/view/table'])).toBe(false);
        expect(canEditServiceCatalogColumn('app_service_catalog', 'admin_approved', ['/ui/view/table'])).toBe(false);
        expect(canEditServiceCatalogColumn('app_service_catalog', 'header', ['/ui/view/table'])).toBe(true);
    });

    test('keeps the owner self-service subset explicit and narrow', () => {
        expect(SERVICE_CATALOG_OWNER_SELF_SERVICE_COLUMNS).toEqual(['published', 'enabled']);
    });
});
