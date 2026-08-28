import { describe, test, expect } from 'vitest';
import {
    getNiceStatusMessage,
    isAbortLikeNetworkError,
    shortenUrl,
} from './error_monitor_handler_helpers.js';

// ---------------------------------------------------------------------------
// getNiceStatusMessage
// ---------------------------------------------------------------------------
describe('getNiceStatusMessage', () => {
    test('returns correct message for known status codes', () => {
        expect(getNiceStatusMessage(400)).toBe("Virheellinen pyynto (400)");
        expect(getNiceStatusMessage(401)).toBe("Luvaton (401)");
        expect(getNiceStatusMessage(403)).toBe("Kielletty (403)");
        expect(getNiceStatusMessage(404)).toBe("Resurssia ei loydy (404)");
        expect(getNiceStatusMessage(429)).toBe("Liian monta pyyntoa (429)");
        expect(getNiceStatusMessage(500)).toBe("Palvelinvirhe (500)");
    });

    test('returns generic message for unknown status codes', () => {
        expect(getNiceStatusMessage(502)).toBe("Tuntematon HTTP-virhe (502)");
        expect(getNiceStatusMessage(503)).toBe("Tuntematon HTTP-virhe (503)");
        expect(getNiceStatusMessage(418)).toBe("Tuntematon HTTP-virhe (418)");
    });

    test('includes status code in parentheses for all messages', () => {
        expect(getNiceStatusMessage(500)).toContain('(500)');
        expect(getNiceStatusMessage(999)).toContain('(999)');
    });
});

// ---------------------------------------------------------------------------
// shortenUrl
// ---------------------------------------------------------------------------
describe('shortenUrl', () => {
    test('returns short URLs unchanged', () => {
        const short = 'https://example.com/api/data';
        expect(shortenUrl(short, 80)).toBe(short);
    });

    test('returns URL unchanged when exactly at maxLength', () => {
        const exact = 'x'.repeat(80);
        expect(shortenUrl(exact, 80)).toBe(exact);
    });

    test('shortens URLs longer than maxLength', () => {
        const long = 'https://example.com/' + 'a'.repeat(100);
        const result = shortenUrl(long, 40);
        expect(result.length).toBeLessThanOrEqual(40);
        expect(result).toContain('...');
    });

    test('preserves start and end of URL', () => {
        const long = 'https://start.com/' + 'x'.repeat(100) + '/end';
        const result = shortenUrl(long, 40);
        expect(result.startsWith('https://')).toBe(true);
        expect(result.endsWith('/end')).toBe(true);
    });

    test('uses 80 as default maxLength', () => {
        const under80 = 'x'.repeat(80);
        expect(shortenUrl(under80)).toBe(under80);

        const over80 = 'y'.repeat(81);
        expect(shortenUrl(over80)).toContain('...');
    });

    test('returns falsy input unchanged', () => {
        expect(shortenUrl('')).toBe('');
        expect(shortenUrl(null)).toBe(null);
        expect(shortenUrl(undefined)).toBe(undefined);
    });
});

describe('isAbortLikeNetworkError', () => {
    test('recognizes browser abort-style fetch failures', () => {
        expect(isAbortLikeNetworkError(new Error('NetworkError when attempting to fetch resource.'))).toBe(true);
        expect(isAbortLikeNetworkError(new Error('NS_BINDING_ABORTED'))).toBe(true);
        const abortError = new Error('signal is aborted without reason');
        abortError.name = 'AbortError';
        expect(isAbortLikeNetworkError(abortError)).toBe(true);
        expect(isAbortLikeNetworkError(new Error('plain failure'))).toBe(false);
    });
});
