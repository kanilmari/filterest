// login_modal_printer.js
// Renders and manages the login modal, handling form fetch, user input, and credential submission.
// Bridges the unauthenticated page state and the session-authenticated state via the login modal UI.
// Exists to provide a pre-session authentication entry point without duplicating login flow logic elsewhere.
// PIPELINE_EXCEPTION: Login, OTP, and password-reset fetches run before a full session/pipeline exists.
import { createModal, showModal, hideModal } from "../../reusable_components/modal/modal_builder.js";
import { gather_browser_fingerprint_hash } from "../../reusable_components/browser_identity_builder.js";
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
    buildPasswordResetRequestBody,
    buildPasswordResetBody,
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

        // Remove the close button (modal has its own)
        const closeBtn = form.querySelector(".auth-form-close-button");
        if (closeBtn) closeBtn.remove();

        const shell = document.createElement("div");
        shell.classList.add("auth-modal-shell");
        if (hero) {
            shell.appendChild(hero);
        }
        shell.appendChild(form);

        // Attach event listeners and cache the form
        await ensurePasswordVisibilityIconsLoaded();
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
    const { visibilityOffSvg, visibilityOnSvg } = getPasswordVisibilityIcons();
    
    if (togglePasswordBtn && passwordInput) {
        // Re-attach the SVG icons logic as they might be lost or need re-initialization
        // Actually, the SVGs are in the HTML fetched. We just need the click handler.
        
        // We need the SVG strings from login.js or just toggle type.
        // Let's just toggle type for simplicity, or copy the SVG logic if we want to be fancy.
        // The fetched HTML already contains the initial SVG.
        
        togglePasswordBtn.addEventListener("click", () => {
            const isHidden = passwordInput.type === "password";
            passwordInput.type = isHidden ? "text" : "password";

            if (visibilityOffSvg && visibilityOnSvg) {
                togglePasswordBtn.innerHTML = isHidden
                    ? visibilityOnSvg
                    : visibilityOffSvg;
            }
            togglePasswordBtn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
        });
    }

    const toggleResetPasswordBtn = form.querySelector("#toggle-password-reset");
    const resetPasswordInput = form.querySelector("#password-reset-new-password");
    if (toggleResetPasswordBtn && resetPasswordInput) {
        toggleResetPasswordBtn.addEventListener("click", () => {
            const isHidden = resetPasswordInput.type === "password";
            resetPasswordInput.type = isHidden ? "text" : "password";

            if (visibilityOffSvg && visibilityOnSvg) {
                toggleResetPasswordBtn.innerHTML = isHidden
                    ? visibilityOnSvg
                    : visibilityOffSvg;
            }
            toggleResetPasswordBtn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
        });
    }

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

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const submitBtn = form.querySelector('input[type="submit"]');
        if (!submitBtn) return;
        submitBtn.disabled = true;

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
            showFormError(form, err.message || "Login failed.");
            submitBtn.disabled = false;
        }
    });

    async function handleCredentialsPhase(form, submitBtn) {
        try {
            cachedFingerprint = await gather_browser_fingerprint_hash();
        } catch (_err) {
            cachedFingerprint = '';
        }

        const username = form.querySelector("#username")?.value || '';
        const password = form.querySelector("#password")?.value || '';
        const csrfToken = form.querySelector("#csrf_token")?.value || '';

        // PIPELINE_EXCEPTION: modal credential submit runs before endpoint_router has session context.
        const resp = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ username, password, fingerprint: cachedFingerprint, csrf_token: csrfToken }),
        });

        const data = await resp.json();

        if (!resp.ok) {
            showFormError(form, translateError(data.error));
            submitBtn.disabled = false;
            return;
        }

        if (data.otp_required) {
            loginPhase = 'otp';
            // Hide credentials, show OTP section
            const usernameLabel = form.querySelector('label[for="username"]');
            const usernameInput = form.querySelector("#username");
            const passwordLabel = form.querySelector('label[for="password"]');
            const passwordWrapper = form.querySelector(".password-wrapper");
            const privacyNotice = form.querySelector(".privacy-notice-link");
            [usernameLabel, usernameInput, passwordLabel, passwordWrapper, privacyNotice].forEach(el => {
                if (el) el.style.display = 'none';
            });

            const otpSection = form.querySelector("#otp-section");
            const otpMessage = form.querySelector("#otp-message");
            const resendLink = form.querySelector("#resend-otp");
            if (otpSection) otpSection.style.display = 'block';
            if (otpMessage) {
                otpMessage.setAttribute("role", "status");
                otpMessage.setAttribute("aria-live", "polite");
                otpMessage.setAttribute("aria-atomic", "true");
                if (data.verification_method === 'fixed_pin') {
                    otpMessage.textContent = getTranslationForKey("verification_fixed_pin_prompt") || "Enter your fixed PIN.";
                } else if (data.verification_method === 'totp') {
                    otpMessage.textContent = getTranslationForKey("verification_authenticator_prompt") || "Enter the current code from your authenticator app.";
                } else {
                    otpMessage.textContent = `${getTranslationForKey("otp_sent") || "Verification code sent"}: ${data.masked_email || ''}`;
                }
            }
            if (resendLink) resendLink.style.display = data.verification_method === 'email' ? 'inline' : 'none';
            if (submitBtn) {
                submitBtn.value = getTranslationForKey("verify") || 'Verify';
                submitBtn.disabled = false;
            }
            const otpInput = form.querySelector("#otp");
            if (otpInput) {
                otpInput.inputMode = data.verification_method === 'email' ? 'text' : 'numeric';
                otpInput.maxLength = data.verification_method === 'fixed_pin' ? 8 : data.verification_method === 'totp' ? 6 : 32;
                otpInput.focus();
            }
            clearFormError(form);
            return;
        }

        if (data.authenticated) {
            await completeSuccessfulModalLogin();
        }
    }

    async function handleOTPPhase(form, submitBtn) {
        const otpCode = sanitizeOtpCode(form.querySelector("#otp")?.value);
        const csrfToken = form.querySelector("#csrf_token")?.value || '';

        if (!otpCode) {
            showFormError(form, getTranslationForKey("enter_otp") || "Enter the verification code.");
            submitBtn.disabled = false;
            return;
        }

        // PIPELINE_EXCEPTION: modal OTP verification is part of the pre-auth login flow.
        const resp = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ otp_code: otpCode, csrf_token: csrfToken }),
        });

        const data = await resp.json();

        if (!resp.ok) {
            let msg = translateError(data.error);
            if (data.attempts_remaining !== undefined && data.attempts_remaining >= 0) {
                msg += ` (${data.attempts_remaining} ${getTranslationForKey("attempts_remaining") || "attempts remaining"})`;
            }
            showFormError(form, msg);
            submitBtn.disabled = false;
            return;
        }

        if (data.authenticated) {
            await completeSuccessfulModalLogin();
        }
    }

    async function handlePasswordResetRequestPhase(form, submitBtn) {
        const identifier = form.querySelector("#username")?.value?.trim() || '';
        const csrfToken = form.querySelector("#csrf_token")?.value || '';

        if (!identifier) {
            showFormError(form, translateError("identifier_required"));
            submitBtn.disabled = false;
            return;
        }

        // PIPELINE_EXCEPTION: modal password-reset OTP request is pre-auth and uses the form CSRF token.
        const resp = await fetch("/api/request-password-reset-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(buildPasswordResetRequestBody(identifier, csrfToken)),
        });
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
        const csrfToken = form.querySelector("#csrf_token")?.value || '';

        if (!otpCode) {
            showFormError(form, getTranslationForKey("enter_otp") || "Enter the verification code.");
            submitBtn.disabled = false;
            return;
        }
        if (!newPassword.trim()) {
            showFormError(form, translateError("new_password_required"));
            submitBtn.disabled = false;
            return;
        }

        // PIPELINE_EXCEPTION: modal password reset completes before endpoint_router session bootstrap.
        const resp = await fetch("/api/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(buildPasswordResetBody(otpCode, newPassword, csrfToken)),
        });
        const data = await resp.json();

        if (!resp.ok) {
            showFormError(form, translateError(data.error));
            submitBtn.disabled = false;
            return;
        }

        restoreLoginCredentialsPhase();
        showFormError(form, "Password updated. Log in with the new password.");
        submitBtn.disabled = false;
    }

    function setPasswordResetMode(enabled) {
        const passwordInput = form.querySelector("#password");
        const privacyCheckbox = form.querySelector("#privacy-accept");
        if (passwordInput) passwordInput.required = !enabled;
        if (privacyCheckbox) privacyCheckbox.required = !enabled;
    }

    function showPasswordResetRequestPhase() {
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
        if (submitBtn) submitBtn.value = 'Send code';
        clearFormError(form);
    }

    function showPasswordResetVerifyPhase() {
        setPasswordResetMode(true);

        const usernameLabel = form.querySelector('label[for="username"]');
        const usernameInput = form.querySelector("#username");
        const passwordLabel = form.querySelector('label[for="password"]');
        const passwordWrapper = form.querySelector(".password-wrapper");
        const privacyNotice = form.querySelector(".privacy-notice-link");
        const otpSection = form.querySelector("#otp-section");
        const resetSection = form.querySelector("#password-reset-section");
        const resetMessage = form.querySelector("#password-reset-message");
        const resendResetLink = form.querySelector("#resend-password-reset-otp");
        const forgotLink = form.querySelector("#forgot-password-link");
        const backLink = form.querySelector("#back-to-login-link");
        const submitBtn = form.querySelector('input[type="submit"]');

        [usernameLabel, usernameInput, passwordLabel, passwordWrapper, privacyNotice].forEach(el => {
            if (el) el.style.display = 'none';
        });
        if (otpSection) otpSection.style.display = 'none';
        if (resetSection) resetSection.style.display = 'block';
        if (resetMessage) {
            resetMessage.textContent = "If the account exists, a verification code was sent. Enter the code and your new password.";
        }
        if (resendResetLink) resendResetLink.style.display = 'inline';
        if (forgotLink) forgotLink.style.display = 'none';
        if (backLink) backLink.style.display = 'inline';
        if (submitBtn) submitBtn.value = 'Reset password';
        form.querySelector("#password-reset-otp")?.focus();
        clearFormError(form);
    }

    function restoreLoginCredentialsPhase() {
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
        if (submitBtn) submitBtn.value = 'Login';
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
    if (resendPasswordResetLink) {
        resendPasswordResetLink.addEventListener("click", async (e) => {
            e.preventDefault();
            if (!resetIdentifier) {
                showFormError(form, translateError("identifier_required"));
                return;
            }
            loginPhase = 'reset_request';
            const submitBtn = form.querySelector('input[type="submit"]');
            if (!submitBtn) return;
            submitBtn.disabled = true;
            await handlePasswordResetRequestPhase(form, submitBtn);
        });
    }
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
