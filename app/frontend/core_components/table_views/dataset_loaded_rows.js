// dataset_loaded_rows.js
// Keeps the committed row prefix on its owning dataset view container.
// Bridges a visible paginated result list and the article navigation list.
// Exists to transfer already loaded rows without replaying their page requests.
import { getUnifiedTableState } from "../state_stores/table_state_store.js";
import { getChosenDatasetView } from "../state_stores/dataset_view_choice_saver.js";
import { getDatasetListingSignature } from "../infinite_scroll/dataset_listing_filters.js";
import { subscribeDatasetAccessRegistry, hasDatasetAccessSnapshot, canReadDatasetFromRegistry } from "../navigation/nav_engine/dataset_access_registry.js";
import { getDatasetViewContainerId } from "./dataset_view_registry.js";

let lists = new WeakMap();
let transfers = new WeakMap();
let awaitingInitialAccess = !hasDatasetAccessSnapshot();
subscribeDatasetAccessRegistry(() => {
    // Initial row reads can finish before the first navigation access snapshot.
    // Keep that DOM-owned prefix, but never allow capture before a positive read
    // decision. Each later refresh discards prior snapshots on clear; its
    // accepted response must not discard new rows rendered during that refresh.
    if (!awaitingInitialAccess && !hasDatasetAccessSnapshot()) lists = new WeakMap();
    transfers = new WeakMap();
    if (hasDatasetAccessSnapshot()) awaitingInitialAccess = false;
});

// A remembered list belongs to the exact listing it came from: the same
// conditions (the committed search among them), order and language.
function signature(tableName, filters = getUnifiedTableState(tableName).filters) {
    const state = getUnifiedTableState(tableName);
    return JSON.stringify([getDatasetListingSignature(tableName, filters, state.sort), document.documentElement.lang]);
}

function uniqueRows(rows, previous = []) {
    const seen = new Set(previous.filter(row => row?.id != null).map(row => String(row.id)));
    return rows.filter(row => {
        if (row?.id == null) return true;
        const key = String(row.id);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function clearLoadedDatasetRows(container) {
    lists.delete(container);
}

/**
 * Remember the rows a view has just put on screen as the start of its list.
 * A committed search is one more condition of that list and part of its
 * signature, so a searched list is remembered like any other and never
 * crosses to a different search.
 */
export function rememberLoadedDatasetRows(container, tableName, result, projectionView) {
    if (!container) return;
    const data = uniqueRows(result.data || []);
    lists.set(container, {
        tableName, signature: signature(tableName), projectionView,
        result: { ...result, data }, offset: result.data?.length || 0,
    });
}

function currentList(container, tableName) {
    const entry = lists.get(container);
    return entry?.tableName === tableName && entry.signature === signature(tableName) ? entry : null;
}

/** Keep the current prefix when its first page resolves only row-group selection. */
export function rekeyLoadedDatasetRows(tableName, previousFilters) {
    const container = document.getElementById(getDatasetViewContainerId(getChosenDatasetView(tableName), tableName));
    const entry = lists.get(container);
    // A stale prefix must never become current through reconciliation. Keep its
    // rows, projection and raw offset untouched only when the old scope matches.
    if (entry?.tableName === tableName && entry.signature === signature(tableName, previousFilters)) {
        entry.signature = signature(tableName);
    }
}

export function getLoadedDatasetProjection(container, tableName) {
    return currentList(container, tableName)?.projectionView || null;
}

export function filterLoadedDatasetDuplicates(container, tableName, rows) {
    return uniqueRows(rows, currentList(container, tableName)?.result.data || []);
}

export function appendLoadedDatasetRows(container, tableName, rows, nextOffset) {
    const entry = currentList(container, tableName);
    if (!entry) return;
    entry.result.data = [...entry.result.data, ...uniqueRows(rows, entry.result.data)];
    entry.offset = nextOffset;
}

/** Only the currently visible, committed prefix may cross views. */
export function captureLoadedDatasetRows(tableName, { retainedCardReturn = false } = {}) {
    const activeView = getChosenDatasetView(tableName);
    if (retainedCardReturn && activeView !== "article_view") return null;
    const view = retainedCardReturn ? "card" : activeView;
    const container = document.getElementById(getDatasetViewContainerId(view, tableName));
    const entry = currentList(container, tableName);
    if (canReadDatasetFromRegistry(tableName) !== true
        || !entry || !container?.isConnected || container.hidden
        || getComputedStyle(container).display === "none"
        || !entry.result.data.length
        || (!retainedCardReturn && Number(getUnifiedTableState(tableName).offset) !== entry.offset)) return null;
    const token = Object.freeze({});
    transfers.set(token, { ...entry, result: { ...entry.result, data: [...entry.result.data] } });
    return token;
}

/** A query/language/access change makes an old handoff unusable. */
export function resolveLoadedDatasetRows(tableName, token) {
    const entry = token && transfers.get(token);
    if (canReadDatasetFromRegistry(tableName) !== true
        || !entry || entry.tableName !== tableName || entry.signature !== signature(tableName)
        || getChosenDatasetView(tableName) !== "article_view") return null;
    return entry;
}
