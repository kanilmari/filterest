// calendar_view_printer.js
// Renders loaded dataset rows into month, week, day, and agenda calendar views.
// Bridges inferred temporal columns, row data, and DOM-only table view rendering.
// Exists to provide a no-dependency calendar view that can later accept explicit column metadata.

import {
    chooseInitialViewDate,
    dateKeyToDate,
    formatDateLabel,
    formatEventRange,
    formatViewTitle,
    getMonthDateKeys,
    getShiftedViewDate,
    getWeekDateKeys,
    getWeekdayLabels,
    groupCalendarRowsByDate,
    inferCalendarColumns,
    isSameLocalDay,
    startOfLocalDay,
    toLocalDateKey,
} from "./calendar_view_helpers.js";
import { openRowArticleView } from "../card_view/row_article_opener.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import { setUnifiedTableState } from "../../state_stores/table_state_store.js";
import {
    bindDatasetLanguageRenderer,
    refreshLocalizedDatasetValues,
} from "../dataset_value_localizer.js";

const CALENDAR_MODES = [
    { key: "month", label: "Month", langKey: "calendar_month" },
    { key: "week", label: "Week", langKey: "calendar_week" },
    { key: "day", label: "Day", langKey: "calendar_day" },
    { key: "agenda", label: "Agenda", langKey: "calendar_agenda" },
];

const MAX_MONTH_TEXT_ROWS = 6;
const MAX_MONTH_PREVIEW_EVENTS = 5;
const NO_EVENTS_LABEL = "No events";
const NO_EVENTS_LANG_KEY = "calendar_no_events";

/**
 * Creates the standalone calendar view element for a dataset.
 * Operates between dataset rows/column metadata and the rendered calendar DOM.
 * Exists as the integration entry point for dataset_view_printer.js.
 */
export function create_calendar_view(table_name, columns, data, data_types = {}) {
    const safeColumns = Array.isArray(columns) ? columns : [];
    const safeRows = Array.isArray(data) ? data : [];
    const calendarColumns = inferCalendarColumns(safeColumns, data_types);

    const root = document.createElement("section");
    root.classList.add("calendar-view");
    root.dataset.datasetName = table_name;
    root.dataset.testid = "calendar-view";

    if (!calendarColumns.dateColumn) {
        root.appendChild(createNoticeElement(
            "No calendar date column found",
            "calendar_no_date_column"
        ));
        return root;
    }

    const groupedEvents = groupCalendarRowsByDate(
        safeRows,
        calendarColumns,
        safeColumns,
        getLanguageWithBrowserFallback(),
        data_types
    );

    const state = {
        mode: "month",
        tableName: table_name,
        viewDate: chooseInitialViewDate(groupedEvents),
        groupedEvents,
        calendarColumns,
        rows: safeRows,
        columns: safeColumns,
        dataTypes: data_types,
    };

    const render = () => renderCalendarRoot(root, state, render);
    bindDatasetLanguageRenderer(root, (chosenLanguage) => {
        state.groupedEvents = groupCalendarRowsByDate(
            state.rows,
            state.calendarColumns,
            state.columns,
            chosenLanguage,
            state.dataTypes
        );
        render();
    });
    return root;
}

/**
 * Refreshes visible calendar event titles after the active language changes.
 * Operates between retained raw row data and already mounted calendar roots.
 * Exists so language switching updates calendar labels without refetching or mutating rows.
 *
 * @param {string} chosenLanguage - Active UI language code.
 */
export function refreshCalendarLanguages(
    chosenLanguage = getLanguageWithBrowserFallback()
) {
    return refreshLocalizedDatasetValues(chosenLanguage, document);
}

/**
 * Renders the calendar root for the current mode/date state.
 * Operates between mutable view state and the DOM section returned to the caller.
 * Exists to rebuild the simple no-dependency view after tab or navigation changes.
 */
function renderCalendarRoot(root, state, render) {
    root.replaceChildren();
    root.appendChild(createToolbarElement(state, render));

    const body = document.createElement("div");
    body.classList.add("calendar-view__body");

    if (state.mode === "month") {
        body.appendChild(createMonthGridElement(state, render));
    } else if (state.mode === "week") {
        body.appendChild(createWeekGridElement(
            "week",
            getWeekDateKeys(state.viewDate),
            state
        ));
    } else if (state.mode === "day") {
        body.appendChild(createWeekGridElement(
            "day",
            [toLocalDateKey(state.viewDate)],
            state
        ));
    } else {
        body.appendChild(createAgendaListElement(getMonthDateKeys(state.viewDate), state));
    }

    root.appendChild(body);
}

/**
 * Builds the mode tabs and previous/today/next controls.
 * Operates between calendar state and user navigation events.
 * Exists to keep all modes navigable without external UI dependencies.
 */
function createToolbarElement(state, render) {
    const toolbar = document.createElement("div");
    toolbar.classList.add("calendar-view__toolbar");

    const navGroup = document.createElement("div");
    navGroup.classList.add("calendar-view__nav-group");
    navGroup.appendChild(createNavigationButton("‹", "Previous", () => {
        state.viewDate = getShiftedViewDate(state.viewDate, state.mode, -1);
        render();
    }));

    const todayButton = createNavigationButton("Today", "Today", () => {
        state.viewDate = startOfLocalDay(new Date());
        render();
    });
    todayButton.classList.add("calendar-view__today-button");
    todayButton.dataset.langKey = "calendar_today";
    navGroup.appendChild(todayButton);

    navGroup.appendChild(createNavigationButton("›", "Next", () => {
        state.viewDate = getShiftedViewDate(state.viewDate, state.mode, 1);
        render();
    }));

    const title = document.createElement("div");
    title.classList.add("calendar-view__title");
    title.textContent = formatViewTitle(state.viewDate, state.mode);

    const modeGroup = document.createElement("div");
    modeGroup.classList.add("calendar-view__mode-tabs");
    CALENDAR_MODES.forEach((mode) => {
        modeGroup.appendChild(createModeButton(mode, state, render));
    });

    toolbar.appendChild(navGroup);
    toolbar.appendChild(title);
    toolbar.appendChild(modeGroup);
    return toolbar;
}

/**
 * Builds one mode-switching button.
 * Operates between mode config and mutable calendar state.
 * Exists to keep tab labels translation-ready through data-lang-key.
 */
function createModeButton(mode, state, render) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("calendar-view__mode-button");
    button.dataset.mode = mode.key;
    button.dataset.langKey = mode.langKey;
    button.textContent = mode.label;
    button.setAttribute("aria-pressed", state.mode === mode.key ? "true" : "false");
    if (state.mode === mode.key) {
        button.classList.add("calendar-view__mode-button--active");
    }
    button.addEventListener("click", () => {
        state.mode = mode.key;
        render();
    });
    return button;
}

/**
 * Creates a toolbar navigation button.
 * Operates between a label and a click handler.
 * Exists to keep previous/today/next buttons consistent.
 */
function createNavigationButton(label, ariaLabel, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("calendar-view__nav-button");
    button.textContent = label;
    button.setAttribute("aria-label", ariaLabel);
    button.addEventListener("click", onClick);
    return button;
}

/**
 * Creates the fixed six-row month grid.
 * Operates between the active month and date-keyed event buckets.
 * Exists to show event counts and a few row titles per day.
 */
function createMonthGridElement(state, render) {
    const grid = document.createElement("div");
    grid.classList.add("calendar-view__month-grid");
    grid.dataset.testid = "calendar-month-grid";

    getWeekdayLabels().forEach((label) => {
        const headerCell = document.createElement("div");
        headerCell.classList.add("calendar-view__weekday-header");
        headerCell.textContent = label;
        grid.appendChild(headerCell);
    });

    const year = state.viewDate.getFullYear();
    const month = state.viewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    let dayNumber = 1 - startOffset;

    for (let cellIndex = 0; cellIndex < 42; cellIndex += 1, dayNumber += 1) {
        const cellDate = new Date(year, month, dayNumber);
        const dateKey = toLocalDateKey(cellDate);
        const eventsForDay = state.groupedEvents.get(dateKey) || [];
        grid.appendChild(createMonthDayCell(
            cellDate,
            month,
            eventsForDay,
            state,
            () => {
                state.viewDate = startOfLocalDay(cellDate);
                state.mode = "day";
                render();
            }
        ));
    }

    return grid;
}

/**
 * Creates one month-grid day cell.
 * Operates between a date, grouped events, and a day navigation callback.
 * Exists to keep month cells stable and safe for arbitrary row text.
 */
function createMonthDayCell(cellDate, activeMonth, eventsForDay, state, onOpenDay) {
    const cell = document.createElement("div");
    cell.classList.add("calendar-view__month-day");
    cell.dataset.date = toLocalDateKey(cellDate);
    if (cellDate.getMonth() !== activeMonth) {
        cell.classList.add("calendar-view__month-day--outside");
    }
    if (isSameLocalDay(cellDate, new Date())) {
        cell.classList.add("calendar-view__month-day--today");
    }

    const dayButton = document.createElement("button");
    dayButton.type = "button";
    dayButton.classList.add("calendar-view__day-number");
    dayButton.textContent = String(cellDate.getDate());
    dayButton.setAttribute("aria-label", formatDateLabel(cellDate));
    dayButton.addEventListener("click", onOpenDay);
    cell.appendChild(dayButton);

    if (eventsForDay.length > 0) {
        appendMonthEventPreview(cell, eventsForDay, state);
    }

    return cell;
}

/**
 * Appends event count and preview labels to a month cell.
 * Operates between grouped events and the month cell DOM.
 * Exists to keep month-day construction readable.
 */
function appendMonthEventPreview(cell, eventsForDay, state) {
    const count = document.createElement("div");
    count.classList.add("calendar-view__event-count");
    count.textContent = `${eventsForDay.length}`;
    count.setAttribute("aria-label", `${eventsForDay.length} events`);
    cell.appendChild(count);

    const previewList = document.createElement("div");
    previewList.classList.add("calendar-view__event-preview-list");
    const renderedEventCount = Math.min(eventsForDay.length, MAX_MONTH_PREVIEW_EVENTS);
    const hasOverflowCount = eventsForDay.length > renderedEventCount;
    const visibleTextRows = renderedEventCount + (hasOverflowCount ? 1 : 0);
    const linesPerEvent = Math.max(1, Math.floor(MAX_MONTH_TEXT_ROWS / Math.max(1, visibleTextRows)));
    previewList.style.setProperty("--calendar-month-event-lines", String(linesPerEvent));
    eventsForDay.slice(0, MAX_MONTH_PREVIEW_EVENTS).forEach((event) => {
        previewList.appendChild(createEventButton(event, state, {
            className: "calendar-view__event-preview",
            includeRange: false,
        }));
    });

    if (eventsForDay.length > MAX_MONTH_PREVIEW_EVENTS) {
        const more = document.createElement("div");
        more.classList.add("calendar-view__event-preview-more");
        more.textContent = `+${eventsForDay.length - MAX_MONTH_PREVIEW_EVENTS}`;
        previewList.appendChild(more);
    }

    cell.appendChild(previewList);
}

/**
 * Creates a Teams-style side-by-side week grid or a one-day slice of it.
 * Operates between visible date keys, grouped event buckets, and row open behavior.
 * Exists to make week/day modes spatially consistent while keeping every event clickable.
 */
function createWeekGridElement(mode, visibleDateKeys, state) {
    const weekGrid = document.createElement("div");
    weekGrid.classList.add("calendar-view__week-grid", `calendar-view__week-grid--${mode}`);
    weekGrid.dataset.testid = `calendar-${mode}-grid`;

    visibleDateKeys.forEach((dateKey) => {
        const eventsForDay = state.groupedEvents.get(dateKey) || [];
        weekGrid.appendChild(createWeekDayColumn(dateKey, eventsForDay, state));
    });

    return weekGrid;
}

/**
 * Creates one day column for week and day modes.
 * Operates between a date bucket and safe event buttons.
 * Exists so empty and populated day slices share one accessible layout.
 */
function createWeekDayColumn(dateKey, eventsForDay, state) {
    const section = document.createElement("section");
    section.classList.add("calendar-view__week-day");
    section.dataset.date = dateKey;
    if (isSameLocalDay(dateKeyToDate(dateKey), new Date())) {
        section.classList.add("calendar-view__week-day--today");
    }

    const heading = document.createElement("h3");
    heading.classList.add("calendar-view__week-day-heading");
    heading.textContent = formatDateLabel(dateKeyToDate(dateKey));
    section.appendChild(heading);

    if (eventsForDay.length === 0) {
        section.appendChild(createEmptyDayElement("calendar-view__week-day-empty"));
        return section;
    }

    section.appendChild(createEventList(eventsForDay, state));
    return section;
}

/**
 * Creates the compact month agenda with event days and collapsed empty ranges.
 * Operates between every date in the active month and grouped event buckets.
 * Exists to avoid blank spatial gaps while still acknowledging empty days.
 */
function createAgendaListElement(visibleDateKeys, state) {
    const agenda = document.createElement("div");
    agenda.classList.add("calendar-view__agenda-list");
    agenda.dataset.testid = "calendar-agenda-list";

    for (let index = 0; index < visibleDateKeys.length; index += 1) {
        const dateKey = visibleDateKeys[index];
        const eventsForDay = state.groupedEvents.get(dateKey) || [];
        if (eventsForDay.length > 0) {
            agenda.appendChild(createAgendaDaySection(dateKey, eventsForDay, state));
            continue;
        }

        const emptyRangeStart = dateKey;
        let emptyRangeEnd = dateKey;
        while (index + 1 < visibleDateKeys.length) {
            const nextDateKey = visibleDateKeys[index + 1];
            if ((state.groupedEvents.get(nextDateKey) || []).length > 0) {
                break;
            }
            emptyRangeEnd = nextDateKey;
            index += 1;
        }
        agenda.appendChild(createEmptyDateRangeSection(emptyRangeStart, emptyRangeEnd));
    }

    return agenda;
}

/**
 * Creates one dated section for agenda event groups.
 * Operates between one date key and that date's events.
 * Exists to make agenda output easy to scan.
 */
function createAgendaDaySection(dateKey, eventsForDay, state) {
    const section = document.createElement("section");
    section.classList.add("calendar-view__day-section");
    section.dataset.date = dateKey;

    const heading = document.createElement("h3");
    heading.classList.add("calendar-view__day-heading");
    heading.textContent = formatDateLabel(dateKeyToDate(dateKey));
    section.appendChild(heading);

    section.appendChild(createEventList(eventsForDay, state));
    return section;
}

/**
 * Creates one compact empty agenda range section.
 * Operates between one or more consecutive date keys and the agenda DOM.
 * Exists to collapse empty days without hiding that no events are scheduled.
 */
function createEmptyDateRangeSection(startDateKey, endDateKey) {
    const section = document.createElement("section");
    section.classList.add("calendar-view__day-section", "calendar-view__day-section--empty-range");
    section.dataset.dateRange = `${startDateKey}:${endDateKey}`;
    section.dataset.testid = "calendar-empty-date-range";

    const heading = document.createElement("h3");
    heading.classList.add("calendar-view__day-heading");
    heading.textContent = formatDateRangeHeading(startDateKey, endDateKey);
    section.appendChild(heading);
    section.appendChild(createEmptyDayElement("calendar-view__day-empty"));
    return section;
}

/**
 * Creates an ordered list of clickable event rows.
 * Operates between normalized event data and row article opening.
 * Exists to reuse the same accessible event button structure in week/day/agenda modes.
 */
function createEventList(eventsForDay, state) {
    const list = document.createElement("ol");
    list.classList.add("calendar-view__event-list");
    eventsForDay.forEach((event) => {
        list.appendChild(createEventListItem(event, state));
    });
    return list;
}

/**
 * Creates one event row for list-like views.
 * Operates between normalized event data and safe textContent output.
 * Exists to avoid embedding row values through HTML strings.
 */
function createEventListItem(event, state) {
    const item = document.createElement("li");
    item.classList.add("calendar-view__event-row");
    item.appendChild(createEventButton(event, state, {
        className: "calendar-view__event-button",
        includeRange: true,
    }));
    return item;
}

/**
 * Creates one accessible event button that opens the existing row article view.
 * Operates between a normalized calendar event and card-view article opener.
 * Exists so every visible event affordance behaves like a normal card title click.
 */
function createEventButton(event, state, { className, includeRange }) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add(className);
    button.dataset.testid = "calendar-event-button";
    if (event.row?.id != null) {
        button.dataset.rowId = String(event.row.id);
    }

    const title = document.createElement("span");
    title.classList.add("calendar-view__event-title");
    title.textContent = event.title;
    button.appendChild(title);

    if (includeRange) {
        const dateRange = document.createElement("span");
        dateRange.classList.add("calendar-view__event-range");
        dateRange.textContent = formatEventRange(event);
        button.appendChild(dateRange);
    }

    button.setAttribute("aria-label", `${event.title}, ${formatEventRange(event)}`);
    button.addEventListener("click", (clickEvent) => {
        clickEvent.preventDefault();
        openCalendarEventArticle(event, state, button);
    });
    return button;
}

async function openCalendarEventArticle(event, state, button) {
    const rowId = event.row?.id;
    if (rowId == null) {
        openRowArticleView(event.row, state.tableName, button);
        return;
    }

    const returnView = localStorage.getItem(`${state.tableName}_view`) || "calendar";
    localStorage.setItem(`${state.tableName}_view`, "card");
    setUnifiedTableState(state.tableName, {
        cardView: {
            collapsed: true,
            expandedId: rowId,
            returnView,
        },
    });

    const { refreshTableUnified } = await import(
        "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js"
    );
    await refreshTableUnified(state.tableName, { skipUrlParams: true });
}

/**
 * Creates the reusable empty-day text element.
 * Operates between empty date sections and translation-ready fallback text.
 * Exists to keep empty week/day/agenda states accessible and visually muted.
 */
function createEmptyDayElement(className) {
    const empty = document.createElement("p");
    empty.classList.add(className);
    empty.dataset.langKey = NO_EVENTS_LANG_KEY;
    empty.textContent = NO_EVENTS_LABEL;
    empty.setAttribute("aria-label", NO_EVENTS_LABEL);
    return empty;
}

/**
 * Formats an agenda heading for one day or a collapsed empty range.
 * Operates between local date keys and locale-aware date labels.
 * Exists so empty ranges remain compact without losing their dates.
 */
function formatDateRangeHeading(startDateKey, endDateKey) {
    if (startDateKey === endDateKey) {
        return formatDateLabel(dateKeyToDate(startDateKey));
    }
    return `${formatDateLabel(dateKeyToDate(startDateKey))} - ${formatDateLabel(dateKeyToDate(endDateKey))}`;
}

/**
 * Creates a small empty-state or missing-metadata notice.
 * Operates between static fallback text and optional translation keys.
 * Exists to keep all messages DOM-safe and translatable later.
 */
function createNoticeElement(message, langKey) {
    const notice = document.createElement("div");
    notice.classList.add("calendar-view__notice");
    notice.dataset.langKey = langKey;
    notice.textContent = message;
    return notice;
}
