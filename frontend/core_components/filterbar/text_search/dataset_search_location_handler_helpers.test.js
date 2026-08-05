import { describe, test, expect } from 'vitest';
import { parseGpsCoordString } from './dataset_search_location_handler_helpers.js';

// ---------------------------------------------------------------------------
// parseGpsCoordString
// ---------------------------------------------------------------------------
describe('parseGpsCoordString', () => {
    test('parses valid lat,lon string', () => {
        expect(parseGpsCoordString('60.1699,24.9384')).toEqual({
            lat: 60.1699,
            lon: 24.9384,
        });
    });

    test('parses negative coordinates', () => {
        expect(parseGpsCoordString('-33.8688,151.2093')).toEqual({
            lat: -33.8688,
            lon: 151.2093,
        });
    });

    test('parses zero coordinates', () => {
        expect(parseGpsCoordString('0,0')).toEqual({ lat: 0, lon: 0 });
    });

    test('returns null for null input', () => {
        expect(parseGpsCoordString(null)).toBeNull();
    });

    test('returns null for undefined input', () => {
        expect(parseGpsCoordString(undefined)).toBeNull();
    });

    test('returns null for empty string', () => {
        expect(parseGpsCoordString('')).toBeNull();
    });

    test('returns null for non-numeric content', () => {
        expect(parseGpsCoordString('abc,def')).toBeNull();
    });

    test('returns null for single value', () => {
        expect(parseGpsCoordString('60.1699')).toBeNull();
    });

    test('returns null for NaN values', () => {
        expect(parseGpsCoordString('NaN,NaN')).toBeNull();
    });

    test('returns null for Infinity', () => {
        expect(parseGpsCoordString('Infinity,24.9384')).toBeNull();
    });

    test('handles whitespace in numbers', () => {
        // Number(" 60.17") returns 60.17 — split+map(Number) trims
        expect(parseGpsCoordString(' 60.17, 24.94')).toEqual({
            lat: 60.17,
            lon: 24.94,
        });
    });
});
