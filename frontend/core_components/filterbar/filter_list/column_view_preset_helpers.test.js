import { describe, test, expect } from 'vitest';
import {
    findPresetById,
    findPresetByName,
    computeUIState,
    normalizePresetList,
} from './column_view_preset_helpers.js';

const PRESETS = [
    { id: 1, preset_name: 'Default View' },
    { id: 2, preset_name: 'Compact' },
    { id: 3, preset_name: 'Full Details' },
];

// ---------------------------------------------------------------------------
// findPresetById
// ---------------------------------------------------------------------------
describe('findPresetById', () => {
    test('returns matching preset by numeric id', () => {
        expect(findPresetById(PRESETS, 2)).toBe(PRESETS[1]);
    });

    test('returns matching preset by string id', () => {
        expect(findPresetById(PRESETS, '3')).toBe(PRESETS[2]);
    });

    test('returns null for empty string id', () => {
        expect(findPresetById(PRESETS, '')).toBeNull();
    });

    test('returns null for null/undefined id', () => {
        expect(findPresetById(PRESETS, null)).toBeNull();
        expect(findPresetById(PRESETS, undefined)).toBeNull();
    });

    test('returns null when no match found', () => {
        expect(findPresetById(PRESETS, 999)).toBeNull();
    });

    test('returns null for empty presets array', () => {
        expect(findPresetById([], 1)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// findPresetByName
// ---------------------------------------------------------------------------
describe('findPresetByName', () => {
    test('returns matching preset (exact case)', () => {
        expect(findPresetByName(PRESETS, 'Compact')).toBe(PRESETS[1]);
    });

    test('matches case-insensitively', () => {
        expect(findPresetByName(PRESETS, 'compact')).toBe(PRESETS[1]);
        expect(findPresetByName(PRESETS, 'COMPACT')).toBe(PRESETS[1]);
        expect(findPresetByName(PRESETS, 'default view')).toBe(PRESETS[0]);
    });

    test('returns null for non-existing name', () => {
        expect(findPresetByName(PRESETS, 'Nonexistent')).toBeNull();
    });

    test('returns null for empty/null name', () => {
        expect(findPresetByName(PRESETS, '')).toBeNull();
        expect(findPresetByName(PRESETS, null)).toBeNull();
        expect(findPresetByName(PRESETS, undefined)).toBeNull();
    });

    test('returns null for empty presets array', () => {
        expect(findPresetByName([], 'Compact')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// computeUIState
// ---------------------------------------------------------------------------
describe('computeUIState', () => {
    test('keeps controls visible with preset-only actions disabled when no preset selected', () => {
        const state = computeUIState(null);
        expect(state).toEqual({
            showSaveNew: true,
            showUpdate: true,
            showClear: true,
            showMore: true,
            updateDisabled: true,
            deleteDisabled: true,
            updateTitle: null,
        });
    });

    test('enables preset-specific actions when preset selected', () => {
        const state = computeUIState({ id: 1, preset_name: 'Default View' });
        expect(state).toEqual({
            showSaveNew: true,
            showUpdate: true,
            showClear: true,
            showMore: true,
            updateDisabled: false,
            deleteDisabled: false,
            updateTitle: 'Default View',
        });
    });

    test('treats undefined as no selected preset', () => {
        const state = computeUIState(undefined);
        expect(state.showSaveNew).toBe(true);
        expect(state.showUpdate).toBe(true);
        expect(state.updateDisabled).toBe(true);
        expect(state.updateTitle).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// normalizePresetList
// ---------------------------------------------------------------------------
describe('normalizePresetList', () => {
    test('returns array as-is', () => {
        const arr = [{ id: 1 }];
        expect(normalizePresetList(arr)).toBe(arr);
    });

    test('returns empty array for null', () => {
        expect(normalizePresetList(null)).toEqual([]);
    });

    test('returns empty array for undefined', () => {
        expect(normalizePresetList(undefined)).toEqual([]);
    });

    test('returns empty array for object', () => {
        expect(normalizePresetList({ error: 'nope' })).toEqual([]);
    });

    test('returns empty array for string', () => {
        expect(normalizePresetList('hello')).toEqual([]);
    });

    test('returns empty array for number', () => {
        expect(normalizePresetList(42)).toEqual([]);
    });

    test('preserves empty array', () => {
        expect(normalizePresetList([])).toEqual([]);
    });
});
