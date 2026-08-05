import { describe, test, expect } from 'vitest';
import {
    formatSortSelection,
    resolveSortSelection,
} from './sort_sync_state_helpers.js';

// ---------------------------------------------------------------------------
// formatSortSelection
// ---------------------------------------------------------------------------
describe('formatSortSelection', () => {
    test('formats column and direction with uppercase direction', () => {
        expect(formatSortSelection('name', 'asc')).toBe('name:ASC');
    });

    test('preserves already-uppercase direction', () => {
        expect(formatSortSelection('age', 'DESC')).toBe('age:DESC');
    });

    test('handles mixed-case direction', () => {
        expect(formatSortSelection('date', 'Desc')).toBe('date:DESC');
    });

    test('converts non-string direction via String()', () => {
        expect(formatSortSelection('id', 123)).toBe('id:123');
    });

    test('handles null direction gracefully', () => {
        expect(formatSortSelection('id', null)).toBe('id:NULL');
    });

    test('handles undefined direction gracefully', () => {
        expect(formatSortSelection('id', undefined)).toBe('id:UNDEFINED');
    });
});

// ---------------------------------------------------------------------------
// resolveSortSelection
// ---------------------------------------------------------------------------
describe('resolveSortSelection', () => {
    test('returns sort from params when both column and order exist', () => {
        const params = { sort_column: 'name', sort_order: 'asc' };
        const state = {};
        expect(resolveSortSelection(params, state)).toBe('name:ASC');
    });

    test('falls back to state when params lack sort info', () => {
        const params = {};
        const state = { sort: { column: 'age', direction: 'desc' } };
        expect(resolveSortSelection(params, state)).toBe('age:DESC');
    });

    test('prefers params over state when both have sort info', () => {
        const params = { sort_column: 'name', sort_order: 'asc' };
        const state = { sort: { column: 'age', direction: 'desc' } };
        expect(resolveSortSelection(params, state)).toBe('name:ASC');
    });

    test('returns empty string when neither has sort info', () => {
        expect(resolveSortSelection({}, {})).toBe('');
    });

    test('returns empty string when params have column but no order', () => {
        const params = { sort_column: 'name' };
        expect(resolveSortSelection(params, {})).toBe('');
    });

    test('returns empty string when params have order but no column', () => {
        const params = { sort_order: 'asc' };
        expect(resolveSortSelection(params, {})).toBe('');
    });

    test('returns empty string when state sort has column but no direction', () => {
        const params = {};
        const state = { sort: { column: 'name' } };
        expect(resolveSortSelection(params, state)).toBe('');
    });

    test('returns empty string when state sort has direction but no column', () => {
        const params = {};
        const state = { sort: { direction: 'asc' } };
        expect(resolveSortSelection(params, state)).toBe('');
    });

    test('returns empty string when state.sort is null', () => {
        const params = {};
        const state = { sort: null };
        expect(resolveSortSelection(params, state)).toBe('');
    });

    test('returns empty string when state.sort is undefined', () => {
        const params = {};
        const state = {};
        expect(resolveSortSelection(params, state)).toBe('');
    });

    test('uppercases direction from state', () => {
        const params = {};
        const state = { sort: { column: 'x', direction: 'Asc' } };
        expect(resolveSortSelection(params, state)).toBe('x:ASC');
    });
});
