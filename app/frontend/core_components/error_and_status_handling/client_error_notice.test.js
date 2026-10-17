// @vitest-environment jsdom
// client_error_notice.test.js
// Verifies the installed global handlers through the monitor entrypoint.
// Connects own/foreign attribution, current admin rights and translated toasts.
// Protects visitors from technical text while leaving every failure in the console.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ technical: vi.fn(), toast: vi.fn(), endpoint: vi.fn() }));
vi.mock('../../reusable_components/notifications/toast_notification_printer.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, showErrorToast: (message, duration) => {
        mocks.technical(message, duration);
        return actual.showToast({ message, duration, level: 'error' });
    }, showToast: (options) => {
        if (options.message) mocks.technical(options.message, options.duration);
        else mocks.toast(options);
        return actual.showToast(options);
    } };
});
vi.mock('../ai_features/table_chat/table_chat_printer.js', () => ({ destroy_chat: vi.fn() }));
vi.mock('../admin_tools/admin_update_notice_subscriber.js', () => ({ stopAdminUpdateNoticeSubscriber: vi.fn() }));
vi.mock('../pipeline/api_pipeline.js', () => ({ ensureCsrfToken: vi.fn() }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: mocks.endpoint }));

const own = `${location.origin}/frontend/dist/main.hash.min.js`;
let original;
const errorAt = (source = own, message = 'private technical failure') =>
    Object.assign(new Error(message), { stack: `Error: ${message}\n    at app (${source}:20:8)` });

function genericNotice(language = 'fi') {
    expect(mocks.technical).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    const { content, duration } = mocks.toast.mock.calls[0][0];
    expect(duration).toBe(0);
    expect(content.querySelector('[data-lang-key="client_error_notice"]')).not.toBeNull();
    expect(content.textContent).toBe(language === 'fi'
        ? 'Sovelluksessa tapahtui virhe. Kokeile ladata sivu uudelleen.'
        : 'The application ran into an error. Try reloading the page.');
    expect(content.textContent).not.toContain('private');
}

describe('global runtime error notices', () => {
    beforeEach(async () => {
        original = { fetch: window.fetch, error: window.onerror, rejection: window.onunhandledrejection };
        localStorage.clear(); sessionStorage.clear();
        document.documentElement.lang = 'fi';
        vi.clearAllMocks(); vi.resetModules();
        mocks.endpoint.mockReset().mockResolvedValue({ app_version: '9.4.3' });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        window.fetch = vi.fn();
        await import('./error_monitor_handler.js');
    });
    afterEach(() => {
        window.fetch = original.fetch;
        window.onerror = original.error;
        window.onunhandledrejection = original.rejection;
        localStorage.clear(); sessionStorage.clear();
        document.body.replaceChildren();
        vi.restoreAllMocks();
    });

    test.each(['fi', 'en'])('visitor receives translated generic copy (%s)', (language) => {
        document.documentElement.lang = language;
        window.onerror('private technical failure', own, 20, 8, errorAt());
        genericNotice(language);
    });
    test('ordinary signed-in user receives generic copy', () => {
        localStorage.setItem('button_state', 'logout');
        sessionStorage.setItem('user_permissions', '["/ui/nav_tree"]');
        window.onerror('private technical failure', own, 20, 8, errorAt());
        genericNotice();
    });
    test('visitor with stale admin route cache still receives generic copy', () => {
        sessionStorage.setItem('user_permissions', '["/api/admin/version-info"]');
        window.onerror('private technical failure', own, 20, 8, errorAt());
        genericNotice();
    });
    test.each([
        ['wallet private failure', location.href, 1, 16, errorAt(location.href)],
        ['Script error.', '', 0, 0, null],
        ['no source', '', 1, 1, null],
        ['no source with stack', '', 1, 1, errorAt()],
        ['extension', 'safari-web-extension://wallet/inject.js', 1, 16, null],
        ['foreign stack', own, 1, 16, errorAt('chrome-extension://wallet/inject.js')],
    ])('console only for %s', (...args) => {
        expect(window.onerror(...args)).toBe(false);
        expect(console.error).toHaveBeenCalled();
        expect(mocks.toast).not.toHaveBeenCalled();
        expect(mocks.technical).not.toHaveBeenCalled();
    });
    test('own source without a stack is still reported', () => {
        window.onerror('private technical failure', own, 20, 8, null);
        genericNotice();
    });
    test('own Error rejection is persistent and generic for visitors', () => {
        window.onunhandledrejection({ reason: errorAt() });
        genericNotice();
    });
    test.each([
        'private rejection', { stack: `at app (${own}:20:8)` },
        errorAt('chrome-extension://wallet/inject.js'),
        Object.assign(new Error('no stack'), { stack: '' }),
    ])('console only for rejection without an own Error stack', (reason) => {
        window.onunhandledrejection({ reason });
        expect(console.error).toHaveBeenCalled();
        expect(mocks.toast).not.toHaveBeenCalled();
        expect(mocks.technical).not.toHaveBeenCalled();
    });
    test.each(['error', 'rejection'])('admin receives bounded technical copy for %s', async (kind) => {
        localStorage.setItem('button_state', 'logout');
        sessionStorage.setItem('user_permissions', '["/api/admin/version-info"]');
        const message = `private technical failure https://example.test/path/module.js?private=abc#fragment /module.js?other=abc ${'x'.repeat(500)}`;
        if (kind === 'error') window.onerror(message, own, 20, 8, errorAt(own, message));
        else window.onunhandledrejection({ reason: errorAt(own, message) });
        await vi.waitFor(() => expect(mocks.technical).toHaveBeenCalledTimes(1));
        expect(mocks.toast).not.toHaveBeenCalled();
        const [text, duration] = mocks.technical.mock.calls[0];
        expect(duration).toBe(0);
        expect(text.length).toBeLessThanOrEqual(240);
        expect(text).toContain('private technical failure');
        expect(text).toContain('module.js');
        expect(text).not.toMatch(/https?:|example\.test|[?#]|private=|other=/);
    });
    test.each(['error', 'rejection'])('admin copy drops queries that contain parentheses for %s', async (kind) => {
        localStorage.setItem('button_state', 'logout');
        sessionStorage.setItem('user_permissions', '["/api/admin/version-info"]');
        const message = 'Request failed https://example.invalid/api?filter=(email)&access_key=PRIVATE_VALUE#part'
            + ' (see https://example.invalid/frontend/load.js) /api/rows?sort=(name)&token=SECOND'
            + ` "https://example.invalid/x?filter='email'&access_key=THIRD#part" <//example.invalid/y?z="q"&k=FOURTH>`;
        if (kind === 'error') window.onerror(message, own, 20, 8, errorAt(own, message));
        else window.onunhandledrejection({ reason: errorAt(own, message) });
        await vi.waitFor(() => expect(mocks.technical).toHaveBeenCalledTimes(1));
        const [text] = mocks.technical.mock.calls[0];
        expect(text).toContain('Request failed api');
        expect(text).toContain('(see load.js)');
        expect(text).not.toMatch(/https?:|example\.invalid|[?#]|filter=|email|access_key|PRIVATE_VALUE|sort=|SECOND|THIRD|FOURTH/);
    });
    test('a non-admin with an admin route grant still receives generic copy', async () => {
        localStorage.setItem('button_state', 'logout');
        sessionStorage.setItem('user_permissions', '["/api/admin/version-info"]');
        mocks.endpoint.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
        window.onerror('private technical failure', own, 20, 8, errorAt());
        await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1));
        genericNotice();
        expect(mocks.endpoint).toHaveBeenCalledWith('adminVersionInfo', expect.objectContaining({
            suppressErrorToast: true, suppressAuthRedirect: true,
        }));
    });
    test('session invalidation during verification withholds technical copy', async () => {
        localStorage.setItem('button_state', 'logout');
        sessionStorage.setItem('user_permissions', '["/api/admin/version-info"]');
        let resolve;
        mocks.endpoint.mockImplementation(() => new Promise(done => { resolve = done; }));
        window.onerror('private technical failure', own, 20, 8, errorAt());
        const { invalidateSessionGeneration } = await import('../auth/session_generation_store.js');
        invalidateSessionGeneration({ reason: 'logout' });
        resolve({ app_version: '9.4.3' });
        await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1));
        genericNotice();
    });
    test.each(['generation', 'logout shell'])('removes visible technical notices on %s changes, retaining generic notices', async (path) => {
        window.onerror('private technical failure', own, 20, 8, errorAt());
        const generic = document.querySelector('[data-lang-key="client_error_notice"]').closest('[data-testid="toast"]');
        localStorage.setItem('button_state', 'logout');
        sessionStorage.setItem('user_permissions', '["/api/admin/version-info"]');
        window.onerror('private administrator diagnostic', own, 20, 8, errorAt());
        window.onunhandledrejection({ reason: errorAt(own, 'another private diagnostic') });
        await vi.waitFor(() => expect(mocks.technical).toHaveBeenCalledTimes(2));
        const technical = [...document.querySelectorAll('[data-testid="toast"]')].filter(toast => toast !== generic);
        expect(technical).toHaveLength(2);
        expect(technical.every(toast => toast.isConnected && toast.style.opacity === '1'
            && toast.textContent.includes('private'))).toBe(true);

        if (path === 'generation') {
            const { invalidateSessionGeneration } = await import('../auth/session_generation_store.js');
            invalidateSessionGeneration({ reason: 'logout' });
        } else {
            // This is the in-place reset used by auth_broadcast_sync after another tab signs out.
            const { applyLoggedOutShellReset } = await import('../auth/logout_shell_reset.js');
            await applyLoggedOutShellReset({ postLogoutPath: '/' });
            expect(localStorage.getItem('button_state')).toBe('login');
        }
        expect(technical.every(toast => !toast.isConnected)).toBe(true);
        expect(document.body.textContent).not.toContain('private');
        expect(generic.isConnected).toBe(true);
        expect(generic.querySelector('[data-lang-key="client_error_notice"]')).not.toBeNull();
    });
    test('ResizeObserver warnings remain ignored', () => {
        expect(window.onerror('ResizeObserver loop limit exceeded', own, 1, 1, errorAt())).toBe(true);
        window.onunhandledrejection({ reason: errorAt(own, 'ResizeObserver loop limit exceeded') });
        expect(console.error).not.toHaveBeenCalled();
        expect(mocks.toast).not.toHaveBeenCalled();
        expect(mocks.technical).not.toHaveBeenCalled();
    });
});
