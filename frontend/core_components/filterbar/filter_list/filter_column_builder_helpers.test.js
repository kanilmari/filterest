import { describe, test, expect } from 'vitest';
import {
    determineColumnCategory,
    buildTestIdSegment,
    buildGeneratedForeignDisplayAliasBase,
    categorizeColumns,
    orderFilterColumns,
    resolveFilterElementKind,
    areForeignFilterOptionValuesNumeric,
    normalizeGeneratedForeignDisplayAliasKey,
    shouldRetryForeignFilterOptionsWithSlug,
    shouldHideRedundantGeneratedForeignDisplayColumn,
} from './filter_column_builder_helpers.js';

// ---------------------------------------------------------------------------
// determineColumnCategory
// ---------------------------------------------------------------------------
describe('determineColumnCategory', () => {
    test('returns "id" for column named "id"', () => {
        expect(determineColumnCategory('id', 'integer')).toBe('id');
    });

    test('returns "additional_id" for columns ending with _id', () => {
        expect(determineColumnCategory('user_id', 'integer')).toBe('additional_id');
        expect(determineColumnCategory('parent_uid', 'integer')).toBe('additional_id');
    });

    test('returns "additional_id" case-insensitively', () => {
        expect(determineColumnCategory('USER_ID', 'integer')).toBe('additional_id');
        expect(determineColumnCategory('Parent_UID', 'bigint')).toBe('additional_id');
    });

    test('returns "numeric" for numeric data types', () => {
        expect(determineColumnCategory('amount', 'numeric')).toBe('numeric');
        expect(determineColumnCategory('count', 'integer')).toBe('numeric');
        expect(determineColumnCategory('total', 'bigint')).toBe('numeric');
        expect(determineColumnCategory('rank', 'smallint')).toBe('numeric');
        expect(determineColumnCategory('score', 'real')).toBe('numeric');
        expect(determineColumnCategory('price', 'double precision')).toBe('numeric');
    });

    test('returns "boolean" for boolean data type', () => {
        expect(determineColumnCategory('is_active', 'boolean')).toBe('boolean');
    });

    test('returns "linked" for columns ending with (linked) or (ln)', () => {
        expect(determineColumnCategory('category(linked)', 'text')).toBe('linked');
        expect(determineColumnCategory('status(ln)', 'text')).toBe('linked');
    });

    test('returns "date" for date/timestamp data types', () => {
        expect(determineColumnCategory('created_at', 'date')).toBe('date');
        expect(determineColumnCategory('updated_at', 'timestamp')).toBe('date');
        expect(determineColumnCategory('start', 'timestamp without time zone')).toBe('date');
        expect(determineColumnCategory('end', 'timestamp with time zone')).toBe('date');
    });

    test('returns "text" as fallback', () => {
        expect(determineColumnCategory('name', 'text')).toBe('text');
        expect(determineColumnCategory('description', 'varchar')).toBe('text');
        expect(determineColumnCategory('notes', '')).toBe('text');
    });

    test('_id suffix takes priority over numeric type', () => {
        expect(determineColumnCategory('parent_id', 'integer')).toBe('additional_id');
    });
});

// ---------------------------------------------------------------------------
// buildTestIdSegment
// ---------------------------------------------------------------------------
describe('buildTestIdSegment', () => {
    test('returns sanitized string for normal input', () => {
        expect(buildTestIdSegment('my_table')).toBe('my_table');
    });

    test('replaces special characters with dashes', () => {
        expect(buildTestIdSegment('foo bar!baz')).toBe('foo-bar-baz');
    });

    test('trims leading and trailing dashes', () => {
        expect(buildTestIdSegment('  !hello!  ')).toBe('hello');
    });

    test('returns "unknown" for null/undefined', () => {
        expect(buildTestIdSegment(null)).toBe('unknown');
        expect(buildTestIdSegment(undefined)).toBe('unknown');
    });

    test('returns "unknown" for empty string', () => {
        expect(buildTestIdSegment('')).toBe('unknown');
    });

    test('returns "unknown" for whitespace-only', () => {
        expect(buildTestIdSegment('   ')).toBe('unknown');
    });

    test('preserves hyphens and underscores', () => {
        expect(buildTestIdSegment('my-table_name')).toBe('my-table_name');
    });

    test('handles numeric input', () => {
        expect(buildTestIdSegment(42)).toBe('42');
    });
});

// ---------------------------------------------------------------------------
// resolveFilterElementKind
// ---------------------------------------------------------------------------
describe('resolveFilterElementKind', () => {
    test('prioritizes foreign keys over numeric data types', () => {
        expect(resolveFilterElementKind({
            data_type: 'integer',
            foreign_table: 'dev_agent_task_queues',
        })).toBe('foreign_key');
    });

    test('returns numeric/date/boolean/text kinds for non-FK columns', () => {
        expect(resolveFilterElementKind({ data_type: 'integer' })).toBe('numeric_range');
        expect(resolveFilterElementKind({ data_type: 'timestamp with time zone' })).toBe('date_range');
        expect(resolveFilterElementKind({ data_type: 'boolean' })).toBe('boolean_select');
        expect(resolveFilterElementKind({ data_type: 'text' })).toBe('text_input');
    });
});

// ---------------------------------------------------------------------------
// foreign filter option fallback
// ---------------------------------------------------------------------------
describe('foreign filter option fallback', () => {
    test('detects numeric foreign-key option values', () => {
        expect(areForeignFilterOptionValuesNumeric([
            { value: 1 },
            { value: '7' },
            { value: '10' },
        ])).toBe(true);
    });

    test('ignores non-numeric or empty foreign-key option values', () => {
        expect(areForeignFilterOptionValuesNumeric([
            { value: 'in_progress' },
            { value: 'done' },
        ])).toBe(false);
        expect(areForeignFilterOptionValuesNumeric([])).toBe(false);
    });

    test('retries text-backed foreign keys with slug when only numeric ids are available', () => {
        expect(shouldRetryForeignFilterOptionsWithSlug(
            'status',
            {
                data_type: 'text',
                foreign_table: 'dev_agent_task_statuses',
            },
            [{ value: 1, label: 'In Progress' }],
            'id',
        )).toBe(true);
    });

    test('does not retry when metadata already provides the foreign text column', () => {
        expect(shouldRetryForeignFilterOptionsWithSlug(
            'status',
            {
                data_type: 'text',
                foreign_table: 'dev_agent_task_statuses',
                foreign_column: 'slug',
            },
            [{ value: 1, label: 'In Progress' }],
            'slug',
        )).toBe(false);
    });

    test('does not retry numeric foreign keys that genuinely store ids', () => {
        expect(shouldRetryForeignFilterOptionsWithSlug(
            'queue_id',
            {
                data_type: 'integer',
                foreign_table: 'dev_agent_task_queues',
            },
            [{ value: 1, label: 'Inbox' }],
            'id',
        )).toBe(false);
    });

    test('does not retry text foreign keys for *_id columns', () => {
        expect(shouldRetryForeignFilterOptionsWithSlug(
            'status_id',
            {
                data_type: 'text',
                foreign_table: 'dev_agent_task_statuses',
            },
            [{ value: 1, label: 'In Progress' }],
            'id',
        )).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// generated foreign display aliases
// ---------------------------------------------------------------------------
describe('generated foreign display aliases', () => {
    test('builds generated FK alias base names for plain and id-backed relations', () => {
        expect(buildGeneratedForeignDisplayAliasBase('status')).toBe('status_name');
        expect(buildGeneratedForeignDisplayAliasBase('queue_id')).toBe('queue_name');
        expect(buildGeneratedForeignDisplayAliasBase('parent_uid')).toBe('parent_name');
    });

    test('normalizes generated FK alias suffixes for safe comparisons', () => {
        expect(normalizeGeneratedForeignDisplayAliasKey('queue_name (ln)')).toBe('queue_name');
        expect(normalizeGeneratedForeignDisplayAliasKey('queue_name (ln 2)')).toBe('queue_name');
    });

    test('hides generated FK display aliases when the source FK filter is visible', () => {
        const columns = ['status', 'status_name', 'title'];
        const dataTypes = {
            status: { data_type: 'text', foreign_table: 'task_statuses' },
            status_name: { data_type: 'text' },
            title: { data_type: 'text' },
        };

        expect(
            shouldHideRedundantGeneratedForeignDisplayColumn('status_name', columns, dataTypes)
        ).toBe(true);
        expect(
            shouldHideRedundantGeneratedForeignDisplayColumn('title', columns, dataTypes)
        ).toBe(false);
    });

    test('keeps generated FK display aliases when the source FK filter is hidden', () => {
        const columns = ['status', 'status_name'];
        const dataTypes = {
            status: {
                data_type: 'text',
                foreign_table: 'task_statuses',
                hide_in_filter_panel: true,
            },
            status_name: { data_type: 'text' },
        };

        expect(
            shouldHideRedundantGeneratedForeignDisplayColumn('status_name', columns, dataTypes)
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// categorizeColumns
// ---------------------------------------------------------------------------
describe('categorizeColumns', () => {
    test('categorizes mixed columns correctly', () => {
        const columns = ['id', 'name', 'amount', 'is_active', 'created_at', 'parent_id', 'status(linked)'];
        const dataTypes = {
            id: 'integer',
            name: 'text',
            amount: 'numeric',
            is_active: 'boolean',
            created_at: 'timestamp',
            parent_id: 'integer',
            'status(linked)': 'text',
        };

        const result = categorizeColumns(columns, dataTypes);
        expect(result.id).toEqual(['id']);
        expect(result.numeric).toEqual(['amount']);
        expect(result.boolean).toEqual(['is_active']);
        expect(result.date).toEqual(['created_at']);
        expect(result.additional_id).toEqual(['parent_id']);
        expect(result.linked).toEqual(['status(linked)']);
        expect(result.text).toEqual(['name']);
    });

    test('handles object-style data types with data_type property', () => {
        const columns = ['score'];
        const dataTypes = { score: { data_type: 'numeric' } };

        const result = categorizeColumns(columns, dataTypes);
        expect(result.numeric).toEqual(['score']);
    });

    test('returns empty arrays for empty input', () => {
        const result = categorizeColumns([], {});
        expect(result.id).toEqual([]);
        expect(result.text).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// orderFilterColumns
// ---------------------------------------------------------------------------
describe('orderFilterColumns', () => {
    test('puts id, numeric, boolean, linked, date in main', () => {
        const categorized = {
            id: ['id'],
            numeric: ['amount'],
            boolean: ['is_active'],
            linked: ['category(linked)'],
            date: ['created_at'],
            text: ['name', 'description'],
            additional_id: ['parent_id'],
        };

        const result = orderFilterColumns(categorized);
        expect(result.main).toEqual(['id', 'amount', 'is_active', 'category(linked)', 'created_at']);
        expect(result.hidden).toEqual(['name', 'description', 'parent_id']);
    });

    test('returns empty arrays when all categories are empty', () => {
        const categorized = {
            id: [], numeric: [], boolean: [], linked: [],
            text: [], date: [], additional_id: [],
        };

        const result = orderFilterColumns(categorized);
        expect(result.main).toEqual([]);
        expect(result.hidden).toEqual([]);
    });

    test('preserves order within each category', () => {
        const categorized = {
            id: [], numeric: ['b_count', 'a_count'], boolean: [],
            linked: [], text: [], date: [], additional_id: [],
        };

        const result = orderFilterColumns(categorized);
        expect(result.main).toEqual(['b_count', 'a_count']);
    });
});
