import { describe, test, expect } from 'vitest';
import {
    groupFilters,
    buildFilterLabel,
    buildDisplayValue,
    buildDedupeKey,
    isTranslatableValue,
    formatRangeLabel,
} from './active_filter_tag_printer_helpers.js';

// ---------------------------------------------------------------------------
// groupFilters
// ---------------------------------------------------------------------------
describe('groupFilters', () => {
    test('groups range filters by base name', () => {
        const filters = {
            age_from: 18,
            age_to: 65,
        };
        const result = groupFilters(filters);
        expect(result).toEqual({
            age: {
                type: 'range',
                keys: ['age_from', 'age_to'],
                values: { from: 18, to: 65 },
            },
        });
    });

    test('creates single-value groups for non-range filters', () => {
        const filters = { status: 'active' };
        const result = groupFilters(filters);
        expect(result).toEqual({
            status: { baseKey: 'status', type: 'single', value: 'active', keys: ['status'] },
        });
    });

    test('skips search key', () => {
        const filters = { search: 'hello', status: 'active' };
        const result = groupFilters(filters);
        expect(result.search).toBeUndefined();
        expect(result.status).toBeDefined();
    });

    test('skips empty string values', () => {
        const filters = { name: '' };
        expect(groupFilters(filters)).toEqual({});
    });

    test('skips null values', () => {
        const filters = { name: null };
        expect(groupFilters(filters)).toEqual({});
    });

    test('skips undefined values', () => {
        const filters = { name: undefined };
        expect(groupFilters(filters)).toEqual({});
    });

    test('handles mixed range and single filters', () => {
        const filters = {
            status: 'active',
            price_from: 10,
            price_to: 100,
            category: 'tools',
        };
        const result = groupFilters(filters);
        expect(Object.keys(result)).toHaveLength(3);
        expect(result.price.type).toBe('range');
        expect(result.status.type).toBe('single');
        expect(result.category.type).toBe('single');
    });

    test('handles partial range (only _from)', () => {
        const filters = { date_from: '2024-01-01' };
        const result = groupFilters(filters);
        expect(result.date).toEqual({
            type: 'range',
            keys: ['date_from'],
            values: { from: '2024-01-01' },
        });
    });

    test('handles partial range (only _to)', () => {
        const filters = { date_to: '2024-12-31' };
        const result = groupFilters(filters);
        expect(result.date).toEqual({
            type: 'range',
            keys: ['date_to'],
            values: { to: '2024-12-31' },
        });
    });

    test('groups exclude filters under the base key and preserves the original key for removal', () => {
        const filters = { status_exclude: 'done,archived' };
        const result = groupFilters(filters);
        expect(result.status__exclude).toEqual({
            baseKey: 'status',
            type: 'single',
            value: 'done,archived',
            keys: ['status_exclude'],
            exclude: true,
        });
    });

    test('keeps include and exclude groups separate for the same base key', () => {
        const filters = { status: 'done', status_exclude: 'archived' };
        const result = groupFilters(filters);
        expect(result.status).toEqual({
            baseKey: 'status',
            type: 'single',
            value: 'done',
            keys: ['status'],
        });
        expect(result.status__exclude).toEqual({
            baseKey: 'status',
            type: 'single',
            value: 'archived',
            keys: ['status_exclude'],
            exclude: true,
        });
    });

    test('returns empty object for empty filters', () => {
        expect(groupFilters({})).toEqual({});
    });
});

// ---------------------------------------------------------------------------
// buildFilterLabel
// ---------------------------------------------------------------------------
describe('buildFilterLabel', () => {
    test('strips table name prefix', () => {
        expect(buildFilterLabel('users_age', 'users')).toBe('age');
    });

    test('returns base unchanged when no prefix match', () => {
        expect(buildFilterLabel('age', 'users')).toBe('age');
    });

    test('handles base that starts with table name but no underscore', () => {
        expect(buildFilterLabel('usersname', 'users')).toBe('usersname');
    });

    test('strips only the first occurrence of table prefix', () => {
        expect(buildFilterLabel('users_users_id', 'users')).toBe('users_id');
    });

    test('handles empty table name', () => {
        expect(buildFilterLabel('age', '')).toBe('age');
    });
});

// ---------------------------------------------------------------------------
// buildDisplayValue
// ---------------------------------------------------------------------------
describe('buildDisplayValue', () => {
    test('formats range with both values', () => {
        const data = { type: 'range', values: { from: 10, to: 20 } };
        expect(buildDisplayValue(data)).toBe('10-20');
    });

    test('formats range with only from', () => {
        const data = { type: 'range', values: { from: 10 } };
        expect(buildDisplayValue(data)).toBe('10-');
    });

    test('formats range with only to', () => {
        const data = { type: 'range', values: { to: 20 } };
        expect(buildDisplayValue(data)).toBe('-20');
    });

    test('returns string value for single type', () => {
        const data = { type: 'single', value: 'active' };
        expect(buildDisplayValue(data)).toBe('active');
    });

    test('converts numeric single value to string', () => {
        const data = { type: 'single', value: 42 };
        expect(buildDisplayValue(data)).toBe('42');
    });

    test('converts boolean single value to string', () => {
        const data = { type: 'single', value: true };
        expect(buildDisplayValue(data)).toBe('true');
    });
});

// ---------------------------------------------------------------------------
// buildDedupeKey
// ---------------------------------------------------------------------------
describe('buildDedupeKey', () => {
    test('combines label and value with separator', () => {
        expect(buildDedupeKey('age', '25')).toBe('age::25');
    });

    test('handles empty strings', () => {
        expect(buildDedupeKey('', '')).toBe('::');
    });
});

// ---------------------------------------------------------------------------
// isTranslatableValue
// ---------------------------------------------------------------------------
describe('isTranslatableValue', () => {
    test('returns true for "true"', () => {
        expect(isTranslatableValue('true')).toBe(true);
    });

    test('returns true for "false"', () => {
        expect(isTranslatableValue('false')).toBe(true);
    });

    test('returns true for "empty"', () => {
        expect(isTranslatableValue('empty')).toBe(true);
    });

    test('returns true for "all"', () => {
        expect(isTranslatableValue('all')).toBe(true);
    });

    test('is case-insensitive', () => {
        expect(isTranslatableValue('TRUE')).toBe(true);
        expect(isTranslatableValue('False')).toBe(true);
        expect(isTranslatableValue('EMPTY')).toBe(true);
    });

    test('returns false for other strings', () => {
        expect(isTranslatableValue('active')).toBe(false);
        expect(isTranslatableValue('hello')).toBe(false);
    });

    test('returns false for numbers', () => {
        expect(isTranslatableValue(42)).toBe(false);
    });

    test('handles boolean true value', () => {
        expect(isTranslatableValue(true)).toBe(true);
    });

    test('handles boolean false value', () => {
        expect(isTranslatableValue(false)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// formatRangeLabel
// ---------------------------------------------------------------------------
describe('formatRangeLabel', () => {
    test('formats full range', () => {
        expect(formatRangeLabel({ from: 10, to: 20 })).toBe(': 10 - 20');
    });

    test('formats from-only range', () => {
        expect(formatRangeLabel({ from: 10 })).toBe(' ≥ 10');
    });

    test('formats to-only range', () => {
        expect(formatRangeLabel({ to: 20 })).toBe(' ≤ 20');
    });

    test('returns empty string when both are missing', () => {
        expect(formatRangeLabel({})).toBe('');
    });

    test('handles string values', () => {
        expect(formatRangeLabel({ from: '2024-01-01', to: '2024-12-31' }))
            .toBe(': 2024-01-01 - 2024-12-31');
    });
});
