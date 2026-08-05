import { describe, test, expect } from 'vitest';
import {
    buildFieldTestId,
    getInputType,
} from './row_input_builder_helpers.js';

// ---------------------------------------------------------------------------
// buildFieldTestId
// ---------------------------------------------------------------------------
describe('buildFieldTestId', () => {
    test('returns prefixed test id', () => {
        expect(buildFieldTestId('username')).toBe('form-input-username');
    });

    test('handles column names with underscores', () => {
        expect(buildFieldTestId('first_name')).toBe('form-input-first_name');
    });

    test('handles empty string', () => {
        expect(buildFieldTestId('')).toBe('form-input-');
    });
});

// ---------------------------------------------------------------------------
// getInputType
// ---------------------------------------------------------------------------
describe('getInputType', () => {
    test('returns number for integer types', () => {
        expect(getInputType('integer')).toBe('number');
        expect(getInputType('bigint')).toBe('number');
        expect(getInputType('smallint')).toBe('number');
        expect(getInputType('numeric')).toBe('number');
    });

    test('returns checkbox for boolean', () => {
        expect(getInputType('boolean')).toBe('checkbox');
    });

    test('returns date for date type', () => {
        expect(getInputType('date')).toBe('date');
    });

    test('returns datetime-local for timestamp types', () => {
        expect(getInputType('timestamp')).toBe('datetime-local');
        expect(getInputType('timestamp without time zone')).toBe('datetime-local');
        expect(getInputType('timestamp with time zone')).toBe('datetime-local');
    });

    test('returns text for unknown types', () => {
        expect(getInputType('varchar')).toBe('text');
        expect(getInputType('text')).toBe('text');
        expect(getInputType('jsonb')).toBe('text');
    });

    test('is case-insensitive', () => {
        expect(getInputType('INTEGER')).toBe('number');
        expect(getInputType('Boolean')).toBe('checkbox');
        expect(getInputType('TIMESTAMP')).toBe('datetime-local');
        expect(getInputType('Date')).toBe('date');
    });
});
