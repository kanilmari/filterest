import { describe, test, expect } from 'vitest';
import {
    buildVisibilityKey,
    parseStoredVisibility,
    resolveInitialVisibility,
} from './filterbar_visibility_handler_helpers.js';

// ---------------------------------------------------------------------------
// buildVisibilityKey
// ---------------------------------------------------------------------------
describe('buildVisibilityKey', () => {
    test('returns wide key when isWideScreen is true', () => {
        expect(buildVisibilityKey('orders', true)).toBe('orders_filterbar_visible_wide');
    });

    test('returns narrow key when isWideScreen is false', () => {
        expect(buildVisibilityKey('orders', false)).toBe('orders_filterbar_visible_narrow');
    });

    test('handles empty table name', () => {
        expect(buildVisibilityKey('', true)).toBe('_filterbar_visible_wide');
    });

    test('handles table name with special characters', () => {
        expect(buildVisibilityKey('my_table-2', false)).toBe('my_table-2_filterbar_visible_narrow');
    });
});

// ---------------------------------------------------------------------------
// parseStoredVisibility
// ---------------------------------------------------------------------------
describe('parseStoredVisibility', () => {
    test('returns true for "true" string', () => {
        expect(parseStoredVisibility('true')).toBe(true);
    });

    test('returns false for "false" string', () => {
        expect(parseStoredVisibility('false')).toBe(false);
    });

    test('returns null for null', () => {
        expect(parseStoredVisibility(null)).toBeNull();
    });

    test('returns null for undefined', () => {
        expect(parseStoredVisibility(undefined)).toBeNull();
    });

    test('returns false for any other string', () => {
        expect(parseStoredVisibility('yes')).toBe(false);
        expect(parseStoredVisibility('')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// resolveInitialVisibility
// ---------------------------------------------------------------------------
describe('resolveInitialVisibility', () => {
    test('uses stored visibility when available (true)', () => {
        expect(resolveInitialVisibility(true, false, false)).toBe(true);
    });

    test('uses stored visibility when available (false)', () => {
        expect(resolveInitialVisibility(false, true, true)).toBe(false);
    });

    test('falls back to dbDefault when stored is null', () => {
        expect(resolveInitialVisibility(null, true, false)).toBe(true);
        expect(resolveInitialVisibility(null, false, true)).toBe(false);
    });

    test('falls back to isWideScreen when stored is null and dbDefault is undefined', () => {
        expect(resolveInitialVisibility(null, undefined, true)).toBe(true);
        expect(resolveInitialVisibility(null, undefined, false)).toBe(false);
    });

    test('stored preference wins over all others', () => {
        expect(resolveInitialVisibility(true, false, false)).toBe(true);
        expect(resolveInitialVisibility(false, true, true)).toBe(false);
    });
});
