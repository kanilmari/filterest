// session_generation_store.js
// Owns the browser document's session generation and verified browsing identity.
// Bridges mandatory session invalidation, Home visits and identity checks on resume.
// Keeps optional automatic login synchronization separate from privacy invalidation.

import { subscribeToAuthBroadcast, publishAuthInvalidation } from './auth_broadcast.js';

let generation = 0;
let identity = null;
let needsValidation = false;
let validation = null;
const subscribers = new Set();

export function getSessionGeneration() { return generation; }
export function isSessionValidationRequired() { return needsValidation; }

/** Invalidate synchronously, before any bootstrap await or new identity read. */
export function invalidateSessionGeneration({ reason = 'session-change', revalidate = true } = {}) {
    generation += 1;
    identity = null;
    needsValidation = revalidate;
    validation?.controller.abort();
    validation = null;
    for (const subscriber of subscribers) subscriber(reason);
}

export function subscribeToSessionGeneration(subscriber) {
    subscribers.add(subscriber);
    return () => subscribers.delete(subscriber);
}

/** The facade names its actual viewer; never accept another account's response. */
export function acceptSessionIdentity(viewerID, expectedGeneration) {
    if (generation !== expectedGeneration || needsValidation) return false;
    if (!Number.isInteger(viewerID) || viewerID < 1) return false;
    if (identity !== null && identity !== viewerID) {
        invalidateSessionGeneration();
        return false;
    }
    identity = viewerID;
    return true;
}

/** Publish privacy invalidation for every successful login, even with sync off. */
export function publishSessionChange(reason) {
    invalidateSessionGeneration({ reason });
    publishAuthInvalidation({ reason });
}

/** A cold bootstrap is already validated. A resumed document must ask the server
 * before Home can reuse visible content or issue a new facade request.
 */
export function revalidateSessionIdentity() {
    if (!needsValidation) return Promise.resolve(generation);
    if (validation) return validation.promise;
    const checking = { generation, controller: new AbortController(), promise: null };
    validation = checking;
    const timeout = setTimeout(() => checking.controller.abort(), 15000);
    checking.promise = (async () => {
        // Lazy import avoids a cycle with the pipeline's own invalidation stage.
        const { endpoint_router } = await import('../endpoints/endpoint_router.js');
        const options = { signal: checking.controller.signal, suppressErrorToast: true,
            suppressAuthRedirect: true };
        const modes = await endpoint_router('fetchAuthModes', options);
        if (!['login', 'logout'].includes(modes?.needs_button)) throw new Error('session_unverified');
        let viewerID = 1;
        if (modes.needs_button === 'logout') {
            const profile = await endpoint_router('fetchUserProfile', options);
            viewerID = profile?.user_id;
            if (!Number.isInteger(viewerID) || viewerID <= 1) throw new Error('session_unverified');
        } else if (modes.login_required_for_browse) {
            throw new Error('session_ended');
        }
        if (generation !== checking.generation || checking.controller.signal.aborted) {
            throw new DOMException('Session changed', 'AbortError');
        }
        identity = viewerID;
        needsValidation = false;
        return generation;
    })().finally(() => {
        clearTimeout(timeout);
        if (validation === checking) validation = null;
    });
    return checking.promise;
}

// This subscriber is registered by the API pipeline before optional login sync.
subscribeToAuthBroadcast(event => {
    if (['login', 'logout', 'session-invalidated'].includes(event?.type)) {
        invalidateSessionGeneration({ reason: event.type });
    }
});

if (typeof window !== 'undefined') {
    window.addEventListener('blur', () => invalidateSessionGeneration({ reason: 'suspend' }));
    window.addEventListener('focus', () => invalidateSessionGeneration({ reason: 'resume' }));
    window.addEventListener('pageshow', event => {
        if (event.persisted) invalidateSessionGeneration({ reason: 'resume' });
    });
    document.addEventListener('visibilitychange', () => {
        invalidateSessionGeneration({ reason: document.hidden ? 'suspend' : 'resume' });
    });
}
