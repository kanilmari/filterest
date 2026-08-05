import { describe, test, expect } from 'vitest';
import {
    mergeStateWithOptions,
    computeNextSortState,
    resolveRouteSort,
} from './table_refresh_unified_helpers.js';

// ---------------------------------------------------------------------------
// mergeStateWithOptions
// ---------------------------------------------------------------------------
describe('mergeStateWithOptions', () => {
    const baseState = () => ({
        offset: 0,
        sort: { column: 'id', direction: 'ASC' },
        filters: { status: 'active' },
    });

    test('returns unchanged state when options is empty', () => {
        const state = baseState();
        const result = mergeStateWithOptions(state, {});
        expect(result).toEqual(state);
    });

    test('does not mutate the original state', () => {
        const state = baseState();
        const original = JSON.parse(JSON.stringify(state));
        mergeStateWithOptions(state, { offsetOverride: 50, newSortColumn: 'name' });
        expect(state).toEqual(original);
    });

    test('overrides offset when offsetOverride is a number', () => {
        const result = mergeStateWithOptions(baseState(), { offsetOverride: 100 });
        expect(result.offset).toBe(100);
    });

    test('overrides offset with zero', () => {
        const state = { ...baseState(), offset: 50 };
        const result = mergeStateWithOptions(state, { offsetOverride: 0 });
        expect(result.offset).toBe(0);
    });

    test('does not override offset when offsetOverride is not a number', () => {
        const result = mergeStateWithOptions(baseState(), { offsetOverride: '50' });
        expect(result.offset).toBe(0);
    });

    test('overrides sort column', () => {
        const result = mergeStateWithOptions(baseState(), { newSortColumn: 'name' });
        expect(result.sort.column).toBe('name');
        expect(result.sort.direction).toBe('ASC'); // direction unchanged
    });

    test('overrides sort direction', () => {
        const result = mergeStateWithOptions(baseState(), { newSortDirection: 'DESC' });
        expect(result.sort.direction).toBe('DESC');
        expect(result.sort.column).toBe('id'); // column unchanged
    });

    test('merges new filters with existing filters', () => {
        const result = mergeStateWithOptions(baseState(), {
            newFilters: { type: 'admin' },
        });
        expect(result.filters).toEqual({ status: 'active', type: 'admin' });
    });

    test('new filters override existing filter keys', () => {
        const result = mergeStateWithOptions(baseState(), {
            newFilters: { status: 'inactive' },
        });
        expect(result.filters.status).toBe('inactive');
    });

    test('ignores newFilters when not an object', () => {
        const result = mergeStateWithOptions(baseState(), { newFilters: 'bad' });
        expect(result.filters).toEqual({ status: 'active' });
    });

    test('applies all overrides at once', () => {
        const result = mergeStateWithOptions(baseState(), {
            offsetOverride: 25,
            newSortColumn: 'email',
            newSortDirection: 'DESC',
            newFilters: { role: 'user' },
        });
        expect(result).toEqual({
            offset: 25,
            sort: { column: 'email', direction: 'DESC' },
            filters: { status: 'active', role: 'user' },
        });
    });
});

// ---------------------------------------------------------------------------
// computeNextSortState
// ---------------------------------------------------------------------------
describe('computeNextSortState', () => {
    test('toggles ASC to DESC when same column clicked', () => {
        const result = computeNextSortState({ column: 'name', direction: 'ASC' }, 'name');
        expect(result).toEqual({ column: 'name', direction: 'DESC' });
    });

    test('toggles DESC to ASC when same column clicked', () => {
        const result = computeNextSortState({ column: 'name', direction: 'DESC' }, 'name');
        expect(result).toEqual({ column: 'name', direction: 'ASC' });
    });

    test('sets new column to ASC when different column clicked', () => {
        const result = computeNextSortState({ column: 'name', direction: 'DESC' }, 'email');
        expect(result).toEqual({ column: 'email', direction: 'ASC' });
    });

    test('sets first column to ASC when current sort is empty string', () => {
        const result = computeNextSortState({ column: '', direction: '' }, 'id');
        expect(result).toEqual({ column: 'id', direction: 'ASC' });
    });
});

describe('resolveRouteSort', () => {
    const imageFirst = { column: '__images_first', direction: 'DESC' };

    test('uses the configured default when the route has no explicit sort', () => {
        expect(resolveRouteSort({}, imageFirst)).toEqual(imageFirst);
    });

    test('keeps an explicit route sort ahead of the configured default', () => {
        expect(resolveRouteSort(
            { column: 'created', direction: 'asc' },
            imageFirst
        )).toEqual({ column: 'created', direction: 'ASC' });
    });

    test('returns an empty sort when neither source is complete', () => {
        expect(resolveRouteSort({}, { column: '__images_first' })).toEqual({
            column: null,
            direction: null,
        });
    });
});
