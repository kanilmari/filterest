// card_article_return_state.js
// Retains one mounted card list while its classic article is open.
// Bridges history entry identity, existing scroll retention and view metadata.
// Exists to return to the same rows and viewport without rebuilding their DOM.

import { ensureHistoryEntryId, HISTORY_ENTRY_ID, writeHistoryEntry } from "./history_entry_state.js";
import { captureDatasetScrollState, restoreDatasetScrollState } from "./dataset_scroll_retention.js";
import { subscribeDatasetAccessRegistry } from "./dataset_access_registry.js";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";

let retained = null;
const metadataKeys = ["columns", "dataTypes", "tableMeta"];

function querySignature(url) {
    const params = new URL(url, window.location.origin).searchParams;
    params.delete("view");
    params.delete("offset");
    return JSON.stringify([...params].sort(([a], [b]) => a.localeCompare(b)));
}

export function invalidateCardArticleReturn(datasetName = null) {
    if (!datasetName || retained?.datasetName === datasetName) retained = null;
}

subscribeDatasetAccessRegistry(() => {
    // The retained hidden surface is ours; release its protected rows on auth
    // invalidation, even when the normal visible-view cleanup runs elsewhere.
    if (retained?.host.style.display === "none") retained.host.replaceChildren();
    invalidateCardArticleReturn();
});

function validRecord(datasetName) {
    const record = retained;
    if (!record || record.datasetName !== datasetName) return null;
    const cache = record.adapter.readSearchCache();
    if (!record.root.isConnected || !record.host.isConnected
        || !record.host.contains(record.cardRoot)
        || record.language !== document.documentElement.lang
        || querySignature(window.location.href) !== record.signature
        || (record.query && (cache !== record.searchCache || cache?.complete !== true))) {
        invalidateCardArticleReturn(datasetName);
        return null;
    }
    return record;
}

// The caller resolves aliases; this module must not import the app/API graph.
function prepareCardReturnOrigin(listPath) {
    if (typeof listPath !== "string" || !listPath.startsWith("/")) return false;
    const current = new URL(window.location.href);
    const list = new URL(listPath, window.location.origin);
    if (list.origin !== current.origin || list.search || list.hash) return false;
    const isList = current.pathname === list.pathname;
    const rowSegment = current.pathname.startsWith(list.pathname + "/")
        ? current.pathname.slice(list.pathname.length + 1) : "";
    if (!isList && !/^\d+(?:-[^/]*)?$/.test(rowSegment)) return false;
    const state = history.state || {};
    const hasArticleState = state.bigCard === true
        || ["rowId", "articleOriginEntry", "articleReturnAvailable"].some(key => Object.hasOwn(state, key));
    const view = current.searchParams.get("view");
    if (isList && (!view || view === "card") && !hasArticleState) return true;
    // Repair only the entry describing this already-visible list. Replacing
    // keeps its identity and unrelated owners; opening the article then pushes.
    current.pathname = list.pathname;
    current.searchParams.set("view", "card");
    writeHistoryEntry(current.pathname + current.search + current.hash, {}, { replace: true });
    return true;
}

export function captureCardArticleReturn(datasetName, adapter) {
    if ((localStorage.getItem(`${datasetName}_view`) || "card") !== "card") return null;
    const root = document.getElementById(`${datasetName}_container`);
    const host = document.getElementById(`${datasetName}_card_view_container`);
    const cardRoot = host?.querySelector(".card_view_wrapper");
    const query = new URLSearchParams(window.location.search).get("search")?.trim() || "";
    const searchCache = adapter.readSearchCache();
    // Retain the already committed prefix, not the pending page request.
    // The transition disconnects pagination and its generation guard discards
    // that late response; resuming starts again at the committed offset.
    const pagination = { ...adapter.readPagination(), isLoading: false };
    // An incomplete intelligent-search stream is not a stable return surface.
    if (!root?.isConnected || !cardRoot?.isConnected || root.classList.contains("hidden")
        || host.hidden || getComputedStyle(host).display === "none"
        || root.querySelector(".tab_parts_container")?.dataset.view !== "card"
        || (query && (searchCache?.query !== query || searchCache?.complete !== true))) {
        invalidateCardArticleReturn();
        return null;
    }
    if (!prepareCardReturnOrigin(adapter.listPath)) {
        invalidateCardArticleReturn();
        return null;
    }
    captureDatasetScrollState(root);
    const topControls = document.getElementById(`${datasetName}_card_top_controls`);
    retained = {
        token: Object.freeze({}), datasetName, root, host, cardRoot, adapter,
        entryId: ensureHistoryEntryId(), pathname: window.location.pathname,
        signature: querySignature(window.location.href),
        language: document.documentElement.lang, query, searchCache, pagination,
        state: getUnifiedTableState(datasetName),
        metadata: metadataKeys.map(key => [key, localStorage.getItem(`${datasetName}_${key}`)]),
        topControls, controlsParent: topControls?.parentElement || null,
    };
    return retained.token;
}

/** Explicit token only; ordinary generation never preserves old rows. */
export function shouldPreserveCardReturnHost(datasetName, token, host) {
    const record = validRecord(datasetName);
    return Boolean(record && token === record.token && host === record.host);
}

export function getCardArticleReturnToken(datasetName) {
    const record = validRecord(datasetName);
    if (!record) return null;
    const state = history.state || {};
    return state[HISTORY_ENTRY_ID] === record.entryId || state.articleOriginEntry === record.entryId
        ? record.token : null;
}

/** Forward leaves an already-restored card list at its latest scroll/page. */
export function refreshCardArticleReturnViewport(datasetName) {
    const record = validRecord(datasetName);
    if (!record || localStorage.getItem(datasetName + "_view") !== "card"
        || record.host.style.display === "none") return;
    const pagination = { ...record.adapter.readPagination(), isLoading: false };
    captureDatasetScrollState(record.root);
    record.pagination = pagination;
    record.state = getUnifiedTableState(datasetName);
}

export function getCardArticleOriginEntry(datasetName) {
    return getCardArticleReturnToken(datasetName) ? retained.entryId : null;
}

export function canRestoreCardArticleReturn(datasetName) {
    const record = validRecord(datasetName);
    return Boolean(record && window.location.pathname === record.pathname
        && history.state?.[HISTORY_ENTRY_ID] === record.entryId
        && !history.state?.bigCard);
}

/** Caller has already passed the ordinary dirty and permission pipeline stages. */
export function restoreCardArticleReturn(datasetName) {
    if (!canRestoreCardArticleReturn(datasetName)) return false;
    const record = retained;
    record.adapter.disconnectPagination();
    localStorage.setItem(`${datasetName}_view`, "card");
    for (const [key, value] of record.metadata) {
        if (value === null) localStorage.removeItem(`${datasetName}_${key}`);
        else localStorage.setItem(`${datasetName}_${key}`, value);
    }
    setUnifiedTableState(datasetName, record.state);
    record.root.querySelectorAll(".scrollable_content").forEach(host => {
        host.style.display = host === record.host ? "block" : "none";
    });
    record.root.querySelector(".tab_parts_container")?.setAttribute("data-view", "card");
    record.root.classList.remove("hidden");
    if (record.topControls?.isConnected && record.controlsParent?.isConnected) {
        // Keep the count and filters above the retained rows as pagination grows them.
        record.controlsParent.insertBefore(record.topControls, record.cardRoot);
    }
    document.getElementById(`${datasetName}_filterBar_panel`)?.__syncActiveView?.();
    record.adapter.syncResultsCount(record.query, record.searchCache, record.pagination.lastRowCount);
    restoreDatasetScrollState(record.root);
    if (!record.query) record.adapter.resumePagination(record.pagination);
    return true;
}
