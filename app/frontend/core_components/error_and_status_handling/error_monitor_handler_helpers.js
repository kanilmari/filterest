// error_monitor_handler_helpers.js
// Pure helpers for the global fetch monitor in error_monitor_handler.js.
// Bridges the monitor, the API pipeline that marks caller-owned failures, and
// the translation handler that serves the notices' language keys.
// Exists so the monitor's notices stay translatable, free of technical detail
// and testable without the browser's global fetch. Zero DOM access.

/**
 * Bootstrap copy for the notices the fetch monitor shows. The installation's
 * runtime translations (system_lang_keys) are authoritative; the translation
 * handler serves this copy only while a site lacks the key. Migration
 * 20260922000001_seed_failure_notice_and_dataset_form_language_keys.sql seeds
 * the same wording, and a Python test keeps the two in step.
 */
export const FAILURE_NOTICE_TRANSLATION_FALLBACKS = Object.freeze({
    server_error_notice: {
        fi: "Palvelussa tapahtui virhe. Yritä hetken kuluttua uudelleen.",
        en: "The service ran into an error. Please try again in a moment.",
        ch: "服务出现错误。请稍后再试。",
        yue: "服務出咗錯。請稍後再試。",
    },
    network_error_notice: {
        fi: "Palveluun ei saatu yhteyttä. Tarkista verkkoyhteys ja yritä uudelleen.",
        en: "The service could not be reached. Check your connection and try again.",
        ch: "无法连接到服务。请检查网络连接后重试。",
        yue: "連唔到服務。請檢查網絡連線再試。",
    },
});

// A registered symbol, so a module evaluated twice (tests, hot reload) still
// recognises the mark. fetch() reads only the members it knows, so the mark
// never reaches the network.
const CALLER_OWNS_FAILURE_NOTICE = Symbol.for("filterest.fetch.callerOwnsFailureNotice");

/**
 * Marks fetch options whose caller shows its own notice when the request
 * fails, so the global monitor does not show a second one. The mark is not
 * enumerable: the options still compare, spread and serialise as before.
 *
 * @param {object} fetchOptions - The options object later passed to fetch()
 * @returns {object} The same options object
 */
export function markCallerOwnsFailureNotice(fetchOptions) {
    if (fetchOptions && typeof fetchOptions === "object") {
        Object.defineProperty(fetchOptions, CALLER_OWNS_FAILURE_NOTICE, {
            value: true,
            configurable: true,
        });
    }
    return fetchOptions;
}

/**
 * Tells whether the caller of one fetch shows its own failure notice.
 *
 * @param {unknown} fetchOptions - The options given to fetch()
 * @returns {boolean}
 */
export function callerOwnsFailureNotice(fetchOptions) {
    return Boolean(fetchOptions && fetchOptions[CALLER_OWNS_FAILURE_NOTICE] === true);
}

/**
 * Composes the notice for a server failure: the translated sentence and the
 * status code. The failed address is diagnostic detail for the console only.
 *
 * @param {number} status - HTTP status code
 * @param {(langKey: string) => string} translate - Returns the copy for one language key
 * @returns {string}
 */
export function buildServerErrorNotice(status, translate) {
    const sentence = translate("server_error_notice");
    return Number.isInteger(status) ? `${sentence} (${status})` : sentence;
}

/**
 * Composes the notice for a request that never reached the service. The
 * browser's own error text is diagnostic detail for the console only.
 *
 * @param {(langKey: string) => string} translate - Returns the copy for one language key
 * @returns {string}
 */
export function buildNetworkErrorNotice(translate) {
    return translate("network_error_notice");
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
