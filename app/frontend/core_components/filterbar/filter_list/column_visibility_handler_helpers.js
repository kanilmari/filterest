// column_visibility_handler_helpers.js
// Pure helper functions extracted from column_visibility_handler.js for testability.
// Zero DOM access — all functions are pure input→output.

import { parseJsonSafely } from "../../state_stores/dataset_selection_saver_helpers.js";

/**
 * Build a sanitised CSS class name for a table column.
 * Strips whitespace and parentheses from both parts.
 *
 * @param {string} tableName
 * @param {string} columnName
 * @returns {string} Class name like `column_TableName_ColName`, or "" on bad input
 */
export function makeColumnClass(tableName, columnName) {
    if (!tableName || tableName.length < 1) {
        console.warn("tableName is empty");
        return "";
    }
    const sanitizedTableName = String(tableName ?? '')
        .replace(/\s+/g, '')
        .replace(/[()]/g, '');
    const sanitizedColumnName = String(columnName ?? '')
        .replace(/\s+/g, '')
        .replace(/[()]/g, '');
    return `column_${sanitizedTableName}_${sanitizedColumnName}`;
}

/**
 * Generate CSS rules that hide fields listed in hiddenMap.
 * Each rule targets the shared column class across table and card views so a
 * field set has one visibility meaning regardless of the active presentation.
 *
 * @param {Record<string, boolean>} hiddenMap - Keys are column names to hide
 * @param {string} tableName - Used to build per-column class names
 * @returns {string} Newline-joined CSS rule text (may be empty)
 */
export function buildCssHideRules(hiddenMap, tableName) {
    if (!hiddenMap || typeof hiddenMap !== 'object') return '';
    return Object.keys(hiddenMap)
        .map((originalColumnName) => {
            const cls = makeColumnClass(tableName, originalColumnName);
            if (!cls) return '';
            return `.${cls} { display: none !important; }`;
        })
        .filter(Boolean)
        .join("\n");
}

/**
 * Parse a JSON string into a hidden-columns map, returning {} on failure.
 *
 * @param {string|null} raw - Raw JSON string (e.g. from localStorage)
 * @returns {Record<string, boolean>}
 */
export function parseHiddenColumns(raw) {
    return parseJsonSafely(raw, {});
}

/**
 * Determine whether a column should be shown given a hidden-columns map.
 *
 * @param {Record<string, boolean>} hiddenMap
 * @param {string} columnName
 * @returns {boolean} true if the column is visible
 */
export function isColumnVisible(hiddenMap, columnName) {
    return !hiddenMap[columnName];
}
