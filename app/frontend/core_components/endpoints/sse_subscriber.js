// sse_subscriber.js
// Manages one shared SSE connection for realtime dataset change notifications.
// Bridges backend row_change metadata events and the unified table refresh entrypoint.
// Exists to keep live-refresh subscription lifecycle centralized instead of scattering EventSource logic.
// PIPELINE_EXCEPTION: The stream and its status probe share the SSE admission endpoint;
// the API pipeline would consume a never-ending stream and redirect on denial.

import { refreshTableUnified } from "../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { getParams } from "../navigation/nav_engine/query_params.js";
import {
    do_intelligent_search,
    hasCachedSearchResults,
    rerenderCachedSearchResults,
} from "../filterbar/text_search/dataset_search_executor.js";
import { datasetSearchState } from "../filterbar/text_search/dataset_search_state_reader.js";

import { hasOpenInlineEditor, getInlineEditorGeneration, setHeldInlineChange,
    subscribeToInlineEditorClose, discardInlineEditors } from '../general_tables/gt_1_row_crud/gt_1_3_row_update/inline_editor_state.js';
import { preserveTableRefreshSelection } from '../table_views/table_view/table_refresh_selection.js';
import { subscribeToSessionGeneration } from '../auth/session_generation_store.js';

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;
const REFRESH_DEBOUNCE_MS = 180;
const SSE_SUBSCRIBE_PATH = "/api/sse/subscribe";

let activeDatasetName = "";
let subscribedTables = new Set();
let eventSource = null;
let reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
let reconnectTimer = null;
const refreshDebounceTimers = new Map();
const refreshRequests = new Map();
let pageUnloadInProgress = false;
let documentSuspended = document.visibilityState === 'hidden';
let resumeAfterPermissionRefresh = false;
let sessionEnded = false;
let permissionDenied = false;
let awaitingPermissionRefresh = false;
let connectionGeneration = 0;
let statusProbe = null;

function cancelStatusProbe() {
    connectionGeneration += 1;
    statusProbe?.abort();
    statusProbe = null;
}

// Focus/visibility changes are not evidence that rights changed. Only the
// existing auth invalidation/bootstrap cycle can release a denied subscription.
subscribeToSessionGeneration(reason => {
    if (!['login', 'logout', 'expiry', 'session-change', 'session-invalidated', 'bootstrap'].includes(reason)) return;
    awaitingPermissionRefresh = true;
    resumeAfterPermissionRefresh = false;
    permissionDenied = false;
    sessionEnded = false;
    cleanupReconnectTimer();
    closeAllRefreshTimers();
    discardInlineEditors();
    closeEventSource();
    cancelStatusProbe();
});
window.addEventListener('routePermissionsRefreshed', () => {
    awaitingPermissionRefresh = false;
    permissionDenied = false;
    sessionEnded = false;
    reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
    resumeAfterPermissionRefresh = documentSuspended;
    if (!documentSuspended) connectIfNeeded();
});

function beginPageUnload() {
    pageUnloadInProgress = true;
    resumeAfterPermissionRefresh = false;
    cancelStatusProbe();
    cleanupReconnectTimer();
    closeEventSource();
}

window.addEventListener("beforeunload", beginPageUnload);
window.addEventListener("pagehide", beginPageUnload);
document.addEventListener("visibilitychange", () => {
    documentSuspended = document.visibilityState === 'hidden';
    if (documentSuspended) {
        // Backgrounding pauses transport; it is not an actual page unload or
        // evidence that the viewer's rights changed.
        cancelStatusProbe();
        cleanupReconnectTimer();
        closeEventSource();
    } else if (resumeAfterPermissionRefresh) {
        resumeAfterPermissionRefresh = false;
        connectIfNeeded();
    }
});

window.addEventListener("pageshow", () => {
    pageUnloadInProgress = false;
});

function browserHasAuthenticatedSession() {
    return localStorage.getItem("button_state") === "logout";
}

function cleanupReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
}

function closeEventSource() {
    if (!eventSource) return;
    eventSource.close();
    eventSource = null;
}

function clearRefreshTimer(tableName) {
    const timerID = refreshDebounceTimers.get(tableName);
    if (!timerID) return;
    clearTimeout(timerID);
    refreshDebounceTimers.delete(tableName);
}

function dropRefresh(tableName) {
    clearRefreshTimer(tableName);
    refreshRequests.delete(tableName);
    setHeldInlineChange(tableName, false);
}

function closeAllRefreshTimers() {
    for (const tableName of new Set([...refreshDebounceTimers.keys(), ...refreshRequests.keys()])) {
        dropRefresh(tableName);
    }
}

function scheduleDebouncedRefresh(tableName) {
    let request = refreshRequests.get(tableName);
    if (!request) refreshRequests.set(tableName, request = { held: false, running: 0 });
    request.held = true;
    setHeldInlineChange(tableName, true);
    clearRefreshTimer(tableName);
    // Nonediting viewers retain the ordinary debounce, even during a request.
    // Unified refresh generations supersede older answers as on the normal path.
    if (hasOpenInlineEditor(tableName)) return;
    queueRefresh(tableName, REFRESH_DEBOUNCE_MS);
}

function queueRefresh(tableName, delay = 0) {
    clearRefreshTimer(tableName);
    refreshDebounceTimers.set(tableName, setTimeout(() => {
        refreshDebounceTimers.delete(tableName);
        void refreshActiveDatasetSurface(tableName);
    }, delay));
}

subscribeToInlineEditorClose(tableName => {
    const request = refreshRequests.get(tableName);
    if (request?.held && !request.running && !hasOpenInlineEditor(tableName)) queueRefresh(tableName);
});

async function refreshActiveDatasetSurface(tableName) {
    const request = refreshRequests.get(tableName);
    if (!request || hasOpenInlineEditor(tableName)) return;
    request.running += 1;
    request.held = false;
    const editorGeneration = getInlineEditorGeneration(tableName);
    let yielded = false;
    let finished = false;
    // Both the fetch answer and the final asynchronous view build must yield.
    // Remember the yield even if the editor closes before the answer arrives.
    const isCurrent = () => {
        if (refreshRequests.get(tableName) !== request || activeDatasetName !== tableName) return false;
        // Completed search caches have no pending inline-view swap to hold.
        if (finished) return !yielded;
        if (getInlineEditorGeneration(tableName) !== editorGeneration || hasOpenInlineEditor(tableName)) {
            yielded = true;
            request.held = true;
            setHeldInlineChange(tableName, true);
        }
        return !yielded;
    };
    const renderOptions = { isCurrent, beforeSwap: preserveTableRefreshSelection };
    try {
        const committedSearchTerm = String(getParams(tableName)?.search || "").trim();
        if (committedSearchTerm) {
            await do_intelligent_search(tableName, committedSearchTerm, {}, renderOptions);
        } else {
            const activeSearchTerm = String(datasetSearchState.get(tableName) || "").trim();
            if (activeSearchTerm && hasCachedSearchResults(tableName)) {
                await rerenderCachedSearchResults(tableName, null, renderOptions);
            } else {
                await refreshTableUnified(tableName, { skipUrlParams: true, ...renderOptions });
            }
        }
    } catch (error) {
        console.warn('sse_subscriber: dataset refresh failed', error);
    } finally {
        finished = true;
        request.running -= 1;
        // An older generation can finish before checking the editor guard.
        // Keep unseen changes marked until every outstanding run has finished.
        if (refreshRequests.get(tableName) === request) setHeldInlineChange(tableName, request.held || request.running > 0);
        if (refreshRequests.get(tableName) === request && request.held && !request.running
            && !refreshDebounceTimers.has(tableName) && !hasOpenInlineEditor(tableName)) {
            queueRefresh(tableName);
        }
    }
}

function currentTableQueryString() {
    const tables = Array.from(subscribedTables).sort();
    if (tables.length === 0) return "";
    // Use the existing multi-dataset ACL query shape so backend access control
    // can validate every subscribed dataset without special SSE-only rules.
    return `datasets=${encodeURIComponent(tables.join(","))}`;
}

function scheduleReconnect() {
    cleanupReconnectTimer();
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectIfNeeded();
    }, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_DELAY_MS);
}

function handleRowChangeEvent(event) {
    if (sessionEnded || permissionDenied || awaitingPermissionRefresh) return;
    let payload = null;
    try {
        payload = JSON.parse(event.data);
    } catch (error) {
        console.warn("sse_subscriber: failed to parse row_change payload", error);
        return;
    }

    const tableName = String(payload?.table || "").trim();
    if (tableName === "" || tableName !== activeDatasetName) {
        return;
    }
    scheduleDebouncedRefresh(tableName);
}

function handleSessionEndedEvent() {
    // Stop this page's stream without changing the shared sign-in flow. The
    // next request will meet the normal authentication boundary.
    sessionEnded = true;
    cancelStatusProbe();
    cleanupReconnectTimer();
    closeAllRefreshTimers();
    discardInlineEditors();
    closeEventSource();
}

function connectIfNeeded() {
    cancelStatusProbe();
    cleanupReconnectTimer();
    closeEventSource();

    if (pageUnloadInProgress || documentSuspended || sessionEnded || permissionDenied || awaitingPermissionRefresh) {
        return;
    }

    if (!browserHasAuthenticatedSession()) {
        closeAllRefreshTimers();
        reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
        return;
    }

    const queryString = currentTableQueryString();
    if (queryString === "") {
        closeAllRefreshTimers();
        reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
        return;
    }

    const streamURL = `${SSE_SUBSCRIBE_PATH}?${queryString}`;
    const streamGeneration = connectionGeneration;
    const source = new EventSource(streamURL);
    eventSource = source;
    eventSource.addEventListener("row_change", event => { if (connectionGeneration === streamGeneration) handleRowChangeEvent(event); });
    eventSource.addEventListener("session_ended", () => { if (connectionGeneration === streamGeneration) handleSessionEndedEvent(); });
    eventSource.onopen = () => {
        if (eventSource !== source) return;
        reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
    };
    eventSource.onerror = () => {
        if (eventSource !== source) return;
        closeEventSource();
        if (pageUnloadInProgress || documentSuspended || sessionEnded || permissionDenied || awaitingPermissionRefresh) {
            return;
        }
        void checkSubscriptionStatus(streamURL);
    };
}

/** EventSource hides HTTP status. Probe the same admission URL once after failure,
 * cancel its body immediately, and stop this session on an authoritative denial.
 * A changed dataset/auth generation owns a different connection, so late status
 * responses may never block or reconnect it.
 */
async function checkSubscriptionStatus(streamURL) {
    const generation = connectionGeneration;
    const controller = new AbortController();
    statusProbe = controller;
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
        const response = await fetch(streamURL, {
            credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        if (generation !== connectionGeneration) return;
        if ([401, 403].includes(response.status)) {
            permissionDenied = true;
            closeAllRefreshTimers();
            discardInlineEditors();
        }
        await response.body?.cancel();
    } catch {
        // Transport failure retains the established backoff, without a noise loop.
    } finally {
        clearTimeout(timeout);
        controller.abort();
        if (statusProbe === controller) statusProbe = null;
        if (generation === connectionGeneration && !pageUnloadInProgress && !documentSuspended && !sessionEnded
            && !permissionDenied && !awaitingPermissionRefresh) scheduleReconnect();
    }
}

export function setSSEActiveDataset(datasetName) {
    const normalizedName = String(datasetName || "").trim();
    if (normalizedName === activeDatasetName) return;

    if (activeDatasetName !== "") {
        subscribedTables.delete(activeDatasetName);
        dropRefresh(activeDatasetName);
        discardInlineEditors(document.getElementById(`${activeDatasetName}_container`));
    }

    activeDatasetName = normalizedName;
    if (activeDatasetName !== "") {
        subscribedTables.add(activeDatasetName);
    }
    connectIfNeeded();
}

export function clearSSEActiveDataset() {
    if (activeDatasetName !== "") {
        subscribedTables.delete(activeDatasetName);
        dropRefresh(activeDatasetName);
        discardInlineEditors(document.getElementById(`${activeDatasetName}_container`));
    }
    activeDatasetName = "";
    connectIfNeeded();
}

export function getSSEActiveDataset() {
    return activeDatasetName;
}
