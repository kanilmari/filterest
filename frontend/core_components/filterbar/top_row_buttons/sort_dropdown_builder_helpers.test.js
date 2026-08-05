import { describe, test, expect } from 'vitest';
import {
    filterSortableColumns,
    buildSortOptions,
    IMAGE_FIRST_SORT_COLUMN,
} from './sort_dropdown_builder_helpers.js';

// ---------------------------------------------------------------------------
// filterSortableColumns
// ---------------------------------------------------------------------------
describe('filterSortableColumns', () => {
    test('excludes created and updated columns', () => {
        const columns = ['name', 'created', 'updated', 'status'];
        const dataTypes = {
            name: { sco_number: 1 },
            created: { sco_number: 2 },
            updated: { sco_number: 3 },
            status: { sco_number: 4 },
        };
        expect(filterSortableColumns(columns, dataTypes)).toEqual(['name', 'status']);
    });

    test('excludes columns without sco_number', () => {
        const columns = ['name', 'description'];
        const dataTypes = {
            name: { sco_number: 1 },
            description: {},
        };
        expect(filterSortableColumns(columns, dataTypes)).toEqual(['name']);
    });

    test('excludes columns missing from dataTypes', () => {
        const columns = ['name', 'orphan'];
        const dataTypes = {
            name: { sco_number: 1 },
        };
        expect(filterSortableColumns(columns, dataTypes)).toEqual(['name']);
    });

    test('sorts by sco_number ascending', () => {
        const columns = ['z_col', 'a_col', 'm_col'];
        const dataTypes = {
            z_col: { sco_number: 30 },
            a_col: { sco_number: 10 },
            m_col: { sco_number: 20 },
        };
        expect(filterSortableColumns(columns, dataTypes)).toEqual(['a_col', 'm_col', 'z_col']);
    });

    test('returns empty array when no columns are sortable', () => {
        const columns = ['created', 'updated'];
        const dataTypes = {
            created: { sco_number: 1 },
            updated: { sco_number: 2 },
        };
        expect(filterSortableColumns(columns, dataTypes)).toEqual([]);
    });

    test('returns empty array for empty inputs', () => {
        expect(filterSortableColumns([], {})).toEqual([]);
    });

    test('handles sco_number of 0 as valid', () => {
        const columns = ['col_zero'];
        const dataTypes = { col_zero: { sco_number: 0 } };
        expect(filterSortableColumns(columns, dataTypes)).toEqual(['col_zero']);
    });
});

// ---------------------------------------------------------------------------
// buildSortOptions
// ---------------------------------------------------------------------------
describe('buildSortOptions', () => {
    test('returns the image-first option among the static defaults', () => {
        const options = buildSortOptions([]);
        expect(options).toHaveLength(6);
        expect(options[0].value).toBe('');
        expect(options[0].langKey).toBe('search_relevance');
        expect(options[1]).toEqual({
            value: `${IMAGE_FIRST_SORT_COLUMN}:DESC`,
            label: 'Rows with images first',
            langKey: 'sort_images_first',
        });
        expect(options[2].value).toBe('created:DESC');
        expect(options[5].value).toBe('updated:ASC');
    });

    test('adds ASC and DESC entries for each sortable column', () => {
        const options = buildSortOptions(['priority']);
        expect(options).toHaveLength(8); // 6 default + 2
        expect(options[6]).toEqual({
            value: 'priority:ASC',
            label: 'priority \u2191',
            langKey: 'priority_asc',
        });
        expect(options[7]).toEqual({
            value: 'priority:DESC',
            label: 'priority \u2193',
            langKey: 'priority_desc',
        });
    });

    test('preserves column order in output', () => {
        const options = buildSortOptions(['alpha', 'beta']);
        expect(options).toHaveLength(10); // 6 + 2*2
        expect(options[6].value).toBe('alpha:ASC');
        expect(options[7].value).toBe('alpha:DESC');
        expect(options[8].value).toBe('beta:ASC');
        expect(options[9].value).toBe('beta:DESC');
    });
});
