// temporal_value_formatter.test.js
// Verifies editor conversions preserve PostgreSQL temporal type semantics.
// Bridges backend strings, browser-local datetime inputs, and API payloads in a deterministic timezone.
// Exists to prevent DATE and naive TIMESTAMP values from being shifted through JavaScript Date conversion.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
    formatTemporalValueForInput,
    getTemporalValueKind,
    serializeTemporalInputValue,
    TEMPORAL_KIND_DATE,
    TEMPORAL_KIND_TIMESTAMP,
    TEMPORAL_KIND_TIMESTAMPTZ,
} from './temporal_value_formatter.js';

const originalTimezone = process.env.TZ;

describe('temporal_value_formatter', () => {
    beforeAll(() => {
        process.env.TZ = 'Asia/Hong_Kong';
    });

    afterAll(() => {
        if (originalTimezone === undefined) {
            delete process.env.TZ;
        } else {
            process.env.TZ = originalTimezone;
        }
    });

    test('classifies DATE, TIMESTAMP WITHOUT TIME ZONE, and TIMESTAMPTZ separately', () => {
        expect(getTemporalValueKind('date')).toBe(TEMPORAL_KIND_DATE);
        expect(getTemporalValueKind('timestamp without time zone')).toBe(TEMPORAL_KIND_TIMESTAMP);
        expect(getTemporalValueKind('timestamp with time zone')).toBe(TEMPORAL_KIND_TIMESTAMPTZ);
        expect(getTemporalValueKind('timestamptz')).toBe(TEMPORAL_KIND_TIMESTAMPTZ);
    });

    test('keeps a DATE calendar value unchanged even when the API includes midnight', () => {
        expect(formatTemporalValueForInput('2026-01-15 00:00:00', 'date')).toBe('2026-01-15');
        expect(serializeTemporalInputValue('2026-01-15', 'date')).toBe('2026-01-15');
    });

    test('keeps a timestamp-without-time-zone wall clock unchanged', () => {
        expect(formatTemporalValueForInput(
            '2026-06-14 09:30:45',
            'timestamp without time zone',
        )).toBe('2026-06-14T09:30');
        expect(serializeTemporalInputValue(
            '2026-06-15T14:30',
            'timestamp without time zone',
        )).toBe('2026-06-15 14:30:00');
    });

    test('converts an explicit TIMESTAMPTZ instant to Hong Kong local time and back', () => {
        expect(formatTemporalValueForInput(
            '2026-06-14T01:30:00Z',
            'timestamp with time zone',
        )).toBe('2026-06-14T09:30');
        expect(serializeTemporalInputValue(
            '2026-06-14T09:30',
            'timestamp with time zone',
        )).toBe('2026-06-14T01:30:00.000Z');
    });

    test('rejects invalid or semantically ambiguous editor values', () => {
        expect(serializeTemporalInputValue('2026-02-30', 'date')).toBeNull();
        expect(serializeTemporalInputValue(
            '2026-06-14T09:30:00Z',
            'timestamp without time zone',
        )).toBeNull();
        expect(formatTemporalValueForInput('not-a-time', 'timestamp with time zone')).toBe('');
    });
});
