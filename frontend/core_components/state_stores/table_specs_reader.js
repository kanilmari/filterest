// table_specs_reader.js
// Provides the single source of truth for the table_specs metadata cache stored in localStorage.
// Between the nav tree data fetch writer and all components that read table metadata.
// Exists to centralize parsing, caching, and table_uid-to-dataset-name helpers while handling errors.

const STORAGE_KEY = 'table_specs';

/** @type {Object|null} In-memory cache. null = not loaded yet. */
let _cache = null;

/**
 * Loads and caches the parsed table_specs from localStorage.
 * On parse error, logs a warning and returns an empty object.
 * @returns {Object}
 */
function _ensureLoaded() {
    if (_cache !== null) return _cache;
    try {
        _cache = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (err) {
        console.warn('table_specs_store: parse error, resetting cache', err);
        _cache = {};
    }
    return _cache;
}

/**
 * Returns the spec object for a single table, or null if not found.
 * @param {string} tableName
 * @returns {Object|null}
 */
export function getTableSpec(tableName) {
    const specs = _ensureLoaded();
    return specs[tableName] || null;
}

/**
 * Returns the full specs map (all tables). Shallow copies to keep callers immutable.
 * @returns {Object}
 */
export function getAllSpecs() {
    return { ..._ensureLoaded() };
}

/**
 * Replaces the entire specs map (called after tree data fetch).
 * Writes to both in-memory cache and localStorage.
 * @param {Object} specsMap
 */
export function setAllSpecs(specsMap) {
    _cache = specsMap;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(specsMap));
    } catch (err) {
        console.warn('table_specs_store: failed to write to localStorage', err);
    }
}

/**
 * Resolves a table_uid to a dataset name; falls back to the uid string when missing.
 * @param {string|number} tableUid
 * @returns {string}
 */
export function getDatasetNameByUID(tableUid) {
    const specs = _ensureLoaded();
    for (const [name, info] of Object.entries(specs)) {
        if (String(info.table_uid) === String(tableUid)) {
            return name;
        }
    }
    return String(tableUid);
}

/**
 * Invalidates the in-memory cache; next read will re-parse from localStorage.
 */
export function invalidateCache() {
    _cache = null;
}
