// timestamp_display_formatter.js
// Formats timestamp-like dataset values for compact display and precise hover text.
// Bridges table, card, article, and related-row renderers through one date-time policy.
// Exists so visible UI omits seconds while preserving the full value in titles.

import {
    extractCalendarDate,
    getTemporalValueKind,
    parseNaiveTimestamp,
    TEMPORAL_KIND_DATE,
    TEMPORAL_KIND_TIMESTAMP,
    TEMPORAL_KIND_TIMESTAMPTZ,
} from './temporal_value_formatter.js';

const TIMESTAMP_VALUE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/u;
const TIME_ONLY_VALUE_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/u;
export const DATE_TIME_DISPLAY_SEPARATOR = " \u2007";

function normalizeColumnDataType(columnMeta = "") {
    if (typeof columnMeta === "string") {
        return columnMeta.toLowerCase();
    }

    if (columnMeta && typeof columnMeta === "object") {
        return String(columnMeta.data_type || columnMeta.type || "").toLowerCase();
    }

    return "";
}

export function isTimestampColumn(columnMeta = "") {
    const dataType = normalizeColumnDataType(columnMeta);
    return dataType.includes("timestamp")
        || dataType.includes("timestamptz")
        || dataType.includes("datetime");
}

function isTimeOnlyColumn(columnMeta = "") {
    const dataType = normalizeColumnDataType(columnMeta);
    return /\btime\b/u.test(dataType) && !dataType.includes("timestamp");
}

function padDatePart(value) {
    return String(value).padStart(2, "0");
}

function formatDateParts(date, includeSeconds = false) {
    const year = date.getFullYear();
    const month = padDatePart(date.getMonth() + 1);
    const day = padDatePart(date.getDate());
    const hours = padDatePart(date.getHours());
    const minutes = padDatePart(date.getMinutes());
    const seconds = padDatePart(date.getSeconds());

    const dateText = `${year}-${month}-${day}`;
    const timeText = includeSeconds
        ? `${hours}:${minutes}:${seconds}`
        : `${hours}:${minutes}`;
    const separator = includeSeconds ? " " : DATE_TIME_DISPLAY_SEPARATOR;

    return `${dateText}${separator}${timeText}`;
}

function valueHasTimePart(value) {
    return /[T\s]\d{2}:\d{2}/u.test(String(value || ""));
}

function formatTimeOnlyValue(value) {
    const match = String(value || "").trim().match(TIME_ONLY_VALUE_PATTERN);
    if (!match) {
        return null;
    }

    const [, hours, minutes, seconds = "00"] = match;
    return {
        displayText: `${hours}:${minutes}`,
        titleText: `${hours}:${minutes}:${seconds}`,
    };
}

export function formatTimestampDisplayParts(value, columnMeta = "", options = {}) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    if (isTimeOnlyColumn(columnMeta)) {
        return formatTimeOnlyValue(value);
    }

    const textValue = value instanceof Date
        ? value.toISOString()
        : String(value).trim();
    const temporalKind = getTemporalValueKind(columnMeta);
    const shouldTryFormatting = options.force === true
        || temporalKind !== null
        || TIMESTAMP_VALUE_PATTERN.test(textValue);
    if (!shouldTryFormatting) {
        return null;
    }

    if (temporalKind === TEMPORAL_KIND_DATE) {
        const dateOnly = extractCalendarDate(textValue);
        return dateOnly ? { displayText: dateOnly, titleText: dateOnly } : null;
    }

    if (!valueHasTimePart(textValue)) {
        const dateOnly = extractCalendarDate(textValue);
        return dateOnly ? { displayText: dateOnly, titleText: dateOnly } : null;
    }

    const explicitTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/u.test(textValue);
    const shouldPreserveWallClock = temporalKind === TEMPORAL_KIND_TIMESTAMP
        || (temporalKind !== TEMPORAL_KIND_TIMESTAMPTZ && !explicitTimeZone && !(value instanceof Date));
    if (shouldPreserveWallClock && valueHasTimePart(textValue)) {
        const parsedNaive = parseNaiveTimestamp(textValue);
        if (!parsedNaive) {
            return null;
        }
        return {
            displayText: `${parsedNaive.dateText}${DATE_TIME_DISPLAY_SEPARATOR}${parsedNaive.hours}:${parsedNaive.minutes}`,
            titleText: `${parsedNaive.dateText} ${parsedNaive.hours}:${parsedNaive.minutes}:${parsedNaive.seconds}`,
        };
    }

    const parsedDate = value instanceof Date ? value : new Date(textValue.replace(" ", "T"));
    if (Number.isNaN(parsedDate.getTime())) {
        return null;
    }

    return {
        displayText: formatDateParts(parsedDate, false),
        titleText: formatDateParts(parsedDate, true),
    };
}

export function formatTimestampDisplayText(value, columnMeta = "", options = {}) {
    return formatTimestampDisplayParts(value, columnMeta, options)?.displayText ?? null;
}
