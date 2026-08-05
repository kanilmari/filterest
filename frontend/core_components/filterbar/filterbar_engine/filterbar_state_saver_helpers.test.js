import { describe, test, expect } from 'vitest';
import {
    buildOpenFiltersKey,
    buildOverflowExpandedKey,
    parseOpenFilters,
    parseOverflowExpanded,
    serializeOpenFilters,
    serializeOverflowExpanded,
} from './filterbar_state_saver_helpers.js';

// ---------------------------------------------------------------------------
// buildOpenFiltersKey
// ---------------------------------------------------------------------------
describe('buildOpenFiltersKey', () => {
    test('appends suffix to table name', () => {
        expect(buildOpenFiltersKey('users')).toBe('users_open_filters');
    });

    test('works with empty string', () => {
        expect(buildOpenFiltersKey('')).toBe('_open_filters');
    });

    test('preserves special characters in table name', () => {
        expect(buildOpenFiltersKey('my-table_v2')).toBe('my-table_v2_open_filters');
    });
});

describe('buildOverflowExpandedKey', () => {
    test('appends overflow suffix to table name', () => {
        expect(buildOverflowExpandedKey('users')).toBe('users_overflow_filters_expanded');
    });

    test('works with empty string', () => {
        expect(buildOverflowExpandedKey('')).toBe('_overflow_filters_expanded');
    });
});

// ---------------------------------------------------------------------------
// parseOpenFilters
// ---------------------------------------------------------------------------
describe('parseOpenFilters', () => {
    test('parses valid JSON array', () => {
        expect(parseOpenFilters('["a","b","c"]')).toEqual(['a', 'b', 'c']);
    });

    test('parses empty array', () => {
        expect(parseOpenFilters('[]')).toEqual([]);
    });

    test('returns empty array for null', () => {
        expect(parseOpenFilters(null)).toEqual([]);
    });

    test('returns empty array for undefined', () => {
        expect(parseOpenFilters(undefined)).toEqual([]);
    });

    test('returns empty array for empty string', () => {
        expect(parseOpenFilters('')).toEqual([]);
    });

    test('returns empty array for invalid JSON', () => {
        expect(parseOpenFilters('{broken')).toEqual([]);
    });

    test('returns empty array for non-array JSON (object)', () => {
        expect(parseOpenFilters('{"key":"value"}')).toEqual([]);
    });

    test('returns empty array for non-array JSON (string)', () => {
        expect(parseOpenFilters('"hello"')).toEqual([]);
    });

    test('returns empty array for non-array JSON (number)', () => {
        expect(parseOpenFilters('42')).toEqual([]);
    });

    test('parses array of numbers', () => {
        expect(parseOpenFilters('[1,2,3]')).toEqual([1, 2, 3]);
    });
});

describe('parseOverflowExpanded', () => {
    test('parses string true as true', () => {
        expect(parseOverflowExpanded('true')).toBe(true);
    });

    test('parses JSON true as true', () => {
        expect(parseOverflowExpanded(' true ')).toBe(true);
    });

    test('returns false for string false', () => {
        expect(parseOverflowExpanded('false')).toBe(false);
    });

    test('returns false for null', () => {
        expect(parseOverflowExpanded(null)).toBe(false);
    });

    test('returns false for invalid JSON', () => {
        expect(parseOverflowExpanded('{broken')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// serializeOpenFilters
// ---------------------------------------------------------------------------
describe('serializeOpenFilters', () => {
    test('serializes array to JSON string', () => {
        expect(serializeOpenFilters(['a', 'b'])).toBe('["a","b"]');
    });

    test('serializes empty array', () => {
        expect(serializeOpenFilters([])).toBe('[]');
    });

    test('defaults to empty array when called with no args', () => {
        expect(serializeOpenFilters()).toBe('[]');
    });

    test('serializes array of numbers', () => {
        expect(serializeOpenFilters([1, 2, 3])).toBe('[1,2,3]');
    });
});

describe('serializeOverflowExpanded', () => {
    test('serializes true as JSON boolean', () => {
        expect(serializeOverflowExpanded(true)).toBe('true');
    });

    test('serializes false as JSON boolean', () => {
        expect(serializeOverflowExpanded(false)).toBe('false');
    });

    test('defaults to false when called with no args', () => {
        expect(serializeOverflowExpanded()).toBe('false');
    });
});
