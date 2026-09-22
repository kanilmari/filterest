// @vitest-environment jsdom
// error_monitor_handler.test.js
// Verifies the global fetch monitor's notices for server and network failures.
// Bridges the monkey-patched window.fetch, the API pipeline's caller-owned
// mark and the language-keyed failure notices.
// Exists so a failed request produces one readable, translated notice without
// its address, and none when the calling code (the API pipeline) shows its own.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const showErrorToastMock = vi.fn();
const showToastMock = vi.fn();
const PAGE_COPY = Object.freeze({
    server_error_notice: 'Palvelussa tapahtui virhe. Yritä hetken kuluttua uudelleen.',
    network_error_notice: 'Palveluun ei saatu yhteyttä. Tarkista verkkoyhteys ja yritä uudelleen.',
});
const FAILED_URL = 'https://localhost:8082/api/get-results?table=private_dataset&token=abc';

let browserFetch;

function response(status) {
    return {
        ok: status < 400,
        status,
        url: FAILED_URL,
        clone() { return response(status); },
        text: async () => 'internal server error',
        headers: { get: () => 'text/plain' },
    };
}

/** Installs the monitor over a fake browser fetch and returns the patched fetch. */
async function loadMonitor(fetchImplementation) {
    vi.resetModules();
    vi.doMock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
        showErrorToast: showErrorToastMock,
        showWarningToast: vi.fn(),
        showAccessDeniedToast: vi.fn(),
        showToast: showToastMock,
    }));
    vi.doMock('../endpoints/endpoint_router.js', () => ({
        endpoint_router: vi.fn(),
    }));
    window.fetch = vi.fn(fetchImplementation);
    await import('./error_monitor_handler.js');
    return window.fetch;
}

async function loadHelpers() {
    return import('./error_monitor_handler_helpers.js');
}

/** The failure notices shown, as { langKey, text }. */
function shownNotices() {
    return showToastMock.mock.calls.map(([options]) => ({
        langKey: options.content.querySelector('[data-lang-key]')?.dataset.langKey,
        text: options.content.textContent,
    }));
}

describe('error_monitor_handler fetch monitor', () => {
    beforeEach(() => {
        browserFetch = window.fetch;
        showErrorToastMock.mockReset();
        showToastMock.mockReset();
        document.documentElement.lang = 'fi';
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        window.fetch = browserFetch;
        vi.restoreAllMocks();
    });

    test('shows one translated notice with the status code for a 5xx', async () => {
        const monitoredFetch = await loadMonitor(async () => response(500));

        const result = await monitoredFetch('/api/get-results', { method: 'GET' });

        expect(result.status).toBe(500);
        expect(shownNotices()).toEqual([
            { langKey: 'server_error_notice', text: `${PAGE_COPY.server_error_notice} (500)` },
        ]);
        expect(showErrorToastMock).not.toHaveBeenCalled();
    });

    test('keeps the failed address out of the notice and in the console', async () => {
        const monitoredFetch = await loadMonitor(async () => response(502));

        await monitoredFetch('/api/get-results');

        const notice = shownNotices()[0].text;
        expect(notice).not.toContain('localhost');
        expect(notice).not.toContain('/api/');
        expect(notice).not.toContain('private_dataset');
        expect(console.error.mock.calls.flat().join(' ')).toContain('/api/get-results');
    });

    test('shows no notice when the caller shows its own', async () => {
        const { markCallerOwnsFailureNotice } = await loadHelpers();
        const monitoredFetch = await loadMonitor(async () => response(500));

        const result = await monitoredFetch('/api/get-results', markCallerOwnsFailureNotice({ method: 'GET' }));

        expect(result.status).toBe(500);
        expect(showToastMock).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith('[HTTP]', expect.stringContaining('500'), result);
    });

    test('leaves 4xx statuses to the caller', async () => {
        const monitoredFetch = await loadMonitor(async () => response(404));

        await monitoredFetch('/api/get-results');

        expect(showToastMock).not.toHaveBeenCalled();
    });

    test('shows the translated network notice without the browser error text', async () => {
        const failure = new TypeError('Failed to fetch https://localhost:8082/api/get-results');
        const monitoredFetch = await loadMonitor(async () => { throw failure; });

        await expect(monitoredFetch('/api/get-results')).rejects.toBe(failure);

        expect(shownNotices()).toEqual([
            { langKey: 'network_error_notice', text: PAGE_COPY.network_error_notice },
        ]);
        expect(console.error.mock.calls.flat().join(' ')).toContain('Failed to fetch');
    });

    test('shows no network notice for a request its caller cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        const failure = new DOMException('Cancelled', 'AbortError');
        const monitoredFetch = await loadMonitor(async () => { throw failure; });

        await expect(monitoredFetch('/api/get-results', { signal: controller.signal })).rejects.toBe(failure);

        expect(showToastMock).not.toHaveBeenCalled();
    });

    test('shows no network notice when the caller shows its own', async () => {
        const { markCallerOwnsFailureNotice } = await loadHelpers();
        const failure = new TypeError('Failed to fetch');
        const monitoredFetch = await loadMonitor(async () => { throw failure; });

        await expect(monitoredFetch('/api/get-results', markCallerOwnsFailureNotice({})))
            .rejects.toBe(failure);

        expect(showToastMock).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalled();
    });

    async function loadPipelineOverMonitor() {
        const monitoredFetch = await loadMonitor(async () => response(500));
        vi.doMock('../endpoints/backend_route_manifest_reader.js', () => ({
            getBackendRoutePathByHandler: () => '/api/get-results',
        }));
        vi.doMock('../auth/login_redirect_handler.js', () => ({ requestLoginRedirect: vi.fn() }));
        const { runApiPipeline } = await import('../pipeline/api_pipeline.js');
        expect(window.fetch).toBe(monitoredFetch);
        return runApiPipeline;
    }

    test('an API pipeline request with suppressErrorToast gets no monitor notice', async () => {
        const runApiPipeline = await loadPipelineOverMonitor();

        await expect(runApiPipeline({ routeName: 'getResults', suppressErrorToast: true }))
            .rejects.toMatchObject({ status: 500 });
        // The pipeline's own error stage respects the same flag; the monitor
        // adds nothing either, so the calling code's notice is the only one.
        expect(showToastMock).not.toHaveBeenCalled();
        expect(showErrorToastMock).not.toHaveBeenCalled();
    });

    test('an ordinary API pipeline request gets exactly one notice, from the pipeline', async () => {
        const runApiPipeline = await loadPipelineOverMonitor();

        await expect(runApiPipeline({ routeName: 'getResults' })).rejects.toMatchObject({ status: 500 });
        expect(shownNotices()).toEqual([
            { langKey: 'server_error_notice', text: `${PAGE_COPY.server_error_notice} (500)` },
        ]);
        expect(showErrorToastMock).not.toHaveBeenCalled();
    });
});
