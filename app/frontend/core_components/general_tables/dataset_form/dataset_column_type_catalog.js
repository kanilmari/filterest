// dataset_column_type_catalog.js
// The one list of column types the dataset forms offer, with each type's parameters.
// Bridges the dataset creation form, the column manager and the server's own type allowlist.
// Exists so the two forms cannot drift apart, or hide a type the server already accepts.

/** How a type is completed before it becomes a column definition. */
export const COLUMN_TYPE_PARAMETER = Object.freeze({
    NONE: "none",
    LENGTH: "length",
    PRECISION: "precision",
});

// A decimal column must carry its precision: the server accepts NUMERIC(p,s)
// but refuses a bare NUMERIC, so the form always completes it.
export const DEFAULT_NUMERIC_PRECISION = 12;
export const DEFAULT_NUMERIC_SCALE = 2;

// creationOnly marks a type that defines how a column is born rather than what
// it holds, so it is never offered as a conversion target for an existing column.
const CATALOG = Object.freeze([
    { value: "SERIAL", labelKey: "dataset_column_type_serial", parameter: COLUMN_TYPE_PARAMETER.NONE, creationOnly: true },
    { value: "INTEGER", labelKey: "dataset_column_type_integer", parameter: COLUMN_TYPE_PARAMETER.NONE },
    { value: "BIGINT", labelKey: "dataset_column_type_bigint", parameter: COLUMN_TYPE_PARAMETER.NONE },
    { value: "SMALLINT", labelKey: "dataset_column_type_smallint", parameter: COLUMN_TYPE_PARAMETER.NONE },
    { value: "NUMERIC", labelKey: "dataset_column_type_numeric", parameter: COLUMN_TYPE_PARAMETER.PRECISION },
    { value: "VARCHAR", labelKey: "dataset_column_type_varchar", parameter: COLUMN_TYPE_PARAMETER.LENGTH, multilingual: true },
    { value: "TEXT", labelKey: "dataset_column_type_text", parameter: COLUMN_TYPE_PARAMETER.NONE, multilingual: true },
    { value: "BOOLEAN", labelKey: "dataset_column_type_boolean", parameter: COLUMN_TYPE_PARAMETER.NONE },
    { value: "DATE", labelKey: "dataset_column_type_date", parameter: COLUMN_TYPE_PARAMETER.NONE },
    { value: "TIMESTAMPTZ", labelKey: "dataset_column_type_timestamptz", parameter: COLUMN_TYPE_PARAMETER.NONE },
    {
        value: "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
        labelKey: "dataset_column_type_auto_timestamp",
        parameter: COLUMN_TYPE_PARAMETER.NONE,
        creationOnly: true,
    },
    { value: "JSONB", labelKey: "dataset_column_type_jsonb", parameter: COLUMN_TYPE_PARAMETER.NONE },
    { value: "JSON", labelKey: "dataset_column_type_json", parameter: COLUMN_TYPE_PARAMETER.NONE },
]);

/**
 * The types one form mode may offer.
 * @param {"create"|"edit"} mode
 */
export function getDatasetColumnTypeOptions(mode = "create") {
    return CATALOG.filter((entry) => mode === "create" || !entry.creationOnly);
}

/** The catalogue entry for a stored or selected type, or null. */
export function findDatasetColumnType(value) {
    const wanted = normalizeTypeName(value);
    return CATALOG.find((entry) => entry.value === wanted) || null;
}

/** Which parameter control a chosen type needs. */
export function getColumnTypeParameter(value) {
    return findDatasetColumnType(value)?.parameter || COLUMN_TYPE_PARAMETER.NONE;
}

/** Whether a type can hold translated text, so a multilingual choice applies. */
export function columnTypeSupportsMultilingual(value) {
    return findDatasetColumnType(value)?.multilingual === true;
}

/**
 * Complete a chosen type into the definition the server expects.
 * An unknown type is returned unchanged so an existing column keeps its schema.
 */
export function composeColumnTypeDefinition(value, { length, precision, scale } = {}) {
    const entry = findDatasetColumnType(value);
    if (!entry) {
        return String(value || "").trim();
    }
    if (entry.parameter === COLUMN_TYPE_PARAMETER.LENGTH) {
        const usedLength = positiveInteger(length);
        return usedLength ? `${entry.value}(${usedLength})` : entry.value;
    }
    if (entry.parameter === COLUMN_TYPE_PARAMETER.PRECISION) {
        const usedPrecision = positiveInteger(precision) || DEFAULT_NUMERIC_PRECISION;
        const usedScale = nonNegativeInteger(scale) ?? DEFAULT_NUMERIC_SCALE;
        return `${entry.value}(${usedPrecision},${Math.min(usedScale, usedPrecision)})`;
    }
    return entry.value;
}

/** Split a stored definition back into the controls that produced it. */
export function parseColumnTypeDefinition(definition) {
    const raw = String(definition || "").trim();
    const match = raw.match(/^([A-Za-z ]+?)\s*\(([^)]*)\)\s*$/);
    if (!match) {
        return { value: normalizeTypeName(raw), length: null, precision: null, scale: null };
    }
    const value = normalizeTypeName(match[1]);
    const [first, second] = match[2].split(",").map((part) => part.trim());
    if (getColumnTypeParameter(value) === COLUMN_TYPE_PARAMETER.PRECISION) {
        return { value, length: null, precision: positiveInteger(first), scale: nonNegativeInteger(second) };
    }
    return { value, length: positiveInteger(first), precision: null, scale: null };
}

/**
 * Bootstrap copy for the type names, merged into the shared translation
 * fallbacks. Reviewed runtime translations stay authoritative.
 */
export function getDatasetColumnTypeTranslationFallbacks() {
    return {
        dataset_column_type_serial: { fi: "Automaattinen tunniste (SERIAL)", en: "Automatic identifier (SERIAL)" },
        dataset_column_type_integer: { fi: "Kokonaisluku (INTEGER)", en: "Integer (INTEGER)", ch: "整数 (INTEGER)", yue: "整數 (INTEGER)" },
        dataset_column_type_bigint: { fi: "Suuri kokonaisluku (BIGINT)", en: "Large integer (BIGINT)" },
        dataset_column_type_smallint: { fi: "Pieni kokonaisluku (SMALLINT)", en: "Small integer (SMALLINT)" },
        dataset_column_type_numeric: { fi: "Desimaaliluku (NUMERIC)", en: "Decimal number (NUMERIC)" },
        dataset_column_type_varchar: { fi: "Rajattu teksti (VARCHAR)", en: "Limited text (VARCHAR)", ch: "有限长度文本 (VARCHAR)", yue: "限長文字 (VARCHAR)" },
        dataset_column_type_text: { fi: "Teksti (TEXT)", en: "Text (TEXT)", ch: "文本 (TEXT)", yue: "文字 (TEXT)" },
        dataset_column_type_boolean: { fi: "Kyllä/ei (BOOLEAN)", en: "Yes/no (BOOLEAN)", ch: "是/否 (BOOLEAN)", yue: "是／否 (BOOLEAN)" },
        dataset_column_type_date: { fi: "Päivämäärä (DATE)", en: "Date (DATE)", ch: "日期 (DATE)", yue: "日期 (DATE)" },
        dataset_column_type_timestamptz: { fi: "Aikaleima (TIMESTAMPTZ)", en: "Timestamp (TIMESTAMPTZ)" },
        dataset_column_type_auto_timestamp: { fi: "Automaattinen aikaleima (TIMESTAMPTZ)", en: "Automatic timestamp (TIMESTAMPTZ)", ch: "自动时间戳 (TIMESTAMPTZ)", yue: "自動時間戳 (TIMESTAMPTZ)" },
        dataset_column_type_jsonb: { fi: "Rakenteinen tieto (JSONB)", en: "Structured data (JSONB)" },
        dataset_column_type_json: { fi: "Rakenteinen tieto tekstinä (JSON)", en: "Structured data as text (JSON)" },
        dataset_column_type_precision: { fi: "Numeroita yhteensä", en: "Total digits" },
        dataset_column_type_scale: { fi: "Desimaaleja", en: "Decimal places" },
    };
}

function normalizeTypeName(value) {
    const upper = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
    if (upper === "CHARACTER VARYING") return "VARCHAR";
    if (upper === "TIMESTAMP WITH TIME ZONE") return "TIMESTAMPTZ";
    if (upper === "DECIMAL") return "NUMERIC";
    return upper;
}

function positiveInteger(value) {
    const parsed = Number.parseInt(String(value ?? "").trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value) {
    const parsed = Number.parseInt(String(value ?? "").trim(), 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
