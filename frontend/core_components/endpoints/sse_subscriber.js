// sse_subscriber.js
// Manages one shared SSE connection for realtime dataset change notifications.
// Bridges backend row_change metadata events and the unified table refresh entrypoint.
// Exists to keep live-refresh subscription lifecycle centralized instead of scattering EventSource logic.
// PIPELINE_EXCEPTION: EventSource live-refresh subscriptions are long-lived streams, not request/response API calls.

import { refreshTableUnified } from "../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { getParams } from "../navigation/nav_engine/query_params.js";
import {
    do_intelligent_search,
    hasCachedSearchResults,
    rerenderCachedSearchResults,
} from "../filterbar/text_search/dataset_search_executor.js";
import { datasetSearchState } from "../filterbar/text_search/dataset_search_state_reader.js";

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
let pageUnloadInProgress = false;

function beginPageUnload() {
    pageUnloadInProgress = true;
    cleanupReconnectTimer();
    closeEventSource();
}

window.addEventListener("beforeunload", beginPageUnload);
window.addEventListener("pagehide", beginPageUnload);
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
        beginPageUnload();
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

function closeAllRefreshTimers() {
    for (const tableName of refreshDebounceTimers.keys()) {
        clearRefreshTimer(tableName);
    }
}

function scheduleDebouncedRefresh(tableName) {
    clearRefreshTimer(tableName);
    const timerID = setTimeout(() => {
        refreshDebounceTimers.delete(tableName);
        void refreshActiveDatasetSurface(tableName);
    }, REFRESH_DEBOUNCE_MS);
    refreshDebounceTimers.set(tableName, timerID);
}

async function refreshActiveDatasetSurface(tableName) {
    const committedSearchTerm = String(getParams(tableName)?.search || "").trim();
    if (committedSearchTerm) {
        await do_intelligent_search(tableName, committedSearchTerm);
        return;
    }

    const activeSearchTerm = String(datasetSearchState.get(tableName) || "").trim();
    if (activeSearchTerm && hasCachedSearchResults(tableName)) {
        await rerenderCachedSearchResults(tableName);
        return;
    }

    await refreshTableUnified(tableName, { skipUrlParams: true });
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

function connectIfNeeded() {
    cleanupReconnectTimer();
    closeEventSource();

    if (pageUnloadInProgress) {
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
    eventSource = new EventSource(streamURL);
    eventSource.addEventListener("row_change", handleRowChangeEvent);
    eventSource.onopen = () => {
        reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
    };
    eventSource.onerror = () => {
        closeEventSource();
        if (pageUnloadInProgress) {
            return;
        }
        scheduleReconnect();
    };
}

export function setSSEActiveDataset(datasetName) {
    const normalizedName = String(datasetName || "").trim();
    if (normalizedName === activeDatasetName) return;

    if (activeDatasetName !== "") {
        subscribedTables.delete(activeDatasetName);
        clearRefreshTimer(activeDatasetName);
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
        clearRefreshTimer(activeDatasetName);
    }
    activeDatasetName = "";
    connectIfNeeded();
}

export function getSSEActiveDataset() {
    return activeDatasetName;
}
