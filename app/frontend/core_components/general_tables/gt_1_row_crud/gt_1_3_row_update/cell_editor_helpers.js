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
 * Reads each column's editability from the per-column metadata the dataset was
 * rendered with, so the table view and the article view describe a dataset the
 * same way and neither depends on a separately cached catalog.
 *
 * @param {Object<string, {editable_in_ui?: any}>} dataTypes
 * @returns {Object<string, {editable_in_ui: boolean}>}
 */
export function buildEditableColumnMap(dataTypes) {
    const columnInfoMap = {};
    if (!dataTypes || typeof dataTypes !== 'object') {
        return columnInfoMap;
    }
    for (const [columnName, columnMeta] of Object.entries(dataTypes)) {
        if (!columnName || !columnMeta || typeof columnMeta !== 'object') continue;
        if (!Object.prototype.hasOwnProperty.call(columnMeta, 'editable_in_ui')) continue;
        columnInfoMap[columnName] = { editable_in_ui: !!columnMeta.editable_in_ui };
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
 * @returns {boolean}
 */
export function canInlineEditCell({
    columnName,
    columns = [],
    dataTypes = {},
    tableName,
}) {
    if (!columnName || !tableName) {
        return true;
    }

    const targetColumn = resolveInlineEditTargetColumn(columnName, columns, dataTypes);
    const columnInfoMap = buildEditableColumnMap(dataTypes);
    const metadata = columnInfoMap[targetColumn];

    if (!metadata) {
        return true;
    }

    return metadata.editable_in_ui === true;
}
