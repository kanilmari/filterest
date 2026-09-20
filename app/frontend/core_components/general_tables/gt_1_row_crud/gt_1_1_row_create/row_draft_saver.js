// row_draft_saver.js
// Saves and restores safe scalar values from one dataset's add-row form.
// Bridges current column metadata, in-memory form state, and guarded local storage.
// Exists so refreshes preserve drafts without retaining attachments or credentials.

import {
    parseJsonSafely,
    safeGetItem,
    safeRemoveItem,
    safeSetItem,
    serializeJsonSafely,
} from "../../../state_stores/dataset_selection_saver_helpers.js";

const DRAFT_VERSION = 1;
const STORAGE_KEY_PREFIX = "filterest:add-row-draft:v1:";
const SENSITIVE_COLUMN_PART = /(^|_)(?:password|passwd|passphrase|credential|credentials|secret|token|api_key|private_key|client_secret|session_key|encryption_key|otp|pin)(_|$)/;

function normalizedColumnName(columnName) {
    return String(columnName || "")
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .trim()
        .toLowerCase();
}

function draftStorageKey(datasetName) {
    const normalizedDatasetName = String(datasetName || "").trim();
    if (!normalizedDatasetName) return "";
    return `${STORAGE_KEY_PREFIX}${encodeURIComponent(normalizedDatasetName)}`;
}

function resolveLocalStorage(storageOverride) {
    if (storageOverride !== undefined) return storageOverride;
    try {
        return globalThis.localStorage || null;
    } catch (_error) {
        return null;
    }
}

function isSafeDraftColumn(column) {
    const columnName = normalizedColumnName(column?.column_name);
    if (!columnName || SENSITIVE_COLUMN_PART.test(columnName)) return false;

    const dataType = String(column?.data_type || "").trim().toLowerCase();
    return dataType !== "bytea";
}

function isSafeDraftValue(value) {
    return typeof value === "string"
        || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value));
}

function collectSafeDraftValues(columns, formState) {
    const values = Object.create(null);
    if (!Array.isArray(columns) || !formState || typeof formState !== "object") {
        return values;
    }

    columns.forEach((column) => {
        if (!isSafeDraftColumn(column)) return;
        const columnName = String(column.column_name || "");
        if (!Object.prototype.hasOwnProperty.call(formState, columnName)) return;

        const value = formState[columnName];
        if (!isSafeDraftValue(value) || value === "") return;
        values[columnName] = value;
    });
    return values;
}

/**
 * Loads only fields that still exist in the current dataset description.
 *
 * @param {string} datasetName
 * @param {Array<Object>} columns
 * @param {Storage|null} [storageOverride]
 * @returns {Object<string, string|boolean|number>}
 */
export function loadRowCreationDraft(datasetName, columns, storageOverride) {
    const key = draftStorageKey(datasetName);
    if (!key) return Object.create(null);

    const rawDraft = safeGetItem(resolveLocalStorage(storageOverride), key);
    const storedDraft = parseJsonSafely(rawDraft, null);
    if (!storedDraft || storedDraft.version !== DRAFT_VERSION
        || !storedDraft.values || typeof storedDraft.values !== "object"
        || Array.isArray(storedDraft.values)) {
        return Object.create(null);
    }

    return collectSafeDraftValues(columns, storedDraft.values);
}

/**
 * Persists the current safe scalar fields and removes an empty draft.
 *
 * @param {string} datasetName
 * @param {Array<Object>} columns
 * @param {Object} formState
 * @param {Storage|null} [storageOverride]
 */
export function saveRowCreationDraft(datasetName, columns, formState, storageOverride) {
    const key = draftStorageKey(datasetName);
    if (!key) return;

    const storage = resolveLocalStorage(storageOverride);
    const values = collectSafeDraftValues(columns, formState);
    if (Object.keys(values).length === 0) {
        safeRemoveItem(storage, key);
        return;
    }

    const serializedDraft = serializeJsonSafely({
        version: DRAFT_VERSION,
        values,
    });
    if (serializedDraft !== null) {
        safeSetItem(storage, key, serializedDraft);
    }
}

/** Clears one dataset's draft without affecting any other dataset. */
export function clearRowCreationDraft(datasetName, storageOverride) {
    const key = draftStorageKey(datasetName);
    if (!key) return;
    safeRemoveItem(resolveLocalStorage(storageOverride), key);
}

/**
 * Creates ordinary form state whose top-level field updates are autosaved.
 * State writes always succeed even when browser storage is blocked or full.
 */
export function createDraftBackedFormState(
    datasetName,
    columns,
    initialValues = loadRowCreationDraft(datasetName, columns),
    storageOverride,
) {
    const formState = Object.assign(Object.create(null), initialValues);
    return new Proxy(formState, {
        set(target, property, value) {
            target[property] = value;
            saveRowCreationDraft(datasetName, columns, target, storageOverride);
            return true;
        },
        deleteProperty(target, property) {
            delete target[property];
            saveRowCreationDraft(datasetName, columns, target, storageOverride);
            return true;
        },
    });
}
