// filter_column_builder_helpers.js
// Resolves filter kinds and foreign-key option values for filters and inline editors.
// Bridges column metadata and the policy-aware option endpoint with both consumers.
// Exists to keep value-column fallback rules in one place.

import { resolveNumberInputStep } from "../../general_tables/gt_1_row_crud/number_input_step_resolver.js";
import { fetchFilterOptions } from "../../endpoints/endpoint_data_fetcher.js";

/**
 * Load the referenced values shared by filters and inline editors. Preserve the
 * filter bar's id/slug compatibility flow and let primary load failures escape.
 * Search and limit are supplied only by callers that need bounded remote search.
 * Keep raw value types here; each consumer owns its display mapping.
 */
export async function loadForeignFilterOptions(columnName, colType, searchOptions = {}) {
    const foreignValueColumn = colType.foreign_column || "id";
    const params = { dataset_name: colType.foreign_table, ...searchOptions };
    const data = Array.isArray(colType.filter_options)
        ? colType.filter_options
        : await fetchFilterOptions({ ...params, value_column: foreignValueColumn });
    let options = Array.isArray(data) ? data : [];

    if (shouldRetryForeignFilterOptionsWithSlug(columnName, colType, options, foreignValueColumn)) {
        try {
            const slugData = await fetchFilterOptions({ ...params, value_column: 'slug' });
            const slugOptions = Array.isArray(slugData) ? slugData : [];
            if (!areForeignFilterOptionValuesNumeric(slugOptions)) {
                options = slugOptions;
            }
        } catch (err) {
            if (document.querySelector('meta[name="app-env"]')?.content === 'dev') {
                console.warn("Failed to fetch slug fallback filter options:", err);
            }
        }
    }
    return options;
}

const DATE_FILTER_TYPES = [
    "date",
    "timestamp",
    "timestamp without time zone",
    "timestamp with time zone",
];
const TEXTUAL_FOREIGN_KEY_TYPES = [
    "text",
    "character varying",
    "character",
    "varchar",
];
const NUMERIC_OPTION_VALUE_RE = /^-?\d+$/;
const GENERATED_FK_ALIAS_SUFFIX_RE = /\s+\(ln(?: \d+)?\)$/iu;

/**
 * Classify a column into a UI category based on its name and data type.
 *
 * @param {string} column - Column name
 * @param {string} dataType - PostgreSQL data type (lowercase)
 * @returns {'id'|'additional_id'|'numeric'|'boolean'|'linked'|'date'|'text'}
 */
export function determineColumnCategory(column, dataType) {
    if (column === "id") return "id";

    const lowerCol = column.toLowerCase();
    if (lowerCol.endsWith("_id") || lowerCol.endsWith("_uid"))
        return "additional_id";

    if (resolveNumberInputStep(dataType) !== null) return "numeric";
    if (dataType === "boolean") return "boolean";
    if (lowerCol.endsWith("(linked)") || lowerCol.endsWith("(ln)"))
        return "linked";

    const dateTypes = [
        "date",
        "timestamp",
        "timestamp without time zone",
        "timestamp with time zone",
    ];

    if (dateTypes.includes(dataType)) return "date";
    return "text";
}

/**
 * Resolve which filter input UI should render for a column.
 *
 * Foreign keys must win even when the underlying data type is numeric, because
 * FK filters use relation-aware multiselects instead of raw integer ranges.
 *
 * @param {string|{data_type?: string, foreign_table?: string}} colType
 * @returns {'foreign_key'|'numeric_range'|'date_range'|'boolean_select'|'text_input'}
 */
export function resolveFilterElementKind(colType) {
    if (Array.isArray(colType?.filter_options)) return "choice";
    if (typeof colType === "object" && colType?.foreign_table) {
        return "foreign_key";
    }

    const dtString = (
        typeof colType === "object" && colType?.data_type
            ? colType.data_type
            : colType || ""
    ).toLowerCase();

    if (resolveNumberInputStep(dtString) !== null) return "numeric_range";
    if (DATE_FILTER_TYPES.includes(dtString)) return "date_range";
    if (dtString === "boolean") return "boolean_select";
    return "text_input";
}

function resolveColumnDataType(colType) {
    return String(
        typeof colType === "object" && colType?.data_type
            ? colType.data_type
            : colType || ""
    ).toLowerCase();
}

/**
 * Whether a dropdown option list currently uses numeric identifiers only.
 *
 * @param {Array<{value?: string|number}>} options
 * @returns {boolean}
 */
export function areForeignFilterOptionValuesNumeric(options = []) {
    const values = options
        .map((option) => String(option?.value ?? "").trim())
        .filter(Boolean);

    return values.length > 0 && values.every((value) => NUMERIC_OPTION_VALUE_RE.test(value));
}

/**
 * Whether a foreign-key filter should retry option loading with `slug`.
 *
 * Some text-backed foreign keys can transiently miss `foreign_column` metadata
 * and therefore fall back to `id`, which produces numeric filter values that do
 * not match the source table's stored text column.
 *
 * @param {string} columnName
 * @param {string|{data_type?: string, foreign_table?: string, foreign_column?: string}} colType
 * @param {Array<{value?: string|number}>} options
 * @param {string} requestedValueColumn
 * @returns {boolean}
 */
export function shouldRetryForeignFilterOptionsWithSlug(
    columnName,
    colType,
    options = [],
    requestedValueColumn = "id"
) {
    if (requestedValueColumn !== "id") {
        return false;
    }

    if (typeof colType !== "object" || !colType?.foreign_table || colType?.foreign_column) {
        return false;
    }

    const normalizedColumnName = String(columnName || "").toLowerCase();
    if (normalizedColumnName.endsWith("_id") || normalizedColumnName.endsWith("_uid")) {
        return false;
    }

    if (!TEXTUAL_FOREIGN_KEY_TYPES.includes(resolveColumnDataType(colType))) {
        return false;
    }

    return areForeignFilterOptionValuesNumeric(options);
}

/**
 * Build the generated FK display alias base for a relation-backed column.
 *
 * @param {string} columnName
 * @returns {string}
 */
export function buildGeneratedForeignDisplayAliasBase(columnName) {
    if (!columnName) {
        return "";
    }

    if (columnName.endsWith("_id")) {
        return `${columnName.slice(0, -3)}_name`;
    }

    if (columnName.endsWith("_uid")) {
        return `${columnName.slice(0, -4)}_name`;
    }

    return `${columnName}_name`;
}

/**
 * Normalize generated FK alias names so backend suffixes compare safely.
 *
 * @param {string} columnName
 * @returns {string}
 */
export function normalizeGeneratedForeignDisplayAliasKey(columnName) {
    return String(columnName || "")
        .trim()
        .replace(GENERATED_FK_ALIAS_SUFFIX_RE, "")
        .toLowerCase();
}

/**
 * Hide generated names with a hidden source (K377), or as redundant when the
 * source filter is available. Inspect full metadata even if a caller already
 * removed hidden sources from its column list; visible-source redundancy still
 * depends on the source being in that list.
 *
 * @param {string} columnName
 * @param {string[]} columns
 * @param {Object<string, object>} dataTypes
 * @returns {boolean}
 */
export function shouldHideRedundantGeneratedForeignDisplayColumn(
    columnName,
    columns = [],
    dataTypes = {}
) {
    const candidateColumn = String(columnName || "").trim();
    if (!candidateColumn) {
        return false;
    }

    const normalizedCandidate = normalizeGeneratedForeignDisplayAliasKey(candidateColumn);
    if (!normalizedCandidate.endsWith("_name")) {
        return false;
    }

    // The types map describes physical fields (get_results_metadata.go).
    // Generated projections have no entry; a stored name wins over alias inference.
    if (Object.hasOwn(dataTypes, candidateColumn)) {
        return false;
    }

    return Object.keys(dataTypes).some((sourceColumn) => {
        if (sourceColumn === candidateColumn) {
            return false;
        }

        const sourceMeta = dataTypes[sourceColumn];
        if (!sourceMeta?.foreign_table) {
            return false;
        }

        return buildGeneratedForeignDisplayAliasBase(sourceColumn).toLowerCase() === normalizedCandidate
            && (sourceMeta.hide_in_filter_panel || sourceMeta.hide_everywhere || columns.includes(sourceColumn));
    });
}

/** Whether visibility metadata hides a field or its generated reference name. */
export function isColumnFilterHidden(columnName, dataTypes = {}) {
    const metadata = dataTypes[columnName];
    if (metadata?.hide_in_filter_panel || metadata?.hide_everywhere) return true;
    // Physical identity wins even for ordinary text fields named like an alias.
    if (Object.hasOwn(dataTypes, columnName)) return false;
    const alias = normalizeGeneratedForeignDisplayAliasKey(columnName);
    return alias.endsWith("_name") && Object.entries(dataTypes).some(([source, sourceMeta]) =>
        sourceMeta?.foreign_table
        && buildGeneratedForeignDisplayAliasBase(source).toLowerCase() === alias
        && (sourceMeta.hide_in_filter_panel || sourceMeta.hide_everywhere)
    );
}

/** One visibility policy for legacy, accordion and inline-open filter layouts. */
export function getFilterableColumns(columns = [], dataTypes = {}) {
    return columns.filter(column => !isColumnFilterHidden(column, dataTypes)
        && !shouldHideRedundantGeneratedForeignDisplayColumn(column, columns, dataTypes));
}

/**
 * Discard hidden selections after metadata loads, keeping visible-source alias
 * selections valid even when their redundant input is omitted. Exact field
 * names win over include/exclude and range suffixes, as in the results API.
 * An unavailable name alias is discarded too: hide-everywhere sources and
 * their generated projections are omitted entirely by the server.
 * Missing metadata is not evidence of hiding; wait for a complete snapshot.
 */
export function withoutHiddenColumnFilters(tableName, filters = {}, columns, dataTypes) {
    if (!Array.isArray(columns) || !dataTypes || typeof dataTypes !== "object") return filters;
    const known = column => columns.includes(column) || Object.hasOwn(dataTypes, column);
    const controls = new Set(["search", "sort_column", "sort_order", "offset", "view", "chart_x", "chart_y", "row_group", "row_group_mode"]);
    const entries = Object.entries(filters).filter(([key]) => {
        if (controls.has(key)) return true;
        let column = key.startsWith(`${tableName}_`) ? key.slice(tableName.length + 1) : key;
        if (!known(column)) column = column.replace(/_exclude$/, "");
        if (!known(column)) column = column.replace(/_(from|to)$/, "");
        if (isColumnFilterHidden(column, dataTypes)) return false;
        const alias = normalizeGeneratedForeignDisplayAliasKey(column);
        const hasSource = Object.entries(dataTypes).some(([source, meta]) => meta?.foreign_table
            && buildGeneratedForeignDisplayAliasBase(source).toLowerCase() === alias);
        return !alias.endsWith("_name") || known(column) || hasSource;
    });
    return entries.length === Object.keys(filters).length ? filters : Object.fromEntries(entries);
}

/**
 * Build a safe test-id segment from an arbitrary value.
 * Strips non-alphanumeric chars, trims leading/trailing dashes.
 *
 * @param {*} value - Raw value to sanitize
 * @returns {string} Sanitized segment, or 'unknown' if empty
 */
export function buildTestIdSegment(value) {
    return String(value ?? "")
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "unknown";
}

/**
 * Categorize an array of columns into UI groups.
 *
 * @param {string[]} columns - Column names
 * @param {Object<string, string|{data_type: string}>} dataTypes - Map of column→type
 * @returns {{id: string[], numeric: string[], boolean: string[], linked: string[], text: string[], date: string[], additional_id: string[]}}
 */
export function categorizeColumns(columns, dataTypes) {
    const categorized = {
        id: [],
        numeric: [],
        boolean: [],
        linked: [],
        text: [],
        date: [],
        additional_id: [],
    };

    columns.forEach((col) => {
        const dtRaw = dataTypes[col];
        const actualType =
            typeof dtRaw === "object" && dtRaw?.data_type
                ? dtRaw.data_type
                : dtRaw;
        const category = determineColumnCategory(col, actualType);
        categorized[category].push(col);
    });

    return categorized;
}

/**
 * Order categorized columns into main (visible) and hidden groups.
 * Main: id, numeric, boolean, linked, date.
 * Hidden: text, additional_id.
 *
 * @param {{id: string[], numeric: string[], boolean: string[], linked: string[], text: string[], date: string[], additional_id: string[]}} categorized
 * @returns {{main: string[], hidden: string[]}}
 */
export function orderFilterColumns(categorized) {
    const main = [
        ...categorized.id,
        ...categorized.numeric,
        ...categorized.boolean,
        ...categorized.linked,
        ...categorized.date,
    ];

    const hidden = [
        ...categorized.text,
        ...categorized.additional_id,
    ];

    return { main, hidden };
}
