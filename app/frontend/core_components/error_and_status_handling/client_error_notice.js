// client_error_notice.js
// Installs the browser runtime notice policy, separate from fetch failures.
// Connects reusable attribution to translated notices and verified admin UI rights.
// Keeps technical details in the console for visitors and ordinary users.
import { classifyClientError } from './client_error_classifier.js';
import { hasCachedRouteRights } from '../permission_cache_reader.js';
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { getSessionGeneration, subscribeToSessionGeneration } from '../auth/session_generation_store.js';
import { showToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import { showRequestFailureNotice } from './request_failure_notice.js';

const ADMIN_ROUTE = '/api/admin/version-info';
const TECHNICAL_TEXT_LIMIT = 240;
const technicalToasts = new Set();

subscribeToSessionGeneration(() => {
    for (const toast of technicalToasts) {
        // Remove synchronously, even if user dismissal already started a fade.
        toast.dismiss({ immediate: true });
        toast.element.remove();
    }
    technicalToasts.clear();
});

/** Install once through error_monitor_handler.js; fetch policy stays there. */
export function installClientErrorHandlers() {
    window.onerror = function(message, source, line, column, error) {
        if (String(message).includes('ResizeObserver loop')) return true;
        console.error(`[JS] ${message} (${source}:${line}:${column})`, error);
        if (classifyClientError({ message, source: source || '', line, column, error }, location.href) === 'own') {
            showOwnError('JS', message);
        }
        return false;
    };
    window.onunhandledrejection = function(event) {
        const reason = event.reason;
        if (reason instanceof Error && String(reason.message).includes('ResizeObserver loop')) return;
        console.error('[Promise]', reason, event);
        if (reason instanceof Error && reason.stack
            && classifyClientError({ error: reason }, location.href) === 'own') {
            showOwnError('Promise', `${reason.name}: ${reason.message}`);
        }
    };
}

async function showOwnError(kind, message) {
    // Route grants alone cannot prove admin membership. The existing protected
    // endpoint verifies it on the server; deny/failure/session changes fail closed.
    const generation = getSessionGeneration();
    let admin = false;
    try {
        if (localStorage.getItem('button_state') === 'logout' && hasCachedRouteRights(ADMIN_ROUTE)) {
            const verified = await endpoint_router('adminVersionInfo', {
                suppressErrorToast: true, suppressAuthRedirect: true,
                signal: AbortSignal.timeout(2000),
            });
            admin = typeof verified?.app_version === 'string'
                && generation === getSessionGeneration()
                && localStorage.getItem('button_state') === 'logout';
        }
    } catch { /* Missing storage, denied rights and failed verification use generic copy. */ }
    if (!admin) {
        showRequestFailureNotice('client_error_notice', { duration: 0 });
        return;
    }
    // Technical copy contains basenames only, with all queries/fragments
    // removed before truncation (including URLs embedded in error messages).
    const text = `[${kind}] ${String(message)}`.split(/\s+/).filter(Boolean).map(technicalWord).join(' ');
    // Drop handles for user-dismissed/capped notices; generic notices are never tracked.
    for (const toast of technicalToasts) {
        if (!toast.element.isConnected) technicalToasts.delete(toast);
    }
    technicalToasts.add(showToast({
        message: text.length > TECHNICAL_TEXT_LIMIT ? `${text.slice(0, TECHNICAL_TEXT_LIMIT - 1)}…` : text,
        level: 'error', duration: 0,
    }));
}

/** One whitespace-separated word of admin copy, without query, fragment or URL host/path. */
function technicalWord(word) {
    // A query or fragment runs to the end of the word, whatever characters
    // (quotes, parentheses) it contains.
    const cut = word.search(/[?#]/);
    const kept = cut === -1 ? word : word.slice(0, cut);
    const start = kept.search(/(?:[a-z][a-z\d+.-]*:)?\/\//i);
    if (start === -1) return kept;
    let name = '';
    try {
        name = new URL(kept.slice(start), location.href).pathname.split('/').pop();
    } catch { /* An unparsable address is replaced as a whole. */ }
    return kept.slice(0, start) + (name || '[url]');
}
