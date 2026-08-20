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
export const TIMESTAMP_DISPLAY_MODE_DATE_ONLY = "date_only";
export const TIMESTAMP_DISPLAY_MODE_DATE_TIME = "date_time";

const UI_LANGUAGE_LOCALES = Object.freeze({
    fi: "fi-FI",
    en: "en-GB",
    ch: "zh-CN",
    yue: "yue-Hant-HK",
    "zh-CN": "zh-CN",
    "zh-HK": "zh-HK",
    "zh-TW": "zh-TW",
});

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

export function normalizeTimestampDisplayMode(value) {
    return value === TIMESTAMP_DISPLAY_MODE_DATE_ONLY
        ? TIMESTAMP_DISPLAY_MODE_DATE_ONLY
        : TIMESTAMP_DISPLAY_MODE_DATE_TIME;
}

function resolveTimestampDisplayLocale(value = "") {
    const normalized = String(value || "").trim();
    return UI_LANGUAGE_LOCALES[normalized] || normalized || "en-GB";
}

function formatLocalizedTimestamp(date, displayMode, locale) {
    const options = displayMode === TIMESTAMP_DISPLAY_MODE_DATE_ONLY
        ? { dateStyle: "medium" }
        : { dateStyle: "medium", timeStyle: "short" };

    try {
        return new Intl.DateTimeFormat(
            resolveTimestampDisplayLocale(locale),
            options
        ).format(date);
    } catch (_error) {
        return new Intl.DateTimeFormat("en-GB", options).format(date);
    }
}

function buildLocalCalendarDate(dateText, timeParts = {}) {
    const [year, month, day] = String(dateText || "")
        .split("-")
        .map((part) => Number(part));
    if (![year, month, day].every(Number.isFinite)) {
        return null;
    }

    const date = new Date(
        year,
        month - 1,
        day,
        Number(timeParts.hours || 0),
        Number(timeParts.minutes || 0),
        Number(timeParts.seconds || 0)
    );
    return Number.isNaN(date.getTime()) ? null : date;
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
    const useLocalizedPresentation = options.displayMode !== undefined;
    const displayMode = normalizeTimestampDisplayMode(options.displayMode);
    const temporalKind = getTemporalValueKind(columnMeta);
    const shouldTryFormatting = options.force === true
        || temporalKind !== null
        || TIMESTAMP_VALUE_PATTERN.test(textValue);
    if (!shouldTryFormatting) {
        return null;
    }

    if (temporalKind === TEMPORAL_KIND_DATE) {
        const dateOnly = extractCalendarDate(textValue);
        if (!dateOnly) {
            return null;
        }
        const calendarDate = buildLocalCalendarDate(dateOnly);
        return {
            displayText: useLocalizedPresentation && calendarDate
                ? formatLocalizedTimestamp(
                    calendarDate,
                    TIMESTAMP_DISPLAY_MODE_DATE_ONLY,
                    options.locale
                )
                : dateOnly,
            titleText: dateOnly,
        };
    }

    if (!valueHasTimePart(textValue)) {
        const dateOnly = extractCalendarDate(textValue);
        if (!dateOnly) {
            return null;
        }
        const calendarDate = buildLocalCalendarDate(dateOnly);
        return {
            displayText: useLocalizedPresentation && calendarDate
                ? formatLocalizedTimestamp(
                    calendarDate,
                    TIMESTAMP_DISPLAY_MODE_DATE_ONLY,
                    options.locale
                )
                : dateOnly,
            titleText: dateOnly,
        };
    }

    const explicitTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/u.test(textValue);
    const shouldPreserveWallClock = temporalKind === TEMPORAL_KIND_TIMESTAMP
        || (temporalKind !== TEMPORAL_KIND_TIMESTAMPTZ && !explicitTimeZone && !(value instanceof Date));
    if (shouldPreserveWallClock && valueHasTimePart(textValue)) {
        const parsedNaive = parseNaiveTimestamp(textValue);
        if (!parsedNaive) {
            return null;
        }
        const localDate = buildLocalCalendarDate(parsedNaive.dateText, parsedNaive);
        return {
            displayText: useLocalizedPresentation && localDate
                ? formatLocalizedTimestamp(localDate, displayMode, options.locale)
                : `${parsedNaive.dateText}${DATE_TIME_DISPLAY_SEPARATOR}${parsedNaive.hours}:${parsedNaive.minutes}`,
            titleText: `${parsedNaive.dateText} ${parsedNaive.hours}:${parsedNaive.minutes}:${parsedNaive.seconds}`,
        };
    }

    const parsedDate = value instanceof Date ? value : new Date(textValue.replace(" ", "T"));
    if (Number.isNaN(parsedDate.getTime())) {
        return null;
    }

    return {
        displayText: useLocalizedPresentation
            ? formatLocalizedTimestamp(parsedDate, displayMode, options.locale)
            : formatDateParts(parsedDate, false),
        titleText: formatDateParts(parsedDate, true),
    };
}

export function formatTimestampDisplayText(value, columnMeta = "", options = {}) {
    return formatTimestampDisplayParts(value, columnMeta, options)?.displayText ?? null;
}
