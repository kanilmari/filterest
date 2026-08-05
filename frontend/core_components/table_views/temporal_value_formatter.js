// temporal_value_formatter.js
// Converts DATE, timestamp-without-time-zone, and timestamp-with-time-zone values for editors and API writes.
// Bridges backend temporal strings with inline-table and article-card datetime-local inputs.
// Exists to keep calendar dates and wall-clock timestamps free from accidental browser timezone conversion.

export const TEMPORAL_KIND_DATE = 'date';
export const TEMPORAL_KIND_TIMESTAMP = 'timestamp-without-time-zone';
export const TEMPORAL_KIND_TIMESTAMPTZ = 'timestamp-with-time-zone';

const DATE_VALUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/u;
const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const NAIVE_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/u;

function normalizeDataType(columnMeta = '') {
    if (typeof columnMeta === 'string') {
        return columnMeta.trim().toLowerCase();
    }

    if (columnMeta && typeof columnMeta === 'object') {
        return String(columnMeta.data_type || columnMeta.type || '').trim().toLowerCase();
    }

    return '';
}

function hasValidDateParts(yearText, monthText, dayText) {
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return false;
    }
    if (month < 1 || month > 12 || day < 1) {
        return false;
    }

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day <= daysInMonth;
}

function hasValidTimeParts(hoursText, minutesText, secondsText = '00') {
    const hours = Number(hoursText);
    const minutes = Number(minutesText);
    const seconds = Number(secondsText);
    return Number.isInteger(hours)
        && Number.isInteger(minutes)
        && Number.isInteger(seconds)
        && hours >= 0
        && hours <= 23
        && minutes >= 0
        && minutes <= 59
        && seconds >= 0
        && seconds <= 59;
}

function padTemporalPart(value) {
    return String(value).padStart(2, '0');
}

/**
 * Classifies database temporal metadata without treating DATE as a timestamp.
 *
 * @param {string|object} columnMeta
 * @returns {'date'|'timestamp-without-time-zone'|'timestamp-with-time-zone'|null}
 */
export function getTemporalValueKind(columnMeta = '') {
    const dataType = normalizeDataType(columnMeta);
    if (dataType.includes('timestamptz') || dataType.includes('timestamp with time zone')) {
        return TEMPORAL_KIND_TIMESTAMPTZ;
    }
    if (dataType.includes('timestamp') || dataType.includes('datetime')) {
        return TEMPORAL_KIND_TIMESTAMP;
    }
    if (dataType === 'date') {
        return TEMPORAL_KIND_DATE;
    }
    return null;
}

/**
 * Extracts a validated calendar date without constructing a timezone-aware Date.
 *
 * @param {*} value
 * @returns {string|null}
 */
export function extractCalendarDate(value) {
    const match = String(value ?? '').trim().match(DATE_VALUE_PATTERN);
    if (!match || !hasValidDateParts(match[1], match[2], match[3])) {
        return null;
    }
    return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * Parses a timestamp-without-time-zone into validated wall-clock components.
 *
 * @param {*} value
 * @returns {{dateText: string, hours: string, minutes: string, seconds: string, fraction: string}|null}
 */
export function parseNaiveTimestamp(value) {
    const match = String(value ?? '').trim().match(NAIVE_TIMESTAMP_PATTERN);
    if (
        !match
        || !hasValidDateParts(match[1], match[2], match[3])
        || !hasValidTimeParts(match[4], match[5], match[6])
    ) {
        return null;
    }

    return {
        dateText: `${match[1]}-${match[2]}-${match[3]}`,
        hours: match[4],
        minutes: match[5],
        seconds: match[6] || '00',
        fraction: match[7] || '',
    };
}

/**
 * Formats a backend temporal value for an HTML date or datetime-local input.
 * DATE and naive TIMESTAMP stay as written; TIMESTAMPTZ is shown in browser-local time.
 *
 * @param {*} value
 * @param {string|object} columnMeta
 * @returns {string}
 */
export function formatTemporalValueForInput(value, columnMeta) {
    if (value === null || value === undefined || value === '') {
        return '';
    }

    const temporalKind = getTemporalValueKind(columnMeta);
    if (temporalKind === TEMPORAL_KIND_DATE) {
        return extractCalendarDate(value) || '';
    }
    if (temporalKind === TEMPORAL_KIND_TIMESTAMP) {
        const parsed = parseNaiveTimestamp(value);
        return parsed ? `${parsed.dateText}T${parsed.hours}:${parsed.minutes}` : '';
    }
    if (temporalKind !== TEMPORAL_KIND_TIMESTAMPTZ) {
        return '';
    }

    const instant = value instanceof Date ? value : new Date(String(value).trim());
    if (Number.isNaN(instant.getTime())) {
        return '';
    }

    return [
        `${instant.getFullYear()}-${padTemporalPart(instant.getMonth() + 1)}-${padTemporalPart(instant.getDate())}`,
        `${padTemporalPart(instant.getHours())}:${padTemporalPart(instant.getMinutes())}`,
    ].join('T');
}

/**
 * Serializes an editor value for the matching PostgreSQL temporal type.
 * Returns null for invalid or ambiguous values so callers cannot submit a shifted fallback.
 *
 * @param {*} editorValue
 * @param {string|object} columnMeta
 * @returns {string|null}
 */
export function serializeTemporalInputValue(editorValue, columnMeta) {
    const temporalKind = getTemporalValueKind(columnMeta);
    const value = String(editorValue ?? '').trim();

    if (temporalKind === TEMPORAL_KIND_DATE) {
        const match = value.match(DATE_INPUT_PATTERN);
        if (!match || !hasValidDateParts(match[1], match[2], match[3])) {
            return null;
        }
        return value;
    }

    if (temporalKind === TEMPORAL_KIND_TIMESTAMP) {
        const parsed = parseNaiveTimestamp(value);
        if (!parsed) {
            return null;
        }
        const fraction = parsed.fraction ? `.${parsed.fraction}` : '';
        return `${parsed.dateText} ${parsed.hours}:${parsed.minutes}:${parsed.seconds}${fraction}`;
    }

    if (temporalKind === TEMPORAL_KIND_TIMESTAMPTZ) {
        const instant = new Date(value);
        return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
    }

    return null;
}
