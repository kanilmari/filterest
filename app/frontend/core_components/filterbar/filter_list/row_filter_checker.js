// row_filter_checker.js
// Client-side filter evaluation for streamed rows that bypass backend filtering.
// Between filter bar state, column metadata, and dataset row rendering.
// Exists to keep type-aware filter comparisons consistent across search paths.

const NUMERIC_TYPES = new Set([
    "numeric",
    "integer",
    "bigint",
    "smallint",
    "real",
    "double precision",
]);

const DATE_TYPES = new Set([
    "date",
    "timestamp",
    "timestamp without time zone",
    "timestamp with time zone",
]);

const BOOLEAN_TYPES = new Set(["boolean"]);

function normalizeType(typeHint) {
    if (!typeHint) return "";
    if (typeof typeHint === "string") return typeHint.toLowerCase();
    if (typeof typeHint === "object" && typeHint.data_type) {
        return String(typeHint.data_type).toLowerCase();
    }
    return String(typeHint).toLowerCase();
}

function isDateLike(value) {
    if (value === null || value === undefined) return false;
    const str = String(value);
    return /^\d{4}-\d{2}-\d{2}/.test(str);
}

function coerceTemporal(value) {
    if (value instanceof Date) {
        const ts = value.getTime();
        return Number.isFinite(ts) ? ts : null;
    }
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : null;
}

function coerceNumeric(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function coerceBoolean(value) {
    if (typeof value === "boolean") return value;
    const lower = String(value).toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
    return null;
}

function getColumnType(columnKey, columnTypes = {}) {
    const rawType = columnTypes?.[columnKey];
    return normalizeType(rawType);
}

export function rowMatchesFilters(
    row,
    filters = {},
    tableName = "",
    columnTypes = {}
) {
    if (!row || !filters) return true;
    for (const [rawKey, rawValue] of Object.entries(filters)) {
        if (rawValue === "" || rawValue == null) continue;

        const key = String(rawKey);
        let columnKey = key.startsWith(`${tableName}_`)
            ? key.slice(tableName.length + 1)
            : key;
        const isExclude = columnKey.endsWith("_exclude");
        if (isExclude) {
            columnKey = columnKey.slice(0, -8);
        }

        const isFrom = columnKey.endsWith("_from");
        const isTo = columnKey.endsWith("_to");
        const baseKey = isFrom
            ? columnKey.slice(0, -5)
            : isTo
            ? columnKey.slice(0, -3)
            : columnKey;

        const typeHint = getColumnType(baseKey, columnTypes);
        const preferDate = DATE_TYPES.has(typeHint) || (!NUMERIC_TYPES.has(typeHint) && isDateLike(rawValue));

        if (isFrom || isTo) {
            const rowVal = preferDate
                ? coerceTemporal(row[baseKey])
                : coerceNumeric(row[baseKey]);
            const filterVal = preferDate
                ? coerceTemporal(rawValue)
                : coerceNumeric(rawValue);

            if (filterVal == null) continue; // ignore unparsable filter value
            if (rowVal == null) return false;
            if (isFrom && rowVal < filterVal) return false;
            if (isTo && rowVal > filterVal) return false;
            continue;
        }

        if (BOOLEAN_TYPES.has(typeHint)) {
            const lower = String(rawValue).toLowerCase();
            if (lower === "empty") {
                const rv = row[baseKey];
                const isEmpty = rv === null || rv === undefined || String(rv) === "";
                if (isExclude ? isEmpty : !isEmpty) {
                    return false;
                }
                continue;
            }
            const filterBool = coerceBoolean(rawValue);
            const rowBool = coerceBoolean(row[baseKey]);
            if (filterBool === null || rowBool === null) return false;
            if (isExclude ? rowBool === filterBool : rowBool !== filterBool) return false;
            continue;
        }

        const cell = row[baseKey];
        if (cell == null) return false;

        const cellText = String(cell).toLowerCase();
        const needle = String(rawValue).toLowerCase();
        if (needle.includes(',')) {
            const needles = needle.split(',').map(s => s.trim()).filter(Boolean);
            const hasExactMatch = needles.some(n => cellText === n);
            if (isExclude ? hasExactMatch : !hasExactMatch) return false;
        } else {
            if (isExclude) {
                if (cellText === needle) return false;
            } else if (!cellText.includes(needle)) {
                return false;
            }
        }
    }
    return true;
}
