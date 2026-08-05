import { describe, test, expect } from 'vitest';
import {
    computeIdCellIndex,
    parseIdFromText,
    parseRowObject,
} from './selected_items_reader_helpers.js';

// ---------------------------------------------------------------------------
// computeIdCellIndex
// ---------------------------------------------------------------------------
describe('computeIdCellIndex', () => {
    test('returns correct index when id is first column', () => {
        expect(computeIdCellIndex(['id', 'name', 'email'])).toBe(2);
    });

    test('returns correct index when id is in the middle', () => {
        expect(computeIdCellIndex(['name', 'id', 'email'])).toBe(3);
    });

    test('returns correct index when id is last column', () => {
        expect(computeIdCellIndex(['name', 'email', 'id'])).toBe(4);
    });

    test('returns -1 when id column is absent', () => {
        expect(computeIdCellIndex(['name', 'email', 'status'])).toBe(-1);
    });

    test('returns -1 for empty columns array', () => {
        expect(computeIdCellIndex([])).toBe(-1);
    });
});

// ---------------------------------------------------------------------------
// parseIdFromText
// ---------------------------------------------------------------------------
describe('parseIdFromText', () => {
    test('parses a valid integer string', () => {
        expect(parseIdFromText('42')).toBe(42);
    });

    test('parses a string with leading whitespace', () => {
        expect(parseIdFromText('  7')).toBe(7);
    });

    test('parses a negative integer', () => {
        expect(parseIdFromText('-3')).toBe(-3);
    });

    test('parses a string with trailing non-numeric chars (parseInt behavior)', () => {
        expect(parseIdFromText('123abc')).toBe(123);
    });

    test('returns null for non-numeric string', () => {
        expect(parseIdFromText('abc')).toBeNull();
    });

    test('returns null for empty string', () => {
        expect(parseIdFromText('')).toBeNull();
    });

    test('parses zero', () => {
        expect(parseIdFromText('0')).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// parseRowObject
// ---------------------------------------------------------------------------
describe('parseRowObject', () => {
    test('maps columns to cell texts with +2 offset', () => {
        const columns = ['id', 'name', 'email'];
        const cellTexts = ['1', '✓', '100', 'Alice', 'alice@test.com'];
        expect(parseRowObject(columns, cellTexts)).toEqual({
            id: '100',
            name: 'Alice',
            email: 'alice@test.com',
        });
    });

    test('skips columns when cellTexts is too short', () => {
        const columns = ['id', 'name', 'email'];
        const cellTexts = ['1', '✓', '100']; // only enough for id
        expect(parseRowObject(columns, cellTexts)).toEqual({
            id: '100',
        });
    });

    test('returns empty object for empty columns', () => {
        expect(parseRowObject([], ['a', 'b', 'c'])).toEqual({});
    });

    test('returns empty object when cellTexts has fewer than 3 items', () => {
        const columns = ['id', 'name'];
        const cellTexts = ['1']; // only numbering column, no data columns reachable
        expect(parseRowObject(columns, cellTexts)).toEqual({});
    });

    test('handles single column correctly', () => {
        const columns = ['status'];
        const cellTexts = ['1', '✓', 'active'];
        expect(parseRowObject(columns, cellTexts)).toEqual({ status: 'active' });
    });
});
