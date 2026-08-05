// error_monitor_handler_helpers.js
// Pure helper functions extracted from error_monitor_handler.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Translates an HTTP status code to a human-readable Finnish description.
 *
 * @param {number} status - HTTP status code
 * @returns {string} Human-readable status message with code in parentheses
 */
export function getNiceStatusMessage(status) {
    switch (status) {
        case 400: return "Virheellinen pyynto (400)";
        case 401: return "Luvaton (401)";
        case 403: return "Kielletty (403)";
        case 404: return "Resurssia ei loydy (404)";
        case 429: return "Liian monta pyyntoa (429)";
        case 500: return "Palvelinvirhe (500)";
        default:  return `Tuntematon HTTP-virhe (${status})`;
    }
}

/**
 * Shortens a long URL for display by keeping the start and end,
 * replacing the middle with "...".
 *
 * @param {string} url - URL to shorten
 * @param {number} [maxLength=80] - Maximum character length before truncation
 * @returns {string} Shortened URL, or original if already within maxLength
 */
export function shortenUrl(url, maxLength = 80) {
    if (!url || url.length <= maxLength) return url;
    const half = Math.floor((maxLength - 3) / 2);
    return url.slice(0, half) + "..." + url.slice(url.length - half);
}

/**
 * Detects browser/network abort-style fetch errors that are expected during
 * page unloads or explicitly expendable background maintenance requests.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isAbortLikeNetworkError(error) {
    if (String(error?.name || '') === 'AbortError') {
        return true;
    }
    const message = String(error?.message || error || '');
    if (!message) {
        return false;
    }
    return /AbortError|NS_BINDING_ABORTED|NetworkError when attempting to fetch resource|Failed to fetch|Load failed|signal is aborted without reason/i.test(message);
}
