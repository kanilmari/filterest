import { describe, test, expect } from 'vitest';
import {
    getEditInputType,
    deriveForeignKeyColumnName,
    hasValueChanged,
    formatDateForInput,
    buildEditableColumnMapFromFullTreeData,
    resolveInlineEditTargetColumn,
    canInlineEditCell,
} from './cell_editor_helpers.js';

// ---------------------------------------------------------------------------
// getEditInputType
// ---------------------------------------------------------------------------
describe('getEditInputType', () => {
    test('returns datetime-local for timestamp types', () => {
        expect(getEditInputType('timestamp')).toBe('datetime-local');
        expect(getEditInputType('timestamp without time zone')).toBe('datetime-local');
        expect(getEditInputType('timestamp with time zone')).toBe('datetime-local');
    });

    test('returns date for date type', () => {
        expect(getEditInputType('date')).toBe('date');
    });

    test('returns number for integer types', () => {
        expect(getEditInputType('integer')).toBe('number');
        expect(getEditInputType('int')).toBe('number');
        expect(getEditInputType('bigint')).toBe('number');
        expect(getEditInputType('smallint')).toBe('number');
    });

    test('returns number for numeric type', () => {
        expect(getEditInputType('numeric')).toBe('number');
    });

    test('returns checkbox for boolean', () => {
        expect(getEditInputType('boolean')).toBe('checkbox');
    });

    test('returns text for string types', () => {
        expect(getEditInputType('text')).toBe('text');
        expect(getEditInputType('character varying')).toBe('text');
        expect(getEditInputType('varchar')).toBe('text');
    });

    test('returns text for null/undefined/empty', () => {
        expect(getEditInputType(null)).toBe('text');
        expect(getEditInputType(undefined)).toBe('text');
        expect(getEditInputType('')).toBe('text');
    });

    test('timestamp takes precedence over date substring', () => {
        // 'timestamp' contains 'date' would not match because 'timestamp' check comes first
        expect(getEditInputType('timestamp')).toBe('datetime-local');
    });
});

// ---------------------------------------------------------------------------
// deriveForeignKeyColumnName
// ---------------------------------------------------------------------------
describe('deriveForeignKeyColumnName', () => {
    const cols = ['id', 'status_id', 'status_name', 'category', 'category_name'];

    test('returns _id variant when it exists in columns', () => {
        expect(deriveForeignKeyColumnName('status_name', cols)).toBe('status_id');
    });

    test('falls back to stripping _name when _id variant missing', () => {
        expect(deriveForeignKeyColumnName('category_name', cols)).toBe('category');
    });

    test('returns null for non-_name columns', () => {
        expect(deriveForeignKeyColumnName('status_id', cols)).toBeNull();
        expect(deriveForeignKeyColumnName('id', cols)).toBeNull();
        expect(deriveForeignKeyColumnName('category', cols)).toBeNull();
    });

    test('returns null for null/undefined/empty input', () => {
        expect(deriveForeignKeyColumnName(null, cols)).toBeNull();
        expect(deriveForeignKeyColumnName(undefined, cols)).toBeNull();
        expect(deriveForeignKeyColumnName('', cols)).toBeNull();
    });

    test('returns stripped name even when neither variant exists in columns', () => {
        expect(deriveForeignKeyColumnName('unknown_name', cols)).toBe('unknown');
    });
});

// ---------------------------------------------------------------------------
// hasValueChanged
// ---------------------------------------------------------------------------
describe('hasValueChanged', () => {
    test('detects number changes with float comparison', () => {
        expect(hasValueChanged(10, '10', 'number')).toBe(false);
        expect(hasValueChanged(10, '10.0', 'number')).toBe(false);
        expect(hasValueChanged(10, '11', 'number')).toBe(true);
        expect(hasValueChanged(0, '0', 'number')).toBe(false);
    });

    test('handles NaN in number comparison (NaN !== NaN)', () => {
        // parseFloat('abc') is NaN, and NaN !== NaN is true in JS
        expect(hasValueChanged('abc', 'abc', 'number')).toBe(true);
    });

    test('detects checkbox value changes with strict equality', () => {
        expect(hasValueChanged(true, true, 'checkbox')).toBe(false);
        expect(hasValueChanged(true, false, 'checkbox')).toBe(true);
        expect(hasValueChanged(false, true, 'checkbox')).toBe(true);
    });

    test('detects text value changes with strict equality', () => {
        expect(hasValueChanged('hello', 'hello', 'text')).toBe(false);
        expect(hasValueChanged('hello', 'world', 'text')).toBe(true);
        expect(hasValueChanged('', '', 'text')).toBe(false);
    });

    test('text comparison is type-sensitive (no coercion)', () => {
        expect(hasValueChanged(10, '10', 'text')).toBe(true);
        expect(hasValueChanged(null, '', 'text')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// formatDateForInput
// ---------------------------------------------------------------------------
describe('formatDateForInput', () => {
    test('formats date for date input', () => {
        expect(formatDateForInput('2026-03-15T10:30:00Z', 'date')).toBe('2026-03-15');
    });

    test('formats date for datetime-local input', () => {
        expect(formatDateForInput(
            '2026-03-15 10:30:00',
            'datetime-local',
            'timestamp without time zone',
        )).toBe('2026-03-15T10:30');
    });

    test('does not timezone-shift a DATE returned with a midnight time part', () => {
        expect(formatDateForInput('2026-01-15 00:00:00', 'date', 'date')).toBe('2026-01-15');
    });

    test('returns empty string for invalid date', () => {
        expect(formatDateForInput('not-a-date', 'date')).toBe('');
        expect(formatDateForInput(null, 'date')).toBe('');
        expect(formatDateForInput(undefined, 'datetime-local')).toBe('');
    });

    test('returns empty string for non-date input types', () => {
        expect(formatDateForInput('2026-03-15', 'text')).toBe('');
        expect(formatDateForInput('2026-03-15', 'number')).toBe('');
    });

    test('handles Date object-compatible values', () => {
        expect(formatDateForInput('2026-01-01', 'date')).toBe('2026-01-01');
    });
});

// ---------------------------------------------------------------------------
// buildEditableColumnMapFromFullTreeData
// ---------------------------------------------------------------------------
describe('buildEditableColumnMapFromFullTreeData', () => {
    test('builds editable flags for the requested table only', () => {
        const raw = JSON.stringify({
            column_details: [
                { table_name: 'users', column_name: 'name', editable_in_ui: true },
                { table_name: 'users', column_name: 'role_id', editable_in_ui: false },
                { table_name: 'orders', column_name: 'status', editable_in_ui: true },
            ],
        });

        expect(buildEditableColumnMapFromFullTreeData(raw, 'users')).toEqual({
            name: { editable_in_ui: true },
            role_id: { editable_in_ui: false },
        });
    });

    test('returns empty map for malformed or missing cache', () => {
        expect(buildEditableColumnMapFromFullTreeData('{broken', 'users')).toEqual({});
        expect(buildEditableColumnMapFromFullTreeData(null, 'users')).toEqual({});
    });
});

// ---------------------------------------------------------------------------
// resolveInlineEditTargetColumn
// ---------------------------------------------------------------------------
describe('resolveInlineEditTargetColumn', () => {
    test('maps generated foreign-key display alias back to FK column', () => {
        const columns = ['status_id', 'status_name'];
        const dataTypes = {
            status_id: { foreign_table: 'statuses' },
        };

        expect(resolveInlineEditTargetColumn('status_name', columns, dataTypes)).toBe('status_id');
    });

    test('keeps direct columns unchanged', () => {
        expect(resolveInlineEditTargetColumn('title', ['title'], {})).toBe('title');
    });
});

// ---------------------------------------------------------------------------
// canInlineEditCell
// ---------------------------------------------------------------------------
describe('canInlineEditCell', () => {
    const fullTreeData = {
        column_details: [
            { table_name: 'users', column_name: 'name', editable_in_ui: true },
            { table_name: 'users', column_name: 'status_id', editable_in_ui: false },
        ],
    };

    test('returns false for non-editable direct columns', () => {
        expect(
            canInlineEditCell({
                columnName: 'status_id',
                columns: ['name', 'status_id'],
                dataTypes: {},
                tableName: 'users',
                fullTreeDataRaw: fullTreeData,
            })
        ).toBe(false);
    });

    test('returns false for foreign-key display aliases when source column is not editable', () => {
        expect(
            canInlineEditCell({
                columnName: 'status_name',
                columns: ['status_id', 'status_name'],
                dataTypes: {
                    status_id: { foreign_table: 'statuses' },
                },
                tableName: 'users',
                fullTreeDataRaw: fullTreeData,
            })
        ).toBe(false);
    });

    test('returns true when metadata is missing so backend remains the final guard', () => {
        expect(
            canInlineEditCell({
                columnName: 'unknown',
                columns: ['unknown'],
                dataTypes: {},
                tableName: 'users',
                fullTreeDataRaw: fullTreeData,
            })
        ).toBe(true);
    });
});
