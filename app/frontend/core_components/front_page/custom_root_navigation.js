// custom_root_navigation.js
// Hands Home navigation to the server when its custom document is ready.
// Connects the existing auth bootstrap with Home links and history restoration.
// Uses tab memory, never persisted flags, to prevent stale settings and reload loops.

export const HOME_DEPARTURE_RETRY_AFTER_MS = 10000;

let enabled = false;
let departure = null;
let pendingGuard = null;

function resetDeparture() {
    departure?.cleanup?.();
    departure = null;
}

/** Recover only this terminal attempt, never a newer departure after a cache return. */
function navigateDocument(replace) {
    const attempt = { startedAt: performance.now() };
    departure = attempt;
    const recover = () => { if (departure === attempt) resetDeparture(); };
    try {
        if (typeof window.navigation?.navigate === 'function') {
            const navigation = window.navigation;
            // The event's abort signal also covers cancellation independently of
            // the API method's promises. Capture only this synchronous navigate event.
            const observe = event => {
                const signal = event.signal;
                signal.addEventListener('abort', recover, { once: true });
                attempt.cleanup = () => signal.removeEventListener('abort', recover);
            };
            navigation.addEventListener('navigate', observe, { once: true });
            let result;
            // Timers, focus and beforeunload also run during slow accepted loads,
            // so none of those events proves that the departure was cancelled.
            try { result = navigation.navigate('/', { history: replace ? 'replace' : 'push' }); }
            finally { navigation.removeEventListener('navigate', observe); }
            // Both promises can reject; observe both without awaiting document replacement.
            void result.committed.catch(recover);
            // A terminal success that keeps this document alive must also allow retry.
            // Committed alone is insufficient: the accepted load may still be pending.
            void result.finished.then(recover, recover);
        } else {
            // Older browsers retain document loading and duplicate suppression.
            // Only a later deliberate Home activation can retry without browser signals.
            if (replace) window.location.replace('/');
            else window.location.assign('/');
        }
    } catch (error) { recover(); throw error; }
}

// Back/Forward may restore this SPA document from the browser's page cache.
// Its previous departure has finished; a new Home click must navigate again.
if (typeof window !== 'undefined') window.addEventListener('pageshow', event => {
    if (event.persisted) resetDeparture();
});

/** Accept only the server's effective readiness from the current auth bootstrap. */
export function setCustomRootEnabled(value) {
    enabled = value === true;
    if (!enabled) { resetDeparture(); pendingGuard = null; }
}

export function isCustomRootEnabled() { return enabled; }

export function isRootAuthEntry() {
    const params = new URLSearchParams(window.location.search);
    return window.location.pathname === '/'
        && (params.get('login-entry') === '1' || params.get('register-entry') === '1');
}

/** History already moved to root: replace that entry before any SPA restoration. */
export function loadCustomRootFromHistory() {
    if (window.location.pathname !== '/' || isRootAuthEntry()) return Promise.resolve(false);
    return loadCustomRoot({ replace: true,
        isCurrentNavigation: () => window.location.pathname === '/' && !isRootAuthEntry() });
}

/** Handle custom Home without rendering the SPA, including refused departures. */
export async function loadCustomRoot({ replace = false, isCurrentNavigation, userActivation = false } = {}) {
    if (!enabled) return false;
    if (departure) {
        // A dropped navigation can leave no page-visible terminal signal. Keep the
        // latch until a NEW Home activation after the threshold, never a timer.
        // On a genuinely slow load this restarts the same document navigation.
        if (!userActivation || performance.now() - departure.startedAt < HOME_DEPARTURE_RETRY_AFTER_MS) return true;
        resetDeparture();
    }
    if (pendingGuard) return pendingGuard.promise;
    const attempt = { promise: null };
    pendingGuard = attempt;
    attempt.promise = Promise.resolve().then(async () => {
        // This is the same hook used by navigation_pipeline's dirtyCheck stage.
        // Keep concurrent Home clicks behind one confirmation, before latching.
        if (typeof window.check_manage_permissions_dirty === 'function'
            && !await window.check_manage_permissions_dirty()) return true;
        if (!enabled || pendingGuard !== attempt || isCurrentNavigation?.() === false) return true;
        navigateDocument(replace);
        return true;
    }).finally(() => { if (pendingGuard === attempt) pendingGuard = null; });
    return attempt.promise;
}
