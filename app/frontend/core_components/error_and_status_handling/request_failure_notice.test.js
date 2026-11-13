// @vitest-environment jsdom
// request_failure_notice.test.js
// Verifies the rendered failed-request notice and which network failures deserve one.
// Bridges the notice module with the real toast printer in a browser-like document.
// Exists so each notice carries its language key for the translation handler,
// starts readable in the page's language, and names no route or address.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

async function loadNotice() {
    vi.resetModules();
    return import('./request_failure_notice.js');
}

function visibleNotices() {
    return [...document.querySelectorAll('[data-testid="toast"]')].map((toast) => ({
        level: toast.dataset.toastLevel,
        langKey: toast.querySelector('[data-lang-key]')?.dataset.langKey,
        text: toast.querySelector('.toast-notification-content').textContent,
    }));
}

describe('request failure notice', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        document.documentElement.lang = 'en';
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    test('renders the keyed sentence and the status code as one error notice', async () => {
        const { showRequestFailureNotice } = await loadNotice();

        showRequestFailureNotice('server_error_notice', { status: 502 });

        expect(visibleNotices()).toEqual([{
            level: 'error',
            langKey: 'server_error_notice',
            text: 'The service ran into an error. Please try again in a moment. (502)',
        }]);
    });

    test('counts equal visible notices while keeping each public status, reason and severity distinct', async () => {
        const { showRequestFailureNotice } = await loadNotice();
        const show = (status, key = 'server_error_notice', level = 'error') =>
            showRequestFailureNotice(key, { status, level, duration: 0 });
        const original = show(500);
        const badge = original.element.querySelector('.toast-notification-count');
        expect(badge.hidden).toBe(true);
        expect(show(500)).toBe(original);
        expect(badge.hidden).toBe(false);
        expect(badge.textContent).toBe('×2');

        show(403, 'access_denied_for_action', 'warning');
        show(502);
        show(500, 'request_failed_notice');
        show(500, 'server_error_notice', 'warning');
        expect(show(500)).toBe(original);
        expect(badge.textContent).toBe('×3');
        expect(original.element.getAttribute('aria-atomic')).toBe('true');
        expect(visibleNotices()).toHaveLength(5);
    });

    test.each(['user click', 'expiry'])('starts from one as soon as the old group closes by %s', async (cause) => {
        vi.useFakeTimers();
        try {
            const { showRequestFailureNotice } = await loadNotice();
            const show = () => showRequestFailureNotice('server_error_notice', { status: 500, duration: 900 });
            const original = show();
            show();
            if (cause === 'user click') original.element.querySelector('button').click();
            else vi.advanceTimersByTime(900);
            const replacement = show();
            expect(replacement.element).not.toBe(original.element);
            expect(replacement.element.querySelector('.toast-notification-count').hidden).toBe(true);
            expect(original.element.getAttribute('aria-hidden')).toBe('true');
            vi.advanceTimersByTime(300);
            expect(visibleNotices()).toHaveLength(1);
            expect(replacement.element.isConnected).toBe(true);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    test.each([
        ['fi', 'Pyyntöjä tuli liian monta. Odota hetki ja yritä uudelleen.'],
        ['ch', '请求过多。请稍等片刻后重试。'],
        ['yue', '請求太多。請等一陣再試。'],
        ['sv', 'Too many requests. Wait a moment and try again.'],
    ])('starts from the %s bootstrap copy until translations replace it', async (language, text) => {
        document.documentElement.lang = language;
        const { showRequestFailureNotice } = await loadNotice();

        showRequestFailureNotice('rate_limit_notice', { level: 'warning', duration: 6000 });

        expect(visibleNotices()).toEqual([{ level: 'warning', langKey: 'rate_limit_notice', text }]);
    });

    test('a reason the server names by key starts from the general sentence', async () => {
        const { showRequestFailureNotice } = await loadNotice();

        showRequestFailureNotice('error_table_creation_missing_primary_key');

        expect(visibleNotices()).toEqual([{
            level: 'error',
            langKey: 'error_table_creation_missing_primary_key',
            text: 'The request could not be completed.',
        }]);
    });
});

describe('expected network aborts', () => {
    test('a request its caller cancelled is expected, whatever the error says', async () => {
        const { isExpectedNetworkAbort } = await loadNotice();
        const controller = new AbortController();
        controller.abort();

        expect(isExpectedNetworkAbort(new TypeError('Failed to fetch'), { signal: controller.signal })).toBe(true);
    });

    test('an abort-like failure is expected only while leaving the page or for expendable work', async () => {
        const { isExpectedNetworkAbort } = await loadNotice();
        const failure = new TypeError('Failed to fetch');

        expect(isExpectedNetworkAbort(failure, {})).toBe(false);
        expect(isExpectedNetworkAbort(failure, { headers: { 'X-Ignore-Network-Abort': '1' } })).toBe(true);
        expect(isExpectedNetworkAbort(failure, { headers: { 'x-ignore-network-abort': '1' } })).toBe(true);

        window.dispatchEvent(new Event('pagehide'));
        expect(isExpectedNetworkAbort(failure, {})).toBe(true);
        window.dispatchEvent(new Event('pageshow'));
        expect(isExpectedNetworkAbort(failure, {})).toBe(false);
    });

    test('an abort-like failure soon after beforeunload is a leave, even one the browser then cancelled', async () => {
        vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
        try {
            const { isExpectedNetworkAbort, isLeavingNetworkAbort } = await loadNotice();
            const failure = new TypeError('Failed to fetch');

            expect(isLeavingNetworkAbort(failure)).toBe(false);
            window.dispatchEvent(new Event('beforeunload'));
            expect(isLeavingNetworkAbort(failure)).toBe(true);
            expect(isExpectedNetworkAbort(failure, {})).toBe(true);
            expect(isLeavingNetworkAbort(new Error('certificate rejected'))).toBe(false);
            vi.setSystemTime(1_002_999);
            expect(isLeavingNetworkAbort(failure)).toBe(true);
            vi.setSystemTime(1_003_000);
            expect(isLeavingNetworkAbort(failure)).toBe(false);

            window.dispatchEvent(new Event('beforeunload'));
            window.dispatchEvent(new Event('pageshow'));
            expect(isLeavingNetworkAbort(failure)).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    test('a failure that is not abort-like is never expected', async () => {
        const { isExpectedNetworkAbort } = await loadNotice();

        expect(isExpectedNetworkAbort(new Error('certificate rejected'), {
            headers: { 'X-Ignore-Network-Abort': '1' },
        })).toBe(false);
    });
});
