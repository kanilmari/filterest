// login_modal_printer.test.js
// Verifies the SPA login modal fetch path and redirect restoration without using the standalone login page.
// Bridges modal rendering, auth submission, and post-login bootstrap with focused jsdom mocks.
// Exists to keep the guest-shell login entry slice from regressing back to raw `/login` fetches or stale redirects.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

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
    return `
        <div class="auth-hero">
            <h1 class="site_name">Serlog.com</h1>
            <div class="auth-intro-box" data-html-lang-key="login_page_intro_site_html+Serlog.com">
                <p>Intro text</p>
            </div>
        </div>
        <form class="auth-form">
            <label for="username">Username</label>
            <input id="username" />
            <label for="password">Password</label>
            <div class="password-wrapper">
                <input id="password" type="password" />
                <button type="button" id="toggle-password">toggle</button>
            </div>
            <label class="privacy-notice-link" id="privacy-notice-link">Privacy</label>
            <input id="csrf_token" value="csrf-token" />
            <div id="otp-section" style="display:none"></div>
            <div id="otp-message"></div>
            <a id="resend-otp" style="display:none"></a>
            <a id="forgot-password-link" href="#">Forgot password</a>
            <a id="back-to-login-link" href="#" style="display:none">Back</a>
            <div id="password-reset-section" style="display:none">
                <div id="password-reset-message"></div>
                <input id="password-reset-otp" />
                <input id="password-reset-new-password" type="password" />
                <button type="button" id="toggle-password-reset">toggle reset</button>
                <a id="resend-password-reset-otp" href="#" style="display:none"></a>
            </div>
            <div id="submit"><input type="submit" data-lang-key="login" value="Login" data-testid="login-submit" /></div>
        </form>
    `;
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
    }));
    vi.doMock("../config_fetcher.js", () => ({
        isCrossTabLoginSyncEnabled: isCrossTabLoginSyncEnabledMock,
    }));
    vi.doMock("../lang/translation_handler.js", () => ({
        getTranslationForKey: (key, { fallback } = {}) => loginCopy[uiLanguage][key] || fallback || "",
    }));
    vi.doMock("../state_stores/lang_preference_reader.js", () => ({
        getLanguageWithBrowserFallback: () => "en",
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
            expect(button.textContent).toContain("toggle");
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
});
