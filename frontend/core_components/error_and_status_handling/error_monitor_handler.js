// error_monitor_handler.js
// Monitors system-level errors and the global fetch wrapper for failure reporting.
// Bridges browser runtime events and failed fetch responses and the unified toast notification UI.
// Exists to surface genuine system failures while leaving application-level statuses to calling components.
// Note: application-level statuses (4xx) pass through silently to
// endpoint_router.js and the calling component.
//
// Fingerprint injection and auth redirects have been moved to the API pipeline
// (api_pipeline.js stages: fingerprintStage, authRedirectStage).
// The fetch monkey-patch now only handles 5xx toasts and network error reporting.
//
// Session reset is available via window.__resetSession() in the browser console
// for recovery from corrupted session state.
import { endpoint_router } from "../endpoints/endpoint_router.js";
import { showErrorToast } from "../../reusable_components/notifications/toast_notification_printer.js";
import { getNiceStatusMessage, isAbortLikeNetworkError, shortenUrl } from "./error_monitor_handler_helpers.js";
// Imported as a side-effect module in main.js:
//   import "./core_components/error_and_status_handling/error_and_status_monitor.js";

(function() {
    let pageUnloadInProgress = false;
    window.addEventListener('pagehide', () => {
        pageUnloadInProgress = true;
    });
    window.addEventListener('pageshow', () => {
        pageUnloadInProgress = false;
    });

    // ==========================================
    // Session Reset (recovery tool)
    // ==========================================
    // Exposed as window.__resetSession() for dev console recovery.
    // Clears client-side cookies and calls the server reset endpoint.

    window.__resetSession = function() {
        const cookiesToRemove = [
            "device_id", "fingerprint", "nonce_name", "session", "nonce_value"
        ];
        cookiesToRemove.forEach(name => {
            document.cookie = name + "=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
        });
        endpoint_router('resetSession', { method: 'POST' })
            .then(() => location.reload())
            .catch(err => {
                console.error('Reset-session error:', err);
                showErrorToast('Session reset failed!');
            });
    };

    // ==========================================
    // Global Error Handlers
    // ==========================================

    // window.onerror: all traditional JS errors
    window.onerror = function(message, source, lineno, colno, error) {
        // Ignore harmless ResizeObserver warning
        if (message && message.includes("ResizeObserver loop")) {
            return true;
        }

        const msg = `[JS] ${message} (${source}:${lineno}:${colno})`;
        console.error(msg, error);
        showErrorToast(msg, 0); // duration 0 = manual dismiss for critical errors
        return false;
    };

    // window.onunhandledrejection: promise errors
    window.onunhandledrejection = function(event) {
        const msg = `[Promise] ${event.reason}`;
        console.error(msg, event);
        showErrorToast(msg); // default 7s auto-dismiss — permanent toasts are too aggressive
    };

    // ==========================================
    // Fetch Monkey-Patch (5xx + network errors)
    // ==========================================
    // Surfaces system-level (5xx) errors and network failures as error toasts.
    // All other cross-cutting concerns (fingerprint, CSRF, auth redirect)
    // are handled by the API pipeline stages in api_pipeline.js.

    const originalFetch = window.fetch;
    window.fetch = async function(resource, options = {}) {
        try {
            const response = await originalFetch(resource, options);

            // System-level error (5xx): error toast + console.error
            if (!response.ok && response.status >= 500) {
                const niceStatusMsg = getNiceStatusMessage(response.status);
                const shortUrl = shortenUrl(response.url, 160);
                const msg = `${niceStatusMsg} | ${shortUrl}`;
                console.error('[HTTP]', msg, response);
                showErrorToast(msg);
            }

            // 4xx passes through silently — endpoint_router or calling component handles it
            return response;
        } catch (err) {
            const ignoreAbortNoise = options?.headers?.['X-Ignore-Network-Abort'] === '1'
                || options?.headers?.['x-ignore-network-abort'] === '1';
            if ((pageUnloadInProgress || ignoreAbortNoise) && isAbortLikeNetworkError(err)) {
                throw err;
            }
            // Network failure or fetch parse error
            const msg = `[Network] ${err.message || err}`;
            console.error(msg, err);
            showErrorToast(msg);
            throw err;
        }
    };
})();
