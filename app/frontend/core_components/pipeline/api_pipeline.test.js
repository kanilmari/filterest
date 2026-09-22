// @vitest-environment jsdom
// api_pipeline.test.js
// Verifies shared API-pipeline recovery behavior and the one notice each failed request gets.
// Bridges cached CSRF bootstrap, retry-once recovery, the manifest-backed route pipeline and its notices.
// Exists to keep admin saves working after session/token churn and failures reported once, translated.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const requestLoginRedirectMock = vi.fn();
const requestSessionAccessPromptMock = vi.fn();
const showErrorToastMock = vi.fn();
const showAccessDeniedToastMock = vi.fn();
const showWarningToastMock = vi.fn();
const showToastMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock('../auth/login_redirect_handler.js', () => ({
        requestLoginRedirect: requestLoginRedirectMock,
    }));
    vi.doMock('../auth/session_access_prompt.js', () => ({
        requestSessionAccessPrompt: requestSessionAccessPromptMock,
    }));
    vi.doMock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
        showErrorToast: showErrorToastMock,
        showAccessDeniedToast: showAccessDeniedToastMock,
        showWarningToast: showWarningToastMock,
        showToast: showToastMock,
    }));
    return import('./api_pipeline.js');
}

/** The failure notices shown, as { langKey, text, level, duration }. */
function shownNotices() {
    return showToastMock.mock.calls.map(([options]) => ({
        langKey: options.content.querySelector('[data-lang-key]')?.dataset.langKey,
        text: options.content.textContent,
        level: options.level,
        duration: options.duration,
    }));
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
        localStorage.clear();
        requestLoginRedirectMock.mockReset();
        showAccessDeniedToastMock.mockReset();
        requestSessionAccessPromptMock.mockReset();
        showErrorToastMock.mockReset();
        showWarningToastMock.mockReset();
        showToastMock.mockReset();
        vi.restoreAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        document.documentElement.lang = 'en';
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
        expect(showAccessDeniedToastMock).toHaveBeenCalledWith('updateRow');
        expect(showErrorToastMock).not.toHaveBeenCalled();
    });

    test.each(['login', 'logout'])('keeps a %s shell on the public page after a permission-only 403', async (buttonState) => {
        localStorage.setItem('button_state', buttonState);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(buildResponse(
            { error: '403 - Forbidden (function-level)', code: 403 },
            { ok: false, status: 403, statusText: 'Forbidden' }
        )));
        const mod = await loadModule();

        await expect(mod.runApiPipeline({ routeName: 'datasetNames' })).rejects.toMatchObject({ status: 403 });

        expect(requestSessionAccessPromptMock).not.toHaveBeenCalled();
        expect(requestLoginRedirectMock).not.toHaveBeenCalled();
        expect(showAccessDeniedToastMock).toHaveBeenCalledWith('datasetNames');
        expect(showErrorToastMock).not.toHaveBeenCalled();
        expect(localStorage.getItem('button_state')).toBe(buttonState);
    });

    test.each(['login', 'logout'])('keeps optional alias denials silent in the %s shell', async (buttonState) => {
        localStorage.setItem('button_state', buttonState);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(buildResponse(
            { error: '403 - Forbidden (function-level)', code: 403 },
            { ok: false, status: 403 }
        )));
        const mod = await loadModule();
        await expect(mod.runApiPipeline({ routeName: 'datasetAliases', suppressAuthRedirect: true, suppressErrorToast: true }))
            .rejects.toMatchObject({ status: 403 });
        expect(requestSessionAccessPromptMock).not.toHaveBeenCalled();
        expect(requestLoginRedirectMock).not.toHaveBeenCalled();
        expect(showErrorToastMock).not.toHaveBeenCalled();
        expect(showAccessDeniedToastMock).not.toHaveBeenCalled();
    });

    test.each([
        [401, { error: 'Unauthorized' }],
        [403, { error: 'Session ended', auth_failure: true }],
    ])('reports only an explicit HTTP %s auth failure to login recovery', async (status, body) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(buildResponse(body, { ok: false, status })));
        const mod = await loadModule();
        const result = await mod.runApiPipeline({ routeName: 'getResults' });
        expect(result).toMatchObject({ abort: true, reason: 'auth_redirect', error: { status } });
        expect(requestLoginRedirectMock).toHaveBeenCalledWith({ authenticationFailure: true });
        expect(requestSessionAccessPromptMock).not.toHaveBeenCalled();
        expect(showErrorToastMock).not.toHaveBeenCalled();
        expect(showAccessDeniedToastMock).not.toHaveBeenCalled();
    });

    test.each([
        [401, { error: 'Unauthorized' }],
        [403, { error: 'Session ended', auth_failure: true }],
    ])('leaves optional HTTP %s auth failure recovery to its caller', async (status, body) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(buildResponse(body, { ok: false, status })));
        const mod = await loadModule();
        const result = await mod.runApiPipeline({ routeName: 'datasetAliases', suppressAuthRedirect: true, suppressErrorToast: true });
        expect(result).toMatchObject({ abort: true, reason: 'auth_redirect', error: { status } });
        expect(requestLoginRedirectMock).not.toHaveBeenCalled();
        expect(requestSessionAccessPromptMock).not.toHaveBeenCalled();
        expect(showErrorToastMock).not.toHaveBeenCalled();
    });

    test('turns a 503 into a retryable typed error without exposing the raw response', async () => {
        document.documentElement.lang = 'en';
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(buildResponse(
            'upstream filterest-com-app-2 failed: private runtime detail',
            { ok: false, status: 503, statusText: 'Service Unavailable', contentType: 'text/plain' }
        )));
        const mod = await loadModule();

        await expect(mod.runApiPipeline({ routeName: 'datasetNames' })).rejects.toMatchObject({
            status: 503,
            isServiceUnavailable: true,
            isRetryable: true,
        });

        expect(shownNotices()).toEqual([{
            langKey: 'service_unavailable_notice',
            text: 'The service is temporarily under maintenance. Please retry shortly.',
            level: 'warning',
            duration: 7000,
        }]);
        expect(showErrorToastMock).not.toHaveBeenCalled();
        expect(showWarningToastMock).not.toHaveBeenCalled();
    });
    test.each([400, 403, 429, 503])('quiet requests still fail for HTTP %s without error or warning toasts', async (status) => {
        localStorage.setItem('button_state', 'logout');
        vi.stubGlobal('fetch', vi.fn(async () => buildResponse({ error: 'Provider unavailable' }, { ok: false, status })));
        const mod = await loadModule();
        await expect(mod.runApiPipeline({ routeName: 'imageSourcePickerProviders', suppressErrorToast: true })).rejects.toThrow();
        expect(showToastMock).not.toHaveBeenCalled();
        expect(showErrorToastMock).not.toHaveBeenCalled();
        expect(showWarningToastMock).not.toHaveBeenCalled();
        expect(showAccessDeniedToastMock).not.toHaveBeenCalled();
        expect(requestLoginRedirectMock).not.toHaveBeenCalled();
    });

    test.each([
        [400, 'request_failed_notice', 'The request could not be completed. (400)', 'error'],
        [429, 'rate_limit_notice', 'Too many requests. Wait a moment and try again.', 'warning'],
        [500, 'server_error_notice', 'The service ran into an error. Please try again in a moment. (500)', 'error'],
        [503, 'service_unavailable_notice', 'The service is temporarily under maintenance. Please retry shortly.', 'warning'],
    ])('an ordinary HTTP %s gets one translated notice without route or server text', async (status, langKey, text, level) => {
        localStorage.setItem('button_state', 'logout');
        vi.stubGlobal('fetch', vi.fn(async () => buildResponse({ error: 'Provider unavailable' }, { ok: false, status })));
        const mod = await loadModule();
        await expect(mod.runApiPipeline({ routeName: 'imageSourcePickerProviders' })).rejects.toMatchObject({ status });
        expect(shownNotices()).toMatchObject([{ langKey, text, level }]);
        expect(text).not.toMatch(/imageSourcePickerProviders|Provider unavailable/);
        expect(showErrorToastMock).not.toHaveBeenCalled();
        expect(showWarningToastMock).not.toHaveBeenCalled();
    });

    test('a notice starts in the page language before runtime translations replace it', async () => {
        document.documentElement.lang = 'fi';
        vi.stubGlobal('fetch', vi.fn(async () => buildResponse('internal server error', {
            ok: false, status: 500, contentType: 'text/plain',
        })));
        const mod = await loadModule();
        await expect(mod.runApiPipeline({ routeName: 'getResults' })).rejects.toMatchObject({ status: 500 });
        expect(shownNotices()).toMatchObject([{
            langKey: 'server_error_notice',
            text: 'Palvelussa tapahtui virhe. Yritä hetken kuluttua uudelleen. (500)',
        }]);
        // The route and the server's text are technical detail for the console.
        expect(console.error.mock.calls.flat().join(' ')).toContain('getResults');
        expect(console.error.mock.calls.flat().join(' ')).toContain('internal server error');
    });

    test('a refusal that names its reason by language key shows that reason', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => buildResponse({
            error_lang_key: 'error_table_creation_missing_primary_key',
            error_message: 'missing primary key',
        }, { ok: false, status: 400 })));
        const mod = await loadModule();
        await expect(mod.runApiPipeline({ routeName: 'getResults' })).rejects.toMatchObject({ status: 400 });
        expect(shownNotices()).toMatchObject([{ langKey: 'error_table_creation_missing_primary_key', level: 'error' }]);
        expect(shownNotices()[0].text).not.toContain('missing primary key');
    });

    test('marks every request so the global fetch monitor adds no second notice', async () => {
        const fetchMock = vi.fn(async () => buildResponse({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);
        const mod = await loadModule();
        const { callerOwnsFailureNotice } = await import('../error_and_status_handling/error_monitor_handler_helpers.js');
        await mod.runApiPipeline({ routeName: 'getResults' });
        await mod.runApiPipeline({ routeName: 'getResults', suppressErrorToast: true });
        expect(fetchMock.mock.calls.map(([, options]) => callerOwnsFailureNotice(options))).toEqual([true, true]);
    });

    test('a request that never reaches the service gets the translated network notice', async () => {
        const failure = new TypeError('Failed to fetch https://localhost:8082/api/get-results');
        vi.stubGlobal('fetch', vi.fn(async () => { throw failure; }));
        const mod = await loadModule();
        await expect(mod.runApiPipeline({ routeName: 'getResults' })).rejects.toBe(failure);
        expect(shownNotices()).toEqual([{
            langKey: 'network_error_notice',
            text: 'The service could not be reached. Check your connection and try again.',
            level: 'error',
            duration: undefined,
        }]);
        expect(console.error.mock.calls.flat()).toContain(failure);
    });

    test('a cancelled or quiet request that never reaches the service gets no notice', async () => {
        const controller = new AbortController();
        controller.abort();
        vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('Cancelled', 'AbortError'); }));
        const mod = await loadModule();
        await expect(mod.runApiPipeline({ routeName: 'getResults', signal: controller.signal }))
            .rejects.toMatchObject({ name: 'AbortError' });
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
        await expect(mod.runApiPipeline({ routeName: 'getResults', suppressErrorToast: true })).rejects.toThrow('Failed to fetch');
        expect(showToastMock).not.toHaveBeenCalled();
    });

    test.each([429, 503])('a quiet HTTP %s does not consume the next ordinary notification throttle', async (status) => {
        localStorage.setItem('button_state', 'logout');
        vi.stubGlobal('fetch', vi.fn(async () => buildResponse({ error: 'Busy' }, { ok: false, status })));
        const mod = await loadModule();
        await expect(mod.runApiPipeline({ routeName: 'imageSourcePickerProviders', suppressErrorToast: true })).rejects.toThrow();
        await expect(mod.runApiPipeline({ routeName: 'imageSourcePickerProviders' })).rejects.toThrow();
        expect(showToastMock).toHaveBeenCalledOnce();
    });

    test.each([
        [401, { error: 'Unauthorized' }],
        [403, { error: 'Unauthorized', auth_failure: true }],
    ])('quiet error toasts do not suppress HTTP %s authentication redirects', async (status, body) => {
        vi.stubGlobal('fetch', vi.fn(async () => buildResponse(body, { ok: false, status })));
        const mod = await loadModule();
        const result = await mod.runApiPipeline({ routeName: 'imageSourcePickerProviders', suppressErrorToast: true });
        expect(result.abort).toBe(true);
        expect(requestLoginRedirectMock).toHaveBeenCalledOnce();
        expect(showErrorToastMock).not.toHaveBeenCalled();
    });

    test('quiet error toasts retain CSRF retry and request credentials', async () => {
        const responses = [
            buildResponse({ csrf_token: 'old-csrf' }),
            buildResponse({ error: 'missing CSRF token' }, { ok: false, status: 403 }),
            buildResponse({ csrf_token: 'new-csrf' }),
            buildResponse({ selection: { provider: 'pexels' } }),
        ];
        const fetchMock = vi.fn(async () => responses.shift());
        vi.stubGlobal('fetch', fetchMock);
        const mod = await loadModule();
        const result = await mod.runApiPipeline({
            routeName: 'imageSourcePickerResolve', method: 'POST',
            bodyData: { source_url: 'https://www.pexels.com/photo/example-123/' }, suppressErrorToast: true,
        });
        expect(result.parsedData.selection.provider).toBe('pexels');
        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(fetchMock.mock.calls[3][1]).toEqual(expect.objectContaining({
            credentials: 'include', headers: expect.objectContaining({ 'X-CSRF-Token': 'new-csrf' }),
        }));
        expect(showErrorToastMock).not.toHaveBeenCalled();
    });

});


test('passes opt-in AbortSignal to fetch and propagates cancellation', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const mod = await loadModule();
    const pending = mod.runApiPipeline({
        routeName: 'getIntelligentResultsStream', method: 'GET', stream: true,
        signal: controller.signal, suppressAuthRedirect: true, suppressErrorToast: true,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});
