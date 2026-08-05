// selected_items_reader_helpers.js
// Pure helper functions extracted from selected_items_reader.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Compute the cell index for the ID column within a table row.
 * Accounts for the +2 offset (numbering column + checkbox column).
 *
 * @param {string[]} columns - Array of column names from table dataset
 * @returns {number} The cell index for the ID column, or -1 if 'id' is not in columns
 */
export function computeIdCellIndex(columns) {
    const idx = columns.indexOf('id');
    return idx !== -1 ? idx + 2 : -1;
}

/**
 * Parse an integer ID from a text string.
 * Returns null if the text cannot be parsed as an integer.
 *
 * @param {string} text - Raw cell text content
 * @returns {number|null} Parsed integer ID, or null if invalid
 */
export function parseIdFromText(text) {
    const parsed = parseInt(text, 10);
    return isNaN(parsed) ? null : parsed;
}

/**
 * Build a row object from column names and cell text values.
 * Maps each column to its corresponding cell text (offset by 2 to skip
 * numbering and checkbox columns).
 *
 * @param {string[]} columns - Array of column names
 * @param {string[]} cellTexts - Array of trimmed text values from all cells in the row
 * @returns {Object<string, string>} Key-value object mapping column names to cell text
 */
export function parseRowObject(columns, cellTexts) {
    const rowObj = {};
    columns.forEach((col, idx) => {
        const cellIndex = idx + 2; // skip numbering + checkbox
        if (cellTexts.length > cellIndex) {
            rowObj[col] = cellTexts[cellIndex];
        }
    });
    return rowObj;
}
