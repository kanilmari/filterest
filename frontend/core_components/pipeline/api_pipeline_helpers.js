// api_pipeline_helpers.js
// Pure helper functions extracted from api_pipeline.js for testability.
// Zero DOM access — all functions are pure input→output.

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
 * Resolves a route name to a full URL using the endpoint map.
 * Throws for unknown route names (programming error).
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
    return baseUrl + (urlParams || '');
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

/**
 * Truncates text to a maximum length, appending '...' if truncated.
 *
 * @param {string} text - Text to truncate
 * @param {number} [maxLength=200] - Maximum character length before truncation
 * @returns {string}
 */
export function truncateErrorText(text, maxLength = 200) {
    if (!text) return '';
    return text.length > maxLength
        ? text.slice(0, maxLength) + '\u2026'
        : text;
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
