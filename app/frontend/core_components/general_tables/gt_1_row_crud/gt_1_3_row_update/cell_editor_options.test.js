import { describe, expect, test } from 'vitest';
import {
    getInlineEditCacheInvalidationKeys,
    getInlineEditOptions,
    normalizeInlineEditOptionValue,
} from './cell_editor_options.js';

describe('cell_editor_options', () => {
    test('offers card detail layout options for system_db_tables.card_details_layout', () => {
        const options = getInlineEditOptions({
            tableName: 'system_db_tables',
            columnName: 'card_details_layout',
        });

        expect(options.map((option) => option.value)).toEqual([
            'single_line',
            'conditional_multiline',
            'stacked',
            'inline',
        ]);
    });

    test('uses translations when available', () => {
        const options = getInlineEditOptions({
            tableName: 'system_db_tables',
            columnName: 'card_details_layout',
            translate: (key) => (key === 'stacked' ? 'Pinottu' : ''),
        });

        expect(options.find((option) => option.value === 'stacked')?.label).toBe('Pinottu');
    });

    test('does not offer options for unrelated columns', () => {
        expect(getInlineEditOptions({
            tableName: 'system_db_tables',
            columnName: 'table_name',
        })).toEqual([]);
    });

    test('offers canonical ticket statuses for dev_agent_tasks.status', () => {
        const options = getInlineEditOptions({
            tableName: 'dev_agent_tasks',
            columnName: 'status',
        });

        expect(options.map((option) => option.value)).toContain('aborted');
        expect(options.map((option) => option.value)).toContain('in_progress');
    });

    test('offers card style variants for system_db_tables.card_style_variant', () => {
        const options = getInlineEditOptions({
            tableName: 'system_db_tables',
            columnName: 'card_style_variant',
        });

        expect(options.map((option) => option.value)).toEqual([
            'standard',
            'modern',
        ]);
    });

    test('normalizes legacy multiline to conditional multiline', () => {
        expect(normalizeInlineEditOptionValue({
            tableName: 'system_db_tables',
            columnName: 'card_details_layout',
            value: 'multiline',
        })).toBe('conditional_multiline');
    });

    test('normalizes unknown card style variants to standard', () => {
        expect(normalizeInlineEditOptionValue({
            tableName: 'system_db_tables',
            columnName: 'card_style_variant',
            value: 'floating',
        })).toBe('standard');
    });

    test('normalizes ticket status aliases to canonical DB status values', () => {
        expect(normalizeInlineEditOptionValue({
            tableName: 'dev_agent_tasks',
            columnName: 'status',
            value: 'closed',
        })).toBe('done');
    });

    test('invalidates the target table metadata cache after layout edits', () => {
        expect(getInlineEditCacheInvalidationKeys({
            tableName: 'system_db_tables',
            columnName: 'card_details_layout',
            rowData: { table_name: 'service_catalog' },
        })).toEqual(['service_catalog_tableMeta']);
    });

    test('invalidates the target table metadata cache after style edits', () => {
        expect(getInlineEditCacheInvalidationKeys({
            tableName: 'system_db_tables',
            columnName: 'card_style_variant',
            rowData: { table_name: 'service_catalog' },
        })).toEqual(['service_catalog_tableMeta']);
    });
});
