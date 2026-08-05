import { describe, test, expect } from 'vitest';
import {
    resolveMultilingualValue,
    reconstructMultilingualValue,
    resolveInputType,
    buildColumnInfoMap,
    buildGeneratedForeignDisplayAliasBase,
    normalizeGeneratedForeignDisplayAliasKey,
    getGeneratedForeignDisplayColumn,
    isGeneratedForeignDisplayColumn,
    resolveCardFieldDisplayValue,
    normalizeTicketStatusForClient,
    normalizeTicketStatusForDb,
    isTicketStatusField,
    getTicketStatusOptions,
    getTicketStatusTone,
} from './card_field_formatter_helpers.js';

// ---------------------------------------------------------------------------
// resolveMultilingualValue
// ---------------------------------------------------------------------------
describe('resolveMultilingualValue', () => {
    test('returns null for empty/null input', () => {
        expect(resolveMultilingualValue(null, false, 'en')).toBeNull();
        expect(resolveMultilingualValue('', false, 'en')).toBeNull();
        expect(resolveMultilingualValue(undefined, false, 'en')).toBeNull();
    });

    test('returns null for non-JSON strings', () => {
        expect(resolveMultilingualValue('hello', false, 'en')).toBeNull();
        expect(resolveMultilingualValue('123', false, 'en')).toBeNull();
    });

    test('returns null for JSON arrays', () => {
        expect(resolveMultilingualValue('[1,2,3]', false, 'en')).toBeNull();
    });

    test('returns null for non-multilingual objects without meta flag', () => {
        const json = JSON.stringify({ name: 'test', count: '5' });
        expect(resolveMultilingualValue(json, false, 'en')).toBeNull();
    });

    test('detects multilingual via heuristic (2-letter keys)', () => {
        const json = JSON.stringify({ fi: 'Moi', en: 'Hello', sv: 'Hej' });
        const result = resolveMultilingualValue(json, false, 'fi');
        expect(result).toEqual({
            displayText: 'Moi',
            multiLangObj: { fi: 'Moi', en: 'Hello', sv: 'Hej' },
            editLang: 'fi',
        });
    });

    test('detects and selects three-letter Cantonese yue values', () => {
        const json = JSON.stringify({ en: 'Services', fi: 'Palvelut', yue: '服務' });
        const result = resolveMultilingualValue(json, false, 'yue');
        expect(result).toEqual({
            displayText: '服務',
            multiLangObj: { en: 'Services', fi: 'Palvelut', yue: '服務' },
            editLang: 'yue',
        });
    });

    test('detects multilingual via metadata flag even with non-lang keys', () => {
        const json = JSON.stringify({ english: 'Hello', finnish: 'Moi' });
        const result = resolveMultilingualValue(json, true, 'english');
        expect(result).toEqual({
            displayText: 'Hello',
            multiLangObj: { english: 'Hello', finnish: 'Moi' },
            editLang: 'english',
        });
    });

    test('falls back to en when preferred lang not found', () => {
        const json = JSON.stringify({ fi: 'Moi', en: 'Hello' });
        const result = resolveMultilingualValue(json, false, 'sv');
        expect(result.displayText).toBe('Hello');
        expect(result.editLang).toBe('sv');
    });

    test('falls back to first key when neither preferred nor en found', () => {
        const json = JSON.stringify({ fi: 'Moi', sv: 'Hej' });
        const result = resolveMultilingualValue(json, false, 'de');
        expect(result.displayText).toBe('Moi');
    });

    test('defaults editLang to en when preferredLang is falsy', () => {
        const json = JSON.stringify({ en: 'Hello', fi: 'Moi' });
        const result = resolveMultilingualValue(json, false, '');
        expect(result.editLang).toBe('en');
        expect(result.displayText).toBe('Hello');
    });

    test('returns null for invalid JSON', () => {
        expect(resolveMultilingualValue('{broken', false, 'en')).toBeNull();
    });

    test('returns null for empty object', () => {
        expect(resolveMultilingualValue('{}', false, 'en')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// reconstructMultilingualValue
// ---------------------------------------------------------------------------
describe('reconstructMultilingualValue', () => {
    test('updates the specified language and returns JSON', () => {
        const json = JSON.stringify({ fi: 'Moi', en: 'Hello' });
        const result = reconstructMultilingualValue(json, 'fi', 'Terve');
        expect(JSON.parse(result)).toEqual({ fi: 'Terve', en: 'Hello' });
    });

    test('adds a new language key', () => {
        const json = JSON.stringify({ en: 'Hello' });
        const result = reconstructMultilingualValue(json, 'sv', 'Hej');
        expect(JSON.parse(result)).toEqual({ en: 'Hello', sv: 'Hej' });
    });

    test('returns null for missing inputs', () => {
        expect(reconstructMultilingualValue(null, 'en', 'x')).toBeNull();
        expect(reconstructMultilingualValue('{}', null, 'x')).toBeNull();
        expect(reconstructMultilingualValue('{}', 'en', 5)).toBeNull();
    });

    test('returns null for invalid JSON', () => {
        expect(reconstructMultilingualValue('{broken', 'en', 'x')).toBeNull();
    });

    test('handles empty string newValue', () => {
        const json = JSON.stringify({ en: 'Hello' });
        const result = reconstructMultilingualValue(json, 'en', '');
        expect(JSON.parse(result)).toEqual({ en: '' });
    });

    test('does not add a new empty language key when the selected language was untouched', () => {
        const json = JSON.stringify({ fi: 'Moi', sv: 'Hej' });
        const result = reconstructMultilingualValue(json, 'en', '');
        expect(JSON.parse(result)).toEqual({ fi: 'Moi', sv: 'Hej' });
    });
});

// ---------------------------------------------------------------------------
// resolveInputType
// ---------------------------------------------------------------------------
describe('resolveInputType', () => {
    test('boolean → checkbox', () => {
        expect(resolveInputType('boolean', 0)).toEqual({ type: 'checkbox' });
    });

    test('date → date', () => {
        expect(resolveInputType('date', 10)).toEqual({ type: 'date' });
    });

    test('timestamp variants → datetime-local', () => {
        expect(resolveInputType('timestamp', 0)).toEqual({ type: 'datetime-local' });
        expect(resolveInputType('timestamp without time zone', 0)).toEqual({ type: 'datetime-local' });
        expect(resolveInputType('timestamp with time zone', 0)).toEqual({ type: 'datetime-local' });
    });

    test('numeric types → number', () => {
        expect(resolveInputType('int', 0)).toEqual({ type: 'number' });
        expect(resolveInputType('integer', 0)).toEqual({ type: 'number' });
        expect(resolveInputType('numeric', 0)).toEqual({ type: 'number' });
    });

    test('short text → text input', () => {
        expect(resolveInputType('text', 10)).toEqual({ type: 'text' });
        expect(resolveInputType('text', 80)).toEqual({ type: 'text' });
    });

    test('long text → textarea', () => {
        expect(resolveInputType('text', 81)).toEqual({ type: 'textarea' });
        expect(resolveInputType('text', 500)).toEqual({ type: 'textarea' });
    });

    test('unknown type with short text → text', () => {
        expect(resolveInputType('varchar', 20)).toEqual({ type: 'text' });
    });

    test('unknown type with long text → textarea', () => {
        expect(resolveInputType('varchar', 200)).toEqual({ type: 'textarea' });
    });
});

// ---------------------------------------------------------------------------
// buildColumnInfoMap
// ---------------------------------------------------------------------------
describe('buildColumnInfoMap', () => {
    const sampleColumns = [
        { table_name: 'users', column_name: 'name', editable_in_ui: true, data_type: 'text', is_multilingual: false },
        { table_name: 'users', column_name: 'email', editable_in_ui: false, data_type: 'text', is_multilingual: false },
        { table_name: 'users', column_name: 'title', editable_in_ui: true, data_type: 'text', is_multilingual: true },
        { table_name: 'orders', column_name: 'total', editable_in_ui: true, data_type: 'numeric', is_multilingual: false },
    ];

    test('builds map for matching table only', () => {
        const map = buildColumnInfoMap(sampleColumns, 'users');
        expect(Object.keys(map)).toEqual(['name', 'email', 'title']);
        expect(map.name).toEqual({ editable_in_ui: true, data_type: 'text', is_multilingual: false });
        expect(map.email).toEqual({ editable_in_ui: false, data_type: 'text', is_multilingual: false });
        expect(map.title).toEqual({ editable_in_ui: true, data_type: 'text', is_multilingual: true });
    });

    test('returns empty map when no columns match', () => {
        expect(buildColumnInfoMap(sampleColumns, 'nonexistent')).toEqual({});
    });

    test('returns empty map for null/undefined input', () => {
        expect(buildColumnInfoMap(null, 'users')).toEqual({});
        expect(buildColumnInfoMap(undefined, 'users')).toEqual({});
    });

    test('handles missing data_type (defaults to text)', () => {
        const cols = [{ table_name: 't', column_name: 'c', editable_in_ui: true }];
        const map = buildColumnInfoMap(cols, 't');
        expect(map.c.data_type).toBe('text');
    });

    test('coerces truthy/falsy editable_in_ui and is_multilingual', () => {
        const cols = [
            { table_name: 't', column_name: 'a', editable_in_ui: 1, data_type: 'int', is_multilingual: 0 },
            { table_name: 't', column_name: 'b', editable_in_ui: null, data_type: 'text', is_multilingual: undefined },
        ];
        const map = buildColumnInfoMap(cols, 't');
        expect(map.a.editable_in_ui).toBe(true);
        expect(map.a.is_multilingual).toBe(false);
        expect(map.b.editable_in_ui).toBe(false);
        expect(map.b.is_multilingual).toBe(false);
    });

    test('skips entries without column_name', () => {
        const cols = [
            { table_name: 't', column_name: '', editable_in_ui: true, data_type: 'text' },
            { table_name: 't', column_name: null, editable_in_ui: true, data_type: 'text' },
        ];
        expect(buildColumnInfoMap(cols, 't')).toEqual({});
    });
});

// ---------------------------------------------------------------------------
// FK display alias helpers
// ---------------------------------------------------------------------------
describe('buildGeneratedForeignDisplayAliasBase', () => {
    test('maps _id columns to *_name', () => {
        expect(buildGeneratedForeignDisplayAliasBase('queue_id')).toBe('queue_name');
        expect(buildGeneratedForeignDisplayAliasBase('parent_id')).toBe('parent_name');
    });

    test('maps _uid columns to *_name', () => {
        expect(buildGeneratedForeignDisplayAliasBase('table_uid')).toBe('table_name');
    });

    test('falls back to suffixing _name', () => {
        expect(buildGeneratedForeignDisplayAliasBase('status')).toBe('status_name');
    });
});

describe('normalizeGeneratedForeignDisplayAliasKey', () => {
    test('normalizes plain and collision-safe ln aliases to the same base', () => {
        expect(normalizeGeneratedForeignDisplayAliasKey('queue_name')).toBe('queue_name');
        expect(normalizeGeneratedForeignDisplayAliasKey('queue_name (ln)')).toBe('queue_name');
        expect(normalizeGeneratedForeignDisplayAliasKey('queue_name (ln 2)')).toBe('queue_name');
    });
});

describe('getGeneratedForeignDisplayColumn', () => {
    const dataTypes = {
        queue_id: { foreign_table: 'dev_agent_task_queues' },
        parent_id: { foreign_table: 'dev_agent_tasks' },
        title: { data_type: 'text' },
    };

    test('finds generated FK alias columns for foreign keys', () => {
        const row = {
            queue_id: 9,
            'queue_name (ln)': 'Feature development',
            parent_id: 42,
            'parent_name (ln)': 'Epic: Ticket status UI',
        };

        expect(getGeneratedForeignDisplayColumn(row, 'queue_id', dataTypes)).toBe('queue_name (ln)');
        expect(getGeneratedForeignDisplayColumn(row, 'parent_id', dataTypes)).toBe('parent_name (ln)');
    });

    test('ignores unrelated columns and missing FK metadata', () => {
        const row = {
            queue_id: 9,
            title: 'Ticket 803',
        };

        expect(getGeneratedForeignDisplayColumn(row, 'title', dataTypes)).toBeNull();
        expect(getGeneratedForeignDisplayColumn(row, 'queue_id', {})).toBeNull();
    });
});

describe('isGeneratedForeignDisplayColumn', () => {
    const dataTypes = {
        queue_id: { foreign_table: 'dev_agent_task_queues' },
        parent_id: { foreign_table: 'dev_agent_tasks' },
    };

    test('marks generated FK aliases as generated when no metadata row exists', () => {
        expect(isGeneratedForeignDisplayColumn('queue_name (ln)', dataTypes)).toBe(true);
        expect(isGeneratedForeignDisplayColumn('parent_name', dataTypes)).toBe(true);
    });

    test('does not hide real columns that have metadata', () => {
        expect(isGeneratedForeignDisplayColumn('queue_id', dataTypes)).toBe(false);
    });
});

describe('resolveCardFieldDisplayValue', () => {
    const dataTypes = {
        queue_id: { foreign_table: 'dev_agent_task_queues' },
        status: { data_type: 'text' },
        title: { is_multilingual: true },
    };

    test('prefers generated FK label aliases while preserving the raw value', () => {
        const row = {
            queue_id: 9,
            'queue_name (ln)': 'Feature development',
        };

        expect(
            resolveCardFieldDisplayValue(row, 'queue_id', dataTypes, 'en', 'dev_agent_tasks')
        ).toEqual({
            rawValue: 9,
            displayValue: 'Feature development',
            aliasColumn: 'queue_name (ln)',
            isMultilingual: null,
        });
    });

    test('normalizes dev_agent_tasks status to the contributor-facing alias', () => {
        const row = { status: 'awaiting_review' };

        expect(
            resolveCardFieldDisplayValue(row, 'status', dataTypes, 'en', 'dev_agent_tasks')
        ).toEqual({
            rawValue: 'awaiting_review',
            displayValue: 'awaiting_human_decision',
            aliasColumn: null,
            isMultilingual: null,
        });
    });

    test('keeps multilingual values localized when no FK alias applies', () => {
        const row = {
            title: JSON.stringify({ en: 'Ticket status polish', fi: 'Tikettistatuksen viimeistely' }),
        };

        expect(
            resolveCardFieldDisplayValue(row, 'title', dataTypes, 'fi', 'dev_agent_tasks')
        ).toEqual({
            rawValue: row.title,
            displayValue: 'Tikettistatuksen viimeistely',
            aliasColumn: null,
            isMultilingual: true,
        });
    });
});

// ---------------------------------------------------------------------------
// Ticket status helpers
// ---------------------------------------------------------------------------
describe('ticket status helpers', () => {
    test('normalizeTicketStatusForClient maps legacy aliases to canonical statuses', () => {
        expect(normalizeTicketStatusForClient('awaiting_review')).toBe('awaiting_human_decision');
        expect(normalizeTicketStatusForClient('closed')).toBe('done');
        expect(normalizeTicketStatusForClient('later')).toBe('backlog_later');
        expect(normalizeTicketStatusForClient('nice_to_have')).toBe('backlog_nice_to_have');
        expect(normalizeTicketStatusForClient('in_progress')).toBe('in_progress');
    });

    test('normalizeTicketStatusForDb maps legacy aliases into canonical DB values', () => {
        expect(normalizeTicketStatusForDb('awaiting_human_decision')).toBe('awaiting_human_decision');
        expect(normalizeTicketStatusForDb('awaiting_review')).toBe('awaiting_human_decision');
        expect(normalizeTicketStatusForDb('done_autonomously')).toBe('done');
        expect(normalizeTicketStatusForDb('later')).toBe('backlog_later');
        expect(normalizeTicketStatusForDb('nice_to_have')).toBe('backlog_nice_to_have');
    });

    test('isTicketStatusField only matches dev_agent_tasks.status', () => {
        expect(isTicketStatusField('dev_agent_tasks', 'status')).toBe(true);
        expect(isTicketStatusField('dev_agent_tasks', 'queue_id')).toBe(false);
        expect(isTicketStatusField('other_table', 'status')).toBe(false);
    });

    test('getTicketStatusOptions returns the canonical task status set', () => {
        expect(getTicketStatusOptions()).toEqual([
            { value: 'new', label: 'new' },
            { value: 'backlog', label: 'backlog' },
            { value: 'backlog_later', label: 'backlog_later' },
            { value: 'backlog_nice_to_have', label: 'backlog_nice_to_have' },
            { value: 'in_progress', label: 'in_progress' },
            { value: 'on_hold', label: 'on_hold' },
            { value: 'awaiting_human_decision', label: 'awaiting_human_decision' },
            { value: 'done', label: 'done' },
            { value: 'rejected', label: 'rejected' },
            { value: 'aborted', label: 'aborted' },
            { value: 'archived', label: 'archived' },
            { value: 'to_be_deleted', label: 'to_be_deleted' },
        ]);
    });

    test('getTicketStatusOptions preserves an uncommon current value', () => {
        expect(getTicketStatusOptions('done')).toContainEqual({ value: 'done', label: 'done' });
    });

    test('getTicketStatusTone maps known statuses to badge tones', () => {
        expect(getTicketStatusTone('new')).toBe('new');
        expect(getTicketStatusTone('backlog')).toBe('backlog');
        expect(getTicketStatusTone('backlog_later')).toBe('later');
        expect(getTicketStatusTone('backlog_nice_to_have')).toBe('nice');
        expect(getTicketStatusTone('in_progress')).toBe('progress');
        expect(getTicketStatusTone('on_hold')).toBe('hold');
        expect(getTicketStatusTone('awaiting_review')).toBe('awaiting');
        expect(getTicketStatusTone('done')).toBe('done');
        expect(getTicketStatusTone('rejected')).toBe('rejected');
        expect(getTicketStatusTone('aborted')).toBe('aborted');
        expect(getTicketStatusTone('archived')).toBe('archived');
        expect(getTicketStatusTone('to_be_deleted')).toBe('delete');
    });
});
