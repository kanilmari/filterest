// @vitest-environment jsdom
// api_pipeline.test.js
// Verifies shared API-pipeline recovery behavior for CSRF token drift on mutating requests.
// Bridges cached CSRF bootstrap, retry-once recovery, and the manifest-backed route pipeline.
// Exists to keep admin saves working after session/token churn without requiring a full page refresh.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const requestLoginRedirectMock = vi.fn();
const showErrorToastMock = vi.fn();
const showWarningToastMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock('../auth/login_redirect_handler.js', () => ({
        requestLoginRedirect: requestLoginRedirectMock,
    }));
    vi.doMock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
        showErrorToast: showErrorToastMock,
        showWarningToast: showWarningToastMock,
    }));
    return import('./api_pipeline.js');
}

function buildResponse(body, { ok = true, status = 200, statusText = 'OK', contentType = 'application/json' } = {}) {
    const payload = typeof body === 'string' ? body : body == null ? '' : JSON.stringify(body);
    return {
        ok,
        status,
        statusText,
        clone() {
            return buildResponse(payload, { ok, status, statusText, contentType });
        },
        text: async () => payload,
        json: async () => (payload ? JSON.parse(payload) : null),
        headers: {
            get(name) {
                return name === 'Content-Type' ? contentType : null;
            },
        },
    };
}

describe('api_pipeline', () => {
    beforeEach(() => {
        requestLoginRedirectMock.mockReset();
        showErrorToastMock.mockReset();
        showWarningToastMock.mockReset();
        vi.restoreAllMocks();
    });

    test('keeps private endpoint registration available beside manifest-backed routes', async () => {
        const mod = await loadModule();

        mod.registerEndpointRoute('privateToolExample', '/api/private-tools/example');

        expect(mod.getEndpointUrl('privateToolExample')).toBe('/api/private-tools/example');
        expect(() => {
            mod.registerEndpointRoute('privateToolExample', '/api/private-tools/other-example');
        }).toThrow('endpoint route "privateToolExample" is already registered');
    });

    test('refreshes the CSRF token and retries once after a CSRF-specific 403', async () => {
        const recordedCalls = [];
        const responses = [
            buildResponse({ csrf_token: 'stale-token' }),
            buildResponse({ error: 'missing CSRF token' }, { ok: false, status: 403, statusText: 'Forbidden' }),
            buildResponse({ csrf_token: 'fresh-token' }),
            buildResponse({ ok: true }),
        ];
        const fetchMock = vi.fn(async (url, options) => {
            recordedCalls.push([url, JSON.parse(JSON.stringify(options || {}))]);
            return responses.shift();
        });
        vi.stubGlobal('fetch', fetchMock);
        const mod = await loadModule();

        const result = await mod.runApiPipeline({
            routeName: 'updateRow',
            method: 'POST',
            bodyData: { id: 7, column: 'title', value: 'Updated' },
        });

        expect(result.parsedData).toEqual({ ok: true });
        expect(recordedCalls).toEqual([
            ['/api/csrf-token', { credentials: 'include' }],
            ['/api/update-row', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': 'stale-token',
                },
                body: JSON.stringify({ id: 7, column: 'title', value: 'Updated' }),
            }],
            ['/api/csrf-token', { credentials: 'include' }],
            ['/api/update-row', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': 'fresh-token',
                },
                body: JSON.stringify({ id: 7, column: 'title', value: 'Updated' }),
            }],
        ]);
        expect(showErrorToastMock).not.toHaveBeenCalled();
    });

    test('does not retry non-CSRF 403 responses', async () => {
        const recordedCalls = [];
        const responses = [
            buildResponse({ csrf_token: 'stale-token' }),
            buildResponse('403 - Forbidden (single table)', { ok: false, status: 403, statusText: 'Forbidden', contentType: 'text/plain' }),
        ];
        const fetchMock = vi.fn(async (url, options) => {
            recordedCalls.push([url, JSON.parse(JSON.stringify(options || {}))]);
            return responses.shift();
        });
        vi.stubGlobal('fetch', fetchMock);
        const mod = await loadModule();

        await expect(mod.runApiPipeline({
            routeName: 'updateRow',
            method: 'POST',
            bodyData: { id: 7, column: 'title', value: 'Updated' },
        })).rejects.toThrow('Virhe pyynnössä (updateRow): 403 - Forbidden (single table)');

        expect(recordedCalls).toEqual([
            ['/api/csrf-token', { credentials: 'include' }],
            ['/api/update-row', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': 'stale-token',
                },
                body: JSON.stringify({ id: 7, column: 'title', value: 'Updated' }),
            }],
        ]);
        expect(showErrorToastMock).toHaveBeenCalledTimes(1);
    });
});
