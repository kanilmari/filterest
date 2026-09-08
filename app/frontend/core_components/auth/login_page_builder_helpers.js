// Provides value builders, localized errors, and navigation guards for the login workflow.
// Bridges pre-auth form state, redirect inputs, and browser location metadata.
// Keeps authentication decisions and pre-auth copy independently testable.
// Exists so login routing and safety rules have one deterministic source.
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';

/**
 * Translate backend login errors, with FI/EN fallback copy for admission-policy failures.
 * These pre-auth failures must remain readable when policy/database lookup is unavailable.
 *
 * @param {string} code - error code from the API (e.g. 'wrong_credentials')
 * @param {string} languageCode - current stored/browser language by default
 * @returns {string} translated message, or the code itself if unknown
 */
export function translateError(code, languageCode = getLanguageWithBrowserFallback()) {
    // Accept an optional transport/error prefix for these exact codes only.
    // Existing error messages below keep their established copy and fallback behavior.
    const policyCode = String(code ?? '').match(/(?:^|:\s*)(login_not_allowed|authentication_policy_unavailable)\s*$/)?.[1];
    const policyMessages = {
        login_not_allowed: {
            fi: 'Tällä tilillä ei voi kirjautua tähän palveluun.',
            en: 'This account is not allowed to sign in to this service.',
        },
        authentication_policy_unavailable: {
            fi: 'Kirjautuminen ei ole juuri nyt käytettävissä. Yritä hetken kuluttua uudelleen.',
            en: 'Sign-in is temporarily unavailable. Please try again shortly.',
        },
    };
    if (policyCode) {
        const language = String(languageCode || '').trim().toLowerCase().split(/[-_]/)[0];
        return policyMessages[policyCode][language === 'fi' ? 'fi' : 'en'];
    }

    const map = {
        'wrong_credentials': 'Väärä käyttäjätunnus tai salasana.',
        'wrong_otp': 'Virheellinen vahvistuskoodi.',
        'csrf_token_invalid': 'Virheellinen CSRF-token. Lataa sivu uudelleen.',
        'no_pending_otp': 'Ei odottavaa vahvistusta. Kirjaudu uudelleen.',
        'no_pending_password_reset': 'Ei odottavaa salasanan palautusta. Aloita alusta.',
        'too_many_otp_requests': 'Liian monta koodipyyntöä. Odota hetki.',
        'email_not_found': 'Sähköpostiosoitetta ei löydy. Ota yhteyttä ylläpitoon.',
        'identifier_required': 'Syötä käyttäjätunnus tai sähköposti.',
        'new_password_required': 'Syötä uusi salasana.',
    };
    return map[code] || code || 'Virhe kirjautumisessa.';
}

/**
 * Parse a multilingual JSON string and return the value for the requested language.
 * Falls back to English, then the first available value.
 * If the input is not valid JSON, returns it as a plain string.
 *
 * @param {string} jsonStr - JSON string like '{"fi":"Hei","en":"Hello"}'
 * @param {string} lang - language code, e.g. 'fi'
 * @returns {string}
 */
export function pickLang(jsonStr, lang) {
    if (!jsonStr) return "";
    try {
        const obj = JSON.parse(jsonStr);
        return obj[lang] || obj["en"] || Object.values(obj)[0] || "";
    } catch {
        return jsonStr;
    }
}

/**
 * Sanitize an OTP code by stripping all whitespace.
 *
 * @param {string} raw - raw OTP input value
 * @returns {string} cleaned OTP code
 */
export function sanitizeOtpCode(raw) {
    return (raw || '').replace(/\s/g, '');
}

/**
 * Build the request body for the credentials login phase.
 *
 * @param {string} username
 * @param {string} password
 * @param {string} fingerprint
 * @param {string} csrfToken
 * @returns {object}
 */
export function buildCredentialsBody(username, password, fingerprint, csrfToken) {
    return {
        username,
        password,
        fingerprint,
        csrf_token: csrfToken,
    };
}

/**
 * Build the request body for the OTP verification phase.
 *
 * @param {string} otpCode - sanitized OTP code
 * @param {string} csrfToken
 * @returns {object}
 */
export function buildOtpBody(otpCode, csrfToken) {
    return {
        otp_code: otpCode,
        csrf_token: csrfToken,
    };
}

/**
 * Build the request body for the password-reset OTP request phase.
 *
 * @param {string} identifier
 * @param {string} csrfToken
 * @returns {object}
 */
export function buildPasswordResetRequestBody(identifier, csrfToken) {
    return {
        identifier,
        csrf_token: csrfToken,
    };
}

/**
 * Build the request body for the password-reset confirmation phase.
 *
 * @param {string} otpCode
 * @param {string} newPassword
 * @param {string} csrfToken
 * @returns {object}
 */
export function buildPasswordResetBody(otpCode, newPassword, csrfToken) {
    return {
        otp_code: otpCode,
        new_password: newPassword,
        csrf_token: csrfToken,
    };
}

/**
 * Format an OTP error message, optionally appending remaining attempts.
 *
 * @param {string} msg - base error message
 * @param {number|undefined} attemptsRemaining - attempts left, or undefined
 * @returns {string}
 */
export function formatOtpError(msg, attemptsRemaining) {
    if (attemptsRemaining !== undefined && attemptsRemaining >= 0) {
        return `${msg} (${attemptsRemaining} yritystä jäljellä)`;
    }
    return msg;
}

/**
 * Resolve the post-login navigation target from the login page context.
 * Prefers the existing ?redirect= query captured by auth redirects, then falls
 * back to the backend-provided redirect if it is same-origin.
 *
 * @param {string} loginSearch - window.location.search from the login page
 * @param {string} apiRedirect - redirect returned by the login API response
 * @param {string} currentOrigin - window.location.origin
 * @returns {string} safe relative target path, defaulting to '/'
 */
export function resolvePostLoginTarget(loginSearch, apiRedirect, currentOrigin) {
    const redirectFromQuery = new URLSearchParams(loginSearch || '').get('redirect');

    return normalizeSameOriginRedirect(redirectFromQuery, currentOrigin)
        || normalizeSameOriginRedirect(apiRedirect, currentOrigin)
        || '/';
}

function normalizeSameOriginRedirect(candidate, currentOrigin) {
    if (!candidate || !currentOrigin) {
        return '';
    }

    try {
        const resolvedUrl = new URL(candidate, currentOrigin);
        if (resolvedUrl.origin !== currentOrigin) {
            return '';
        }

        return `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
    } catch {
        return '';
    }
}

const NON_PUBLIC_LOGIN_RETURN_PREFIXES = [
    '/admin',
    '/api',
    '/first-run',
    '/login',
    '/register',
    '/system',
];

/**
 * Resolve a safe destination from the optional-browsing standalone login page.
 * Between the login document referrer and public app routes, it permits an exact
 * same-origin return while rejecting auth, admin, API, and recovery-loop paths.
 * Why: a guest should be able to leave login without reopening a protected route.
 *
 * @param {string} referrer - document.referrer
 * @param {string} currentOrigin - window.location.origin
 * @param {string} loginSearch - window.location.search on the login page
 * @returns {string} safe relative destination, defaulting to '/'
 */
export function computeStandaloneLoginBackTarget(referrer, currentOrigin, loginSearch = '') {
    const loginParams = new URLSearchParams(loginSearch || '');
    if (loginParams.has('redirect') || loginParams.has('auth_notice')) {
        return '/';
    }

    try {
        const refUrl = new URL(referrer);
        if (refUrl.origin !== currentOrigin || !isPublicLoginReturnPath(refUrl)) {
            return '/';
        }
        return `${refUrl.pathname}${refUrl.search}${refUrl.hash}`;
    } catch {
        return '/';
    }
}

function isPublicLoginReturnPath(refUrl) {
    const normalizedPath = refUrl.pathname.toLowerCase().replace(/\/+$/, '') || '/';
    if (NON_PUBLIC_LOGIN_RETURN_PREFIXES.some((prefix) => (
        normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
    ))) {
        return false;
    }

    return !refUrl.searchParams.has('login-entry')
        && !refUrl.searchParams.has('register-entry');
}
