// api_pipeline_helpers.test.js
// Verifies the pure request-routing, response-classification, and typed-error helpers.
// Bridges shared pipeline contracts with focused unit-level regression coverage.
// Exists so cross-cutting HTTP behavior can change without requiring browser integration tests.

import { describe, test, expect } from 'vitest';
import {
    isMutatingMethod,
    resolveEndpointUrl,
    buildFetchOptions,
    isAuthFailure403,
    isCsrfFailureResponse,
    createAuthError,
    createRateLimitError,
    createServiceUnavailableError,
    isServiceUnavailableError,
    stripAnsiCodes,
    shouldThrottleRateLimitToast,
    resolveFailureNotice,
} from './api_pipeline_helpers.js';

describe('service-unavailable errors', () => {
    test('creates and recognizes the stable retryable 503 contract', () => {
        const error = createServiceUnavailableError('updateRow');

        expect(error).toMatchObject({
            status: 503,
            isServiceUnavailable: true,
            isRetryable: true,
        });
        expect(isServiceUnavailableError(error)).toBe(true);
        expect(isServiceUnavailableError({ status: 503 })).toBe(true);
        expect(isServiceUnavailableError({ status: 500 })).toBe(false);
    });
});

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
        searchStream: '/api/get-intelligent-results?stream=1',
    };

    test('resolves known route to base URL', () => {
        expect(resolveEndpointUrl('fetchUsers', '', map)).toBe('/api/users');
    });

    test('appends urlParams to base URL', () => {
        expect(resolveEndpointUrl('fetchUsers', '?id=5', map)).toBe('/api/users?id=5');
    });

    test('inserts a query delimiter for bare URLSearchParams strings', () => {
        expect(resolveEndpointUrl('fetchUsers', 'dataset=dokumentaatio', map))
            .toBe('/api/users?dataset=dokumentaatio');
        expect(resolveEndpointUrl('fetchUsers', '&dataset=dokumentaatio', map))
            .toBe('/api/users?dataset=dokumentaatio');
    });

    // A route variant with its own query must keep the caller's dataset name
    // inside the same query string; a second '?' hid it from the permission check.
    test('continues a route variant that already carries a query', () => {
        expect(resolveEndpointUrl('searchStream', '&dataset=system_functions&query=api', map))
            .toBe('/api/get-intelligent-results?stream=1&dataset=system_functions&query=api');
        expect(resolveEndpointUrl('searchStream', '?dataset=system_functions', map))
            .toBe('/api/get-intelligent-results?stream=1&dataset=system_functions');
        expect(resolveEndpointUrl('searchStream', '', map))
            .toBe('/api/get-intelligent-results?stream=1');
    });

    test('keeps path-suffix urlParams without a query delimiter', () => {
        expect(resolveEndpointUrl('fetchUsers', 'orders', map)).toBe('/api/usersorders');
        expect(resolveEndpointUrl('fetchUsers', 'node?lines=240', map)).toBe('/api/usersnode?lines=240');
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
// resolveFailureNotice
// ---------------------------------------------------------------------------
describe('resolveFailureNotice', () => {
    test('a server error gets the server-error sentence and its status code', () => {
        expect(resolveFailureNotice(500, 'internal server error')).toEqual({ langKey: 'server_error_notice', status: 500 });
        expect(resolveFailureNotice(502, '<html>Bad gateway</html>')).toEqual({ langKey: 'server_error_notice', status: 502 });
    });

    test('a refusal shows the general sentence, never the server text', () => {
        expect(resolveFailureNotice(400, 'Invalid JSON')).toEqual({ langKey: 'request_failed_notice', status: 400 });
        expect(resolveFailureNotice(404, JSON.stringify({ error: 'dataset "x" not found', code: 404 })))
            .toEqual({ langKey: 'request_failed_notice', status: 404 });
    });

    test('a refusal that names its reason by language key shows that reason', () => {
        const body = JSON.stringify({
            error_lang_key: 'error_table_creation_missing_primary_key',
            error_message: 'missing primary key',
        });
        expect(resolveFailureNotice(400, body)).toEqual({ langKey: 'error_table_creation_missing_primary_key' });
    });

    test('a named reason that is not a plain language key is ignored', () => {
        for (const reasonKey of ['<img src=x>', 'Error Key', '', 42, 'x'.repeat(200)]) {
            expect(resolveFailureNotice(409, JSON.stringify({ error_lang_key: reasonKey })))
                .toEqual({ langKey: 'request_failed_notice', status: 409 });
        }
    });

    test('a server error keeps its own sentence even when it names a reason', () => {
        expect(resolveFailureNotice(500, JSON.stringify({ error_lang_key: 'some_reason' })))
            .toEqual({ langKey: 'server_error_notice', status: 500 });
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
