// translation_handler_discovery_pipeline.test.js
// Verifies that a refused or failed missing-key discovery request never becomes a user notice.
// Between the translation handler and the real endpoint router and API pipeline; only fetch is faked.
// Why: a guest's 403 on development pages showed the pipeline's "Access denied for action" toast.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    showAccessDeniedToast: vi.fn(),
    showErrorToast: vi.fn(),
    showWarningToast: vi.fn(),
    showToast: vi.fn(),
    requestLoginRedirect: vi.fn(),
}));
// The pipeline's own notices: the access-denied toast, and the translated
// failure notice that request_failure_notice.js shows through showToast.
vi.mock("../../reusable_components/notifications/toast_notification_printer.js", () => ({
    showAccessDeniedToast: mocks.showAccessDeniedToast,
    showErrorToast: mocks.showErrorToast,
    showWarningToast: mocks.showWarningToast,
    showToast: mocks.showToast,
}));
vi.mock("../auth/login_redirect_handler.js", () => ({
    requestLoginRedirect: mocks.requestLoginRedirect,
}));
vi.mock("../table_views/card_view/card_view_printer.js", () => ({
    refreshCardLanguages: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../table_views/dataset_value_localizer.js", () => ({
    refreshLocalizedDatasetValues: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./dev_lang_key_editor.js", () => ({ initDevLangKeyEditor: vi.fn() }));

// What a guest's travel_deals card view asked for on 8.10.2026: the filter
// bar's heading and search field for the creator and owner name columns.
const DISCOVERED_KEYS = [
    "created_by_name",
    "search_for_created_by_name",
    "owner_name (ln)",
    "search_for_owner_name (ln)",
];

/** A fetch answer with the members the API pipeline reads. */
function buildResponse(status, body) {
    const payload = JSON.stringify(body);
    return {
        ok: status >= 200 && status < 300,
        status,
        redirected: false,
        headers: {
            get: (name) => (name.toLowerCase() === "content-type" ? "application/json" : null),
        },
        clone: () => buildResponse(status, body),
        text: async () => payload,
        json: async () => JSON.parse(payload),
    };
}

const NativeMutationObserver = globalThis.MutationObserver;
let observers;

beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    for (const method of ["warn", "error", "info", "log", "debug"]) {
        vi.spyOn(console, method).mockImplementation(() => {});
    }
    // Each test imports a fresh handler; disconnect its observer afterwards so it
    // cannot send discovery requests for elements a later test adds.
    observers = [];
    vi.stubGlobal("MutationObserver", class extends NativeMutationObserver {
        constructor(callback) {
            super(callback);
            observers.push(this);
        }
    });
    document.head.innerHTML = '<meta name="app-env" content="dev">';
    document.body.innerHTML = "";
    sessionStorage.clear();
    window.translationPromises = { en: Promise.resolve({}), fi: Promise.resolve({}) };
});

afterEach(() => {
    observers.forEach((observer) => observer.disconnect());
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.translationPromises;
    document.head.innerHTML = "";
    document.body.innerHTML = "";
});

test.each([
    ["a function-level 403", () => buildResponse(403, { error: "403 - Forbidden (function-level)", code: 403 })],
    ["a 400", () => buildResponse(400, { error: "error decoding JSON" })],
    ["a 429", () => buildResponse(429, { error: "Too many requests" })],
    ["a 500", () => buildResponse(500, { error: "translation provider failed" })],
    ["a 503", () => buildResponse(503, { error: "Service unavailable" })],
    ["a network failure", () => Promise.reject(new TypeError("Failed to fetch"))],
])("keeps %s from discovery in diagnostics without a user notice", async (_, answerDiscovery) => {
    const { translatePage } = await import("./translation_handler.js");
    const { get_endpoint_url } = await import("../endpoints/endpoint_router.js");
    const discoveryUrl = get_endpoint_url("generateTranslations");
    const fetchMock = vi.fn(async (url) => (
        url === discoveryUrl ? answerDiscovery() : buildResponse(200, { csrf_token: "csrf-for-test" })
    ));
    vi.stubGlobal("fetch", fetchMock);
    await translatePage("fi");

    for (const key of DISCOVERED_KEYS) {
        const element = document.createElement(key.startsWith("search_for_") ? "input" : "h3");
        element.dataset.langKey = key;
        document.body.appendChild(element);
    }
    await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("[Translation diagnostics] AI Translation ERROR")
    ));

    const discoveryRequests = fetchMock.mock.calls.filter(([url]) => url === discoveryUrl);
    expect(discoveryRequests).toHaveLength(1);
    expect(JSON.parse(discoveryRequests[0][1].body)).toMatchObject({
        missing_keys: DISCOVERED_KEYS,
        chosen_language: "fi",
    });
    expect(mocks.showAccessDeniedToast).not.toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(mocks.showErrorToast).not.toHaveBeenCalled();
    expect(mocks.showWarningToast).not.toHaveBeenCalled();
    expect(mocks.requestLoginRedirect).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
        "[AI Translation] Error fetching translations:", expect.any(Error)
    );
});
