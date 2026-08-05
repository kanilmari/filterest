// dataset_search_state_reader.js
// Stores shared dataset-search cache, registry, and id generation helpers.
// Bridges URL param filters and unified table filter state into one active-filter snapshot.
// Exists to keep search state concerns isolated from UI rendering logic.
import { getParams } from "../../navigation/nav_engine/query_params.js";
import { getUnifiedTableState } from "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";

export const tableMetaCache = {}; // { [tableName]: { rowCount, hasGeo } }

export const datasetSearchRegistry = new Map();
export const datasetSearchIdCounters = new Map();
export const RESERVED_PARAM_KEYS = new Set([
    "sort_column",
    "sort_order",
    "offset",
    "search",
    "table",
    "lang",
    "view",
]);

export function getActiveFiltersSnapshot(tableName) {
    const stateFilters = getUnifiedTableState(tableName)?.filters || {};
    const params = getParams(tableName) || {};
    const paramFilters = {};

    Object.entries(params).forEach(([key, val]) => {
        if (RESERVED_PARAM_KEYS.has(String(key).toLowerCase())) return;
        if (val === "" || val == null) return;
        paramFilters[key] = val;
    });

    return { ...stateFilters, ...paramFilters };
}

export function normalizeVariantName(variantRaw) {
    return (String(variantRaw || "filterbar")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "") || "default");
}

export function generateDatasetSearchIdPrefix(tableName, variant, customPrefix) {
    if (customPrefix) {
        return customPrefix;
    }
    const normalizedVariant = normalizeVariantName(variant);
    const counterKey = `${tableName}__${normalizedVariant}`;
    const nextValue = (datasetSearchIdCounters.get(counterKey) || 0) + 1;
    datasetSearchIdCounters.set(counterKey, nextValue);
    return `${tableName}_${normalizedVariant}_dataset_search_${nextValue}`;
}

export class DatasetSearchStateManager {
    constructor() {
        this.entries = new Map();
    }

    ensureEntry(tableName) {
        if (!this.entries.has(tableName)) {
            this.entries.set(tableName, {
                value: "",
                initialized: false,
                subscribers: new Set(),
            });
        }
        return this.entries.get(tableName);
    }

    initialize(tableName, initialValue = "") {
        const entry = this.ensureEntry(tableName);
        if (!entry.initialized) {
            entry.value = typeof initialValue === "string"
                ? initialValue
                : String(initialValue ?? "");
            entry.initialized = true;
        }
        return entry.value;
    }

    get(tableName) {
        return this.ensureEntry(tableName).value;
    }

    set(tableName, nextValue = "", sourceId = null) {
        const entry = this.ensureEntry(tableName);
        const normalizedValue =
            typeof nextValue === "string"
                ? nextValue
                : String(nextValue ?? "");
        entry.initialized = true;
        if (entry.value === normalizedValue) {
            return entry.value;
        }
        entry.value = normalizedValue;
        entry.subscribers.forEach((callback) => {
            try {
                callback(entry.value, sourceId);
            } catch (err) {
                console.warn("datasetSearchState subscriber error", err);
            }
        });
        return entry.value;
    }

    subscribe(tableName, callback) {
        if (typeof callback !== "function") {
            return () => {};
        }
        const entry = this.ensureEntry(tableName);
        entry.subscribers.add(callback);
        try {
            callback(entry.value, null);
        } catch (err) {
            console.warn("datasetSearchState immediate callback error", err);
        }
        return () => entry.subscribers.delete(callback);
    }
}

export const datasetSearchState = new DatasetSearchStateManager();

export class DatasetSearchBooleanStateManager {
    constructor(defaultValue = false) {
        this.entries = new Map();
        this.defaultValue = Boolean(defaultValue);
    }

    ensureEntry(tableName) {
        if (!this.entries.has(tableName)) {
            this.entries.set(tableName, {
                value: this.defaultValue,
                initialized: false,
                subscribers: new Set(),
            });
        }
        return this.entries.get(tableName);
    }

    initialize(tableName, initialValue = this.defaultValue) {
        const entry = this.ensureEntry(tableName);
        if (!entry.initialized) {
            entry.value = Boolean(initialValue);
            entry.initialized = true;
        }
        return entry.value;
    }

    get(tableName) {
        return this.ensureEntry(tableName).value;
    }

    set(tableName, nextValue = this.defaultValue, sourceId = null) {
        const entry = this.ensureEntry(tableName);
        const normalizedValue = Boolean(nextValue);
        entry.initialized = true;
        if (entry.value === normalizedValue) {
            return entry.value;
        }
        entry.value = normalizedValue;
        entry.subscribers.forEach((callback) => {
            try {
                callback(entry.value, sourceId);
            } catch (err) {
                console.warn("datasetSearchBooleanState subscriber error", err);
            }
        });
        return entry.value;
    }

    subscribe(tableName, callback) {
        if (typeof callback !== "function") {
            return () => {};
        }
        const entry = this.ensureEntry(tableName);
        entry.subscribers.add(callback);
        try {
            callback(entry.value, null);
        } catch (err) {
            console.warn(
                "datasetSearchBooleanState immediate callback error",
                err
            );
        }
        return () => entry.subscribers.delete(callback);
    }
}

export const datasetSearchLocationState =
    new DatasetSearchBooleanStateManager(false);

export function shouldRenderLocationCheckbox(tableName) {
    return tableMetaCache[tableName]?.hasGeo === true;
}

export function registerDatasetSearchComponent(tableName, component) {
    if (!datasetSearchRegistry.has(tableName)) {
        datasetSearchRegistry.set(tableName, new Set());
    }
    datasetSearchRegistry.get(tableName).add(component);
}

export function getDatasetSearchInputs(tableName) {
    const components = datasetSearchRegistry.get(tableName);
    if (!components) return [];
    return Array.from(components).map((component) => component.input);
}
