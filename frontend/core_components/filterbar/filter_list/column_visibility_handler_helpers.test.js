import { describe, test, expect, vi } from 'vitest';
import {
    makeColumnClass,
    buildCssHideRules,
    parseHiddenColumns,
    isColumnVisible,
} from './column_visibility_handler_helpers.js';

// ---------------------------------------------------------------------------
// makeColumnClass
// ---------------------------------------------------------------------------
describe('makeColumnClass', () => {
    test('returns prefixed class for normal inputs', () => {
        expect(makeColumnClass('orders', 'status')).toBe('column_orders_status');
    });

    test('strips whitespace from both parts', () => {
        expect(makeColumnClass('my table', 'col name')).toBe('column_mytable_colname');
    });

    test('strips parentheses', () => {
        expect(makeColumnClass('tbl(1)', 'col(x)')).toBe('column_tbl1_colx');
    });

    test('returns empty string for empty tableName', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(makeColumnClass('', 'col')).toBe('');
        spy.mockRestore();
    });

    test('returns empty string for null tableName', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(makeColumnClass(null, 'col')).toBe('');
        spy.mockRestore();
    });

    test('returns empty string for undefined tableName', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(makeColumnClass(undefined, 'col')).toBe('');
        spy.mockRestore();
    });

    test('handles null columnName gracefully', () => {
        expect(makeColumnClass('tbl', null)).toBe('column_tbl_');
    });

    test('handles undefined columnName gracefully', () => {
        expect(makeColumnClass('tbl', undefined)).toBe('column_tbl_');
    });

    test('handles numeric-coercible inputs', () => {
        expect(makeColumnClass('tbl', 42)).toBe('column_tbl_42');
    });
});

// ---------------------------------------------------------------------------
// buildCssHideRules
// ---------------------------------------------------------------------------
describe('buildCssHideRules', () => {
    test('generates one rule per hidden column', () => {
        const result = buildCssHideRules({ age: true, name: true }, 'users');
        expect(result).toContain('.column_users_age');
        expect(result).toContain('.column_users_name');
        expect(result.split('\n')).toHaveLength(2);
    });

    test('each rule hides the shared field class in every dataset presentation', () => {
        const result = buildCssHideRules({ status: true }, 'orders');
        expect(result).toBe(
            '.column_orders_status { display: none !important; }'
        );
    });

    test('does not exempt card fields from field-set visibility', () => {
        const css = buildCssHideRules({ description: true }, 'orders');

        expect(css).toBe(
            '.column_orders_description { display: none !important; }'
        );
        expect(css).not.toContain('data-hide-field-on-card');
    });

    test('returns empty string for empty hiddenMap', () => {
        expect(buildCssHideRules({}, 'tbl')).toBe('');
    });

    test('returns empty string for null hiddenMap', () => {
        expect(buildCssHideRules(null, 'tbl')).toBe('');
    });

    test('returns empty string for undefined hiddenMap', () => {
        expect(buildCssHideRules(undefined, 'tbl')).toBe('');
    });

    test('skips columns that produce empty class (bad tableName)', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = buildCssHideRules({ col: true }, '');
        expect(result).toBe('');
        spy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// parseHiddenColumns
// ---------------------------------------------------------------------------
describe('parseHiddenColumns', () => {
    test('parses valid JSON object', () => {
        expect(parseHiddenColumns('{"age":true}')).toEqual({ age: true });
    });

    test('returns empty object for null', () => {
        expect(parseHiddenColumns(null)).toEqual({});
    });

    test('returns empty object for empty string', () => {
        expect(parseHiddenColumns('')).toEqual({});
    });

    test('returns empty object for undefined', () => {
        expect(parseHiddenColumns(undefined)).toEqual({});
    });

    test('returns empty object for invalid JSON', () => {
        expect(parseHiddenColumns('{bad')).toEqual({});
    });

    test('parses empty JSON object', () => {
        expect(parseHiddenColumns('{}')).toEqual({});
    });
});

// ---------------------------------------------------------------------------
// isColumnVisible
// ---------------------------------------------------------------------------
describe('isColumnVisible', () => {
    const hidden = { age: true, status: true };

    test('returns false for hidden column', () => {
        expect(isColumnVisible(hidden, 'age')).toBe(false);
    });

    test('returns true for visible column', () => {
        expect(isColumnVisible(hidden, 'name')).toBe(true);
    });

    test('returns true when hiddenMap is empty', () => {
        expect(isColumnVisible({}, 'anything')).toBe(true);
    });

    test('returns true for undefined column name in map', () => {
        expect(isColumnVisible(hidden, 'nonexistent')).toBe(true);
    });
});
