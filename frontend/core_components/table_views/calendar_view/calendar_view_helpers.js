// calendar_view_helpers.js
// Provides pure date inference, grouping, and formatting helpers for the calendar table view.
// Bridges dataset columns, system_column_details-like metadata, and calendar renderer state.
// Exists to keep the DOM printer small while preserving a clean path for future temporal roles.

import { resolveDatasetDisplayValue } from "../dataset_value_localizer.js";

const PRIMARY_DATE_COLUMN_CANDIDATES = [
    "due_date",
    "start_date",
    "event_date",
    "date",
    "created",
    "created_at",
    "updated",
    "updated_at",
    "alkaa",
    "pvm",
    "paiva",
    "paivamaara",
];

const START_COLUMN_CANDIDATES = [
    "start_date",
    "start_at",
    "starts_at",
    "start",
    "alkaa",
];

const END_COLUMN_CANDIDATES = [
    "end_date",
    "end_at",
    "ends_at",
    "end",
    "due_date",
    "finish_date",
    "finished_at",
    "loppuu",
    "paattyy",
];

const TITLE_COLUMN_CANDIDATES = [
    "title",
    "name",
    "nimi",
    "otsikko",
    "subject",
    "summary",
    "description",
    "kuvaus",
];

const TEMPORAL_DATA_TYPE_HINTS = ["date", "timestamp", "timestamptz"];
const MAX_RANGE_DAYS_TO_EXPAND = 370;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Infers calendar start/end/title columns from future metadata, exact names, and safe type hints.
 * Operates between column lists and system_column_details-like metadata.
 * Exists so future temporal/calendar roles can replace frontend name heuristics cleanly.
 */
export function inferCalendarColumns(columns, dataTypes = {}) {
    const safeColumns = Array.isArray(columns) ? columns : [];
    const metadataStartColumn = findColumnByMetadataRole(safeColumns, dataTypes, [
        "calendar_start",
        "start",
        "starts",
        "temporal_start",
    ]);
    const metadataEndColumn = findColumnByMetadataRole(safeColumns, dataTypes, [
        "calendar_end",
        "end",
        "ends",
        "temporal_end",
    ]);
    const metadataDateColumn = findColumnByMetadataRole(safeColumns, dataTypes, [
        "calendar_date",
        "event_date",
        "date",
        "single_date",
        "temporal_date",
    ]);

    const inferredStartColumn = metadataStartColumn
        || findColumnByNormalizedName(safeColumns, START_COLUMN_CANDIDATES);
    const inferredEndColumn = metadataEndColumn
        || findColumnByNormalizedName(safeColumns, END_COLUMN_CANDIDATES);

    if (inferredStartColumn && inferredEndColumn && inferredStartColumn !== inferredEndColumn) {
        return {
            dateColumn: inferredStartColumn,
            startColumn: inferredStartColumn,
            endColumn: inferredEndColumn,
            titleColumn: inferTitleColumn(safeColumns, inferredStartColumn, inferredEndColumn),
            source: metadataStartColumn || metadataEndColumn ? "metadata_range" : "name_range",
        };
    }

    const primaryDateColumn = metadataDateColumn
        || findColumnByNormalizedName(safeColumns, PRIMARY_DATE_COLUMN_CANDIDATES)
        || findSingleTemporalTypedColumn(safeColumns, dataTypes);
    const dateColumn = primaryDateColumn || inferredStartColumn || null;

    return {
        dateColumn,
        startColumn: dateColumn,
        endColumn: null,
        titleColumn: inferTitleColumn(safeColumns, dateColumn, null),
        source: metadataDateColumn ? "metadata_date" : "name_or_type_date",
    };
}

/**
 * Groups rows by every local calendar day they occupy.
 * Operates between raw row values and date-keyed event buckets.
 * Exists to keep month/list rendering independent from row parsing details.
 */
export function groupCalendarRowsByDate(
    rows,
    calendarColumns,
    columns = [],
    preferredLanguage = "en",
    dataTypes = {}
) {
    const groupedEvents = new Map();
    const events = buildCalendarEvents(
        rows,
        calendarColumns,
        columns,
        preferredLanguage,
        dataTypes
    );

    events.forEach((event) => {
        event.dateKeys.forEach((dateKey) => {
            if (!groupedEvents.has(dateKey)) {
                groupedEvents.set(dateKey, []);
            }
            groupedEvents.get(dateKey).push(event);
        });
    });

    groupedEvents.forEach((eventsForDay) => {
        eventsForDay.sort(compareCalendarEvents);
    });

    return groupedEvents;
}

/**
 * Selects the first useful visible date.
 * Operates between grouped event dates and today's date.
 * Exists so sparse datasets open near their loaded events instead of a blank month.
 */
export function chooseInitialViewDate(groupedEvents) {
    const today = startOfLocalDay(new Date());
    const todayKey = toLocalDateKey(today);
    if (groupedEvents.has(todayKey)) {
        return today;
    }

    const sortedDateKeys = Array.from(groupedEvents.keys()).sort();
    return sortedDateKeys.length > 0 ? dateKeyToDate(sortedDateKeys[0]) : today;
}

/**
 * Returns the shifted view date for previous/next navigation.
 * Operates between active mode and date math.
 * Exists so each mode advances by its natural interval.
 */
export function getShiftedViewDate(date, mode, direction) {
    if (mode === "week") {
        return addDays(date, direction * 7);
    }
    if (mode === "day") {
        return addDays(date, direction);
    }
    return addMonths(date, direction);
}

/**
 * Builds the visible date keys for a Monday-start week.
 * Operates between one active date and seven local date keys.
 * Exists to keep week rendering aligned with the filterbar calendar.
 */
export function getWeekDateKeys(date) {
    const start = getMondayOfWeek(date);
    return Array.from({ length: 7 }, (_, index) => toLocalDateKey(addDays(start, index)));
}

/**
 * Builds every local date key in the active month.
 * Operates between month navigation state and agenda rendering.
 * Exists so agenda can show compact empty-day ranges without spatial gaps.
 */
export function getMonthDateKeys(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, index) => {
        return toLocalDateKey(new Date(year, month, index + 1));
    });
}

/**
 * Builds event-bearing date keys for the active agenda month.
 * Operates between the active month and all grouped event buckets.
 * Exists to keep agenda compact while preserving month navigation.
 */
export function getMonthDateKeysWithEvents(date, groupedEvents) {
    const year = date.getFullYear();
    const month = date.getMonth();
    return Array.from(groupedEvents.keys())
        .filter((dateKey) => {
            const eventDate = dateKeyToDate(dateKey);
            return eventDate.getFullYear() === year && eventDate.getMonth() === month;
        })
        .sort();
}

/**
 * Formats the toolbar title for the active mode.
 * Operates between date state and locale-aware display text.
 * Exists to keep navigation context visible.
 */
export function formatViewTitle(date, mode) {
    if (mode === "week") {
        const start = getMondayOfWeek(date);
        const end = addDays(start, 6);
        return `${formatShortDateLabel(start)} - ${formatShortDateLabel(end)}`;
    }
    if (mode === "day") {
        return formatDateLabel(date);
    }
    return new Intl.DateTimeFormat(undefined, {
        month: "long",
        year: "numeric",
    }).format(date);
}

/**
 * Formats a full date label for headings and aria labels.
 * Operates between a Date and locale-aware text.
 * Exists to avoid hardcoded month/day names.
 */
export function formatDateLabel(date) {
    return new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
    }).format(date);
}

/**
 * Formats a compact date label for ranges.
 * Operates between a Date and locale-aware text.
 * Exists to keep list event metadata short.
 */
export function formatShortDateLabel(date) {
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
    }).format(date);
}

/**
 * Formats one event's date or date range.
 * Operates between normalized event dates and list metadata.
 * Exists to show range events clearly in week/day/agenda modes.
 */
export function formatEventRange(event) {
    if (event.startKey === event.endKey) {
        return formatShortDateLabel(event.startDate);
    }
    return `${formatShortDateLabel(event.startDate)} - ${formatShortDateLabel(event.endDate)}`;
}

/**
 * Builds localized weekday headings starting on Monday.
 * Operates between Intl formatting and the month grid.
 * Exists to mirror the simple filterbar calendar convention.
 */
export function getWeekdayLabels() {
    const formatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
    return Array.from({ length: 7 }, (_, index) => {
        return formatter.format(new Date(2026, 0, 5 + index));
    });
}

/**
 * Parses a row value into a local Date.
 * Operates between database date/timestamp values and calendar day grouping.
 * Exists to handle date-only values without UTC day shifting.
 */
export function parseCalendarDate(rawValue) {
    if (rawValue instanceof Date) {
        return Number.isNaN(rawValue.getTime()) ? null : new Date(rawValue);
    }

    if (typeof rawValue === "number") {
        const parsedNumberDate = new Date(rawValue);
        return Number.isNaN(parsedNumberDate.getTime()) ? null : parsedNumberDate;
    }

    const stringValue = String(rawValue ?? "").trim();
    if (!stringValue) {
        return null;
    }

    const dateOnlyMatch = stringValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
        return new Date(
            Number(dateOnlyMatch[1]),
            Number(dateOnlyMatch[2]) - 1,
            Number(dateOnlyMatch[3])
        );
    }

    const parsedDate = new Date(stringValue.replace(" ", "T"));
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

/**
 * Returns a local midnight clone for a date.
 * Operates between Date objects and date-only comparisons.
 * Exists to prevent time-of-day from affecting grouping/navigation.
 */
export function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Converts a Date into yyyy-mm-dd in local time.
 * Operates between Date objects and grouping keys.
 * Exists to avoid UTC shifts for date-only calendar rendering.
 */
export function toLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/**
 * Parses a yyyy-mm-dd key into a local Date.
 * Operates between grouping keys and display dates.
 * Exists to reverse toLocalDateKey without timezone ambiguity.
 */
export function dateKeyToDate(dateKey) {
    const [year, month, day] = String(dateKey).split("-").map(Number);
    return new Date(year, month - 1, day);
}

/**
 * Checks local calendar-day equality.
 * Operates between month cell dates and today's date.
 * Exists to style today's cell without time comparisons.
 */
export function isSameLocalDay(firstDate, secondDate) {
    return toLocalDateKey(firstDate) === toLocalDateKey(secondDate);
}

/**
 * Builds normalized calendar events from loaded rows.
 * Operates between inferred columns and row-level start/end values.
 * Exists to centralize date parsing and inclusive range expansion.
 */
function buildCalendarEvents(
    rows,
    calendarColumns,
    columns,
    preferredLanguage,
    dataTypes
) {
    if (!calendarColumns?.startColumn) {
        return [];
    }

    return rows
        .map((row, index) => buildCalendarEvent(
            row,
            index,
            calendarColumns,
            columns,
            preferredLanguage,
            dataTypes
        ))
        .filter(Boolean);
}

/**
 * Builds one normalized event from one dataset row.
 * Operates between a raw row object and the calendar event shape used by renderers.
 * Exists so all modes share the same title, date, and range semantics.
 */
function buildCalendarEvent(
    row,
    index,
    calendarColumns,
    columns,
    preferredLanguage,
    dataTypes
) {
    const startValue = row?.[calendarColumns.startColumn];
    const startDate = parseCalendarDate(startValue);
    if (!startDate) {
        return null;
    }

    const parsedEndDate = calendarColumns.endColumn
        ? parseCalendarDate(row?.[calendarColumns.endColumn])
        : null;
    const endDate = parsedEndDate && parsedEndDate >= startOfLocalDay(startDate)
        ? parsedEndDate
        : startDate;
    const dateKeys = expandDateRangeKeys(startDate, endDate);

    return {
        row,
        index,
        title: formatRowTitle(
            row,
            calendarColumns.titleColumn,
            columns,
            preferredLanguage,
            dataTypes
        ),
        startDate,
        endDate,
        startKey: toLocalDateKey(startDate),
        endKey: toLocalDateKey(endDate),
        dateKeys,
    };
}

/**
 * Finds a column by future calendar/temporal role metadata.
 * Operates between current data_types objects and future system_column_details fields.
 * Exists as the forward-compatible path for explicit calendar roles.
 */
function findColumnByMetadataRole(columns, dataTypes, acceptedRoles) {
    const acceptedRoleSet = new Set(acceptedRoles.map(normalizeColumnName));
    return columns.find((column) => {
        const roles = getColumnMetadataRoles(dataTypes?.[column]);
        return roles.some((role) => acceptedRoleSet.has(role));
    }) || null;
}

/**
 * Reads normalized role tokens from a column metadata object.
 * Operates between flexible metadata shapes and exact role comparisons.
 * Exists so a future backend field can be added without changing render logic.
 */
function getColumnMetadataRoles(columnMetadata) {
    if (!columnMetadata || typeof columnMetadata !== "object") {
        return [];
    }

    const rawRoleValues = [
        columnMetadata.calendar_role,
        columnMetadata.calendarRole,
        columnMetadata.temporal_role,
        columnMetadata.temporalRole,
        columnMetadata.date_role,
        columnMetadata.dateRole,
    ];

    if (Array.isArray(columnMetadata.roles)) {
        rawRoleValues.push(...columnMetadata.roles);
    }

    return rawRoleValues
        .filter((value) => value != null)
        .flatMap((value) => String(value).split(/[,+\s|/]+/))
        .map(normalizeColumnName)
        .filter(Boolean);
}

/**
 * Finds the first exact normalized-name match from an ordered candidate list.
 * Operates between database column names and conservative frontend heuristics.
 * Exists to avoid broad substring guesses for temporal columns.
 */
function findColumnByNormalizedName(columns, candidateNames) {
    const columnsByNormalizedName = new Map();
    columns.forEach((column) => {
        columnsByNormalizedName.set(normalizeColumnName(column), column);
    });

    for (const candidateName of candidateNames) {
        const matchingColumn = columnsByNormalizedName.get(normalizeColumnName(candidateName));
        if (matchingColumn) {
            return matchingColumn;
        }
    }

    return null;
}

/**
 * Finds one unambiguous temporal typed column when name heuristics fail.
 * Operates between data_types hints and the available columns.
 * Exists as a conservative fallback only when there is exactly one date-like type.
 */
function findSingleTemporalTypedColumn(columns, dataTypes) {
    const temporalColumns = columns.filter((column) => {
        const rawMetadata = dataTypes?.[column];
        const rawDataType = typeof rawMetadata === "object"
            ? rawMetadata?.data_type
            : rawMetadata;
        const dataType = String(rawDataType || "").toLowerCase();
        return TEMPORAL_DATA_TYPE_HINTS.some((hint) => dataType.includes(hint));
    });

    return temporalColumns.length === 1 ? temporalColumns[0] : null;
}

/**
 * Infers a readable title column for event previews.
 * Operates between all columns and inferred date columns.
 * Exists to show useful row labels without requiring calendar metadata.
 */
function inferTitleColumn(columns, dateColumn, endColumn) {
    const titleColumn = findColumnByNormalizedName(columns, TITLE_COLUMN_CANDIDATES);
    if (titleColumn) {
        return titleColumn;
    }

    return columns.find((column) => {
        const normalized = normalizeColumnName(column);
        return column !== dateColumn
            && column !== endColumn
            && normalized !== "id"
            && normalized !== "oid";
    }) || "id";
}

/**
 * Formats the best available row title.
 * Operates between row values and display-only calendar labels.
 * Exists to keep previews readable while preserving safe textContent rendering.
 */
function formatRowTitle(row, titleColumn, columns, preferredLanguage, dataTypes) {
    const titleValue = stringifyCalendarValue(
        row?.[titleColumn],
        preferredLanguage,
        dataTypes?.[titleColumn]?.is_multilingual ?? null
    );
    if (titleValue) {
        return titleValue;
    }

    const idValue = stringifyCalendarValue(row?.id ?? row?.ID, preferredLanguage, false);
    if (idValue) {
        return `#${idValue}`;
    }

    const fallbackColumn = columns.find((column) => {
        return stringifyCalendarValue(
            row?.[column],
            preferredLanguage,
            dataTypes?.[column]?.is_multilingual ?? null
        );
    });
    return fallbackColumn
        ? stringifyCalendarValue(
            row?.[fallbackColumn],
            preferredLanguage,
            dataTypes?.[fallbackColumn]?.is_multilingual ?? null
        )
        : "Untitled row";
}

/**
 * Converts a row value into a compact display string.
 * Operates between scalar or multilingual-like row values and text-only DOM output.
 * Exists so JSON language values do not render as [object Object].
 */
function stringifyCalendarValue(value, preferredLanguage, isMultilingual) {
    if (value == null) {
        return "";
    }

    const metadata = isMultilingual == null ? null : { is_multilingual: isMultilingual };
    return resolveDatasetDisplayValue(value, metadata, preferredLanguage).trim();
}

/**
 * Expands an inclusive event range into local date keys.
 * Operates between parsed start/end dates and grouped calendar buckets.
 * Exists so range events appear on each occupied day.
 */
function expandDateRangeKeys(startDate, endDate) {
    const keys = [];
    const start = startOfLocalDay(startDate);
    const end = startOfLocalDay(endDate);

    if (end < start) {
        return [toLocalDateKey(start)];
    }

    const totalDays = Math.floor((end - start) / DAY_IN_MS) + 1;
    const daysToExpand = Math.min(totalDays, MAX_RANGE_DAYS_TO_EXPAND);
    for (let dayIndex = 0; dayIndex < daysToExpand; dayIndex += 1) {
        keys.push(toLocalDateKey(addDays(start, dayIndex)));
    }
    return keys;
}

/**
 * Compares normalized events for stable list ordering.
 * Operates between two event objects.
 * Exists so re-rendered buckets stay predictable.
 */
function compareCalendarEvents(firstEvent, secondEvent) {
    return firstEvent.startKey.localeCompare(secondEvent.startKey)
        || firstEvent.title.localeCompare(secondEvent.title)
        || firstEvent.index - secondEvent.index;
}

/**
 * Adds local days to a Date.
 * Operates between date math helpers and navigation/range rendering.
 * Exists to keep daylight-saving transitions out of simple day increments.
 */
function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * Adds local months to a Date and clamps to the target month.
 * Operates between navigation controls and month/agenda modes.
 * Exists to avoid Date overflow skipping short months.
 */
function addMonths(date, months) {
    const targetMonthStart = new Date(date.getFullYear(), date.getMonth() + months, 1);
    const daysInTargetMonth = new Date(
        targetMonthStart.getFullYear(),
        targetMonthStart.getMonth() + 1,
        0
    ).getDate();
    return new Date(
        targetMonthStart.getFullYear(),
        targetMonthStart.getMonth(),
        Math.min(date.getDate(), daysInTargetMonth)
    );
}

/**
 * Returns the Monday for a date's ISO-style week.
 * Operates between Date objects and week list boundaries.
 * Exists to match the filterbar calendar's Monday-first convention.
 */
function getMondayOfWeek(date) {
    const day = date.getDay() || 7;
    return addDays(date, 1 - day);
}

/**
 * Normalizes a column or role string for exact comparisons.
 * Operates between human-readable DB labels and code heuristics.
 * Exists to support Finnish accents and common separator differences.
 */
function normalizeColumnName(columnName) {
    return String(columnName || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}
