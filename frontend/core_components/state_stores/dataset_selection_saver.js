// dataset_selection_saver.js
// Reads and writes dataset selection state and redirect notices across storage layers.
// Bridges session/localStorage migration logic and dataset navigation state consumers.
// Exists to centralise dataset-selection persistence so callers do not duplicate storage fallback logic.

import {
    safeSetItem,
    safeGetItem,
    safeRemoveItem,
    parseJsonSafely,
    serializeJsonSafely,
    migrateToSession,
} from './dataset_selection_saver_helpers.js';

const STORAGE_KEYS = {
    selectedDataset: 'selected_dataset',
    initialQueryParams: 'initial_query_params',
    redirectNotice: 'datasetRedirectNotice',
};

// ---------- selected_dataset ----------

export function setSelectedDataset(datasetName) {
    if (!datasetName) return;
    safeSetItem(sessionStorage, STORAGE_KEYS.selectedDataset, datasetName);
    safeRemoveItem(localStorage, STORAGE_KEYS.selectedDataset);
}

export function getSelectedDataset() {
    return migrateToSession(sessionStorage, localStorage, STORAGE_KEYS.selectedDataset);
}

export function clearSelectedDataset() {
    safeRemoveItem(sessionStorage, STORAGE_KEYS.selectedDataset);
    safeRemoveItem(localStorage, STORAGE_KEYS.selectedDataset);
}

// ---------- initial_query_params ----------

export function setInitialQueryParams(paramsString) {
    if (paramsString == null) return;
    safeSetItem(sessionStorage, STORAGE_KEYS.initialQueryParams, paramsString);
    safeRemoveItem(localStorage, STORAGE_KEYS.initialQueryParams);
}

export function getInitialQueryParams() {
    return migrateToSession(sessionStorage, localStorage, STORAGE_KEYS.initialQueryParams);
}

export function clearInitialQueryParams() {
    safeRemoveItem(sessionStorage, STORAGE_KEYS.initialQueryParams);
    safeRemoveItem(localStorage, STORAGE_KEYS.initialQueryParams);
}

export function clearDatasetSelectionState() {
    clearSelectedDataset();
    clearInitialQueryParams();
}

// ---------- redirect notice (raw payload only) ----------

export function setRedirectNotice(noticeObject) {
    if (!noticeObject) return;
    const payload = serializeJsonSafely(noticeObject);
    if (payload) {
        safeSetItem(sessionStorage, STORAGE_KEYS.redirectNotice, payload);
    }
}

export function consumeRedirectNotice() {
    const raw = safeGetItem(sessionStorage, STORAGE_KEYS.redirectNotice);
    if (!raw) return null;
    safeRemoveItem(sessionStorage, STORAGE_KEYS.redirectNotice);
    return parseJsonSafely(raw, null);
}

export function clearRedirectNotice() {
    safeRemoveItem(sessionStorage, STORAGE_KEYS.redirectNotice);
}
