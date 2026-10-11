// oid_updater.js
// Triggers the admin action that refreshes backend OIDs and table-name mappings.
// Bridges the OID update endpoint with lightweight frontend action handling.
// Exists to keep this maintenance action isolated from larger admin view builders.
// PIPELINE_EXCEPTION: /api/update-oids is a best-effort maintenance refresh that
// cancels on pagehide. Bootstrap first reads for drift and skips a current
// catalogue; changed/forced refreshes wait for policy mutations and reconcile. It is sent as POST because it rewrites stored
// catalog metadata; it borrows the pipeline's own token cache rather than
// keeping a second one.

import { get_endpoint_url } from '../../endpoints/endpoint_router.js';
import { ensureCsrfToken } from '../../pipeline/api_pipeline.js';

const OID_REFRESH_CACHE_KEY = 'easelect_oid_refresh_started_at';
const OID_REFRESH_TAB_SESSION_KEY = 'easelect_oid_refresh_started_this_tab_session';
const OID_REFRESH_MIN_INTERVAL_MS = 10 * 60 * 1000;

function readLastOidRefreshStartedAt() {
    try {
        const raw = window.localStorage.getItem(OID_REFRESH_CACHE_KEY);
        const parsed = Number.parseInt(raw || '', 10);
        return Number.isFinite(parsed) ? parsed : 0;
    } catch {
        return 0;
    }
}

function markOidRefreshStarted() {
    try {
        window.localStorage.setItem(OID_REFRESH_CACHE_KEY, String(Date.now()));
    } catch {
        // Ignore localStorage write failures in admin bootstrap.
    }

    try {
        window.sessionStorage.setItem(OID_REFRESH_TAB_SESSION_KEY, '1');
    } catch {
        // Ignore sessionStorage write failures in admin bootstrap.
    }
}

function wasOidRefreshAttemptedThisTabSession() {
    try {
        return window.sessionStorage.getItem(OID_REFRESH_TAB_SESSION_KEY) === '1';
    } catch {
        return false;
    }
}

function isAbortLikeMaintenanceFailure(error) {
    if (String(error?.name || '') === 'AbortError') {
        return true;
    }
    const message = String(error?.message || error || '');
    return /AbortError|NS_BINDING_ABORTED|NetworkError when attempting to fetch resource|Failed to fetch|Load failed/i.test(message);
}

function createOidRefreshAbortContext() {
    const abortController = new AbortController();
    const abortOnPageHide = () => {
        abortController.abort();
    };
    window.addEventListener('pagehide', abortOnPageHide, { once: true });

    return {
        signal: abortController.signal,
        cleanup() {
            window.removeEventListener('pagehide', abortOnPageHide);
        },
    };
}

async function fetchOidRefresh({ signal, onlyIfChanged = false } = {}) {
    const csrfToken = await ensureCsrfToken();
    const endpoint = get_endpoint_url('updateOids');
    // Ordinary bootstrap reads for drift before entering a policy mutation.
    // A forced maintenance refresh retains the complete reconciliation path.
    const url = onlyIfChanged ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}only_if_changed=true` : endpoint;
    const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'X-Ignore-Network-Abort': '1',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        signal,
    });

    if (response.ok) {
        return;
    }

    let responseText = '';
    try {
        responseText = await response.text();
    } catch {
        responseText = '';
    }

    throw new Error(responseText || `OID refresh failed (${response.status})`);
}

export async function update_oids_and_table_names({ force = false } = {}) {
    if (!force) {
        if (wasOidRefreshAttemptedThisTabSession()) {
            return;
        }
        const lastRefreshStartedAt = readLastOidRefreshStartedAt();
        if (lastRefreshStartedAt > 0 && (Date.now() - lastRefreshStartedAt) < OID_REFRESH_MIN_INTERVAL_MS) {
            return;
        }
    }

    markOidRefreshStarted();
    const abortContext = createOidRefreshAbortContext();

    try {
        await fetchOidRefresh({ signal: abortContext.signal, onlyIfChanged: !force });
    } catch (error) {
        if (isAbortLikeMaintenanceFailure(error)) {
            return;
        }
        console.warn('error updating OID values and table names:', error);
    } finally {
        abortContext.cleanup();
    }
}
