// login_page_builder_helpers.js
// Pure helper functions extracted from login_page_builder.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Translate a backend error code into a Finnish user-facing message.
 *
 * @param {string} code - error code from the API (e.g. 'wrong_credentials')
 * @returns {string} translated message, or the code itself if unknown
 */
export function translateError(code) {
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

/**
 * Compute the close-button redirect target.
 * Returns the referrer if it's same-origin and not the current page, otherwise '/'.
 *
 * @param {string} referrer - document.referrer
 * @param {string} currentOrigin - window.location.origin
 * @param {string} currentPathname - window.location.pathname
 * @returns {string} target URL
 */
export function computeCloseTarget(referrer, currentOrigin, currentPathname) {
    if (referrer && referrer.startsWith(currentOrigin)) {
        try {
            const refUrl = new URL(referrer);
            if (refUrl.pathname !== currentPathname) {
                return referrer;
            }
        } catch {
            // invalid URL — fall through to default
        }
    }
    return '/';
}
