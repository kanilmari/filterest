// price_chart_data_reader.js
// Extracts time-series price points from generic dataset rows.
// Bridges table column metadata and the price chart view renderer.
// Exists so chart column inference and numeric parsing stay testable outside the DOM.

const TIME_COLUMN_ALIASES = [
    "observed_at",
    "timestamp",
    "datetime",
    "date",
    "time",
    "recorded_at",
    "priced_at",
    "created_at",
    "created",
    "paiva",
    "pvm",
];

const PRICE_COLUMN_ALIASES = [
    "close_price",
    "closing_price",
    "price",
    "hinta",
    "kurssi",
    "value",
    "amount",
    "close",
    "last_price",
];

const TEMPORAL_DATA_TYPE_HINTS = ["date", "time", "timestamp", "timestamptz"];
const NUMERIC_DATA_TYPE_HINTS = [
    "numeric",
    "decimal",
    "integer",
    "bigint",
    "smallint",
    "real",
    "double",
    "float",
];

// Normalizes names so aliases survive snake_case, spaces, and punctuation.
function normalizeColumnName(columnName) {
    return String(columnName || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Reads the backend data type regardless of whether it arrived as text or metadata.
function getColumnDataType(dataTypes, columnName) {
    const columnInfo = dataTypes?.[columnName];
    if (typeof columnInfo === "string") {
        return columnInfo.toLowerCase();
    }
    return String(columnInfo?.data_type || "").toLowerCase();
}

// Checks whether a backend type is suitable for the chart's x-axis.
function isTemporalDataType(dataType) {
    return TEMPORAL_DATA_TYPE_HINTS.some((hint) => dataType.includes(hint));
}

// Checks whether a backend type is suitable for the chart's y-axis.
function isNumericDataType(dataType) {
    return NUMERIC_DATA_TYPE_HINTS.some((hint) => dataType.includes(hint));
}

// Finds a column by exact normalized aliases before falling back to type hints.
function findColumnByAliases(columns, aliases) {
    const normalizedAliases = aliases.map(normalizeColumnName);
    return columns.find((column) => normalizedAliases.includes(normalizeColumnName(column))) || null;
}

// Finds the first column with a matching data type hint.
function findColumnByType(columns, dataTypes, predicate) {
    return columns.find((column) => predicate(getColumnDataType(dataTypes, column))) || null;
}

/**
 * Infers the time and price columns used by the chart.
 * Operates between visible dataset columns and backend type metadata.
 * Exists to keep the view useful without per-dataset chart configuration.
 */
export function infer_price_chart_columns(columns, dataTypes = {}) {
    const safeColumns = Array.isArray(columns) ? columns : [];
    const timeColumn = findColumnByAliases(safeColumns, TIME_COLUMN_ALIASES)
        || findColumnByType(safeColumns, dataTypes, isTemporalDataType);
    const priceColumn = findColumnByAliases(safeColumns, PRICE_COLUMN_ALIASES)
        || findColumnByType(
            safeColumns.filter((column) => column !== timeColumn && normalizeColumnName(column) !== "id"),
            dataTypes,
            isNumericDataType
        );

    return {
        timeColumn,
        priceColumn,
    };
}

/**
 * Parses a dataset cell into a millisecond timestamp.
 * Operates between API row values and stable chart coordinates.
 * Exists so date-only and timestamp values can share one x-axis.
 */
export function parse_price_chart_time(rawValue) {
    if (rawValue instanceof Date) {
        const value = rawValue.getTime();
        return Number.isFinite(value) ? value : null;
    }
    if (typeof rawValue === "number") {
        if (!Number.isFinite(rawValue)) return null;
        return rawValue > 100000000000 ? rawValue : rawValue * 1000;
    }
    if (typeof rawValue !== "string" || !rawValue.trim()) {
        return null;
    }

    const parsedTime = Date.parse(rawValue.trim());
    return Number.isFinite(parsedTime) ? parsedTime : null;
}

/**
 * Parses a dataset cell into a finite price number.
 * Operates between localized-looking cell text and chart y-axis values.
 * Exists so simple demo data and imported price feeds both render.
 */
export function parse_price_chart_value(rawValue) {
    if (typeof rawValue === "number") {
        return Number.isFinite(rawValue) ? rawValue : null;
    }
    if (typeof rawValue !== "string") {
        return null;
    }

    const strippedValue = rawValue
        .trim()
        .replace(/[\s€$£¥]/g, "")
        .replace(",", ".");
    if (!strippedValue || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(strippedValue)) {
        return null;
    }

    const parsedValue = Number(strippedValue);
    return Number.isFinite(parsedValue) ? parsedValue : null;
}

/**
 * Extracts sorted chart points from dataset rows.
 * Operates between raw API rows and the price chart renderer.
 * Exists to drop malformed cells without making the whole view fail.
 */
export function extract_price_chart_points(columns, data, dataTypes = {}) {
    const safeRows = Array.isArray(data) ? data : [];
    const chartColumns = infer_price_chart_columns(columns, dataTypes);

    if (!chartColumns.timeColumn || !chartColumns.priceColumn) {
        return {
            points: [],
            timeColumn: chartColumns.timeColumn,
            priceColumn: chartColumns.priceColumn,
        };
    }

    const points = safeRows
        .map((row, rowIndex) => {
            const time = parse_price_chart_time(row?.[chartColumns.timeColumn]);
            const price = parse_price_chart_value(row?.[chartColumns.priceColumn]);
            if (time === null || price === null) {
                return null;
            }
            return {
                row,
                rowIndex,
                time,
                price,
            };
        })
        .filter(Boolean)
        .sort((left, right) => left.time - right.time);

    return {
        points,
        timeColumn: chartColumns.timeColumn,
        priceColumn: chartColumns.priceColumn,
    };
}

/**
 * Formats a price value for compact axis labels.
 * Operates between chart values and visible y-axis text.
 * Exists to keep large values readable without committing to one currency.
 */
export function format_price_chart_value(value) {
    if (!Number.isFinite(value)) {
        return "";
    }
    return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: value >= 100 ? 0 : 2,
    }).format(value);
}

/**
 * Formats a timestamp for chart range labels.
 * Operates between millisecond timestamps and locale-aware UI text.
 * Exists so the same chart works for date and timestamp datasets.
 */
export function format_price_chart_time(value) {
    if (!Number.isFinite(value)) {
        return "";
    }
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
    }).format(new Date(value));
}
