// pre_auth_request_sender.test.js
// Verifies that sign-in requests recover a stale CSRF token by themselves.
// Bridges mocked service answers, the pipeline's token fetch, and the form's hidden token field.
// Exists so a page restored from the browser's cache signs in without telling the person to reload.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const ensureCsrfTokenMock = vi.fn();
const fetchMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock("../pipeline/api_pipeline.js", () => ({
        ensureCsrfToken: ensureCsrfTokenMock,
    }));
    return import("./pre_auth_request_sender.js");
}

function answer(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function tokenField(value) {
    const field = document.createElement("input");
    field.id = "csrf_token";
    field.value = value;
    return field;
}

function sentTokens() {
    return fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body).csrf_token);
}

describe("postPreAuthJson", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ensureCsrfTokenMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
    });

    test("sends once with the form's token when the service accepts it", async () => {
        const { postPreAuthJson } = await loadModule();
        fetchMock.mockResolvedValueOnce(answer(200, { authenticated: true }));
        ensureCsrfTokenMock.mockResolvedValueOnce('signed-in-token');

        const response = await postPreAuthJson("/api/login", tokenField("page-token"), (csrf_token) => ({ username: "u", csrf_token }));

        expect(response.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith("/api/login", expect.objectContaining({
            method: "POST",
            credentials: "include",
        }));
        expect(sentTokens()).toEqual(["page-token"]);
        expect(ensureCsrfTokenMock).toHaveBeenCalledExactlyOnceWith({ forceRefresh: true });
    });

    test.each(['password', 'email', 'fixed_pin', 'totp'])(
        '%s completion waits for the new token and updates the form before returning', async (method) => {
            const { postPreAuthJson } = await loadModule();
            const { getSessionGeneration } = await import('./session_generation_store.js');
            const generationBeforeLogin = getSessionGeneration();
            const field = tokenField('pre-sign-in');
            fetchMock.mockResolvedValueOnce(answer(200, { authenticated: true, verification_method: method }));
            let finishRefresh;
            ensureCsrfTokenMock.mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }));
            let returned = false;
            const completion = postPreAuthJson('/api/login', field, (csrf_token) => ({ csrf_token }))
                .then((response) => { returned = true; return response; });
            await vi.waitFor(() => expect(ensureCsrfTokenMock).toHaveBeenCalledTimes(1));
            expect(getSessionGeneration()).toBe(generationBeforeLogin + 1);
            expect(returned).toBe(false);
            finishRefresh('post-sign-in');
            expect((await completion).ok).toBe(true);
            expect(field.value).toBe('post-sign-in');
            expect(fetchMock).toHaveBeenCalledTimes(1);
        },
    );

    test('pending factors and password-reset replies do not refresh the sign-in cache', async () => {
        const { postPreAuthJson } = await loadModule();
        fetchMock.mockResolvedValueOnce(answer(200, { otp_required: true }))
            .mockResolvedValueOnce(answer(200, { success: true }));
        const field = tokenField('pending-token');
        await postPreAuthJson('/api/login', field, (csrf_token) => ({ csrf_token }));
        await postPreAuthJson('/api/reset-password', field, (csrf_token) => ({ csrf_token }));
        expect(ensureCsrfTokenMock).not.toHaveBeenCalled();
        expect(field.value).toBe('pending-token');
    });

    test("fetches the session's token, writes it into the form and sends once more after a token refusal", async () => {
        const { postPreAuthJson } = await loadModule();
        const field = tokenField("stale-token");
        fetchMock
            .mockResolvedValueOnce(answer(403, { error: "csrf_token_invalid" }))
            .mockResolvedValueOnce(answer(200, { authenticated: true }));
        ensureCsrfTokenMock.mockResolvedValue("session-token");

        const response = await postPreAuthJson("/api/login", field, (csrf_token) => ({ csrf_token }));

        expect(response.status).toBe(200);
        expect(ensureCsrfTokenMock).toHaveBeenCalledWith({ forceRefresh: true });
        expect(sentTokens()).toEqual(["stale-token", "session-token"]);
        expect(field.value).toBe("session-token");
    });

    // The first refusal can itself clear a stray session cookie, after which the
    // same token matches; one more attempt is still worth making.
    test("sends once more even when the session's token equals the form's", async () => {
        const { postPreAuthJson } = await loadModule();
        fetchMock
            .mockResolvedValueOnce(answer(403, { error: "csrf_token_invalid" }))
            .mockResolvedValueOnce(answer(200, { authenticated: true }));
        ensureCsrfTokenMock.mockResolvedValue("page-token");

        const response = await postPreAuthJson("/api/login", tokenField("page-token"), (csrf_token) => ({ csrf_token }));

        expect(response.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test("tries only once more, and returns the second refusal", async () => {
        const { postPreAuthJson } = await loadModule();
        fetchMock
            .mockResolvedValueOnce(answer(403, { error: "csrf_token_invalid" }))
            .mockResolvedValueOnce(answer(403, { error: "csrf_token_invalid" }));
        ensureCsrfTokenMock.mockResolvedValue("session-token");

        const response = await postPreAuthJson("/api/login", tokenField("stale-token"), (csrf_token) => ({ csrf_token }));

        expect(response.status).toBe(403);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test("does not retry a refusal that is not about the token", async () => {
        const { postPreAuthJson } = await loadModule();
        fetchMock.mockResolvedValueOnce(answer(403, { error: "account_locked" }));

        const response = await postPreAuthJson("/api/login", tokenField("page-token"), (csrf_token) => ({ csrf_token }));

        expect(response.status).toBe(403);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(ensureCsrfTokenMock).not.toHaveBeenCalled();
    });

    test("returns the refusal when no fresh token can be fetched", async () => {
        const { postPreAuthJson } = await loadModule();
        const field = tokenField("stale-token");
        fetchMock.mockResolvedValueOnce(answer(403, { error: "csrf_token_invalid" }));
        ensureCsrfTokenMock.mockResolvedValue(null);

        const response = await postPreAuthJson("/api/login", field, (csrf_token) => ({ csrf_token }));

        expect(response.status).toBe(403);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(field.value).toBe("stale-token");
    });
});
