import { describe, test, expect } from 'vitest';
import {
    getPrefixFromPathname,
    parseDeepLink,
    buildParamsFromParsed,
    isDatasetBasePath,
    isDatasetRowPath,
} from './history_navigation_handler_helpers.js';

const DATASET_PREFIX = '/';

// ---------------------------------------------------------------------------
// getPrefixFromPathname
// ---------------------------------------------------------------------------
describe('getPrefixFromPathname', () => {
    test('returns /admin/ for admin paths', () => {
        expect(getPrefixFromPathname('/admin/users', DATASET_PREFIX)).toBe('/admin/');
        expect(getPrefixFromPathname('/admin/', DATASET_PREFIX)).toBe('/admin/');
    });

    test('returns null for root path', () => {
        expect(getPrefixFromPathname('/', DATASET_PREFIX)).toBeNull();
    });

    test('returns null for /api/ paths', () => {
        expect(getPrefixFromPathname('/api/login', DATASET_PREFIX)).toBeNull();
    });

    test('returns null for /frontend/ paths', () => {
        expect(getPrefixFromPathname('/frontend/main.js', DATASET_PREFIX)).toBeNull();
    });

    test('returns dataset prefix for normal dataset paths', () => {
        expect(getPrefixFromPathname('/elections', DATASET_PREFIX)).toBe('/');
        expect(getPrefixFromPathname('/candidates', DATASET_PREFIX)).toBe('/');
    });

    test('uses custom dataset prefix', () => {
        expect(getPrefixFromPathname('/data/elections', '/data/')).toBe('/data/');
    });
});

// ---------------------------------------------------------------------------
// parseDeepLink
// ---------------------------------------------------------------------------
describe('parseDeepLink', () => {
    test('returns name and null rowId for simple names', () => {
        expect(parseDeepLink('elections')).toEqual({
            name: 'elections',
            deepLinkedRowId: null,
        });
    });

    test('extracts row ID from deep link', () => {
        expect(parseDeepLink('elections/42')).toEqual({
            name: 'elections',
            deepLinkedRowId: '42',
        });
    });

    test('strips SEO slug from row ID', () => {
        expect(parseDeepLink('elections/125-some-title')).toEqual({
            name: 'elections',
            deepLinkedRowId: '125',
        });
    });

    test('maps aliased public dataset names back to raw table names', () => {
        expect(parseDeepLink('service_catalog')).toEqual({
            name: 'app_service_catalog',
            deepLinkedRowId: null,
        });
    });

    test('maps aliased row deep links back to raw table names', () => {
        expect(parseDeepLink('service_catalog/42-some-title')).toEqual({
            name: 'app_service_catalog',
            deepLinkedRowId: '42',
        });
    });

    test('handles slug with multiple dashes', () => {
        expect(parseDeepLink('candidates/7-john-doe-2026')).toEqual({
            name: 'candidates',
            deepLinkedRowId: '7',
        });
    });

    test('returns original name when slash is trailing', () => {
        // "elections/" → baseName="elections", rowIdPart="" → empty, so no match
        expect(parseDeepLink('elections/')).toEqual({
            name: 'elections/',
            deepLinkedRowId: null,
        });
    });

    test('returns original name when base is empty', () => {
        // "/42" → baseName="", rowIdPart="42" → baseName empty, no match
        expect(parseDeepLink('/42')).toEqual({
            name: '/42',
            deepLinkedRowId: null,
        });
    });

    test('handles dash at position 0 (no numeric prefix)', () => {
        // "elections/-slug" → dashIdx=0, so rowIdPart stays "-slug"
        expect(parseDeepLink('elections/-slug')).toEqual({
            name: 'elections',
            deepLinkedRowId: '-slug',
        });
    });
});

// ---------------------------------------------------------------------------
// buildParamsFromParsed
// ---------------------------------------------------------------------------
describe('buildParamsFromParsed', () => {
    test('includes only filters when no sort or offset', () => {
        const parsed = {
            filters: { status: 'active', type: 'primary' },
            sort: { column: null, direction: null },
            offset: 0,
        };
        expect(buildParamsFromParsed(parsed)).toEqual({
            status: 'active',
            type: 'primary',
        });
    });

    test('includes sort_column and sort_order when present', () => {
        const parsed = {
            filters: {},
            sort: { column: 'name', direction: 'asc' },
            offset: 0,
        };
        expect(buildParamsFromParsed(parsed)).toEqual({
            sort_column: 'name',
            sort_order: 'asc',
        });
    });

    test('includes offset as string when > 0', () => {
        const parsed = {
            filters: {},
            sort: { column: null, direction: null },
            offset: 50,
        };
        expect(buildParamsFromParsed(parsed)).toEqual({
            offset: '50',
        });
    });

    test('combines all fields', () => {
        const parsed = {
            filters: { region: 'north' },
            sort: { column: 'date', direction: 'desc' },
            offset: 100,
            search: 'firefox',
            view: 'article',
        };
        expect(buildParamsFromParsed(parsed)).toEqual({
            region: 'north',
            sort_column: 'date',
            sort_order: 'desc',
            offset: '100',
            search: 'firefox',
            view: 'article',
        });
    });

    test('returns empty object when all fields are empty/zero', () => {
        const parsed = {
            filters: {},
            sort: { column: null, direction: null },
            offset: 0,
        };
        expect(buildParamsFromParsed(parsed)).toEqual({});
    });

    test('excludes sort_order if only sort_column is set', () => {
        const parsed = {
            filters: {},
            sort: { column: 'name', direction: null },
            offset: 0,
        };
        expect(buildParamsFromParsed(parsed)).toEqual({
            sort_column: 'name',
        });
    });
});

describe('dataset path helpers', () => {
    test('recognizes alias base paths for the expected raw dataset', () => {
        expect(isDatasetBasePath('/service_catalog', DATASET_PREFIX, 'app_service_catalog')).toBe(true);
    });

    test('rejects row deep links when checking for a base dataset path', () => {
        expect(isDatasetBasePath('/service_catalog/42-some-title', DATASET_PREFIX, 'app_service_catalog')).toBe(false);
    });

    test('recognizes alias row deep links for the expected raw dataset', () => {
        expect(isDatasetRowPath('/service_catalog/42-some-title', DATASET_PREFIX, 'app_service_catalog')).toBe(true);
    });
});
