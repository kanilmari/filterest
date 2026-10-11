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

    test('keeps migrated Helsinki clocks in editors and supplies a zoned write value', () => {
        process.env.TZ = 'Europe/Helsinki';
        try {
            for (const [wallClock, instant] of [
                ['2026-01-15 09:30:00', '2026-01-15T07:30:00Z'],
                ['2026-06-14 09:30:00', '2026-06-14T06:30:00Z'],
                ['2026-03-29 04:30:00', '2026-03-29T01:30:00Z'],
            ]) {
                const editorValue = formatTemporalValueForInput(instant, 'timestamptz');
                expect(editorValue).toBe(formatTemporalValueForInput(wallClock, 'timestamp'));
                expect(serializeTemporalInputValue(editorValue, 'timestamptz'))
                    .toBe(instant.replace('Z', '.000Z'));
            }
        } finally {
            process.env.TZ = 'Asia/Hong_Kong';
        }
    });

    test.each([
        ['summer occurrence', '2026-10-25T00:30:00Z', '2026-10-25T00:31:00.000Z'],
        ['standard occurrence', '2026-10-25T01:30:00Z', '2026-10-25T01:31:00.000Z'],
    ])('keeps the Helsinki autumn overlap %s when editing 03:30 to 03:31', (_label, original, edited) => {
        process.env.TZ = 'Europe/Helsinki';
        try {
            expect(formatTemporalValueForInput(original, 'timestamptz')).toBe('2026-10-25T03:30');
            expect(serializeTemporalInputValue('2026-10-25T03:31', 'timestamptz', original)).toBe(edited);
            expect(new Date(edited).getTime() - new Date(original).getTime()).toBe(60_000);
        } finally {
            process.env.TZ = 'Asia/Hong_Kong';
        }
    });

    test('resolves other Helsinki overlaps earlier and edits outside the starting overlap normally', () => {
        process.env.TZ = 'Europe/Helsinki';
        try {
            expect(serializeTemporalInputValue('2026-10-25T03:31', 'timestamptz'))
                .toBe('2026-10-25T00:31:00.000Z');
            expect(serializeTemporalInputValue('2026-10-25T04:31', 'timestamptz', '2026-10-25T00:30:00Z'))
                .toBe('2026-10-25T02:31:00.000Z');
        } finally {
            process.env.TZ = 'Asia/Hong_Kong';
        }
    });

    test('normalizes the true Helsinki spring gap 03:30 forward to 04:30 for zoned edits', () => {
        process.env.TZ = 'Europe/Helsinki';
        try {
            const serialized = serializeTemporalInputValue('2026-03-29T03:30', 'timestamptz', '2026-03-29T00:30:00Z');
            expect(serialized).toBe('2026-03-29T01:30:00.000Z');
            expect(formatTemporalValueForInput(serialized, 'timestamptz')).toBe('2026-03-29T04:30');
            expect(serializeTemporalInputValue('2026-03-29T03:30', 'timestamp')).toBe('2026-03-29 03:30:00');
        } finally {
            process.env.TZ = 'Asia/Hong_Kong';
        }
    });
});
