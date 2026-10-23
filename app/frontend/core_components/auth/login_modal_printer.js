// login_modal_printer.js
// Renders and manages the login modal, handling form fetch, user input, and credential submission.
// Bridges the unauthenticated page state and the session-authenticated state via the login modal UI.
// Exists to provide a pre-session authentication entry point without duplicating login flow logic elsewhere.
// Login, OTP, and password-reset requests run before a full session/pipeline exists;
// they are sent by pre_auth_request_sender.js, which also recovers a stale CSRF token.
import { createModal, showModal, hideModal } from "../../reusable_components/modal/modal_builder.js";
import { gather_browser_fingerprint_hash } from "../../reusable_components/browser_identity_builder.js";
import { mountLoginSecondStep, leaveLoginSecondStep, bindLoginCodeResend, setSecondStepReveal, showLoginStatus } from './second_step_view.js';
import { postPreAuthJson } from "./pre_auth_request_sender.js";
import { getTranslationForKey } from "../lang/translation_handler.js";
import { endpoint_router } from "../endpoints/endpoint_router.js";
import { getLanguageWithBrowserFallback } from "../state_stores/lang_preference_reader.js";
import { renderAllowedHtml } from "../../reusable_components/dom_container_builder.js";
import {
    ensurePasswordVisibilityIconsLoaded,
    getPasswordVisibilityIcons,
} from "./password_visibility_icon_reader.js";
import {
    pickLang,
    resolvePostLoginTarget,
    translateError,
    sanitizeOtpCode,
    buildCredentialsBody,
    buildOtpBody,
    buildPasswordResetRequestBody,
    buildPasswordResetBody,
    applyLoginLangKey,
} from "./login_page_builder_helpers.js";
import { runPostAuthBootstrap } from "./post_auth_bootstrap.js";
import { publishAuthLogin } from "./auth_broadcast.js";
import { isCrossTabLoginSyncEnabled } from "../config_fetcher.js";

// Cached login shell — preserved across modal open/close so typed values persist.
let cachedLoginShell = null;
let pendingRedirectTarget = "";

function resolvePendingRedirectTarget() {
    const safePath = resolvePostLoginTarget(
        pendingRedirectTarget ? `?redirect=${encodeURIComponent(pendingRedirectTarget)}` : "",
        "",
        window.location.origin
    );
    return safePath === "/login" ? "/" : safePath;
}

function clearLoginEntryQueryFromUrl() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("login-entry") !== "1") {
        return false;
    }

    params.delete("login-entry");
    params.delete("redirect");
    const cleanSearch = params.toString();
    const cleanUrl = window.location.pathname + (cleanSearch ? `?${cleanSearch}` : "") + window.location.hash;
    window.history.replaceState({}, "", cleanUrl);
    return true;
}

async function completeSuccessfulModalLogin() {
    try {
        const safePath = resolvePendingRedirectTarget();
        const shouldSyncLogin = await isCrossTabLoginSyncEnabled();
        if (safePath && safePath !== "/") {
            window.history.replaceState({}, "", safePath);
        } else {
            clearLoginEntryQueryFromUrl();
        }
        if (shouldSyncLogin) {
            publishAuthLogin({ reason: "login" });
        }
        await runPostAuthBootstrap();
        cachedLoginShell = null;
        pendingRedirectTarget = "";
        hideModal();
    } catch (err) {
        console.warn("Post-auth SPA bootstrap failed, reloading as fallback:", err);
        cachedLoginShell = null;
        pendingRedirectTarget = "";
        hideModal();
        window.location.reload();
    }
}

export async function showLoginModal(redirectTarget) {
    try {
        pendingRedirectTarget = redirectTarget || "";

        // Reuse existing shell if available (preserves typed username/password/OTP and phase state)
        if (cachedLoginShell) {
            createModal({
                titleDataLangKey: "login",
                contentElements: [cachedLoginShell],
                width: 'min(480px, 97vw)',
                skipModalTitle: true
            });
            showModal();
            return;
        }

        // First open: fetch the login page to get CSRF token and form structure
        const response = await endpoint_router('login', { returnResponse: true, url_params: '?fragment=1' });
        if (!response.ok) {
            console.warn("Failed to fetch login page:", response.statusText);
            return;
        }
        const htmlText = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, "text/html");
        const hero = doc.querySelector(".auth-hero");
        const form = doc.querySelector("form.auth-form");

        if (!form) {
            console.warn("Login form not found in /login response");
            return;
        }

        const shell = document.createElement("div");
        shell.classList.add("auth-modal-shell");
        if (hero) {
            shell.appendChild(hero);
        }
        shell.appendChild(form);

        // Attach event listeners and cache the form
        setupFormInteractions(form);
        cachedLoginShell = shell;

        createModal({
            titleDataLangKey: "login",
            contentElements: [shell],
            width: 'min(480px, 97vw)',
            skipModalTitle: true
        });

        showModal();

    } catch (err) {
        console.warn("Error showing login modal:", err);
    }
}

function setupFormInteractions(form) {
    // Password toggle
    const togglePasswordBtn = form.querySelector("#toggle-password");
    const passwordInput = form.querySelector("#password");
    
    if (togglePasswordBtn && passwordInput) {
        setSecondStepReveal(togglePasswordBtn, passwordInput);
        togglePasswordBtn.addEventListener("click", () => {
            const isHidden = passwordInput.type === "password";
            passwordInput.type = isHidden ? "text" : "password";
            togglePasswordBtn.setAttribute("aria-pressed", String(isHidden));
            const { visibilityOffSvg, visibilityOnSvg } = getPasswordVisibilityIcons();

            if (visibilityOffSvg && visibilityOnSvg) {
                togglePasswordBtn.innerHTML = isHidden
                    ? visibilityOnSvg
                    : visibilityOffSvg;
            }
            setSecondStepReveal(togglePasswordBtn, passwordInput);
        });
    }

    const toggleResetPasswordBtn = form.querySelector("#toggle-password-reset");
    const resetPasswordInput = form.querySelector("#password-reset-new-password");
    if (toggleResetPasswordBtn && resetPasswordInput) {
        setSecondStepReveal(toggleResetPasswordBtn, resetPasswordInput);
        toggleResetPasswordBtn.addEventListener("click", () => {
            const isHidden = resetPasswordInput.type === "password";
            resetPasswordInput.type = isHidden ? "text" : "password";
            toggleResetPasswordBtn.setAttribute("aria-pressed", String(isHidden));
            const { visibilityOffSvg, visibilityOnSvg } = getPasswordVisibilityIcons();

            if (visibilityOffSvg && visibilityOnSvg) {
                toggleResetPasswordBtn.innerHTML = isHidden
                    ? visibilityOnSvg
                    : visibilityOffSvg;
            }
            setSecondStepReveal(toggleResetPasswordBtn, resetPasswordInput);
        });
    }

    // The template already has a themed SVG fallback. Optional assets must never
    // delay form listeners, and a late response must respect the current reveal state.
    void ensurePasswordVisibilityIconsLoaded().then(() => {
        const { visibilityOffSvg, visibilityOnSvg } = getPasswordVisibilityIcons();
        for (const [button, input] of [[togglePasswordBtn, passwordInput], [toggleResetPasswordBtn, resetPasswordInput]]) {
            if (!button || !input) continue;
            const icon = input.type === "password" ? visibilityOffSvg : visibilityOnSvg;
            if (icon) button.innerHTML = icon;
        }
    }).catch(() => console.warn("[login] Password icons unavailable; using the form fallback."));

    // Privacy notice link
    const privacyNoticeLink = form.querySelector("#privacy-notice-link");
    if (privacyNoticeLink) {
        privacyNoticeLink.addEventListener("click", (e) => {
            e.preventDefault();
            // We can't easily open another modal on top of this one with the current modal factory 
            // if it uses a singleton ID.
            // But let's try. If modal factory replaces content, we lose the login form.
            // Ideally we should show the privacy notice in a separate way or replace content and have a "back" button.
            // For now, let's just alert or open in new tab? 
            // Or maybe we can fetch the privacy content and replace the form with it, with a "Back to login" button.
            
            showPrivacyContentInModal();
        });
    }

    // 2-step AJAX login: Phase 1 (credentials) → Phase 2 (OTP verification)
    let loginPhase = 'credentials'; // 'credentials' | 'otp' | 'reset_request' | 'reset_verify'
    let cachedFingerprint = '';
    let resetIdentifier = '';
    let secondStep = null;

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const submitBtn = form.querySelector('input[type="submit"]');
        if (!submitBtn) return;
        submitBtn.disabled = true;

        secondStep?.busy(true);
        try {
            if (loginPhase === 'credentials') {
                await handleCredentialsPhase(form, submitBtn);
            } else if (loginPhase === 'otp') {
                await handleOTPPhase(form, submitBtn);
            } else if (loginPhase === 'reset_request') {
                await handlePasswordResetRequestPhase(form, submitBtn);
            } else {
                await handlePasswordResetVerifyPhase(form, submitBtn);
            }
        } catch (err) {
            console.warn("Login submission error:", err);
            if (secondStep) secondStep.error();
            else showFormError(form, err.message || "Login failed.");
            submitBtn.disabled = false;
        } finally {
            secondStep?.busy(false);
        }
    });

    async function handleCredentialsPhase(form, submitBtn, resending = false) {
        try {
            cachedFingerprint = await gather_browser_fingerprint_hash();
        } catch (_err) {
            cachedFingerprint = '';
        }

        const username = form.querySelector("#username")?.value || '';
        const password = form.querySelector("#password")?.value || '';

        const resp = await postPreAuthJson(
            "/api/login",
            form.querySelector("#csrf_token"),
            (csrfToken) => buildCredentialsBody(username, password, cachedFingerprint, csrfToken),
        );

        const data = await resp.json();

        if (!resp.ok) {
            if (!resending) showFormError(form, translateError(data.error));
            submitBtn.disabled = false;
            return false;
        }

        if (data.otp_required) {
            loginPhase = 'otp';
            clearFormError(form);
            secondStep = mountLoginSecondStep(form, data.verification_method, data);
            submitBtn.disabled = false;
            return true;
        }

        if (data.authenticated) {
            await completeSuccessfulModalLogin();
        }
    }

    async function handleOTPPhase(form, submitBtn) {
        const otpCode = sanitizeOtpCode(form.querySelector("#otp")?.value);

        if (!secondStep.validate()) {
            if (submitBtn) submitBtn.disabled = false;
            return;
        }
        const resp = await postPreAuthJson(
            "/api/login",
            form.querySelector("#csrf_token"),
            (csrfToken) => buildOtpBody(otpCode, csrfToken),
        );

        const data = await resp.json();

        if (!resp.ok) {
            secondStep.error(data);
            if (submitBtn) submitBtn.disabled = false;
            return;
        }

        if (data.authenticated) {
            await completeSuccessfulModalLogin();
        }
    }

    async function handlePasswordResetRequestPhase(form, submitBtn) {
        const identifier = form.querySelector("#username")?.value?.trim() || '';

        if (!identifier) {
            showFormError(form, translateError("identifier_required"));
            submitBtn.disabled = false;
            return;
        }

        const resp = await postPreAuthJson(
            "/api/request-password-reset-otp",
            form.querySelector("#csrf_token"),
            (csrfToken) => buildPasswordResetRequestBody(identifier, csrfToken),
        );
        const data = await resp.json();

        if (!resp.ok) {
            showFormError(form, translateError(data.error));
            submitBtn.disabled = false;
            return;
        }

        resetIdentifier = identifier;
        loginPhase = 'reset_verify';
        showPasswordResetVerifyPhase();
        submitBtn.disabled = false;
    }

    async function handlePasswordResetVerifyPhase(form, submitBtn) {
        const otpCode = sanitizeOtpCode(form.querySelector("#password-reset-otp")?.value);
        const newPassword = form.querySelector("#password-reset-new-password")?.value || '';

        if (!secondStep.validate()) {
            if (submitBtn) submitBtn.disabled = false;
            return;
        }
        if (!newPassword.trim()) {
            secondStep.passwordError();
            submitBtn.disabled = false;
            return;
        }

        const resp = await postPreAuthJson(
            "/api/reset-password",
            form.querySelector("#csrf_token"),
            (csrfToken) => buildPasswordResetBody(otpCode, newPassword, csrfToken),
        );
        const data = await resp.json();

        if (!resp.ok) {
            secondStep.error(data);
            if (submitBtn) submitBtn.disabled = false;
            return;
        }

        restoreLoginCredentialsPhase();
        showLoginStatus(form, 'password_updated_sign_in');
        form.querySelector("#password")?.focus();
        submitBtn.disabled = false;
    }

    function setPasswordResetMode(enabled) {
        const passwordInput = form.querySelector("#password");
        const privacyCheckbox = form.querySelector("#privacy-accept");
        if (passwordInput) passwordInput.required = !enabled;
        if (privacyCheckbox) privacyCheckbox.required = !enabled;
    }

    function showPasswordResetRequestPhase() {
        leaveLoginSecondStep(form);
        secondStep = null;
        loginPhase = 'reset_request';
        setPasswordResetMode(true);

        const passwordLabel = form.querySelector('label[for="password"]');
        const passwordWrapper = form.querySelector(".password-wrapper");
        const otpSection = form.querySelector("#otp-section");
        const resetSection = form.querySelector("#password-reset-section");
        const forgotLink = form.querySelector("#forgot-password-link");
        const backLink = form.querySelector("#back-to-login-link");
        const privacyNotice = form.querySelector(".privacy-notice-link");
        const submitBtn = form.querySelector('input[type="submit"]');

        if (passwordLabel) passwordLabel.style.display = 'none';
        if (passwordWrapper) passwordWrapper.style.display = 'none';
        if (otpSection) otpSection.style.display = 'none';
        if (resetSection) resetSection.style.display = 'none';
        if (forgotLink) forgotLink.style.display = 'none';
        if (backLink) backLink.style.display = 'inline';
        if (privacyNotice) privacyNotice.style.display = 'none';
        applyLoginLangKey(
            submitBtn,
            'send_code',
            getTranslationForKey('send_code', { fallback: 'Send code' }) || 'Send code'
        );
        clearFormError(form);
    }

    function showPasswordResetVerifyPhase() {
        setPasswordResetMode(true);
        clearFormError(form);
        secondStep = mountLoginSecondStep(form, 'recovery');
    }

    function restoreLoginCredentialsPhase() {
        leaveLoginSecondStep(form);
        secondStep = null;
        loginPhase = 'credentials';
        setPasswordResetMode(false);
        resetIdentifier = '';

        const usernameLabel = form.querySelector('label[for="username"]');
        const usernameInput = form.querySelector("#username");
        const passwordLabel = form.querySelector('label[for="password"]');
        const passwordWrapper = form.querySelector(".password-wrapper");
        const privacyNotice = form.querySelector(".privacy-notice-link");
        const otpSection = form.querySelector("#otp-section");
        const resetSection = form.querySelector("#password-reset-section");
        const resendLink = form.querySelector("#resend-otp");
        const resendResetLink = form.querySelector("#resend-password-reset-otp");
        const forgotLink = form.querySelector("#forgot-password-link");
        const backLink = form.querySelector("#back-to-login-link");
        const submitBtn = form.querySelector('input[type="submit"]');

        [usernameLabel, usernameInput, passwordLabel, passwordWrapper, privacyNotice].forEach(el => {
            if (el) el.style.display = '';
        });
        if (otpSection) otpSection.style.display = 'none';
        if (resetSection) resetSection.style.display = 'none';
        if (resendLink) resendLink.style.display = 'none';
        if (resendResetLink) resendResetLink.style.display = 'none';
        if (forgotLink) forgotLink.style.display = 'inline';
        if (backLink) backLink.style.display = 'none';
        applyLoginLangKey(
            submitBtn,
            'login',
            getTranslationForKey('login', { fallback: 'Login' }) || 'Login'
        );
        const otpInput = form.querySelector("#otp");
        const resetOtpInput = form.querySelector("#password-reset-otp");
        const resetPasswordInput = form.querySelector("#password-reset-new-password");
        if (otpInput) otpInput.value = '';
        if (resetOtpInput) resetOtpInput.value = '';
        if (resetPasswordInput) resetPasswordInput.value = '';
    }

    function showFormError(form, msg) {
        let errEl = form.querySelector(".error");
        if (!errEl) {
            errEl = document.createElement("div");
            errEl.className = "error";
            errEl.setAttribute("role", "alert");
            errEl.setAttribute("aria-live", "assertive");
            errEl.setAttribute("aria-atomic", "true");
            const h2 = form.querySelector("h2");
            if (h2) { h2.after(errEl); } else { form.prepend(errEl); }
        }
        errEl.textContent = msg;
    }

    function clearFormError(form) {
        const errEl = form.querySelector(".error");
        if (errEl) errEl.textContent = '';
    }

    bindLoginCodeResend(form, () => secondStep, async () => {
        loginPhase = 'credentials';
        try {
            return await handleCredentialsPhase(form, form.querySelector('input[type="submit"]'), true);
        } finally {
            if (loginPhase === 'credentials') loginPhase = 'otp';
        }
    });

    const forgotPasswordLink = form.querySelector("#forgot-password-link");
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener("click", (e) => {
            e.preventDefault();
            showPasswordResetRequestPhase();
        });
    }

    const backToLoginLink = form.querySelector("#back-to-login-link");
    if (backToLoginLink) {
        backToLoginLink.addEventListener("click", (e) => {
            e.preventDefault();
            restoreLoginCredentialsPhase();
        });
    }

    const resendPasswordResetLink = form.querySelector("#resend-password-reset-otp");
    resendPasswordResetLink?.addEventListener('click', event => {
        event.preventDefault();
        void secondStep?.resend(async () => {
            const resp = await postPreAuthJson('/api/request-password-reset-otp',
                form.querySelector("#csrf_token"),
                csrf => buildPasswordResetRequestBody(resetIdentifier, csrf));
            return resp.ok;
        });
    });
}

async function showPrivacyContentInModal() {
    // Haetaan tietosuojaseloste system_about-taulusta (id=4).
    // Sisältö on monikielisessä JSON-rakenteessa.
    const modalContent = document.createElement("div");
    modalContent.innerHTML = "";

    let titleText = getTranslationForKey("privacy_notice_title") || "Privacy notice";
    try {
        const data = await endpoint_router('fetchAboutContent', { url_params: '?id=4' });
        if (data) {
            const lang = getLanguageWithBrowserFallback();
            titleText = pickLang(data.title, lang) || titleText;
            const descriptionHtml = pickLang(data.description, lang) || "";
            modalContent.innerHTML = '';
            modalContent.appendChild(renderAllowedHtml(descriptionHtml));
        }
    } catch (err) {
        console.warn("[showPrivacyContentInModal] fetch error:", err);
    }

    const backBtn = document.createElement("button");
    backBtn.textContent = getTranslationForKey("back") || "Back";
    backBtn.className = "button";
    backBtn.style.marginTop = "20px";
    backBtn.addEventListener("click", () => {
        showLoginModal();
    });

    createModal({
        titlePlainText: titleText,
        contentElements: [modalContent, backBtn],
        width: '800px',
        maxHeight: '80vh'
    });

    showModal();
}
