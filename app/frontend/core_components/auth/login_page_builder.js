// login_page_builder.js
// Builds and controls the login page UI lifecycle.
// Bridges localization, fingerprint capture, and pre-auth login/OTP requests.
// Exists to provide a reliable pre-session authentication flow for the web app.
// Login, OTP, and password-reset requests are pre-auth and cannot flow through
// runApiPipeline; they are sent by pre_auth_request_sender.js, which also
// recovers a stale CSRF token.
import { gather_browser_fingerprint_hash } from "../../reusable_components/browser_identity_builder.js";
import { mountLoginSecondStep, leaveLoginSecondStep, bindLoginCodeResend, setSecondStepReveal, showLoginStatus } from './second_step_view.js';
import { postPreAuthJson } from "./pre_auth_request_sender.js";
import { createModal, showModal } from "../../reusable_components/modal/modal_builder.js";
import { endpoint_router } from "../endpoints/endpoint_router.js";
import {
    getLanguageWithBrowserFallback,
} from "../state_stores/lang_preference_reader.js";
import { renderAllowedHtml } from "../../reusable_components/dom_container_builder.js";
import {
    ensurePasswordVisibilityIconsLoaded,
    getPasswordVisibilityIcons,
} from "./password_visibility_icon_reader.js";
import { getTranslationForKey, translatePage } from "../lang/translation_handler.js";
import {
    translateError,
    pickLang,
    sanitizeOtpCode,
    buildCredentialsBody,
    buildOtpBody,
    buildPasswordResetRequestBody,
    buildPasswordResetBody,
    resolvePostLoginTarget,
    computeStandaloneLoginBackTarget,
    applyLoginLangKey,
} from "./login_page_builder_helpers.js";
import { publishAuthLogin } from "./auth_broadcast.js";
import { isCrossTabLoginSyncEnabled } from "../config_fetcher.js";
import { initializeStandaloneLoginShell } from "./login_page_shell_builder.js";
import { initializeAuthSessionNotice } from './auth_session_notice_handler.js';
import { authPreferenceControlsReady } from "./auth_preference_controls.js";

if (document.documentElement.dataset.shellBootProbe === '--filterest-auth-css-applied') {
    window.__filterestShellBoot?.evaluated();
}

// 2-step AJAX login: Phase 1 (credentials) → Phase 2 (OTP verification)
document.addEventListener("DOMContentLoaded", () => {
    initializeStandaloneLoginShell();
    initializeAuthSessionNotice();
    initializeTourGalleryModals();

    const loginForm = document.querySelector("form");
    let loginPhase = 'credentials'; // 'credentials' | 'otp' | 'reset_request' | 'reset_verify'
    let cachedFingerprint = '';
    let resetIdentifier = '';
    let secondStep = null;

    if (loginForm) {
        loginForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            const submitBtn = loginForm.querySelector('input[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;

            secondStep?.busy(true);
            try {
                if (loginPhase === 'credentials') {
                    await handleCredentialsPhase(loginForm, submitBtn);
                } else if (loginPhase === 'otp') {
                    await handleOTPPhase(loginForm, submitBtn);
                } else if (loginPhase === 'reset_request') {
                    await handlePasswordResetRequestPhase(loginForm, submitBtn);
                } else {
                    await handlePasswordResetVerifyPhase(loginForm, submitBtn);
                }
            } catch (err) {
                console.error("[login] error:", err);
                if (secondStep) secondStep.error();
                else showLoginError(err.message || "Virhe kirjautumisessa.");
                if (submitBtn) submitBtn.disabled = false;
            } finally {
                secondStep?.busy(false);
            }
        });
    }

    async function handleCredentialsPhase(form, submitBtn, resending = false) {
        // Calculate fingerprint
        try {
            cachedFingerprint = await gather_browser_fingerprint_hash();
        } catch (err) {
            console.warn("[login] fingerprint failed:", err);
            cachedFingerprint = '';
        }

        const username = document.getElementById("username")?.value || '';
        const password = document.getElementById("password")?.value || '';

        const resp = await postPreAuthJson(
            "/api/login",
            document.getElementById("csrf_token"),
            (csrfToken) => buildCredentialsBody(username, password, cachedFingerprint, csrfToken),
        );

        const data = await resp.json();

        if (!resp.ok) {
            if (!resending) showLoginError(translateError(data.error));
            if (submitBtn) submitBtn.disabled = false;
            return false;
        }

        if (data.otp_required) {
            // Transition to OTP phase
            loginPhase = 'otp';
            showOTPPhase(data);
            if (submitBtn) submitBtn.disabled = false;
            return true;
        }

        if (data.authenticated) {
            if (await isCrossTabLoginSyncEnabled()) {
                publishAuthLogin({ reason: "login" });
            }
            window.location.href = resolvePostLoginTarget(
                window.location.search,
                data.redirect,
                window.location.origin
            );
            return;
        }
    }

    async function handleOTPPhase(form, submitBtn) {
        const otpCode = sanitizeOtpCode(document.getElementById("otp")?.value);

        if (!secondStep.validate()) {
            if (submitBtn) submitBtn.disabled = false;
            return;
        }
        const resp = await postPreAuthJson(
            "/api/login",
            document.getElementById("csrf_token"),
            (csrfToken) => buildOtpBody(otpCode, csrfToken),
        );

        const data = await resp.json();

        if (!resp.ok) {
            secondStep.error(data);
            if (submitBtn) submitBtn.disabled = false;
            return;
        }

        if (data.authenticated) {
            if (await isCrossTabLoginSyncEnabled()) {
                publishAuthLogin({ reason: "login" });
            }
            window.location.href = resolvePostLoginTarget(
                window.location.search,
                data.redirect,
                window.location.origin
            );
        }
    }

    async function handlePasswordResetRequestPhase(form, submitBtn) {
        const identifier = document.getElementById("username")?.value?.trim() || '';
        if (!identifier) {
            showLoginError(translateError("identifier_required"));
            if (submitBtn) submitBtn.disabled = false;
            return;
        }

        const resp = await postPreAuthJson(
            "/api/request-password-reset-otp",
            document.getElementById("csrf_token"),
            (csrfToken) => buildPasswordResetRequestBody(identifier, csrfToken),
        );
        const data = await resp.json();

        if (!resp.ok) {
            showLoginError(translateError(data.error));
            if (submitBtn) submitBtn.disabled = false;
            return;
        }

        resetIdentifier = identifier;
        loginPhase = 'reset_verify';
        showPasswordResetVerifyPhase();
        if (submitBtn) submitBtn.disabled = false;
    }

    async function handlePasswordResetVerifyPhase(form, submitBtn) {
        const otpCode = sanitizeOtpCode(document.getElementById("password-reset-otp")?.value);
        const newPassword = document.getElementById("password-reset-new-password")?.value || '';

        if (!secondStep.validate()) {
            if (submitBtn) submitBtn.disabled = false;
            return;
        }
        if (!newPassword.trim()) {
            secondStep.passwordError();
            if (submitBtn) submitBtn.disabled = false;
            return;
        }

        const resp = await postPreAuthJson(
            "/api/reset-password",
            document.getElementById("csrf_token"),
            (csrfToken) => buildPasswordResetBody(otpCode, newPassword, csrfToken),
        );
        const data = await resp.json();

        if (!resp.ok) {
            secondStep.error(data);
            if (submitBtn) submitBtn.disabled = false;
            return;
        }

        restoreLoginCredentialsPhase();
        showLoginStatus(loginForm, 'password_updated_sign_in');
        document.getElementById("password")?.focus();
        if (submitBtn) submitBtn.disabled = false;
    }

    function showOTPPhase(data) {
        clearLoginError();
        secondStep = mountLoginSecondStep(loginForm, data.verification_method, data);
    }

    function showPasswordResetRequestPhase() {
        leaveLoginSecondStep(loginForm);
        secondStep = null;
        loginPhase = 'reset_request';
        setPasswordResetMode(true);

        const otpSection = document.getElementById("otp-section");
        const resetSection = document.getElementById("password-reset-section");
        const forgotLink = document.getElementById("forgot-password-link");
        const backLink = document.getElementById("back-to-login-link");
        const privacyNotice = document.querySelector(".privacy-notice-link");
        const passwordLabel = document.querySelector('label[for="password"]');
        const passwordWrapper = document.querySelector(".password-wrapper");
        const submitBtn = loginForm.querySelector('input[type="submit"]');

        if (otpSection) otpSection.style.display = 'none';
        if (resetSection) resetSection.style.display = 'none';
        if (forgotLink) forgotLink.style.display = 'none';
        if (backLink) backLink.style.display = 'inline';
        if (privacyNotice) privacyNotice.style.display = 'none';
        if (passwordLabel) passwordLabel.style.display = 'none';
        if (passwordWrapper) passwordWrapper.style.display = 'none';
        applyLoginLangKey(
            submitBtn,
            'send_code',
            getTranslationForKey('send_code', { fallback: 'Send code' }) || 'Send code'
        );

        clearLoginError();
    }

    function showPasswordResetVerifyPhase() {
        setPasswordResetMode(true);
        clearLoginError();
        secondStep = mountLoginSecondStep(loginForm, 'recovery');
    }

    function restoreLoginCredentialsPhase() {
        leaveLoginSecondStep(loginForm);
        secondStep = null;
        loginPhase = 'credentials';
        setPasswordResetMode(false);
        resetIdentifier = '';

        const usernameLabel = document.querySelector('label[for="username"]');
        const usernameInput = document.getElementById("username");
        const passwordLabel = document.querySelector('label[for="password"]');
        const passwordWrapper = document.querySelector(".password-wrapper");
        const privacyNotice = document.querySelector(".privacy-notice-link");
        const otpSection = document.getElementById("otp-section");
        const resetSection = document.getElementById("password-reset-section");
        const forgotLink = document.getElementById("forgot-password-link");
        const backLink = document.getElementById("back-to-login-link");
        const resendLink = document.getElementById("resend-otp");
        const resendResetLink = document.getElementById("resend-password-reset-otp");
        const submitBtn = loginForm.querySelector('input[type="submit"]');

        [usernameLabel, usernameInput, passwordLabel, passwordWrapper, privacyNotice].forEach(el => {
            if (el) el.style.display = '';
        });
        if (otpSection) otpSection.style.display = 'none';
        if (resetSection) resetSection.style.display = 'none';
        if (forgotLink) forgotLink.style.display = 'inline';
        if (backLink) backLink.style.display = 'none';
        if (resendLink) resendLink.style.display = 'none';
        if (resendResetLink) resendResetLink.style.display = 'none';
        applyLoginLangKey(
            submitBtn,
            'login',
            getTranslationForKey('login', { fallback: 'Login' }) || 'Login'
        );

        const otpInput = document.getElementById("otp");
        const resetOtpInput = document.getElementById("password-reset-otp");
        const resetPasswordInput = document.getElementById("password-reset-new-password");
        if (otpInput) otpInput.value = '';
        if (resetOtpInput) resetOtpInput.value = '';
        if (resetPasswordInput) resetPasswordInput.value = '';

        clearLoginError();
    }

    function setPasswordResetMode(enabled) {
        const passwordInput = document.getElementById("password");
        const privacyCheckbox = document.getElementById("privacy-accept");
        if (passwordInput) {
            passwordInput.required = !enabled;
        }
        if (privacyCheckbox) {
            privacyCheckbox.required = !enabled;
        }
    }

    function showLoginError(msg) {
        let errEl = document.getElementById("login-error-msg");
        if (!errEl) {
            errEl = document.createElement("div");
            errEl.id = "login-error-msg";
            errEl.setAttribute("role", "alert");
            errEl.setAttribute("aria-live", "assertive");
            errEl.setAttribute("aria-atomic", "true");
            errEl.style.cssText = "color:var(--color-error);font-size:0.9em;margin:8px 0;text-align:center;";
            const submitDiv = document.getElementById("submit");
            if (submitDiv) submitDiv.parentNode.insertBefore(errEl, submitDiv);
        }
        errEl.textContent = msg;
    }

    function clearLoginError() {
        const errEl = document.getElementById("login-error-msg");
        if (errEl) errEl.textContent = '';
    }

    bindLoginCodeResend(loginForm, () => secondStep, async () => {
        loginPhase = 'credentials';
        try {
            return await handleCredentialsPhase(loginForm, loginForm.querySelector('input[type="submit"]'), true);
        } finally {
            if (loginPhase === 'credentials') loginPhase = 'otp';
        }
    });

    const forgotPasswordLink = document.getElementById("forgot-password-link");
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener("click", (e) => {
            e.preventDefault();
            showPasswordResetRequestPhase();
        });
    }

    const backToLoginLink = document.getElementById("back-to-login-link");
    if (backToLoginLink) {
        backToLoginLink.addEventListener("click", (e) => {
            e.preventDefault();
            restoreLoginCredentialsPhase();
        });
    }

    const resendPasswordResetLink = document.getElementById("resend-password-reset-otp");
    resendPasswordResetLink?.addEventListener('click', event => {
        event.preventDefault();
        void secondStep?.resend(async () => {
            const resp = await postPreAuthJson('/api/request-password-reset-otp',
                document.getElementById("csrf_token"),
                csrf => buildPasswordResetRequestBody(resetIdentifier, csrf));
            return resp.ok;
        });
    });

    document.querySelectorAll("[data-auth-public-back]").forEach((returnButton) => {
        returnButton.addEventListener("click", (e) => {
            e.preventDefault();
            window.location.replace(computeStandaloneLoginBackTarget(
                document.referrer,
                window.location.origin,
                window.location.search
            ));
        });
    });

    const togglePasswordBtn = document.getElementById("toggle-password");
    const passwordInput = document.getElementById("password");
    if (togglePasswordBtn && passwordInput) {
        setSecondStepReveal(togglePasswordBtn, passwordInput);
        togglePasswordBtn.addEventListener("click", () => {
            const isHidden = passwordInput.type === "password";
            passwordInput.type = isHidden ? "text" : "password";
            togglePasswordBtn.setAttribute("aria-pressed", String(isHidden));
            const { visibilityOffSvg, visibilityOnSvg } = getPasswordVisibilityIcons();
            if (visibilityOffSvg && visibilityOnSvg) {
                togglePasswordBtn.innerHTML = isHidden ? visibilityOnSvg : visibilityOffSvg;
            }
            setSecondStepReveal(togglePasswordBtn, passwordInput);
        });
    }

    const toggleResetPasswordBtn = document.getElementById("toggle-password-reset");
    const resetPasswordInput = document.getElementById("password-reset-new-password");
    if (toggleResetPasswordBtn && resetPasswordInput) {
        setSecondStepReveal(toggleResetPasswordBtn, resetPasswordInput);
        toggleResetPasswordBtn.addEventListener("click", () => {
            const isHidden = resetPasswordInput.type === "password";
            resetPasswordInput.type = isHidden ? "text" : "password";
            toggleResetPasswordBtn.setAttribute("aria-pressed", String(isHidden));
            const { visibilityOffSvg, visibilityOnSvg } = getPasswordVisibilityIcons();
            if (visibilityOffSvg && visibilityOnSvg) {
                toggleResetPasswordBtn.innerHTML = isHidden ? visibilityOnSvg : visibilityOffSvg;
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

    // Lisätään privacy notice modal functionality
    const privacyNoticeLink = document.getElementById("privacy-notice-link");
    if (privacyNoticeLink) {
        privacyNoticeLink.addEventListener("click", function(event) {
            event.preventDefault();
            showPrivacyNoticeModal();
        });
    }
    if (document.body.dataset.loginPageMode === "standalone") {
        void authPreferenceControlsReady
            .then(() => translatePage(getLanguageWithBrowserFallback()))
            .then(() => window.__filterestShellBoot?.ready());
    }
});

async function showPrivacyNoticeModal() {
    // Haetaan tietosuojaseloste system_about-taulusta (id=4).
    // Sisältö on monikielisessä JSON-rakenteessa, josta valitaan selaimen kieli.
    const modalContent = document.createElement("div");
    modalContent.innerHTML = "";

    let titleText = "Privacy notice";
    try {
        const data = await endpoint_router('fetchAboutContent', { url_params: '?id=4' });
        if (data) {
            const lang = getLanguageWithBrowserFallback();
            // Parsitaan monikielinen JSON — fallback englantiin
            titleText = pickLang(data.title, lang) || titleText;
            modalContent.innerHTML = '';
            modalContent.appendChild(renderAllowedHtml(pickLang(data.description, lang) || ""));
        }
    } catch (err) {
        console.warn("[showPrivacyNoticeModal] fetch error:", err);
    }

    createModal({
        titlePlainText: titleText,
        contentElements: [modalContent],
        width: '800px',
        maxHeight: '80vh'
    });

    showModal();
}

// Wires standalone login-tour screenshot cards to the shared modal viewer.
function initializeTourGalleryModals() {
    const tourShots = Array.from(document.querySelectorAll(".auth-tour-shot"));
    if (tourShots.length === 0) {
        return;
    }

    tourShots.forEach((tourShot) => {
        tourShot.addEventListener("click", () => {
            openTourGalleryModal(tourShot);
        });
    });
}

// Opens one login-tour screenshot inside the shared modal system.
function openTourGalleryModal(tourShot) {
    const imageElement = tourShot.querySelector("img");
    if (!(imageElement instanceof HTMLImageElement)) {
        return;
    }

    const titleText = tourShot.querySelector(".auth-tour-shot-title")?.textContent?.trim() || "Interface snapshot";
    const captionText = tourShot.querySelector(".auth-tour-shot-caption")?.textContent?.trim() || "";

    const figure = document.createElement("figure");
    figure.className = "auth-tour-modal-figure";

    const modalImage = document.createElement("img");
    modalImage.className = "auth-tour-modal-image";
    modalImage.src = imageElement.currentSrc || imageElement.src;
    modalImage.alt = imageElement.alt || titleText;
    figure.appendChild(modalImage);

    if (captionText) {
        const caption = document.createElement("figcaption");
        caption.className = "auth-tour-modal-caption";
        caption.textContent = captionText;
        figure.appendChild(caption);
    }

    const { modal_overlay, modal } = createModal({
        titlePlainText: titleText,
        contentElements: [figure],
        width: "min(1920px, 96vw)",
        maxWidth: "96vw",
        maxHeight: "96vh",
    });
    modal_overlay.classList.add("modal_overlay_blur");
    modal.classList.add("auth-tour-image-modal");

    showModal();
}
