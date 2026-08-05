import { describe, test, expect } from 'vitest';
import {
    isMutatingMethod,
    resolveEndpointUrl,
    buildFetchOptions,
    isAuthFailure403,
    isCsrfFailureResponse,
    createAuthError,
    createRateLimitError,
    stripAnsiCodes,
    truncateErrorText,
    shouldThrottleRateLimitToast,
} from './api_pipeline_helpers.js';

// ---------------------------------------------------------------------------
// isMutatingMethod
// ---------------------------------------------------------------------------
describe('isMutatingMethod', () => {
    test('returns true for POST, PUT, PATCH, DELETE', () => {
        expect(isMutatingMethod('POST')).toBe(true);
        expect(isMutatingMethod('PUT')).toBe(true);
        expect(isMutatingMethod('PATCH')).toBe(true);
        expect(isMutatingMethod('DELETE')).toBe(true);
    });

    test('returns false for GET, HEAD, OPTIONS', () => {
        expect(isMutatingMethod('GET')).toBe(false);
        expect(isMutatingMethod('HEAD')).toBe(false);
        expect(isMutatingMethod('OPTIONS')).toBe(false);
    });

    test('is case-sensitive (lowercase returns false)', () => {
        expect(isMutatingMethod('post')).toBe(false);
        expect(isMutatingMethod('delete')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// resolveEndpointUrl
// ---------------------------------------------------------------------------
describe('resolveEndpointUrl', () => {
    const map = {
        fetchUsers: '/api/users',
        fetchItems: '/api/items',
    };

    test('resolves known route to base URL', () => {
        expect(resolveEndpointUrl('fetchUsers', '', map)).toBe('/api/users');
    });

    test('appends urlParams to base URL', () => {
        expect(resolveEndpointUrl('fetchUsers', '?id=5', map)).toBe('/api/users?id=5');
    });

    test('treats null/undefined urlParams as empty string', () => {
        expect(resolveEndpointUrl('fetchUsers', null, map)).toBe('/api/users');
        expect(resolveEndpointUrl('fetchUsers', undefined, map)).toBe('/api/users');
    });

    test('throws for unknown route name', () => {
        expect(() => resolveEndpointUrl('nonexistent', '', map)).toThrow(
            'api_pipeline: unknown route "nonexistent"'
        );
    });
});

// ---------------------------------------------------------------------------
// buildFetchOptions
// ---------------------------------------------------------------------------
describe('buildFetchOptions', () => {
    test('returns GET with default headers and credentials', () => {
        const opts = buildFetchOptions({});
        expect(opts.method).toBe('GET');
        expect(opts.headers['Content-Type']).toBe('application/json');
        expect(opts.credentials).toBe('include');
        expect(opts.body).toBeUndefined();
    });

    test('uppercases the method', () => {
        expect(buildFetchOptions({ method: 'post' }).method).toBe('POST');
        expect(buildFetchOptions({ method: 'Patch' }).method).toBe('PATCH');
    });

    test('merges extra headers', () => {
        const opts = buildFetchOptions({ headers: { 'X-Custom': 'test' } });
        expect(opts.headers['X-Custom']).toBe('test');
        expect(opts.headers['Content-Type']).toBe('application/json');
    });

    test('extra headers override defaults', () => {
        const opts = buildFetchOptions({
            headers: { 'Content-Type': 'text/plain' },
        });
        expect(opts.headers['Content-Type']).toBe('text/plain');
    });

    test('JSON-stringifies non-FormData body', () => {
        const data = { name: 'test', value: 42 };
        const opts = buildFetchOptions({ bodyData: data });
        expect(opts.body).toBe(JSON.stringify(data));
        expect(opts.headers['Content-Type']).toBe('application/json');
    });

    test('removes Content-Type for FormData body', () => {
        const fd = new FormData();
        fd.append('file', 'dummy');
        const opts = buildFetchOptions({ bodyData: fd });
        expect(opts.body).toBe(fd);
        expect(opts.headers['Content-Type']).toBeUndefined();
    });

    test('does not set body when bodyData is null', () => {
        const opts = buildFetchOptions({ bodyData: null });
        expect(opts.body).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// isAuthFailure403
// ---------------------------------------------------------------------------
describe('isAuthFailure403', () => {
    test('returns true for auth_failure=true JSON', () => {
        expect(isAuthFailure403('{"auth_failure": true}')).toBe(true);
    });

    test('returns false for auth_failure=false JSON', () => {
        expect(isAuthFailure403('{"auth_failure": false}')).toBe(false);
    });

    test('returns false for business-logic 403 (no auth_failure field)', () => {
        expect(isAuthFailure403('{"error": "forbidden"}')).toBe(false);
    });

    test('returns false for plain-text function-level 403 body', () => {
        expect(isAuthFailure403('403 - Forbidden (function-level)')).toBe(false);
    });

    test('returns false for plain-text single-table 403 body', () => {
        expect(isAuthFailure403('403 - Forbidden (single table)')).toBe(false);
    });

    test('returns false for empty or null body', () => {
        expect(isAuthFailure403('')).toBe(false);
        expect(isAuthFailure403(null)).toBe(false);
        expect(isAuthFailure403(undefined)).toBe(false);
    });

    test('returns false for whitespace-only body', () => {
        expect(isAuthFailure403('   ')).toBe(false);
    });

    test('returns false for invalid JSON', () => {
        expect(isAuthFailure403('not json')).toBe(false);
        expect(isAuthFailure403('{broken')).toBe(false);
    });

    test('handles body with surrounding whitespace', () => {
        expect(isAuthFailure403('  {"auth_failure": true}  ')).toBe(true);
    });

    test('returns false when auth_failure is truthy but not boolean true', () => {
        expect(isAuthFailure403('{"auth_failure": 1}')).toBe(false);
        expect(isAuthFailure403('{"auth_failure": "true"}')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// isCsrfFailureResponse
// ---------------------------------------------------------------------------
describe('isCsrfFailureResponse', () => {
    test('returns true for JSON csrf_token_invalid errors', () => {
        expect(isCsrfFailureResponse('{"error": "csrf_token_invalid"}')).toBe(true);
    });

    test('returns true for plain-text missing CSRF token errors', () => {
        expect(isCsrfFailureResponse('missing CSRF token')).toBe(true);
    });

    test('returns false for plain-text permission denials', () => {
        expect(isCsrfFailureResponse('403 - Forbidden (single table)')).toBe(false);
    });

    test('returns false for empty or invalid bodies without csrf text', () => {
        expect(isCsrfFailureResponse('')).toBe(false);
        expect(isCsrfFailureResponse(null)).toBe(false);
        expect(isCsrfFailureResponse('not json')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// createAuthError
// ---------------------------------------------------------------------------
describe('createAuthError', () => {
    test('creates error with status and message for 401', () => {
        const err = createAuthError(401, 'fetchUsers');
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe('Authentication required (401) for route: fetchUsers');
        expect(err.status).toBe(401);
    });

    test('creates error with status and message for 403', () => {
        const err = createAuthError(403, 'updateRow');
        expect(err.message).toContain('403');
        expect(err.message).toContain('updateRow');
        expect(err.status).toBe(403);
    });
});

// ---------------------------------------------------------------------------
// createRateLimitError
// ---------------------------------------------------------------------------
describe('createRateLimitError', () => {
    test('creates error with status 429 and isRateLimited flag', () => {
        const err = createRateLimitError('fetchData');
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toContain('429');
        expect(err.message).toContain('fetchData');
        expect(err.status).toBe(429);
        expect(err.isRateLimited).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// stripAnsiCodes
// ---------------------------------------------------------------------------
describe('stripAnsiCodes', () => {
    test('removes ANSI color codes', () => {
        expect(stripAnsiCodes('\x1b[31mError\x1b[0m')).toBe('Error');
    });

    test('removes multiple ANSI sequences', () => {
        expect(stripAnsiCodes('\x1b[1;31mBold Red\x1b[0m normal \x1b[32mGreen\x1b[0m'))
            .toBe('Bold Red normal Green');
    });

    test('returns clean text unchanged', () => {
        expect(stripAnsiCodes('no codes here')).toBe('no codes here');
    });

    test('returns empty string unchanged', () => {
        expect(stripAnsiCodes('')).toBe('');
    });

    test('passes through non-string values', () => {
        expect(stripAnsiCodes(null)).toBe(null);
        expect(stripAnsiCodes(undefined)).toBe(undefined);
        expect(stripAnsiCodes(42)).toBe(42);
    });
});

// ---------------------------------------------------------------------------
// truncateErrorText
// ---------------------------------------------------------------------------
describe('truncateErrorText', () => {
    test('returns text unchanged when under maxLength', () => {
        expect(truncateErrorText('short', 200)).toBe('short');
    });

    test('truncates and appends ellipsis when over maxLength', () => {
        const long = 'x'.repeat(250);
        const result = truncateErrorText(long, 200);
        expect(result.length).toBe(201); // 200 chars + ellipsis char
        expect(result.endsWith('\u2026')).toBe(true);
    });

    test('uses 200 as default maxLength', () => {
        const exact200 = 'a'.repeat(200);
        expect(truncateErrorText(exact200)).toBe(exact200);

        const over200 = 'b'.repeat(201);
        expect(truncateErrorText(over200).endsWith('\u2026')).toBe(true);
    });

    test('returns empty string for falsy input', () => {
        expect(truncateErrorText('')).toBe('');
        expect(truncateErrorText(null)).toBe('');
        expect(truncateErrorText(undefined)).toBe('');
    });

    test('handles text at exact boundary', () => {
        const exact = 'c'.repeat(200);
        expect(truncateErrorText(exact, 200)).toBe(exact);
    });
});

// ---------------------------------------------------------------------------
// shouldThrottleRateLimitToast
// ---------------------------------------------------------------------------
describe('shouldThrottleRateLimitToast', () => {
    test('returns true when enough time has elapsed', () => {
        expect(shouldThrottleRateLimitToast(1000, 5000, 7000)).toBe(true);
    });

    test('returns false when within throttle window', () => {
        expect(shouldThrottleRateLimitToast(1000, 5000, 3000)).toBe(false);
    });

    test('returns true at exact boundary (> not >=)', () => {
        // At exactly the window, diff === windowMs, so > is false
        expect(shouldThrottleRateLimitToast(1000, 5000, 6000)).toBe(false);
        expect(shouldThrottleRateLimitToast(1000, 5000, 6001)).toBe(true);
    });

    test('returns true when lastToastTime is 0 (never shown)', () => {
        expect(shouldThrottleRateLimitToast(0, 5000, 10000)).toBe(true);
    });
});
