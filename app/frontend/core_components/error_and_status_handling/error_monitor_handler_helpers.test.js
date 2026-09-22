import { describe, test, expect } from 'vitest';
import {
    FAILURE_NOTICE_TRANSLATION_FALLBACKS,
    buildNetworkErrorNotice,
    buildServerErrorNotice,
    callerOwnsFailureNotice,
    isAbortLikeNetworkError,
    markCallerOwnsFailureNotice,
    shortenUrl,
} from './error_monitor_handler_helpers.js';

// ---------------------------------------------------------------------------
// Failure notices
// ---------------------------------------------------------------------------
describe('failure notices', () => {
    const translate = (langKey) => `copy of ${langKey}`;

    test('server notice is the translated sentence and the status code', () => {
        expect(buildServerErrorNotice(500, translate)).toBe('copy of server_error_notice (500)');
        expect(buildServerErrorNotice(502, translate)).toBe('copy of server_error_notice (502)');
    });

    test('server notice omits a status code it was not given', () => {
        expect(buildServerErrorNotice(undefined, translate)).toBe('copy of server_error_notice');
    });

    test('network notice is only the translated sentence', () => {
        expect(buildNetworkErrorNotice(translate)).toBe('copy of network_error_notice');
    });

    test('every notice key has bootstrap copy in each installed language', () => {
        expect(Object.keys(FAILURE_NOTICE_TRANSLATION_FALLBACKS).sort())
            .toEqual(['network_error_notice', 'server_error_notice']);
        for (const copy of Object.values(FAILURE_NOTICE_TRANSLATION_FALLBACKS)) {
            expect(Object.keys(copy).sort()).toEqual(['ch', 'en', 'fi', 'yue']);
            for (const text of Object.values(copy)) {
                expect(text.trim()).not.toBe('');
                expect(text).not.toMatch(/https?:|\/api\//);
            }
        }
    });
});

// ---------------------------------------------------------------------------
// Caller-owned failure notices
// ---------------------------------------------------------------------------
describe('caller-owned failure notices', () => {
    test('marked options are recognised, unmarked and missing options are not', () => {
        const options = markCallerOwnsFailureNotice({ method: 'GET' });
        expect(callerOwnsFailureNotice(options)).toBe(true);
        expect(callerOwnsFailureNotice({ method: 'GET' })).toBe(false);
        expect(callerOwnsFailureNotice(undefined)).toBe(false);
        expect(callerOwnsFailureNotice(null)).toBe(false);
    });

    test('the mark leaves what fetch sends unchanged', () => {
        const options = markCallerOwnsFailureNotice({ method: 'POST', headers: { 'X-CSRF-Token': 't' } });
        expect(Object.keys(options)).toEqual(['method', 'headers']);
        expect(JSON.stringify(options)).toBe('{"method":"POST","headers":{"X-CSRF-Token":"t"}}');
        expect(options).toEqual({ method: 'POST', headers: { 'X-CSRF-Token': 't' } });
    });

    test('marking tolerates a missing options object', () => {
        expect(markCallerOwnsFailureNotice(undefined)).toBeUndefined();
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
