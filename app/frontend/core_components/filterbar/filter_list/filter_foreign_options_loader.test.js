// filter_foreign_options_loader.test.js
// Verifies the value-column flow extracted from the filter builder.
// Bridges filter/editor metadata with mocked policy-aware option reads.
// Exists to prevent fallback changes when the two consumers share their loader.

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { loadForeignFilterOptions } from './filter_column_builder_helpers.js';
import { fetchFilterOptions } from '../../endpoints/endpoint_data_fetcher.js';

vi.mock('../../endpoints/endpoint_data_fetcher.js', () => ({ fetchFilterOptions: vi.fn() }));

const numericOptions = [{ value: 87, label: 'Dataset' }];
const textColumn = { foreign_table: 'statuses', data_type: 'text' };

describe('shared foreign option loader', () => {
    beforeEach(() => { fetchFilterOptions.mockReset(); });

    test('uses foreign_column and leaves the filter bar request arguments unchanged', async () => {
        fetchFilterOptions.mockResolvedValue(numericOptions);
        expect(await loadForeignFilterOptions('dataset_uid', {
            foreign_table: 'system_db_tables', foreign_column: 'table_uid', data_type: 'integer',
        })).toEqual(numericOptions);
        expect(fetchFilterOptions.mock.calls).toEqual([[{
            dataset_name: 'system_db_tables', value_column: 'table_uid',
        }]]);
    });

    test('falls back to id and accepts bounded server search for the editor', async () => {
        fetchFilterOptions.mockResolvedValue(numericOptions);
        await loadForeignFilterOptions('service_id', {
            foreign_table: 'services', data_type: 'integer',
        }, { search: 'portal', limit: 100 });
        expect(fetchFilterOptions.mock.calls).toEqual([[{
            dataset_name: 'services', value_column: 'id', search: 'portal', limit: 100,
        }]]);
    });

    test('retries with slug for the existing missing-metadata text predicate', async () => {
        const slugs = [{ value: 'in_progress', label: 'In progress' }];
        fetchFilterOptions.mockResolvedValueOnce(numericOptions).mockResolvedValueOnce(slugs);
        expect(await loadForeignFilterOptions('status', textColumn, { search: 'progress', limit: 100 })).toEqual(slugs);
        expect(fetchFilterOptions.mock.calls).toEqual([
            [{ dataset_name: 'statuses', value_column: 'id', search: 'progress', limit: 100 }],
            [{ dataset_name: 'statuses', value_column: 'slug', search: 'progress', limit: 100 }],
        ]);
    });

    test.each([
        ['explicit id', 'status', { ...textColumn, foreign_column: 'id' }, numericOptions],
        ['explicit text key', 'status', { ...textColumn, foreign_column: 'code' }, numericOptions],
        ['id suffix', 'status_id', textColumn, numericOptions],
        ['uid suffix', 'status_uid', textColumn, numericOptions],
        ['numeric column', 'status', { ...textColumn, data_type: 'integer' }, numericOptions],
        ['already text values', 'status', textColumn, [{ value: 'done', label: 'Done' }]],
        ['no results', 'status', textColumn, []],
    ])('does not retry for %s', async (_name, column, metadata, options) => {
        fetchFilterOptions.mockResolvedValue(options);
        expect(await loadForeignFilterOptions(column, metadata)).toEqual(options);
        expect(fetchFilterOptions).toHaveBeenCalledTimes(1);
    });

    test('ignores a numeric slug answer', async () => {
        fetchFilterOptions.mockResolvedValueOnce(numericOptions).mockResolvedValueOnce([{ value: '12', label: 'Numeric slug' }]);
        expect(await loadForeignFilterOptions('status', textColumn)).toEqual(numericOptions);
        expect(fetchFilterOptions).toHaveBeenCalledTimes(2);
    });

    test('keeps the old options after a refused optional slug retry', async () => {
        fetchFilterOptions.mockResolvedValueOnce(numericOptions).mockRejectedValueOnce(new Error('No slug'));
        expect(await loadForeignFilterOptions('status', textColumn)).toEqual(numericOptions);
    });

    test('keeps the old empty slug answer behavior', async () => {
        fetchFilterOptions.mockResolvedValueOnce(numericOptions).mockResolvedValueOnce([]);
        expect(await loadForeignFilterOptions('status', textColumn)).toEqual([]);
    });

    test('propagates primary load failures to the editor', async () => {
        const failure = new Error('Forbidden');
        fetchFilterOptions.mockRejectedValue(failure);
        await expect(loadForeignFilterOptions('status', textColumn)).rejects.toBe(failure);
        expect(fetchFilterOptions).toHaveBeenCalledTimes(1);
    });

    test('preserves inline choice options without requesting the server', async () => {
        expect(await loadForeignFilterOptions('status', { filter_options: numericOptions })).toEqual(numericOptions);
        expect(fetchFilterOptions).not.toHaveBeenCalled();
    });
});
