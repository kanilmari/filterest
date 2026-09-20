// oid_updater.js
// Triggers the admin action that refreshes backend OIDs and table-name mappings.
// Bridges the OID update endpoint with lightweight frontend action handling.
// Exists to keep this maintenance action isolated from larger admin view builders.
// PIPELINE_EXCEPTION: /api/update-oids is a best-effort maintenance refresh that
// needs a local AbortController timeout so slow catalog syncs do not prolong
// reloads or pagehide churn. It is sent as POST because it rewrites stored
// catalog metadata; it borrows the pipeline's own token cache rather than
// keeping a second one.

import { get_endpoint_url } from '../../endpoints/endpoint_router.js';
import { ensureCsrfToken } from '../../pipeline/api_pipeline.js';

const OID_REFRESH_CACHE_KEY = 'easelect_oid_refresh_started_at';
const OID_REFRESH_TAB_SESSION_KEY = 'easelect_oid_refresh_started_this_tab_session';
const OID_REFRESH_MIN_INTERVAL_MS = 10 * 60 * 1000;
const OID_REFRESH_TIMEOUT_MS = 8000;

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

function createOidRefreshAbortContext(timeoutMs = OID_REFRESH_TIMEOUT_MS) {
    const abortController = new AbortController();
    const abortOnPageHide = () => {
        abortController.abort();
    };

    const timeoutId = window.setTimeout(() => {
        abortController.abort();
    }, timeoutMs);

    window.addEventListener('pagehide', abortOnPageHide, { once: true });

    return {
        signal: abortController.signal,
        cleanup() {
            window.clearTimeout(timeoutId);
            window.removeEventListener('pagehide', abortOnPageHide);
        },
    };
}

async function fetchOidRefresh({ signal } = {}) {
    const csrfToken = await ensureCsrfToken();
    const response = await fetch(get_endpoint_url('updateOids'), {
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
        await fetchOidRefresh({ signal: abortContext.signal });
    } catch (error) {
        if (isAbortLikeMaintenanceFailure(error)) {
            return;
        }
        console.warn('error updating OID values and table names:', error);
    } finally {
        abortContext.cleanup();
    }
}
