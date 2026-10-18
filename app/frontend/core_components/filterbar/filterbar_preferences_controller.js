// filterbar_preferences_controller.js
// Loads one safe shared layout and the current account's existing preferences.
// Connects ordering and settings controls through a single change notification.
// Publishes successful writes, serializes edits and discards stale session responses.
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { registerEndpointRoute } from '../pipeline/api_pipeline.js';
import { hasRoutePermission } from '../route_permission_checker.js';
import { getSessionGeneration, subscribeToSessionGeneration, revalidateSessionIdentity } from '../auth/session_generation_store.js';
import { normalizeFilterbarSectionLayout, normalizeFilterbarSectionOrder } from './filterbar_section_layout_normalizer.js';

registerEndpointRoute('userFilterbarPreference', '/api/user-filterbar-preference');
let shared = normalizeFilterbarSectionLayout();
let personal = { order_mode: 'shared', visibility_memory: 'shared', own_order_allowed: false };
let loading = null;
let queuedRefresh = null;
let loaded = false;
let sharedRevision = 0;
let personalRevision = 0;
let writes = Promise.resolve();
const subscribers = new Set();
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('filterest-filterbar-layout') : null;
channel?.unref?.();
const authenticated = () => localStorage.getItem('button_state') === 'logout';

export function getFilterbarPreferences() {
    const own = authenticated() && personal.own_order_allowed && personal.order_mode === 'own';
    return {
        shared, personal, loaded, mode: own ? 'own' : 'shared',
        order: own ? normalizeFilterbarSectionOrder(personal.section_order) : shared.section_order,
        canEditShared: hasRoutePermission('/api/filterbar-section-layout/save'),
        ownAllowed: authenticated() && personal.own_order_allowed,
    };
}

export function canEditFilterbarOrder() {
    const state = getFilterbarPreferences();
    return loaded && (state.mode === 'own' || state.canEditShared);
}

export function subscribeFilterbarPreferences(callback) {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
}

function publish() { for (const callback of subscribers) callback(getFilterbarPreferences()); }

/** All roles load the public order; only signed-in users ask for an own choice. */
export function loadFilterbarPreferences({ refresh = false } = {}) {
    if (loading) {
        if (!refresh) return loading;
        if (!queuedRefresh) {
            const generation = getSessionGeneration();
            // Wait for cleanup even after failure. Only explicit refresh requests
            // enqueue a follow-up; concurrent requests share this one promise.
            queuedRefresh = loading.catch(() => {}).then(() => {
                if (generation !== getSessionGeneration()) return getFilterbarPreferences();
                queuedRefresh = null;
                return loadFilterbarPreferences({ refresh: true });
            });
        }
        return queuedRefresh;
    }
    if (loaded && !refresh) return Promise.resolve(getFilterbarPreferences());
    const generation = getSessionGeneration();
    const startedSharedRevision = sharedRevision;
    const startedPersonalRevision = personalRevision;
    const options = { suppressAuthRedirect: true, signal: AbortSignal.timeout(10000) };
    const pending = revalidateSessionIdentity().then(() => Promise.all([
        endpoint_router('getFilterbarSectionLayout', options),
        authenticated() ? endpoint_router('userFilterbarPreference', options).catch(error => {
            console.warn('filterbar personal preference unavailable', error);
            return null;
        }) : Promise.resolve(null),
    ])).then(([layout, preference]) => {
        if (generation !== getSessionGeneration()) return getFilterbarPreferences();
        // A committed write invalidates only its own store's pending read.
        if (sharedRevision === startedSharedRevision) shared = normalizeFilterbarSectionLayout(layout);
        if (personalRevision === startedPersonalRevision) {
            personal = preference || { order_mode: 'shared', visibility_memory: 'shared', own_order_allowed: false };
        }
        loaded = true;
        publish();
        return getFilterbarPreferences();
    }).finally(() => { if (loading === pending) loading = null; });
    loading = pending;
    return pending;
}

function enqueueWrite(route, method, patch, accept) {
    const generation = getSessionGeneration();
    const operation = writes.catch(() => {}).then(async () => {
        if (generation !== getSessionGeneration()) throw new DOMException('Session changed', 'AbortError');
        const response = await endpoint_router(route, { method, body_data: patch });
        if (generation !== getSessionGeneration()) throw new DOMException('Session changed', 'AbortError');
        accept(response);
        loaded = true;
        publish();
        channel?.postMessage('changed');
        return getFilterbarPreferences();
    });
    writes = operation;
    return operation;
}

export function saveSharedFilterbarLayout(patch) {
    return enqueueWrite('saveFilterbarSectionLayout', 'POST', patch,
        response => { sharedRevision += 1; shared = normalizeFilterbarSectionLayout(response); });
}

export function savePersonalFilterbarPreference(patch) {
    return enqueueWrite('userFilterbarPreference', 'PATCH', patch,
        response => { personalRevision += 1; personal = response; });
}

export function saveFilterbarOrder(order, collapsed = {}) {
    return getFilterbarPreferences().mode === 'own'
        ? savePersonalFilterbarPreference({ section_order: order })
        : saveSharedFilterbarLayout({ section_order: order,
            ...(Object.keys(collapsed).length ? { section_collapsed: collapsed } : {}) });
}

channel?.addEventListener('message', () => {
    void loadFilterbarPreferences({ refresh: true }).catch(error => console.warn('filterbar layout refresh failed', error));
});
subscribeToSessionGeneration(() => {
    sharedRevision += 1;
    personalRevision += 1;
    loaded = false;
    loading = null;
    queuedRefresh = null;
    personal = { order_mode: 'shared', visibility_memory: 'shared', own_order_allowed: false };
    publish();
});

if (typeof window !== 'undefined') window.addEventListener('focus', () => {
    if (subscribers.size) void loadFilterbarPreferences({ refresh: true }).catch(error => console.warn('filterbar layout refresh failed', error));
});
