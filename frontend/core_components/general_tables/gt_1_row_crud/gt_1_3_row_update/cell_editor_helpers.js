// cell_editor_helpers.js
// Pure helper functions extracted from cell_editor.js for testability.
// Zero DOM access — all functions are pure input→output.

import { formatTemporalValueForInput } from '../../../table_views/temporal_value_formatter.js';

/**
 * Map a database data type string to the corresponding HTML input type.
 *
 * @param {string} dataType - Database column data type (e.g. 'timestamp', 'integer', 'boolean')
 * @returns {string} HTML input type ('text', 'datetime-local', 'date', 'number', or 'checkbox')
 */
export function getEditInputType(dataType) {
    if (!dataType) return 'text';
    if (dataType.includes('timestamp')) return 'datetime-local';
    if (dataType.includes('date')) return 'date';
    if (dataType.includes('int') || dataType === 'numeric') return 'number';
    if (dataType === 'boolean') return 'checkbox';
    return 'text';
}

/**
 * Derive the foreign key column name from a '_name' display column.
 * Tries '_id' suffix first, then falls back to stripping '_name'.
 * Returns null if the column does not end with '_name'.
 *
 * @param {string} colName - The column name to check
 * @param {string[]} allCols - All column names in the table
 * @returns {string|null} The foreign key column name, or null
 */
export function deriveForeignKeyColumnName(colName, allCols) {
    if (!colName || !colName.endsWith('_name')) return null;
    const idVariant = colName.replace('_name', '_id');
    if (allCols.includes(idVariant)) return idVariant;
    return colName.replace('_name', '');
}

/**
 * Determine whether a cell value has changed, accounting for input type.
 * Numbers are compared as floats; other types use strict equality.
 *
 * @param {*} originalValue - The original cell value
 * @param {*} newValue - The new value from the input
 * @param {string} inputType - The HTML input type ('checkbox', 'number', 'text', etc.)
 * @returns {boolean} True if the value has changed
 */
export function hasValueChanged(originalValue, newValue, inputType) {
    if (inputType === 'number') {
        return parseFloat(newValue) !== parseFloat(originalValue);
    }
    return newValue !== originalValue;
}

/**
 * Format a value for a date or datetime-local input element.
 * Returns an empty string if the value is not a valid date.
 *
 * @param {*} value - The raw value to format
 * @param {string} inputType - 'date' or 'datetime-local'
 * @returns {string} Formatted date string or empty string
 */
export function formatDateForInput(value, inputType, dataType = '') {
    if (inputType === 'date') {
        return formatTemporalValueForInput(value, dataType || 'date');
    }
    if (inputType === 'datetime-local') {
        return formatTemporalValueForInput(value, dataType || 'timestamp without time zone');
    }
    return '';
}

/**
 * Builds a simple { column_name -> { editable_in_ui } } lookup from cached
 * full_tree_data payloads. Returns an empty map if the cache is missing or
 * malformed so callers can fall back to backend enforcement.
 *
 * @param {string|object|null} fullTreeDataRaw
 * @param {string} tableName
 * @returns {Object<string, {editable_in_ui: boolean}>}
 */
export function buildEditableColumnMapFromFullTreeData(fullTreeDataRaw, tableName) {
    if (!fullTreeDataRaw || !tableName) {
        return {};
    }

    let parsed;
    if (typeof fullTreeDataRaw === 'string') {
        try {
            parsed = JSON.parse(fullTreeDataRaw);
        } catch {
            return {};
        }
    } else if (typeof fullTreeDataRaw === 'object') {
        parsed = fullTreeDataRaw;
    } else {
        return {};
    }

    if (!Array.isArray(parsed?.column_details)) {
        return {};
    }

    const columnInfoMap = {};
    for (const colObj of parsed.column_details) {
        if (colObj?.table_name === tableName && colObj.column_name) {
            columnInfoMap[colObj.column_name] = {
                editable_in_ui: !!colObj.editable_in_ui,
            };
        }
    }

    return columnInfoMap;
}

/**
 * Resolves which actual backend column an inline table edit would target.
 * Generated FK display aliases like `status_name` map back to `status_id`
 * when that FK column is present in the table metadata.
 *
 * @param {string} columnName
 * @param {string[]} columns
 * @param {Object<string, {foreign_table?: string}>} dataTypes
 * @returns {string}
 */
export function resolveInlineEditTargetColumn(columnName, columns, dataTypes = {}) {
    const foreignKeyColumnName = deriveForeignKeyColumnName(columnName, columns);
    if (foreignKeyColumnName && dataTypes[foreignKeyColumnName]?.foreign_table) {
        return foreignKeyColumnName;
    }

    return columnName;
}

/**
 * Determines whether the UI should allow inline editing for a table cell based
 * on cached column metadata. Missing metadata returns true so the backend keeps
 * being the final authority instead of blocking unexpectedly.
 *
 * @param {Object} options
 * @param {string} options.columnName
 * @param {string[]} options.columns
 * @param {Object<string, {foreign_table?: string}>} [options.dataTypes]
 * @param {string} options.tableName
 * @param {string|object|null} options.fullTreeDataRaw
 * @returns {boolean}
 */
export function canInlineEditCell({
    columnName,
    columns = [],
    dataTypes = {},
    tableName,
    fullTreeDataRaw,
}) {
    if (!columnName || !tableName) {
        return true;
    }

    const targetColumn = resolveInlineEditTargetColumn(columnName, columns, dataTypes);
    const columnInfoMap = buildEditableColumnMapFromFullTreeData(
        fullTreeDataRaw,
        tableName
    );
    const metadata = columnInfoMap[targetColumn];

    if (!metadata) {
        return true;
    }

    return metadata.editable_in_ui === true;
}
