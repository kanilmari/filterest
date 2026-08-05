// translation_handler_helpers.test.js
// Unit tests for the pure translation helper functions used by the frontend lang flow.
// Bridges deterministic Vitest fixtures and translation_handler_helpers.js return values.
// Exists to keep key parsing, fallback resolution, and placeholder substitution stable.

import { describe, test, expect } from 'vitest';
import {
    appendAltContext,
    splitTranslationKey,
    formatMissingKey,
    applyTranslationVariable,
    resolveTranslation,
} from './translation_handler_helpers.js';

// ---------------------------------------------------------------------------
// splitTranslationKey
// ---------------------------------------------------------------------------
describe('splitTranslationKey', () => {
    test('splits key with variable part', () => {
        expect(splitTranslationKey('manage_table+dev_dating_profiles')).toEqual({
            baseKey: 'manage_table',
            variablePart: 'dev_dating_profiles',
        });
    });

    test('returns null variablePart when no plus sign', () => {
        expect(splitTranslationKey('simple_key')).toEqual({
            baseKey: 'simple_key',
            variablePart: null,
        });
    });

    test('handles empty string', () => {
        expect(splitTranslationKey('')).toEqual({
            baseKey: '',
            variablePart: null,
        });
    });

    test('handles null/undefined', () => {
        expect(splitTranslationKey(null)).toEqual({
            baseKey: '',
            variablePart: null,
        });
        expect(splitTranslationKey(undefined)).toEqual({
            baseKey: '',
            variablePart: null,
        });
    });

    test('handles key with multiple plus signs (takes first split only)', () => {
        const result = splitTranslationKey('a+b+c');
        expect(result.baseKey).toBe('a');
        expect(result.variablePart).toBe('b');
    });
});

// ---------------------------------------------------------------------------
// formatMissingKey
// ---------------------------------------------------------------------------
describe('formatMissingKey', () => {
    test('replaces underscores and capitalises first letter', () => {
        expect(formatMissingKey('manage_table', null)).toBe('Manage table');
    });

    test('appends variable part after space', () => {
        expect(formatMissingKey('manage_table', 'users')).toBe('Manage table users');
    });

    test('handles single-word key', () => {
        expect(formatMissingKey('settings', null)).toBe('Settings');
    });

    test('returns empty string for empty/null baseKey', () => {
        expect(formatMissingKey('', null)).toBe('');
        expect(formatMissingKey(null, null)).toBe('');
    });

    test('handles key already capitalised', () => {
        expect(formatMissingKey('Already_capitalised', null)).toBe('Already capitalised');
    });
});

// ---------------------------------------------------------------------------
// applyTranslationVariable
// ---------------------------------------------------------------------------
describe('applyTranslationVariable', () => {
    test('replaces $table_name with variable part', () => {
        expect(applyTranslationVariable('Manage $table_name', 'users'))
            .toBe('Manage users');
    });

    test('replaces $site_name with variable part', () => {
        expect(applyTranslationVariable('Welcome to $site_name', 'serlog.com'))
            .toBe('Welcome to serlog.com');
    });

    test('returns translation unchanged when variablePart is null', () => {
        expect(applyTranslationVariable('Hello world', null)).toBe('Hello world');
    });

    test('returns translation unchanged when no placeholder present', () => {
        expect(applyTranslationVariable('No placeholder here', 'value'))
            .toBe('No placeholder here');
    });

    test('returns empty string for null/empty translation', () => {
        expect(applyTranslationVariable(null, 'value')).toBe('');
        expect(applyTranslationVariable('', 'value')).toBe('');
    });

    test('replaces every repeated occurrence', () => {
        expect(applyTranslationVariable('$table_name and $table_name', 'x'))
            .toBe('x and x');
    });

    test('replaces repeated $site_name occurrences', () => {
        expect(applyTranslationVariable('$site_name runs on $site_name', 'Easelect'))
            .toBe('Easelect runs on Easelect');
    });
});

// ---------------------------------------------------------------------------
// appendAltContext
// ---------------------------------------------------------------------------
describe('appendAltContext', () => {
    test('appends image context with a colon by default', () => {
        expect(appendAltContext('Picture', 'Jane Doe (Users)'))
            .toBe('Picture: Jane Doe (Users)');
    });

    test('avoids duplicate punctuation when translation already ends with a separator', () => {
        expect(appendAltContext('Picture missing:', 'Jane Doe (Users)'))
            .toBe('Picture missing: Jane Doe (Users)');
    });

    test('returns the base translation when context is missing', () => {
        expect(appendAltContext('Picture', '')).toBe('Picture');
    });

    test('returns the context when the translated base is missing', () => {
        expect(appendAltContext('', 'Jane Doe (Users)'))
            .toBe('Jane Doe (Users)');
    });
});

// ---------------------------------------------------------------------------
// resolveTranslation
// ---------------------------------------------------------------------------
describe('resolveTranslation', () => {
    const primary = { greeting: 'Hei', farewell: 'Näkemiin' };
    const fallback = { greeting: 'Hello', missing_in_primary: 'Fallback value' };

    test('returns primary translation when available', () => {
        expect(resolveTranslation('greeting', primary, fallback)).toBe('Hei');
    });

    test('falls back to default when primary missing', () => {
        expect(resolveTranslation('missing_in_primary', primary, fallback))
            .toBe('Fallback value');
    });

    test('returns null when key missing from both', () => {
        expect(resolveTranslation('nonexistent', primary, fallback)).toBeNull();
    });

    test('returns null for empty/null baseKey', () => {
        expect(resolveTranslation('', primary, fallback)).toBeNull();
        expect(resolveTranslation(null, primary, fallback)).toBeNull();
    });

    test('handles null/undefined data objects gracefully', () => {
        expect(resolveTranslation('key', null, null)).toBeNull();
        expect(resolveTranslation('key', undefined, undefined)).toBeNull();
    });

    test('handles empty data objects', () => {
        expect(resolveTranslation('key', {}, {})).toBeNull();
    });

    test('prefers primary over fallback even if both exist', () => {
        expect(resolveTranslation('greeting', primary, fallback)).toBe('Hei');
    });
});
