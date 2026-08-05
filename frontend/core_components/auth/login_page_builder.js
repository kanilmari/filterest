// login_page_builder.js
// Builds and controls the login page UI lifecycle.
// Bridges localization, fingerprint capture, and pre-auth login/OTP requests.
// Exists to provide a reliable pre-session authentication flow for the web app.
// PIPELINE_EXCEPTION: Login page runs before session/CSRF bootstrap; endpoint_router
// requires a valid session context that does not exist on the pre-auth login page.
// Login, OTP, and password-reset fetches are pre-auth and cannot flow through runApiPipeline.
import { gather_browser_fingerprint_hash } from "../../reusable_components/browser_identity_builder.js";
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
import {
    translateError,
    pickLang,
    sanitizeOtpCode,
    buildCredentialsBody,
    buildOtpBody,
    buildPasswordResetRequestBody,
    buildPasswordResetBody,
    formatOtpError,
    resolvePostLoginTarget,
    computeCloseTarget,
} from "./login_page_builder_helpers.js";
import { publishAuthLogin } from "./auth_broadcast.js";
import { isCrossTabLoginSyncEnabled } from "../config_fetcher.js";
import { initializeStandaloneLoginShell } from "./login_page_shell_builder.js";
import "./auth_preference_controls.js";

const cookiesToRemove = [
    "device_id",
    "fingerprint",
    "nonce_name",
    // "session",
    "nonce_value",
];
cookiesToRemove.forEach((cookieName) => {
    // HttpOnly-cookieta (kuten session) ei voi poistaa JS:llä,
    // mutta yritetään joka tapauksessa, jos se ei sattuisi olemaan HttpOnly.
    document.cookie =
        cookieName + "=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});


// 2-step AJAX login: Phase 1 (credentials) → Phase 2 (OTP verification)
document.addEventListener("DOMContentLoaded", async () => {
    await ensurePasswordVisibilityIconsLoaded();
    initializeStandaloneLoginShell();
    initializeTourGalleryModals();

    const loginForm = document.querySelector("form");
    let loginPhase = 'credentials'; // 'credentials' | 'otp' | 'reset_request' | 'reset_verify'
    let cachedFingerprint = '';
    let resetIdentifier = '';

    if (loginForm) {
        loginForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            const submitBtn = loginForm.querySelector('input[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;

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
                showLoginError(err.message || "Virhe kirjautumisessa.");
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    async function handleCredentialsPhase(form, submitBtn) {
        // Calculate fingerprint
        try {
            cachedFingerprint = await gather_browser_fingerprint_hash();
        } catch (err) {
            console.warn("[login] fingerprint failed:", err);
            cachedFingerprint = '';
        }

        const username = document.getElementById("username")?.value || '';
        const password = document.getElementById("password")?.value || '';
        const csrfToken = document.getElementById("csrf_token")?.value || '';

        // PIPELINE_EXCEPTION: login runs before session exists — no CSRF/fingerprint pipeline stages available
        const resp = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(buildCredentialsBody(username, password, cachedFingerprint, csrfToken)),
        });

        const data = await resp.json();

        if (!resp.ok) {
            showLoginError(translateError(data.error));
            if (submitBtn) submitBtn.disabled = false;
            return;
        }

        if (data.otp_required) {
            // Transition to OTP phase
            loginPhase = 'otp';
            showOTPPhase(data);
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
            return;
        }
    }

    async function handleOTPPhase(form, submitBtn) {
        const otpCode = sanitizeOtpCode(document.getElementById("otp")?.value);
        const csrfToken = document.getElementById("csrf_token")?.value || '';

        if (!otpCode) {
            showLoginError("Syötä vahvistuskoodi.");
            if (submitBtn) submitBtn.disabled = false;
            return;
        }

        // PIPELINE_EXCEPTION: OTP verification is part of login flow — no session/pipeline available yet
        const resp = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(buildOtpBody(otpCode, csrfToken)),
        });

        const data = await resp.json();

        if (!resp.ok) {
            const msg = formatOtpError(translateError(data.error), data.attempts_remaining);
            showLoginError(msg);
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
        const csrfToken = document.getElementById("csrf_token")?.value || '';
        if (!identifier) {
            showLoginError(translateError("identifier_required"));
            if (submitBtn) submitBtn.disabled = false;
            return;
        }

        // PIPELINE_EXCEPTION: password-reset OTP request is part of the pre-auth login page flow.
        const resp = await fetch("/api/request-password-reset-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(buildPasswordResetRequestBody(identifier, csrfToken)),
        });
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
        const csrfToken = document.getElementById("csrf_token")?.value || '';

        if (!otpCode) {
            showLoginError("Syötä vahvistuskoodi.");
            if (submitBtn) submitBtn.disabled = false;
            return;
        }
        if (!newPassword.trim()) {
            showLoginError(translateError("new_password_required"));
            if (submitBtn) submitBtn.disabled = false;
            return;
        }

        // PIPELINE_EXCEPTION: password reset completes before the user has a session for endpoint_router.
        const resp = await fetch("/api/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(buildPasswordResetBody(otpCode, newPassword, csrfToken)),
        });
        const data = await resp.json();

        if (!resp.ok) {
            showLoginError(translateError(data.error));
            if (submitBtn) submitBtn.disabled = false;
            return;
        }

        restoreLoginCredentialsPhase();
        showLoginError("Salasana vaihdettu. Kirjaudu sisään uudella salasanalla.");
        document.getElementById("password")?.focus();
        if (submitBtn) submitBtn.disabled = false;
    }

    function showOTPPhase(data) {
        // Hide credentials section
        const usernameLabel = document.querySelector('label[for="username"]');
        const usernameInput = document.getElementById("username");
        const passwordLabel = document.querySelector('label[for="password"]');
        const passwordWrapper = document.querySelector(".password-wrapper");
        const privacyNotice = document.querySelector(".privacy-notice-link");

        [usernameLabel, usernameInput, passwordLabel, passwordWrapper, privacyNotice].forEach(el => {
            if (el) el.style.display = 'none';
        });

        // Show OTP section
        const otpSection = document.getElementById("otp-section");
        const otpMessage = document.getElementById("otp-message");
        const resendLink = document.getElementById("resend-otp");
        const submitBtn = loginForm.querySelector('input[type="submit"]');

        if (otpSection) otpSection.style.display = 'block';
        if (otpMessage) {
            otpMessage.setAttribute("role", "status");
            otpMessage.setAttribute("aria-live", "polite");
            otpMessage.setAttribute("aria-atomic", "true");
            const method = data.verification_method;
            if (method === 'fixed_pin') {
                otpMessage.dataset.langKey = 'verification_fixed_pin_prompt';
                otpMessage.textContent = 'Enter your fixed PIN.';
            } else if (method === 'totp') {
                otpMessage.dataset.langKey = 'verification_authenticator_prompt';
                otpMessage.textContent = 'Enter the current code from your authenticator app.';
            } else {
                otpMessage.dataset.langKey = `verification_email_prompt+${data.masked_email || ''}`;
                otpMessage.textContent = `Verification code sent: ${data.masked_email || ''}`;
            }
        }
        if (resendLink) resendLink.style.display = data.verification_method === 'email' ? 'inline' : 'none';
        if (submitBtn) submitBtn.value = 'Vahvista';

        // Focus OTP input
        const otpInput = document.getElementById("otp");
        if (otpInput) {
            otpInput.inputMode = data.verification_method === 'email' ? 'text' : 'numeric';
            otpInput.maxLength = data.verification_method === 'fixed_pin' ? 8 : data.verification_method === 'totp' ? 6 : 32;
            otpInput.focus();
        }

        // Clear any previous error
        clearLoginError();
    }

    function showPasswordResetRequestPhase() {
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
        if (submitBtn) submitBtn.value = 'Lähetä koodi';

        clearLoginError();
    }

    function showPasswordResetVerifyPhase() {
        setPasswordResetMode(true);

        const usernameLabel = document.querySelector('label[for="username"]');
        const usernameInput = document.getElementById("username");
        const passwordLabel = document.querySelector('label[for="password"]');
        const passwordWrapper = document.querySelector(".password-wrapper");
        const privacyNotice = document.querySelector(".privacy-notice-link");
        const otpSection = document.getElementById("otp-section");
        const resetSection = document.getElementById("password-reset-section");
        const resetMessage = document.getElementById("password-reset-message");
        const resendResetLink = document.getElementById("resend-password-reset-otp");
        const backLink = document.getElementById("back-to-login-link");
        const forgotLink = document.getElementById("forgot-password-link");
        const submitBtn = loginForm.querySelector('input[type="submit"]');

        [usernameLabel, usernameInput, passwordLabel, passwordWrapper, privacyNotice].forEach(el => {
            if (el) el.style.display = 'none';
        });
        if (otpSection) otpSection.style.display = 'none';
        if (resetSection) resetSection.style.display = 'block';
        if (resetMessage) {
            resetMessage.textContent = "Jos käyttäjä löytyy, vahvistuskoodi on lähetetty. Syötä koodi ja uusi salasana.";
        }
        if (resendResetLink) resendResetLink.style.display = 'inline';
        if (backLink) backLink.style.display = 'inline';
        if (forgotLink) forgotLink.style.display = 'none';
        if (submitBtn) submitBtn.value = 'Vaihda salasana';

        document.getElementById("password-reset-otp")?.focus();
        clearLoginError();
    }

    function restoreLoginCredentialsPhase() {
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
        if (submitBtn) submitBtn.value = 'Login';

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

    // Resend OTP link
    const resendLink = document.getElementById("resend-otp");
    if (resendLink) {
        resendLink.addEventListener("click", async (e) => {
            e.preventDefault();
            // Go back to credentials phase and re-submit
            loginPhase = 'credentials';
            loginForm.dispatchEvent(new Event('submit'));
        });
    }

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
    if (resendPasswordResetLink) {
        resendPasswordResetLink.addEventListener("click", async (e) => {
            e.preventDefault();
            if (!resetIdentifier) {
                showLoginError(translateError("identifier_required"));
                return;
            }
            loginPhase = 'reset_request';
            const submitBtn = loginForm.querySelector('input[type="submit"]');
            await handlePasswordResetRequestPhase(loginForm, submitBtn);
        });
    }

    const closeBtn = document.querySelector(".auth-form-close-button");
    if (closeBtn) {
        closeBtn.addEventListener("click", (e) => {
            e.preventDefault();
            window.location.href = computeCloseTarget(
                document.referrer,
                window.location.origin,
                window.location.pathname
            );
        });
    }

    const togglePasswordBtn = document.getElementById("toggle-password");
    const passwordInput = document.getElementById("password");
    if (togglePasswordBtn && passwordInput) {
        const { visibilityOffSvg, visibilityOnSvg } = getPasswordVisibilityIcons();
        if (visibilityOffSvg) {
            togglePasswordBtn.innerHTML = visibilityOffSvg;
        }

        togglePasswordBtn.addEventListener("click", () => {
            const isHidden = passwordInput.type === "password";
            passwordInput.type = isHidden ? "text" : "password";
            if (visibilityOffSvg && visibilityOnSvg) {
                togglePasswordBtn.innerHTML = isHidden ? visibilityOnSvg : visibilityOffSvg;
            }
            togglePasswordBtn.setAttribute(
                "aria-label",
                isHidden ? "Hide password" : "Show password"
            );
        });
    }

    const toggleResetPasswordBtn = document.getElementById("toggle-password-reset");
    const resetPasswordInput = document.getElementById("password-reset-new-password");
    if (toggleResetPasswordBtn && resetPasswordInput) {
        const { visibilityOffSvg, visibilityOnSvg } = getPasswordVisibilityIcons();
        if (visibilityOffSvg) {
            toggleResetPasswordBtn.innerHTML = visibilityOffSvg;
        }

        toggleResetPasswordBtn.addEventListener("click", () => {
            const isHidden = resetPasswordInput.type === "password";
            resetPasswordInput.type = isHidden ? "text" : "password";
            if (visibilityOffSvg && visibilityOnSvg) {
                toggleResetPasswordBtn.innerHTML = isHidden ? visibilityOnSvg : visibilityOffSvg;
            }
            toggleResetPasswordBtn.setAttribute(
                "aria-label",
                isHidden ? "Hide password" : "Show password"
            );
        });
    }

    // Lisätään privacy notice modal functionality
    const privacyNoticeLink = document.getElementById("privacy-notice-link");
    if (privacyNoticeLink) {
        privacyNoticeLink.addEventListener("click", function(event) {
            event.preventDefault();
            showPrivacyNoticeModal();
        });
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
