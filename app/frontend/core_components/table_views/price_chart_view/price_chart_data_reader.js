// price_chart_data_reader.js
// Extracts time-series numeric points from typed dataset rows.
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

// Exact scalar types: text aliases, arrays, intervals and domains do not qualify.
const TEMPORAL_TYPE = /^(?:date|time(?:\(\d+\))?(?: with(?:out)? time zone)?|timetz|timestamp(?:\(\d+\))?(?: with(?:out)? time zone)?|timestamptz)$/;
const NUMERIC_TYPE = /^(?:smallint|integer|bigint|int[248]?|smallserial|serial|bigserial|serial[248]|numeric(?:\(\d+(?:\s*,\s*\d+)?\))?|decimal(?:\(\d+(?:\s*,\s*\d+)?\))?|real|double precision|float[48]?)$/;

export const CHART_AXIS_PARAMS = Object.freeze({ x: "chart_x", y: "chart_y" });

// Normalizes names so aliases survive snake_case, spaces, and punctuation.
function normalizeColumnName(columnName) {
    return String(columnName || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Reads the backend data type regardless of whether it arrived as text or metadata.
function getColumnDataType(dataTypes, columnName) {
    const columnInfo = dataTypes?.[columnName];
    if (typeof columnInfo === "string") {
        return columnInfo.toLowerCase().trim();
    }
    return String(columnInfo?.data_type || "").toLowerCase().trim();
}

// Checks whether a backend type is suitable for the chart's x-axis.
function isTemporalDataType(dataType) {
    return TEMPORAL_TYPE.test(dataType);
}

// Checks whether a backend type is suitable for the chart's y-axis.
function isNumericDataType(dataType) {
    return NUMERIC_TYPE.test(dataType);
}

// Finds a column by exact normalized aliases before falling back to type hints.
function findColumnByAliases(columns, aliases) {
    const normalizedAliases = aliases.map(normalizeColumnName);
    return columns.find((column) => normalizedAliases.includes(normalizeColumnName(column))) || null;
}

/** Eligible delivered scalar columns, independent of rows or view permissions. */
export function getChartAxisChoices(columns = [], dataTypes = {}) {
    const available = Array.isArray(columns) ? columns.filter(column => {
        const metadata = dataTypes?.[column];
        return !metadata?.hide_everywhere
            && (!metadata?.client_delivery_mode || metadata.client_delivery_mode === "include");
    }) : [];
    return {
        x: available.filter(column => isTemporalDataType(getColumnDataType(dataTypes, column))),
        y: available.filter(column => isNumericDataType(getColumnDataType(dataTypes, column))),
    };
}

/** The single chart fit rule; id counts, text dates do not, empty tables can fit. */
export function datasetSupportsChartView(columns = [], dataTypes = {}) {
    const choices = getChartAxisChoices(columns, dataTypes);
    return choices.x.length > 0 && choices.y.length > 0;
}

/**
 * Infers the time and price columns used by the chart.
 * Operates between visible dataset columns and backend type metadata.
 * Exists to keep the view useful without per-dataset chart configuration.
 */
export function infer_price_chart_columns(columns, dataTypes = {}) {
    const choices = getChartAxisChoices(columns, dataTypes);
    const timeColumn = findColumnByAliases(choices.x, TIME_COLUMN_ALIASES) || choices.x[0] || null;
    const priceColumn = findColumnByAliases(choices.y, PRICE_COLUMN_ALIASES)
        || choices.y.find(column => normalizeColumnName(column) !== "id")
        || choices.y[0] || null;

    return {
        timeColumn,
        priceColumn,
    };
}

/** Address > eligible saved member by type > inference; resolve each axis separately. */
export function resolveChartAxes(columns, dataTypes, params = {}, savedColumns = []) {
    const choices = getChartAxisChoices(columns, dataTypes);
    const inferred = infer_price_chart_columns(columns, dataTypes);
    // The field-set API removes inaccessible members and compacts the list.
    // Type membership keeps the surviving saved axis without relying on its position.
    const saved = Array.isArray(savedColumns) ? savedColumns : [];
    const timeDefault = saved.find(column => choices.x.includes(column)) || inferred.timeColumn;
    const valueDefault = saved.find(column => choices.y.includes(column)) || inferred.priceColumn;
    return {
        timeColumn: choices.x.includes(params.chart_x) ? params.chart_x : timeDefault,
        priceColumn: choices.y.includes(params.chart_y) ? params.chart_y : valueDefault,
    };
}

/** Preserve filters, sorting and the legacy view key when sharing an axis choice. */
export function chartAxesToParams(params, axes) {
    return { ...params, view: "price_chart", chart_x: axes.timeColumn, chart_y: axes.priceColumn };
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

    // PostgreSQL TIME/TIMETZ have no date. Anchor clocks to one fixed UTC day.
    const value = rawValue.trim();
    const clock = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/i.test(value);
    const clockValue = value.replace(/([+-]\d{2})$/, "$1:00");
    const parsedTime = Date.parse(clock ? `1970-01-01T${clockValue}${/[Z+-]/i.test(clockValue) ? "" : "Z"}` : value);
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
export function extract_price_chart_points(columns, data, dataTypes = {}, axes = null) {
    const safeRows = Array.isArray(data) ? data : [];
    const chartColumns = axes || infer_price_chart_columns(columns, dataTypes);

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
export function format_price_chart_time(value, clockOnly = false) {
    if (!Number.isFinite(value)) {
        return "";
    }
    return new Intl.DateTimeFormat(undefined, clockOnly ? {
        hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC",
    } : {
        year: "numeric",
        month: "short",
        day: "2-digit",
    }).format(new Date(value));
}
