// endpoint_data_fetcher_helpers.test.js
// Verifies projection transport beside listing conditions and pagination.
// Connects pure query serialization to the server-owned support contract.
// Prevents the browser from adding legacy picture or geometry support flags.
import { describe, test, expect } from 'vitest';
import {
    validateSortOrder,
    shouldIncludeRowCount,
    buildDatasetQueryParams,
} from './endpoint_data_fetcher_helpers.js';

// ---------------------------------------------------------------------------
// validateSortOrder
// ---------------------------------------------------------------------------
describe('validateSortOrder', () => {
    test('returns ASC for "asc" (case-insensitive)', () => {
        expect(validateSortOrder('asc')).toBe('ASC');
        expect(validateSortOrder('Asc')).toBe('ASC');
        expect(validateSortOrder('ASC')).toBe('ASC');
    });

    test('returns DESC for "desc" (case-insensitive)', () => {
        expect(validateSortOrder('desc')).toBe('DESC');
        expect(validateSortOrder('Desc')).toBe('DESC');
        expect(validateSortOrder('DESC')).toBe('DESC');
    });

    test('returns ASC as fallback for invalid values', () => {
        expect(validateSortOrder('random')).toBe('ASC');
        expect(validateSortOrder('')).toBe('ASC');
        expect(validateSortOrder('ASCENDING')).toBe('ASC');
    });
});

// ---------------------------------------------------------------------------
// shouldIncludeRowCount
// ---------------------------------------------------------------------------
describe('shouldIncludeRowCount', () => {
    test('returns true when rowCount is set and offset > 0', () => {
        expect(shouldIncludeRowCount(100, 25)).toBe(true);
    });

    test('returns false when rowCount is null', () => {
        expect(shouldIncludeRowCount(null, 25)).toBe(false);
    });

    test('returns false when offset is 0', () => {
        expect(shouldIncludeRowCount(100, 0)).toBe(false);
    });

    test('returns false when both are zero/null', () => {
        expect(shouldIncludeRowCount(null, 0)).toBe(false);
    });

    test('returns true for rowCount 0 with offset > 0', () => {
        expect(shouldIncludeRowCount(0, 10)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// buildDatasetQueryParams
// ---------------------------------------------------------------------------
describe('buildDatasetQueryParams', () => {
    test('builds minimal query with dataset and offset', () => {
        const qs = buildDatasetQueryParams({ dataset_name: 'users' });
        expect(qs).toBe('?dataset=users&offset=0');
    });

    test('includes offset when provided', () => {
        const qs = buildDatasetQueryParams({ dataset_name: 'users', offset: 50 });
        expect(qs).toContain('offset=50');
    });

    test('includes lang when provided', () => {
        const qs = buildDatasetQueryParams({ dataset_name: 'users', lang: 'fi' });
        expect(qs).toContain('lang=fi');
    });

    test('omits lang when null', () => {
        const qs = buildDatasetQueryParams({ dataset_name: 'users', lang: null });
        expect(qs).not.toContain('lang=');
    });

    test('includes sort_column and validated sort_order', () => {
        const qs = buildDatasetQueryParams({
            dataset_name: 'users',
            sort_column: 'name',
            sort_order: 'desc',
        });
        expect(qs).toContain('sort_column=name');
        expect(qs).toContain('sort_order=DESC');
    });

    test('uses ASC fallback for invalid sort_order', () => {
        const qs = buildDatasetQueryParams({
            dataset_name: 'users',
            sort_column: 'name',
            sort_order: 'invalid',
        });
        expect(qs).toContain('sort_order=ASC');
    });

    test('omits sort params when not provided', () => {
        const qs = buildDatasetQueryParams({ dataset_name: 'users' });
        expect(qs).not.toContain('sort_column');
        expect(qs).not.toContain('sort_order');
    });

    test('appends non-empty filter values', () => {
        const qs = buildDatasetQueryParams({
            dataset_name: 'users',
            filters: { status: 'active', role: 'admin' },
        });
        expect(qs).toContain('status=active');
        expect(qs).toContain('role=admin');
    });

    test('skips null, undefined, and empty string filter values', () => {
        const qs = buildDatasetQueryParams({
            dataset_name: 'users',
            filters: { a: null, b: undefined, c: '', d: 'ok' },
        });
        expect(qs).not.toContain('a=');
        expect(qs).not.toContain('b=');
        expect(qs).not.toContain('c=');
        expect(qs).toContain('d=ok');
    });

    test('includes row_count when offset > 0', () => {
        const qs = buildDatasetQueryParams({
            dataset_name: 'users',
            offset: 25,
            row_count: 100,
        });
        expect(qs).toContain('row_count=100');
    });

    test('omits row_count on first page (offset=0)', () => {
        const qs = buildDatasetQueryParams({
            dataset_name: 'users',
            offset: 0,
            row_count: 100,
        });
        expect(qs).not.toContain('row_count');
    });

    test.each(['table', 'card', 'article_view', 'product_card', 'map'])('serializes the %s projection without support flags', viewKey => {
        const params = new URLSearchParams(buildDatasetQueryParams({
            dataset_name: 'users',
            view_key: viewKey,
        }));
        expect([...params]).toEqual([['dataset', 'users'], ['offset', '0'], ['view_key', viewKey]]);
    });

    test('legacy flags belong to API clients rather than the browser serializer', () => {
        const params = new URLSearchParams(buildDatasetQueryParams({
            dataset_name: 'places',
            view_key: 'map', include_card_support: true, include_map_support: true,
        }));
        expect(params.get('view_key')).toBe('map');
        expect(params.has('include_card_support')).toBe(false);
        expect(params.has('include_map_support')).toBe(false);
    });

    test('full params build in correct order', () => {
        const qs = buildDatasetQueryParams({
            dataset_name: 'orders',
            offset: 50,
            lang: 'en',
            sort_column: 'date',
            sort_order: 'DESC',
            filters: { status: 'pending' },
            row_count: 200,
        });
        // Verify all params present
        expect(qs).toContain('dataset=orders');
        expect(qs).toContain('offset=50');
        expect(qs).toContain('lang=en');
        expect(qs).toContain('sort_column=date');
        expect(qs).toContain('sort_order=DESC');
        expect(qs).toContain('status=pending');
        expect(qs).toContain('row_count=200');
    });
});
