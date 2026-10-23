// login_modal_printer.test.js
// Verifies the SPA login modal fetch path and redirect restoration without using the standalone login page.
// Bridges modal rendering, auth submission, and post-login bootstrap with focused jsdom mocks.
// Exists to keep the guest-shell login entry slice from regressing back to raw `/login` fetches or stale redirects.
// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { SECOND_STEP_TRANSLATION_FALLBACKS } from './second_step_translation_fallbacks.js';
import { beforeEach, describe, expect, test, vi } from "vitest";
import { translateError } from './login_page_builder_helpers.js';

const createModalMock = vi.fn();
const showModalMock = vi.fn();
const hideModalMock = vi.fn();
const endpointRouterMock = vi.fn();
const ensureIconsMock = vi.fn().mockResolvedValue(undefined);
let currentIcons = { visibilityOffSvg: "", visibilityOnSvg: "" };
const runPostAuthBootstrapMock = vi.fn().mockResolvedValue({ dataLoaded: false });
const publishAuthLoginMock = vi.fn();
const isCrossTabLoginSyncEnabledMock = vi.fn().mockResolvedValue(true);
let uiLanguage = "en";
const loginCopy = {
    en: {
        send_code: "Send code",
        login: "Login",
        reset_password: "Reset password",
        password_reset_code_sent: "If the account exists, a verification code was sent. Enter the code and your new password.",
        password_updated_sign_in: "Password updated. Log in with the new password.",
        verify: "Verify",
        enter_otp: "Enter the verification code.",
    },
    fi: {
        send_code: "Lähetä koodi",
        login: "Kirjaudu",
        reset_password: "Vaihda salasana",
        password_reset_code_sent: "Jos käyttäjä löytyy, vahvistuskoodi on lähetetty. Syötä koodi ja uusi salasana.",
        password_updated_sign_in: "Salasana vaihdettu. Kirjaudu sisään uudella salasanalla.",
        verify: "Vahvista",
        enter_otp: "Syötä vahvistuskoodi.",
    },
};

function buildLoginFormHtml() {
    const markup = readFileSync('frontend/templates/login.html', 'utf8');
    return markup.slice(markup.indexOf('<div class="auth-login-stack">'), markup.indexOf('</form>') + 7);
}

async function loadModule() {
    vi.resetModules();
    vi.doMock("../../reusable_components/modal/modal_builder.js", () => ({
        createModal: createModalMock,
        showModal: showModalMock,
        hideModal: hideModalMock,
    }));
    vi.doMock("../endpoints/endpoint_router.js", () => ({
        endpoint_router: endpointRouterMock,
    }));
    vi.doMock("./password_visibility_icon_reader.js", () => ({
        ensurePasswordVisibilityIconsLoaded: ensureIconsMock,
        getPasswordVisibilityIcons: () => currentIcons,
    }));
    vi.doMock("./post_auth_bootstrap.js", () => ({
        runPostAuthBootstrap: runPostAuthBootstrapMock,
    }));
    vi.doMock("./auth_broadcast.js", () => ({
        publishAuthLogin: publishAuthLoginMock,
        publishAuthInvalidation: vi.fn(),
        subscribeToAuthBroadcast: vi.fn(() => () => {}),
    }));
    vi.doMock("../config_fetcher.js", () => ({
        isCrossTabLoginSyncEnabled: isCrossTabLoginSyncEnabledMock,
    }));
    vi.doMock("../lang/translation_handler.js", () => ({
        getTranslationForKey: (key, { fallback } = {}) => loginCopy[uiLanguage][key] || SECOND_STEP_TRANSLATION_FALLBACKS[key]?.[uiLanguage] || fallback || "",
    }));
    vi.doMock("../state_stores/lang_preference_reader.js", () => ({
        getLanguageWithBrowserFallback: () => uiLanguage,
    }));
    vi.doMock("../../reusable_components/dom_container_builder.js", () => ({
        renderAllowedHtml: () => document.createElement("div"),
    }));
    return import("./login_modal_printer.js");
}

describe("showLoginModal", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ensureIconsMock.mockReset().mockResolvedValue(undefined);
        currentIcons = { visibilityOffSvg: "", visibilityOnSvg: "" };
        history.replaceState({}, "", "/");
        document.body.innerHTML = `<div id="modal-root"></div>`;
        endpointRouterMock.mockResolvedValue({
            ok: true,
            text: async () => buildLoginFormHtml(),
        });
        runPostAuthBootstrapMock.mockResolvedValue({ dataLoaded: false });
        publishAuthLoginMock.mockReset();
        isCrossTabLoginSyncEnabledMock.mockReset().mockResolvedValue(true);
        uiLanguage = "en";
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ authenticated: true }),
            clone: () => ({ json: async () => ({ authenticated: true }) }),
        }));
    });

    test.each(["pending", "failed"])("opens a usable modal with %s visibility icons", async (state) => {
        ensureIconsMock.mockImplementation(() => state === "pending"
            ? new Promise(() => {})
            : Promise.reject(new Error("asset connection aborted")));
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
        const mod = await loadModule();
        await mod.showLoginModal();
        expect(showModalMock).toHaveBeenCalledOnce();
        const shell = createModalMock.mock.calls.at(-1)[0].contentElements[0];
        document.body.append(shell);
        const form = shell.querySelector("form");
        for (const [buttonId, inputId] of [
            ["toggle-password", "password"],
            ["toggle-password-reset", "password-reset-new-password"],
        ]) {
            const button = form.querySelector("#" + buttonId);
            button.focus();
            button.click();
            expect(form.querySelector("#" + inputId).type).toBe("text");
            expect(button.getAttribute("aria-label")).toBe("Hide password");
            expect(button.getAttribute("aria-pressed")).toBe("true");
            expect(document.activeElement).toBe(button);
            expect(button.querySelector("svg")).not.toBeNull();
        }
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: false, json: async () => ({ error: "wrong_credentials" }),
        }));
        const event = new Event("submit", { bubbles: true, cancelable: true });
        form.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/login", expect.objectContaining({
            method: "POST", credentials: "include",
        })));
        warning.mockRestore();
    });

    test("late icons follow the current modal reveal state without moving focus", async () => {
        let finish;
        ensureIconsMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        const mod = await loadModule();
        await mod.showLoginModal();
        const shell = createModalMock.mock.calls.at(-1)[0].contentElements[0];
        document.body.append(shell);
        const button = shell.querySelector("#toggle-password");
        button.focus();
        button.click();
        currentIcons = {
            visibilityOffSvg: '<svg data-state="off" fill="currentColor"></svg>',
            visibilityOnSvg: '<svg data-state="on" fill="currentColor"></svg>',
        };
        finish();
        await vi.waitFor(() => expect(button.querySelector('[data-state="on"]')).not.toBeNull());
        expect(shell.querySelector("#password").type).toBe("text");
        expect(document.activeElement).toBe(button);
        button.click();
        expect(button.querySelector('[data-state="off"]')).not.toBeNull();
    });

    test("fetches the login form through the fragment path", async () => {
        const mod = await loadModule();

        await mod.showLoginModal("/reports?view=compact");

        expect(endpointRouterMock).toHaveBeenCalledWith("login", {
            returnResponse: true,
            url_params: "?fragment=1",
        });
        expect(createModalMock).toHaveBeenCalledTimes(1);
        expect(showModalMock).toHaveBeenCalledTimes(1);
        const modalShell = createModalMock.mock.calls.at(-1)[0].contentElements[0];
        expect(modalShell.querySelector(".auth-hero")).not.toBeNull();
        expect(modalShell.querySelector("form.auth-form")).not.toBeNull();
    });

    test("reuses the cached form while honoring the newest redirect target", async () => {
        const replaceStateSpy = vi.spyOn(window.history, "replaceState");
        const mod = await loadModule();

        await mod.showLoginModal("/first-target");
        await mod.showLoginModal("/second-target?tab=1");

        const latestForm = createModalMock.mock.calls.at(-1)[0].contentElements[0].querySelector("form.auth-form");
        latestForm.querySelector("#username").value = "admin";
        latestForm.querySelector("#password").value = "secret";
        latestForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

        await vi.waitFor(() => {
            expect(runPostAuthBootstrapMock).toHaveBeenCalledTimes(1);
        });

        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
        expect(replaceStateSpy).toHaveBeenCalledWith({}, "", "/second-target?tab=1");
        expect(publishAuthLoginMock).toHaveBeenCalledWith({ reason: "login" });
        expect(hideModalMock).toHaveBeenCalledTimes(1);
    });

    test("cleans the login-entry query after a successful root login", async () => {
        history.replaceState({}, "", "/?login-entry=1");
        const replaceStateSpy = vi.spyOn(window.history, "replaceState");
        const mod = await loadModule();

        await mod.showLoginModal();

        const form = createModalMock.mock.calls.at(-1)[0].contentElements[0].querySelector("form.auth-form");
        form.querySelector("#username").value = "admin";
        form.querySelector("#password").value = "secret";
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

        await vi.waitFor(() => {
            expect(runPostAuthBootstrapMock).toHaveBeenCalledTimes(1);
        });

        expect(replaceStateSpy).toHaveBeenCalledWith({}, "", "/");
        expect(window.location.search).toBe("");
    });

    test("marks login errors as an assertive alert for assistive tech", async () => {
        const mod = await loadModule();
        const failedFetch = vi.fn().mockResolvedValue({
            ok: false,
            json: async () => ({ error: "wrong_credentials" }),
        });
        vi.stubGlobal("fetch", failedFetch);

        await mod.showLoginModal();

        const form = createModalMock.mock.calls.at(-1)[0].contentElements[0].querySelector("form.auth-form");
        form.querySelector("#username").value = "admin";
        form.querySelector("#password").value = "wrong";
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

        await vi.waitFor(() => {
            const errorElement = form.querySelector(".error");
            expect(errorElement).not.toBeNull();
            expect(errorElement.getAttribute("role")).toBe("alert");
            expect(errorElement.getAttribute("aria-live")).toBe("assertive");
        });
    });

    test("English forgot-password send control is not Finnish", async () => {
        const mod = await loadModule();
        await mod.showLoginModal();

        const form = createModalMock.mock.calls.at(-1)[0].contentElements[0].querySelector("form.auth-form");
        form.querySelector("#forgot-password-link").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

        const submitBtn = form.querySelector('[data-testid="login-submit"]');
        expect(submitBtn.dataset.langKey).toBe("send_code");
        expect(submitBtn.value).toBe("Send code");
        expect(submitBtn.value).not.toBe("Lähetä koodi");
    });

    test("Finnish forgot-password send control stays Finnish", async () => {
        uiLanguage = "fi";
        const mod = await loadModule();
        await mod.showLoginModal();

        const form = createModalMock.mock.calls.at(-1)[0].contentElements[0].querySelector("form.auth-form");
        form.querySelector("#forgot-password-link").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

        const submitBtn = form.querySelector('[data-testid="login-submit"]');
        expect(submitBtn.dataset.langKey).toBe("send_code");
        expect(submitBtn.value).toBe("Lähetä koodi");
    });

    test("forgot-password request switches the modal into reset verification mode", async () => {
        const mod = await loadModule();
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ password_reset_requested: true }),
        });
        vi.stubGlobal("fetch", fetchMock);

        await mod.showLoginModal();

        const form = createModalMock.mock.calls.at(-1)[0].contentElements[0].querySelector("form.auth-form");
        form.querySelector("#username").value = "admin@example.com";
        form.querySelector("#forgot-password-link").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

        await vi.waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith("/api/request-password-reset-otp", expect.objectContaining({
                method: "POST",
                credentials: "include",
            }));
            expect(form.querySelector("#password-reset-section").style.display).toBe("block");
        });
    });

    test("skips login broadcast when cross-tab login sync is disabled", async () => {
        isCrossTabLoginSyncEnabledMock.mockResolvedValue(false);
        const mod = await loadModule();

        await mod.showLoginModal("/reports");

        const form = createModalMock.mock.calls.at(-1)[0].contentElements[0].querySelector("form.auth-form");
        form.querySelector("#username").value = "admin";
        form.querySelector("#password").value = "secret";
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

        await vi.waitFor(() => {
            expect(runPostAuthBootstrapMock).toHaveBeenCalledTimes(1);
        });

        expect(publishAuthLoginMock).not.toHaveBeenCalled();
    });
    test("modal email resend sends another credentials request and shows failure", async () => {
        const mod = await loadModule();
        const responses = [
            { ok: true, json: async () => ({ otp_required: true, verification_method: 'email', masked_email: 'a•••@example.com' }) },
            { ok: false, json: async () => ({ error: 'too_many_otp_requests' }) },
        ];
        const fetchMock = vi.fn().mockImplementation(async () => {
            const response = responses.shift();
            return { ...response, clone: () => response };
        });
        vi.stubGlobal('fetch', fetchMock);
        await mod.showLoginModal();
        const shell = createModalMock.mock.calls.at(-1)[0].contentElements[0];
        document.body.append(shell);
        const form = shell.querySelector('form');
        form.querySelector('#username').value = 'fixture';
        form.querySelector('#password').value = 'fixture value';
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(form.classList.contains('is-verifying')).toBe(true));
        form.querySelector('#resend-otp').click();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ username: 'fixture', password: 'fixture value' });
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('otp_code');
        await vi.waitFor(() => expect(form.querySelector('[data-verify="status"]').textContent).toBe('The code could not be sent. Try again.'));
        expect(form.querySelector('.error')?.textContent || '').toBe('');
    });

    test('recovery keeps the exact password and reports completion as a status', async () => {
        const mod = await loadModule();
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
        vi.stubGlobal('fetch', fetchMock);
        await mod.showLoginModal();
        const shell = createModalMock.mock.calls.at(-1)[0].contentElements[0];
        document.body.append(shell);
        const form = shell.querySelector('form');
        form.querySelector('#username').value = 'fixture';
        form.querySelector('#forgot-password-link').click();
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(form.classList.contains('is-verifying')).toBe(true));
        form.querySelector('#password-reset-otp').value = 'abc 234 def';
        form.querySelector('#password-reset-new-password').value = '  exact replacement  ';
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(form.querySelector('[data-login-status]')?.textContent).toBe(loginCopy.en.password_updated_sign_in));
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ otp_code: 'abc234def', new_password: '  exact replacement  ' });
        expect(form.querySelector('[data-login-status]').getAttribute('role')).toBe('status');
        expect(form.querySelector('[data-login-status]').classList.contains('error')).toBe(false);
        expect(form.classList.contains('is-verifying')).toBe(false);
    });

    test('both password reveal controls retain Finnish accessible names', async () => {
        uiLanguage = 'fi';
        const mod = await loadModule();
        await mod.showLoginModal();
        const shell = createModalMock.mock.calls.at(-1)[0].contentElements[0];
        document.body.append(shell);
        const form = shell.querySelector('form');
        for (const id of ['toggle-password', 'toggle-password-reset']) {
            const button = form.querySelector('#' + id);
            expect(button.getAttribute('aria-label')).toBe('Näytä salasana');
            button.click();
            expect(button.getAttribute('aria-label')).toBe('Piilota salasana');
            expect(button.dataset.ariaLabelLangKey).toBe('hide_password');
        }
    });

    test.each([['en', 'otp'], ['fi', 'otp'], ['en', 'recovery'], ['fi', 'recovery']])(
        '%s %s verification preserves all pre-auth policy messages and unknown errors', async (language, phase) => {
            uiLanguage = language;
            const mod = await loadModule();
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true, json: async () => ({ otp_required: true, verification_method: 'email' }),
                clone: () => ({ json: async () => ({ otp_required: true }) }),
            });
            vi.stubGlobal('fetch', fetchMock);
            await mod.showLoginModal();
            const shell = createModalMock.mock.calls.at(-1)[0].contentElements[0];
            document.body.append(shell);
            const form = shell.querySelector('form');
            form.querySelector('#username').value = 'fixture';
            form.querySelector('#password').value = 'fixture value';
            if (phase === 'recovery') form.querySelector('#forgot-password-link').click();
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await vi.waitFor(() => expect(form.classList.contains('is-verifying')).toBe(true));
            const root = form.querySelector(phase === 'otp' ? '#otp-section' : '#password-reset-section');
            root.querySelector('[data-verify="input"]').value = 'abc234def';
            form.querySelector('#password-reset-new-password').value = 'replacement value';
            let finishVerification;
            fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishVerification = resolve; }));
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
            const resend = root.querySelector('[data-verify="resend"]');
            resend.click();
            for (const key of ['Enter', ' ']) {
                const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
                resend.dispatchEvent(event);
                expect(event.defaultPrevented).toBe(true);
                resend.click();
            }
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(form.querySelector('input[type="submit"]').disabled).toBe(true);
            expect(resend.getAttribute('aria-disabled')).toBe('true');
            expect(resend.getAttribute('tabindex')).toBe('-1');
            finishVerification({ ok: false, json: async () => ({ error: 'wrong_otp' }) });
            await vi.waitFor(() => expect(form.querySelector('input[type="submit"]').disabled).toBe(false));
            for (const code of ['login_not_allowed', 'authentication_policy_unavailable', 'fingerprint_required', 'legacy_form_login_disabled', 'unknown_failure']) {
                for (const error of [code, `HTTP 403: ${code}`]) {
                    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error }) });
                    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                    await vi.waitFor(() => expect(root.querySelector('[data-verify="error"]').textContent).toBe(translateError(error, language)));
                    expect(form.querySelector('input[type="submit"]').disabled).toBe(false);
                }
            }
        },
    );

});
