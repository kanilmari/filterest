// row_input_builder_helpers.js
// Pure helper functions extracted from row_input_builder.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Build a standardized test ID for a form field.
 *
 * @param {string} column_name - The database column name
 * @returns {string} Test ID in the format "form-input-{column_name}"
 */
export function buildFieldTestId(column_name) {
    return `form-input-${column_name}`;
}

/**
 * Determine the HTML input type from a database data type.
 *
 * @param {string} data_type - The database data type (e.g. "integer", "boolean", "timestamp")
 * @returns {string} The corresponding HTML input type
 */
export function getInputType(data_type) {
    switch (data_type.toLowerCase()) {
        case "integer":
        case "bigint":
        case "smallint":
        case "numeric":
            return "number";
        case "boolean":
            return "checkbox";
        case "date":
            return "date";
        case "timestamp":
        case "timestamp without time zone":
        case "timestamp with time zone":
            return "datetime-local";
        default:
            return "text";
    }
}
