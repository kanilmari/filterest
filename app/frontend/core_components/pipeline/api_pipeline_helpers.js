// api_pipeline_helpers.js
// Pure helper functions extracted from api_pipeline.js for testability.
// Bridges raw request/response values with stable pipeline decisions and typed errors.
// Exists to keep cross-cutting HTTP behavior deterministic and free from DOM access.

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** @typedef {import('../../generated/go_contract_types').ErrorBody} ErrorBody */

/**
 * Returns true if the given HTTP method is state-mutating (POST, PUT, PATCH, DELETE).
 *
 * @param {string} method - HTTP method string (case-sensitive, expects uppercase)
 * @returns {boolean}
 */
export function isMutatingMethod(method) {
    return MUTATING_METHODS.has(method);
}

/**
 * Normalize caller url_params so a URLSearchParams string cannot be glued onto
 * the path as `codex-querydataset=…`. Path suffixes such as `orders` stay intact.
 *
 * @param {string} urlParams
 * @returns {string}
 */
export function normalizeEndpointUrlParams(urlParams) {
    const raw = String(urlParams || '');
    if (!raw) return '';
    if (raw.startsWith('?') || raw.startsWith('/') || raw.startsWith('#')) {
        return raw;
    }
    if (raw.startsWith('&') && !raw.includes('?')) {
        return `?${raw.slice(1)}`;
    }
    const looksLikeBareQuery = raw.includes('=') && !raw.includes('/') && !raw.includes('?');
    if (looksLikeBareQuery) {
        return `?${raw}`;
    }
    return raw;
}

/**
 * Resolves a route name to a full URL using the endpoint map.
 * Throws for unknown route names (programming error).
 *
 * A route variant can already carry its own query, such as the streaming search
 * at `/api/get-intelligent-results?stream=1`. The caller's parameters then
 * continue that query instead of starting a second one, so the dataset name
 * stays readable for permission checks.
 *
 * @param {string} routeName - Logical route name from endpoint_map
 * @param {string} urlParams - URL suffix to append (e.g. '?id=1')
 * @param {Object} endpointMap - Map of route names to base URLs
 * @returns {string} Full resolved URL
 */
export function resolveEndpointUrl(routeName, urlParams, endpointMap) {
    const baseUrl = endpointMap[routeName];
    if (!baseUrl) {
        throw new Error(`api_pipeline: unknown route "${routeName}"`);
    }
    const suffix = normalizeEndpointUrlParams(urlParams);
    if (suffix.startsWith('?') && baseUrl.includes('?')) {
        return `${baseUrl}&${suffix.slice(1)}`;
    }
    return baseUrl + suffix;
}

/**
 * Builds a fetch options object from request parameters.
 * Handles FormData (removes Content-Type so browser sets boundary)
 * and JSON serialization for plain objects.
 *
 * @param {Object} params
 * @param {string} [params.method='GET'] - HTTP method
 * @param {Object} [params.headers={}] - Extra request headers
 * @param {*} [params.bodyData=null] - Request payload (FormData or JSON-serializable)
 * @returns {{ method: string, headers: Object, credentials: string, body?: string|FormData }}
 */
export function buildFetchOptions({ method = 'GET', headers = {}, bodyData = null }) {
    const fetchOptions = {
        method: method.toUpperCase(),
        headers: {
            'Content-Type': 'application/json',
            ...headers,
        },
        credentials: 'include',
    };

    if (bodyData) {
        if (typeof FormData !== 'undefined' && bodyData instanceof FormData) {
            delete fetchOptions.headers['Content-Type'];
            fetchOptions.body = bodyData;
        } else {
            fetchOptions.body = JSON.stringify(bodyData);
        }
    }

    return fetchOptions;
}

/**
 * Checks if a 403 response body indicates a session/auth failure.
 * The backend sets auth_failure=true in the JSON response (via RespondWithAuthFailure)
 * only for genuine session problems. All other 403s are business-logic denials.
 *
 * @param {string} bodyText - Raw response body text
 * @returns {boolean}
 */
export function isAuthFailure403(bodyText) {
    const trimmedBody = (bodyText || '').trim();
    if (!trimmedBody) return false;

    try {
        const parsed = /** @type {ErrorBody | null} */ (JSON.parse(trimmedBody));
        return parsed && parsed.auth_failure === true;
    } catch {
        return false;
    }
}

/**
 * Checks whether a data request was answered with a page instead of data.
 *
 * The server's twin of this rule is
 * app/backend/core_components/session_expiry/session_expiry_responder.go: when a
 * sign-in can no longer be accepted, a background request must be told so in a
 * form it can read, never handed the login page with a success status. A browser
 * follows such a redirect silently, so the caller would otherwise parse an HTML
 * document as if it were its data and quietly show an empty interface.
 *
 * This stays deliberately narrow: the response must have followed a redirect and
 * landed on an address outside /api/ that returned markup. A route that answers
 * an API address with markup, and a caller that asked for the raw response, are
 * both untouched.
 *
 * @param {Response} response - The response the pipeline received
 * @returns {boolean}
 */
export function isDataRequestAnsweredWithPage(response) {
    if (!response || response.redirected !== true) return false;
    const contentType = String(response.headers?.get?.('Content-Type') || '').toLowerCase();
    if (!contentType.includes('text/html')) return false;
    try {
        // After a redirect, response.url is where the request actually ended up.
        const finalPath = new URL(response.url).pathname;
        return !finalPath.startsWith('/api/');
    } catch {
        return false;
    }
}

/**
 * Checks if a 403 response body indicates a CSRF-token mismatch or missing token.
 * Used to decide when the frontend may safely fetch a fresh token and retry once.
 *
 * @param {string} bodyText - Raw response body text
 * @returns {boolean}
 */
export function isCsrfFailureResponse(bodyText) {
    const trimmedBody = (bodyText || '').trim();
    if (!trimmedBody) return false;

    try {
        const parsed = /** @type {ErrorBody | null} */ (JSON.parse(trimmedBody));
        const errorText = String(parsed?.error || '').trim().toLowerCase();
        return errorText.includes('csrf');
    } catch {
        return trimmedBody.toLowerCase().includes('csrf');
    }
}

/**
 * Creates an authentication error object with status code attached.
 *
 * @param {number} status - HTTP status code (401 or 403)
 * @param {string} routeName - Logical route name for the error message
 * @returns {Error} Error with .status property
 */
export function createAuthError(status, routeName) {
    const error = new Error(`Authentication required (${status}) for route: ${routeName}`);
    error.status = status;
    return error;
}

/**
 * Creates a rate limit error object with status and isRateLimited flag.
 *
 * @param {string} routeName - Logical route name for the error message
 * @returns {Error} Error with .status=429 and .isRateLimited=true
 */
export function createRateLimitError(routeName) {
    const error = new Error(`Rate limit exceeded (429) for route: ${routeName}`);
    error.status = 429;
    error.isRateLimited = true;
    return error;
}

/**
 * Creates the typed retryable error used when an app is draining or under maintenance.
 * Between the shared response pipeline and editors that must preserve unsaved drafts.
 * Exists so a 503 never has to be inferred from a raw backend or reverse-proxy message.
 *
 * @param {string} routeName - Logical route name for the failed request
 * @returns {Error} Error with stable service-unavailable markers
 */
export function createServiceUnavailableError(routeName) {
    const error = new Error(`Service temporarily unavailable for route: ${routeName}`);
    error.status = 503;
    error.isServiceUnavailable = true;
    error.isRetryable = true;
    return error;
}

/**
 * Recognizes the shared 503 error without depending on one concrete Error class.
 * Between pipeline callers, aggregate save errors, and editor recovery behavior.
 * Exists so tests and compatibility callers can retain drafts from either stable marker.
 *
 * @param {unknown} error - Rejected request value
 * @returns {boolean}
 */
export function isServiceUnavailableError(error) {
    return Boolean(
        error
        && (error.isServiceUnavailable === true || Number(error.status) === 503)
    );
}

/**
 * Strips ANSI color/escape codes from a string.
 * Used to clean backend error messages for browser display.
 *
 * @param {string} text - Text potentially containing ANSI codes
 * @returns {string} Clean text
 */
export function stripAnsiCodes(text) {
    if (typeof text !== 'string') return text;
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, '');
}

// A language key a server may name as the reason for refusing a request.
const SERVER_REASON_LANG_KEY = /^[a-z][a-z0-9_]{0,127}$/;

/**
 * Picks the translated notice for a failed response the earlier stages left:
 * the server-error sentence for a 5xx, the reason a 4xx names by language key
 * (JSON error_lang_key, as table creation sends), and otherwise the general
 * failure sentence. The status code follows each sentence except a named
 * reason, which is already specific. The server's free text is never shown:
 * it is technical, rarely in the reader's language, and goes to the console.
 *
 * @param {number} status - HTTP status code of the failed response
 * @param {string} bodyText - Response body text
 * @returns {{ langKey: string, status?: number }}
 */
export function resolveFailureNotice(status, bodyText) {
    if (status >= 500) {
        return { langKey: 'server_error_notice', status };
    }
    try {
        const reasonKey = JSON.parse(bodyText || '')?.error_lang_key;
        if (typeof reasonKey === 'string' && SERVER_REASON_LANG_KEY.test(reasonKey)) {
            return { langKey: reasonKey };
        }
    } catch {
        // Not JSON: no named reason.
    }
    return { langKey: 'request_failed_notice', status };
}

/**
 * Determines whether a rate-limit toast should be shown, based on throttle window.
 * Returns true if enough time has elapsed since the last toast.
 *
 * @param {number} lastToastTime - Timestamp (ms) of the last rate-limit toast shown
 * @param {number} windowMs - Minimum interval between toasts (ms)
 * @param {number} [now] - Current timestamp (ms), defaults to Date.now()
 * @returns {boolean}
 */
export function shouldThrottleRateLimitToast(lastToastTime, windowMs, now) {
    const currentTime = now !== undefined ? now : Date.now();
    return currentTime - lastToastTime > windowMs;
}
