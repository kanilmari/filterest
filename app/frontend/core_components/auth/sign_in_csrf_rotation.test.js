// sign_in_csrf_rotation.test.js
// Proves the first write after in-page sign-in uses the replacement CSRF token.
// Bridges the shared pre-auth sender with the real API pipeline's token cache.
// Prevents stale-token recovery retries from concealing a broken sign-in transition.
// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

test.each(['password', 'email', 'fixed_pin', 'totp'])(
    '%s completion replaces an already cached token before the first POST', async (method) => {
        vi.resetModules();
        vi.doMock('./login_redirect_handler.js', () => ({ requestLoginRedirect: vi.fn() }));
        vi.doMock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
            showAccessDeniedToast: vi.fn(), showToast: vi.fn(),
        }));
        const { ensureCsrfToken, runApiPipeline } = await import('../pipeline/api_pipeline.js');
        const { postPreAuthJson } = await import('./pre_auth_request_sender.js');
        const json = (body) => new Response(JSON.stringify(body), {
            headers: { 'Content-Type': 'application/json' },
        });
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(json({ csrf_token: 'guest-token' }))
            .mockResolvedValueOnce(json({ authenticated: true, verification_method: method }))
            .mockResolvedValueOnce(json({ csrf_token: 'signed-in-token' }))
            .mockResolvedValueOnce(json({ success: true }));
        vi.stubGlobal('fetch', fetchMock);
        expect(await ensureCsrfToken()).toBe('guest-token');
        const field = document.createElement('input');
        field.value = 'guest-token';

        await postPreAuthJson('/api/login', field, (csrf_token) => ({ csrf_token }));
        const result = await runApiPipeline({ routeName: 'updateUserProfile', method: 'POST', bodyData: {} });

        expect(result.parsedData).toEqual({ success: true });
        expect(field.value).toBe('signed-in-token');
        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(fetchMock.mock.calls[3][1].headers['X-CSRF-Token']).toBe('signed-in-token');
        expect(await ensureCsrfToken()).toBe('signed-in-token');
        expect(fetchMock).toHaveBeenCalledTimes(4); // no refusal, retry or further token pickup
    },
);
