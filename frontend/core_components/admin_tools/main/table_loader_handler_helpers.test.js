import { describe, test, expect } from 'vitest';
import {
    extractRowId,
    parseDeepLink,
    resolveTableName,
} from './table_loader_handler_helpers.js';

// ---------------------------------------------------------------------------
// extractRowId
// ---------------------------------------------------------------------------
describe('extractRowId', () => {
    test('strips SEO slug after dash', () => {
        expect(extractRowId('125-some-title')).toBe('125');
    });

    test('returns plain number as-is', () => {
        expect(extractRowId('42')).toBe('42');
    });

    test('handles dash at very end', () => {
        // "125-" has dash at index 3, > 0, so returns "125"
        expect(extractRowId('125-')).toBe('125');
    });

    test('returns empty string for empty input', () => {
        expect(extractRowId('')).toBe('');
    });

    test('returns empty string for null/undefined', () => {
        expect(extractRowId(null)).toBe('');
        expect(extractRowId(undefined)).toBe('');
    });

    test('returns full string when dash is first character', () => {
        // dashIdx === 0, not > 0, so no stripping
        expect(extractRowId('-leading')).toBe('-leading');
    });

    test('strips only at first dash', () => {
        expect(extractRowId('10-hello-world')).toBe('10');
    });
});

// ---------------------------------------------------------------------------
// parseDeepLink
// ---------------------------------------------------------------------------
describe('parseDeepLink', () => {
    test('returns null for root path', () => {
        expect(parseDeepLink('/')).toEqual({ tableName: null, rowId: null });
    });

    test('returns null for empty string', () => {
        expect(parseDeepLink('')).toEqual({ tableName: null, rowId: null });
    });

    test('returns null for null', () => {
        expect(parseDeepLink(null)).toEqual({ tableName: null, rowId: null });
    });

    test('parses /admin/ prefix', () => {
        expect(parseDeepLink('/admin/users')).toEqual({ tableName: 'users', rowId: null });
    });

    test('parses dataset prefix (default /)', () => {
        expect(parseDeepLink('/orders')).toEqual({ tableName: 'orders', rowId: null });
    });

    test('parses /{table}/{id} pattern', () => {
        expect(parseDeepLink('/users/42')).toEqual({ tableName: 'users', rowId: '42' });
    });

    test('parses /{table}/{id}-{slug} pattern', () => {
        expect(parseDeepLink('/users/125-john-doe')).toEqual({ tableName: 'users', rowId: '125' });
    });

    test('maps aliased public dataset paths back to the raw table name', () => {
        expect(parseDeepLink('/service_catalog')).toEqual({
            tableName: 'app_service_catalog',
            rowId: null,
        });
    });

    test('maps aliased row deep links back to the raw table name', () => {
        expect(parseDeepLink('/service_catalog/125-some-title')).toEqual({
            tableName: 'app_service_catalog',
            rowId: '125',
        });
    });

    test('parses /admin/{table}/{id} pattern', () => {
        expect(parseDeepLink('/admin/users/99')).toEqual({ tableName: 'users', rowId: '99' });
    });

    test('parses /admin/{table}/{id}-{slug} pattern', () => {
        expect(parseDeepLink('/admin/orders/7-big-order')).toEqual({ tableName: 'orders', rowId: '7' });
    });

    test('handles custom dataset prefix', () => {
        expect(parseDeepLink('/data/items', '/data/')).toEqual({ tableName: 'items', rowId: null });
    });
});

// ---------------------------------------------------------------------------
// resolveTableName
// ---------------------------------------------------------------------------
describe('resolveTableName', () => {
    const available = new Set(['users', 'orders', 'products', 'app_service_catalog']);
    const tables = [
        { dataset_name: 'users' },
        { dataset_name: 'orders', is_default: true },
        { dataset_name: 'products' },
    ];
    const customViews = [{ name: 'my_view' }];

    test('returns deep-linked name when valid', () => {
        const result = resolveTableName({
            deepLinkedName: 'users',
            storedName: null,
            availableNames: available,
            tables,
            customViews,
            isLandingOnFrontpage: false,
        });
        expect(result).toEqual({ resolvedName: 'users', deepLinkInvalid: false });
    });

    test('returns deepLinkInvalid when deep link points to missing table', () => {
        const result = resolveTableName({
            deepLinkedName: 'nonexistent',
            storedName: null,
            availableNames: available,
            tables,
            customViews,
            isLandingOnFrontpage: false,
        });
        expect(result).toEqual({ resolvedName: null, deepLinkInvalid: true });
    });

    test('falls back to stored name when no deep link', () => {
        const result = resolveTableName({
            deepLinkedName: null,
            storedName: 'products',
            availableNames: available,
            tables,
            customViews,
            isLandingOnFrontpage: false,
        });
        expect(result.resolvedName).toBe('products');
    });

    test('ignores stored name when landing on front page', () => {
        const result = resolveTableName({
            deepLinkedName: null,
            storedName: 'products',
            availableNames: available,
            tables,
            customViews,
            isLandingOnFrontpage: true,
        });
        // Should fall through to default
        expect(result.resolvedName).toBe('orders'); // is_default
    });

    test('ignores stored name when not in available set', () => {
        const result = resolveTableName({
            deepLinkedName: null,
            storedName: 'deleted_table',
            availableNames: available,
            tables,
            customViews,
            isLandingOnFrontpage: false,
        });
        expect(result.resolvedName).toBe('orders'); // falls to default
    });

    test('uses is_default table as default', () => {
        const result = resolveTableName({
            deepLinkedName: null,
            storedName: null,
            availableNames: available,
            tables,
            customViews,
            isLandingOnFrontpage: false,
        });
        expect(result.resolvedName).toBe('orders');
    });

    test('prefers first current project top-level table over legacy global default', () => {
        const result = resolveTableName({
            deepLinkedName: null,
            storedName: null,
            availableNames: new Set(['app_service_catalog', 'palvelukatalogi', 'riskienhallinta']),
            tables: [
                { dataset_name: 'app_service_catalog', is_default: true },
                {
                    dataset_name: 'palvelukatalogi',
                    is_top_level_in_current_project: true,
                },
                {
                    dataset_name: 'riskienhallinta',
                    is_top_level_in_current_project: true,
                },
            ],
            customViews,
            isLandingOnFrontpage: true,
            tabOrder: [
                { tab_id: 'riskienhallinta', sort_order: 2 },
                { tab_id: 'palvelukatalogi', sort_order: 1 },
            ],
        });
        expect(result.resolvedName).toBe('palvelukatalogi');
    });

    test('falls back to current project table order from server when tab order is missing', () => {
        const result = resolveTableName({
            deepLinkedName: null,
            storedName: null,
            availableNames: new Set(['app_service_catalog', 'dokumentaatio', 'palvelukatalogi']),
            tables: [
                { dataset_name: 'app_service_catalog', is_default: true },
                {
                    dataset_name: 'palvelukatalogi',
                    is_top_level_in_current_project: true,
                },
                {
                    dataset_name: 'dokumentaatio',
                    is_top_level_in_current_project: true,
                },
            ],
            customViews,
            isLandingOnFrontpage: true,
        });
        expect(result.resolvedName).toBe('palvelukatalogi');
    });

    test('falls back to app_service_catalog when no is_default', () => {
        const noDefault = [{ dataset_name: 'users' }, { dataset_name: 'products' }];
        const result = resolveTableName({
            deepLinkedName: null,
            storedName: null,
            availableNames: available,
            tables: noDefault,
            customViews,
            isLandingOnFrontpage: false,
        });
        expect(result.resolvedName).toBe('app_service_catalog');
    });

    test('falls back to first custom view when default not available', () => {
        const smallAvailable = new Set(['my_view']);
        const result = resolveTableName({
            deepLinkedName: null,
            storedName: null,
            availableNames: smallAvailable,
            tables: [],
            customViews: [{ name: 'my_view' }],
            isLandingOnFrontpage: false,
        });
        expect(result.resolvedName).toBe('my_view');
    });

    test('falls back to first available when no custom views', () => {
        const tinyAvailable = new Set(['only_table']);
        const result = resolveTableName({
            deepLinkedName: null,
            storedName: null,
            availableNames: tinyAvailable,
            tables: [],
            customViews: [],
            isLandingOnFrontpage: false,
        });
        expect(result.resolvedName).toBe('only_table');
    });

    test('returns null when nothing available', () => {
        const result = resolveTableName({
            deepLinkedName: null,
            storedName: null,
            availableNames: new Set(),
            tables: [],
            customViews: [],
            isLandingOnFrontpage: false,
        });
        expect(result.resolvedName).toBeNull();
    });
});
