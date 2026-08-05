// filter_column_builder_helpers.js
// Pure helper functions extracted from filter_column_builder.js for testability.
// Zero DOM access — all functions are pure input→output.

const NUMERIC_FILTER_TYPES = [
    "numeric",
    "integer",
    "bigint",
    "smallint",
    "real",
    "double precision",
];

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

    const numericTypes = [
        "numeric",
        "integer",
        "bigint",
        "smallint",
        "real",
        "double precision",
    ];

    if (numericTypes.includes(dataType)) return "numeric";
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
    if (typeof colType === "object" && colType?.foreign_table) {
        return "foreign_key";
    }

    const dtString = (
        typeof colType === "object" && colType?.data_type
            ? colType.data_type
            : colType || ""
    ).toLowerCase();

    if (NUMERIC_FILTER_TYPES.includes(dtString)) return "numeric_range";
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
 * Whether a column is a redundant FK display alias while its source FK filter
 * is already available in the same filter collection.
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

    if (dataTypes[candidateColumn]?.foreign_table) {
        return false;
    }

    return columns.some((sourceColumn) => {
        if (sourceColumn === candidateColumn) {
            return false;
        }

        const sourceMeta = dataTypes[sourceColumn];
        if (!sourceMeta?.foreign_table) {
            return false;
        }

        if (sourceMeta.hide_in_filter_panel || sourceMeta.hide_everywhere) {
            return false;
        }

        return buildGeneratedForeignDisplayAliasBase(sourceColumn).toLowerCase() === normalizedCandidate;
    });
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
