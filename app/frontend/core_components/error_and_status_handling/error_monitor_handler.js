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
// Its notices come from language keys and name no address; the address and the
// browser's own error text go to the console. A request whose caller shows its
// own notice is not given a second one: the API pipeline marks every request
// it sends, so the monitor's notices are for fetches outside the pipeline.
//
// Session reset is available via window.__resetSession() in the browser console
// for recovery from corrupted session state.
import { endpoint_router } from "../endpoints/endpoint_router.js";
import { showErrorToast } from "../../reusable_components/notifications/toast_notification_printer.js";
import { callerOwnsFailureNotice, shortenUrl } from "./error_monitor_handler_helpers.js";
import { isExpectedNetworkAbort, showRequestFailureNotice } from "./request_failure_notice.js";
// Imported as a side-effect module in main.js:
//   import "./core_components/error_and_status_handling/error_monitor_handler.js";

(function() {
    // ==========================================
    // Session Reset (recovery tool)
    // ==========================================
    // Exposed as window.__resetSession() for dev console recovery.
    // Calls the server-owned, instance-scoped reset endpoint. JavaScript must
    // not delete host-wide cookies because sibling instances may share a host.

    window.__resetSession = function() {
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
        let response;
        try {
            response = await originalFetch(resource, options);
        } catch (err) {
            // A cancelled request (its caller aborted it, the page is being
            // left, or it was expendable background work) is not a failure.
            if (isExpectedNetworkAbort(err, options)) {
                throw err;
            }
            // Network failure: the request never reached the service.
            console.error(`[Network] ${err.message || err}`, err);
            if (!callerOwnsFailureNotice(options)) {
                showRequestFailureNotice('network_error_notice');
            }
            throw err;
        }

        // System-level error (5xx): console.error with the address, and a
        // notice unless the caller shows its own. Handled after the try, so a
        // response that did arrive is never also reported as a network failure.
        if (!response.ok && response.status >= 500) {
            console.error('[HTTP]', `${response.status} | ${shortenUrl(response.url, 160)}`, response);
            if (!callerOwnsFailureNotice(options)) {
                showRequestFailureNotice('server_error_notice', { status: response.status });
            }
        }

        // 4xx passes through silently — endpoint_router or calling component handles it
        return response;
    };
})();
