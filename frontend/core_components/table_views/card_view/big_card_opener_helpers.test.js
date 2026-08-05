import { describe, test, expect } from 'vitest';
import {
    buildSlug,
    buildCreationSeed,
    extractRowId,
    sortColumnsByRole,
    buildCardUrl,
} from './big_card_opener_helpers.js';

// ---------------------------------------------------------------------------
// buildSlug
// ---------------------------------------------------------------------------
describe('buildSlug', () => {
    test('converts simple text to lowercase slug', () => {
        expect(buildSlug('Hello World')).toBe('hello-world');
    });

    test('strips diacritics', () => {
        expect(buildSlug('Héllo Wörld')).toBe('hello-world');
    });

    test('removes special characters', () => {
        expect(buildSlug('Hello! @World#')).toBe('hello-world');
    });

    test('collapses multiple spaces and hyphens', () => {
        expect(buildSlug('Hello   World')).toBe('hello-world');
        expect(buildSlug('Hello---World')).toBe('hello-world');
    });

    test('trims leading and trailing hyphens', () => {
        expect(buildSlug(' -Hello- ')).toBe('hello');
    });

    test('truncates to 80 characters', () => {
        const long = 'a'.repeat(100);
        expect(buildSlug(long)).toHaveLength(80);
    });

    test('returns empty string for empty/null/undefined input', () => {
        expect(buildSlug('')).toBe('');
        expect(buildSlug(null)).toBe('');
        expect(buildSlug(undefined)).toBe('');
    });

    test('returns empty string when all characters are special', () => {
        expect(buildSlug('!@#$%')).toBe('');
    });

    test('handles Finnish characters', () => {
        expect(buildSlug('Äänestys päätös')).toBe('aanestys-paatos');
    });
});

// ---------------------------------------------------------------------------
// buildCreationSeed
// ---------------------------------------------------------------------------
describe('buildCreationSeed', () => {
    test('combines id and created timestamp', () => {
        expect(buildCreationSeed({ id: 42, created: '2024-01-01' }))
            .toBe('42_2024-01-01');
    });

    test('uses created_at as fallback', () => {
        expect(buildCreationSeed({ id: 1, created_at: '2024-06-15' }))
            .toBe('1_2024-06-15');
    });

    test('uses luontiaika as fallback', () => {
        expect(buildCreationSeed({ id: 5, luontiaika: '2024-03-10' }))
            .toBe('5_2024-03-10');
    });

    test('prefers created over created_at', () => {
        expect(buildCreationSeed({ id: 1, created: 'A', created_at: 'B' }))
            .toBe('1_A');
    });

    test('returns id only when no creation field exists', () => {
        expect(buildCreationSeed({ id: 99 })).toBe('99');
    });

    test('returns unknown_id when id is missing', () => {
        expect(buildCreationSeed({})).toBe('unknown_id');
    });

    test('returns unknown_id with creation when id is missing', () => {
        expect(buildCreationSeed({ created: '2024-01-01' }))
            .toBe('unknown_id_2024-01-01');
    });

    test('handles id of 0', () => {
        expect(buildCreationSeed({ id: 0 })).toBe('0');
    });
});

// ---------------------------------------------------------------------------
// extractRowId
// ---------------------------------------------------------------------------
describe('extractRowId', () => {
    test('returns string id for numeric id', () => {
        expect(extractRowId({ id: 42 })).toBe('42');
    });

    test('returns string id for string id', () => {
        expect(extractRowId({ id: 'abc' })).toBe('abc');
    });

    test('returns null when id is not present', () => {
        expect(extractRowId({})).toBeNull();
    });

    test('handles id of 0', () => {
        expect(extractRowId({ id: 0 })).toBe('0');
    });

    test('handles empty string id', () => {
        expect(extractRowId({ id: '' })).toBe('');
    });
});

// ---------------------------------------------------------------------------
// sortColumnsByRole
// ---------------------------------------------------------------------------
describe('sortColumnsByRole', () => {
    test('puts columns with card_element before those without', () => {
        const cols = ['name', 'age', 'email'];
        const types = {
            name: {},
            age: { card_element: 'header' },
            email: {},
        };
        expect(sortColumnsByRole(cols, types)).toEqual(['age', 'name', 'email']);
    });

    test('preserves order when all have roles', () => {
        const cols = ['a', 'b'];
        const types = {
            a: { card_element: 'header' },
            b: { card_element: 'details' },
        };
        expect(sortColumnsByRole(cols, types)).toEqual(['a', 'b']);
    });

    test('preserves order when none have roles', () => {
        const cols = ['x', 'y', 'z'];
        const types = { x: {}, y: {}, z: {} };
        expect(sortColumnsByRole(cols, types)).toEqual(['x', 'y', 'z']);
    });

    test('does not mutate input array', () => {
        const cols = ['a', 'b'];
        const types = { a: {}, b: { card_element: 'header' } };
        const original = [...cols];
        sortColumnsByRole(cols, types);
        expect(cols).toEqual(original);
    });

    test('handles empty dataTypes gracefully', () => {
        const cols = ['a', 'b'];
        expect(sortColumnsByRole(cols, {})).toEqual(['a', 'b']);
    });

    test('handles empty columns', () => {
        expect(sortColumnsByRole([], {})).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// buildCardUrl
// ---------------------------------------------------------------------------
describe('buildCardUrl', () => {
    test('builds URL with slug', () => {
        expect(buildCardUrl('/d/', 'users', '42', 'john-doe'))
            .toBe('/d/users/42-john-doe');
    });

    test('builds URL without slug', () => {
        expect(buildCardUrl('/d/', 'users', '42', ''))
            .toBe('/d/users/42');
    });

    test('prefers the public dataset alias when one exists', () => {
        expect(buildCardUrl('/', 'app_service_catalog', '42', 'sample-title'))
            .toBe('/service_catalog/42-sample-title');
    });

    test('handles different prefix formats', () => {
        expect(buildCardUrl('/dataset/', 'items', '1', 'test'))
            .toBe('/dataset/items/1-test');
    });

    test('keeps the card URL canonical even when the dataset view had filters', () => {
        expect(buildCardUrl('/d/', 'users', '42', 'john-doe'))
            .toBe('/d/users/42-john-doe');
    });
});
