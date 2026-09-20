// row_input_builder_helpers.js
// Pure helper functions extracted from row_input_builder.js for testability.
// Zero DOM access — all functions are pure input→output.

import { resolveNumberInputStep } from "../number_input_step_resolver.js";

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
    const normalizedDataType = String(data_type || "").trim().toLowerCase();
    if (resolveNumberInputStep(normalizedDataType) !== null) {
        return "number";
    }

    switch (normalizedDataType) {
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


// Mirrors only the server-supported actor defaults; unrelated insert specs
// never make a required relation optional.
export function isRequiredForeignKeyColumn(column) {
    if (!(column.foreign_dataset_name || column.foreign_table_name)
        || !column.foreign_column_name
        || String(column.is_nullable).toLowerCase() !== "no"
        || column.column_default) return false;
    let specs = {};
    try {
        const parsed = JSON.parse(column.source_insert_specs || "{}");
        if (parsed && !Array.isArray(parsed) && typeof parsed === "object"
            && Object.values(parsed).every((value) => value === null || typeof value === "string")) specs = parsed;
    } catch { /* Invalid specs cannot bypass required-field validation. */ }
    const actorSupplied = (column.column_name === "user_id" && specs.user_id === "currentUser")
        || (column.column_name === "cached_username" && specs.cached_username === "currentUserName");
    return !actorSupplied;
}
