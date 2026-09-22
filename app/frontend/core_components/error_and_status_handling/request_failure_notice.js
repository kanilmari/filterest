// request_failure_notice.js
// Shows the one notice a failed request gets, in the reader's language.
// Bridges the API pipeline and the global fetch monitor with the toast printer
// and the language keys the translation handler serves.
// Exists so every failure notice reads the same, names no route or address,
// and is translated like any other interface text.
//
// The notice's sentence is a data-lang-key element, so the translation handler
// fills it from the site's runtime translations as it does every other label.
// This module therefore needs no translation import, which keeps the pipeline
// free of an import cycle (translation handler -> endpoint router -> pipeline).

import { showToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import {
    FAILURE_NOTICE_TRANSLATION_FALLBACKS,
    isAbortLikeNetworkError,
} from './error_monitor_handler_helpers.js';

let pageUnloadInProgress = false;
if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
        pageUnloadInProgress = true;
    });
    window.addEventListener('pageshow', () => {
        pageUnloadInProgress = false;
    });
}

/**
 * Tells whether a request that never reached the service was cancelled on
 * purpose, so it deserves no notice: its caller aborted it, the page is being
 * left, or the caller marked it as expendable background work.
 *
 * @param {unknown} error - What fetch() rejected with
 * @param {object} [fetchOptions] - The options given to fetch()
 * @returns {boolean}
 */
export function isExpectedNetworkAbort(error, fetchOptions) {
    if (fetchOptions?.signal?.aborted) return true;
    if (!isAbortLikeNetworkError(error)) return false;
    const headers = fetchOptions?.headers || {};
    const expendable = headers['X-Ignore-Network-Abort'] === '1'
        || headers['x-ignore-network-abort'] === '1';
    return pageUnloadInProgress || expendable;
}

/**
 * Shows one failed-request notice: a translated sentence and, when given, the
 * status code in parentheses. The route, address and server text belong in
 * the console, which the caller writes.
 *
 * The sentence starts as the bootstrap copy of the page's language, so the
 * notice reads correctly even before the site's translations have loaded.
 *
 * @param {string} langKey - Language key of the sentence
 * @param {object} [options]
 * @param {number} [options.status] - HTTP status code to show after the sentence
 * @param {'error'|'warning'} [options.level='error'] - Visual severity
 * @param {number} [options.duration] - Auto-dismiss delay in ms (toast default when omitted)
 * @returns {{element: HTMLElement, dismiss: Function}}
 */
export function showRequestFailureNotice(langKey, { status, level = 'error', duration } = {}) {
    const sentence = document.createElement('span');
    sentence.dataset.langKey = langKey;
    sentence.textContent = bootstrapCopy(langKey, document.documentElement.lang);

    const notice = document.createElement('span');
    notice.className = 'toast-notification-text';
    notice.append(sentence);
    if (Number.isInteger(status)) {
        notice.append(` (${status})`);
    }
    return showToast({
        content: notice,
        level,
        ...(duration === undefined ? {} : { duration }),
    });
}

/**
 * Bootstrap copy of a notice key in one language, English when the language
 * has none. A key the server named without bootstrap copy starts from the
 * general failure sentence until its own translation replaces it.
 */
function bootstrapCopy(langKey, language) {
    const copy = FAILURE_NOTICE_TRANSLATION_FALLBACKS[langKey]
        || FAILURE_NOTICE_TRANSLATION_FALLBACKS.request_failed_notice;
    return copy[String(language || '').toLowerCase()] || copy.en;
}
