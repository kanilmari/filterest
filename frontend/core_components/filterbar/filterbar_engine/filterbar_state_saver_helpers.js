// filterbar_state_saver_helpers.js
// Pure helper functions extracted from filterbar_state_saver.js for testability.
// Zero DOM access — all functions are pure input→output.

import { parseJsonSafely } from "../../state_stores/dataset_selection_saver_helpers.js";

const OPEN_KEY_SUFFIX = "_open_filters";
const OVERFLOW_EXPANDED_KEY_SUFFIX = "_overflow_filters_expanded";

/**
 * Build the localStorage key for a table's open filters.
 *
 * @param {string} tableName - The dataset/table name
 * @returns {string} The storage key
 */
export function buildOpenFiltersKey(tableName) {
    return `${tableName}${OPEN_KEY_SUFFIX}`;
}

/**
 * Build the localStorage key for a table's favefox overflow expanded/collapsed state.
 *
 * @param {string} tableName - The dataset/table name
 * @returns {string} The storage key
 */
export function buildOverflowExpandedKey(tableName) {
    return `${tableName}${OVERFLOW_EXPANDED_KEY_SUFFIX}`;
}

/**
 * Parse a JSON string into an opened-filters array.
 * Returns an empty array on invalid or falsy input.
 *
 * @param {string|null} jsonString - Raw localStorage value
 * @returns {Array} Parsed array or empty fallback
 */
export function parseOpenFilters(jsonString) {
    const parsed = parseJsonSafely(jsonString, []);
    return Array.isArray(parsed) ? parsed : [];
}

/**
 * Parse a JSON or string boolean for the favefox overflow expanded state.
 * Returns false on invalid or falsy input.
 *
 * @param {string|null|undefined} rawValue - Raw localStorage value
 * @returns {boolean} Parsed boolean or false fallback
 */
export function parseOverflowExpanded(rawValue) {
    if (rawValue === "true") {
        return true;
    }
    if (rawValue === "false" || rawValue === null || rawValue === undefined || rawValue === "") {
        return false;
    }

    return parseJsonSafely(rawValue, false) === true;
}

/**
 * Serialize an opened-filters array to JSON.
 *
 * @param {Array} opened - Array of opened filter identifiers
 * @returns {string} JSON string
 */
export function serializeOpenFilters(opened = []) {
    return JSON.stringify(opened);
}

/**
 * Serialize the favefox overflow expanded state to JSON.
 *
 * @param {boolean} isExpanded - Whether overflow filters are expanded
 * @returns {string} JSON boolean string
 */
export function serializeOverflowExpanded(isExpanded = false) {
    return JSON.stringify(Boolean(isExpanded));
}
