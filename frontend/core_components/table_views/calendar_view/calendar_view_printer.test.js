// @vitest-environment jsdom
// calendar_view_printer.test.js
// Verifies calendar column inference, row grouping, and core DOM rendering.
// Bridges pure helper behavior and the standalone calendar view entry point.
// Exists to keep the calendar MVP stable before dataset_view_printer.js wires it in.

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    openRowArticleViewMock,
    refreshTableUnifiedMock,
    setUnifiedTableStateMock,
} = vi.hoisted(() => ({
    openRowArticleViewMock: vi.fn(),
    refreshTableUnifiedMock: vi.fn(),
    setUnifiedTableStateMock: vi.fn(),
}));

vi.mock("../card_view/row_article_opener.js", () => ({
    openRowArticleView: openRowArticleViewMock,
}));

vi.mock("../../state_stores/table_state_store.js", () => ({
    setUnifiedTableState: setUnifiedTableStateMock,
}));

vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    refreshTableUnified: refreshTableUnifiedMock,
}));

import {
    create_calendar_view,
    refreshCalendarLanguages,
} from "./calendar_view_printer.js";
import {
    groupCalendarRowsByDate,
    inferCalendarColumns,
    parseCalendarDate,
    toLocalDateKey,
} from "./calendar_view_helpers.js";

describe("calendar_view_helpers", () => {
    test("prefers conservative primary date names over created timestamps", () => {
        const inferred = inferCalendarColumns(
            ["id", "created", "due_date", "title"],
            {
                created: { data_type: "timestamp with time zone" },
                due_date: { data_type: "date" },
            }
        );

        expect(inferred).toMatchObject({
            dateColumn: "due_date",
            startColumn: "due_date",
            endColumn: null,
            titleColumn: "title",
        });
    });

    test("uses start/end columns as an inclusive range", () => {
        const inferred = inferCalendarColumns(
            ["id", "name", "start_date", "end_date", "created"],
            {}
        );

        expect(inferred).toMatchObject({
            dateColumn: "start_date",
            startColumn: "start_date",
            endColumn: "end_date",
            titleColumn: "name",
            source: "name_range",
        });
    });

    test("accepts future calendar role metadata when present", () => {
        const inferred = inferCalendarColumns(
            ["id", "label", "begins_on", "closes_on"],
            {
                begins_on: { calendar_role: "calendar_start" },
                closes_on: { temporal_role: "calendar_end" },
            }
        );

        expect(inferred).toMatchObject({
            startColumn: "begins_on",
            endColumn: "closes_on",
            titleColumn: "label",
            source: "metadata_range",
        });
    });

    test("groups range rows across every occupied local day", () => {
        const columns = ["id", "title", "start_date", "end_date"];
        const inferred = inferCalendarColumns(columns, {});
        const grouped = groupCalendarRowsByDate(
            [
                {
                    id: 1,
                    title: "Sprint",
                    start_date: "2026-04-01",
                    end_date: "2026-04-03",
                },
                {
                    id: 2,
                    title: "Review",
                    start_date: "2026-04-03",
                    end_date: null,
                },
                {
                    id: 3,
                    title: "No date",
                    start_date: "",
                    end_date: "",
                },
            ],
            inferred,
            columns
        );

        expect(Array.from(grouped.keys())).toEqual([
            "2026-04-01",
            "2026-04-02",
            "2026-04-03",
        ]);
        expect(grouped.get("2026-04-01").map((event) => event.title)).toEqual(["Sprint"]);
        expect(grouped.get("2026-04-03").map((event) => event.title)).toEqual([
            "Sprint",
            "Review",
        ]);
    });

    test("keeps date-only values on their local calendar day", () => {
        expect(toLocalDateKey(parseCalendarDate("2026-04-29"))).toBe("2026-04-29");
    });
});

describe("create_calendar_view", () => {
    beforeEach(() => {
        document.documentElement.lang = "en";
        document.body.innerHTML = "";
        localStorage.clear();
        openRowArticleViewMock.mockReset();
        refreshTableUnifiedMock.mockReset();
        refreshTableUnifiedMock.mockResolvedValue(undefined);
        setUnifiedTableStateMock.mockReset();
    });

    test("renders mode buttons, month counts, safe row titles, and clickable events", async () => {
        const row = {
            id: 1,
            title: "<b>Launch</b>",
            event_date: "2026-04-15",
        };
        const view = create_calendar_view(
            "events",
            ["id", "title", "event_date"],
            [row],
            { event_date: { data_type: "date" } }
        );

        document.body.appendChild(view);

        expect(view.querySelector('[data-testid="calendar-month-grid"]')).not.toBeNull();
        expect(view.querySelectorAll(".calendar-view__mode-button")).toHaveLength(4);
        expect(view.querySelector('[data-lang-key="calendar_month"]')?.textContent).toBe("Month");

        const eventDay = view.querySelector('[data-date="2026-04-15"]');
        expect(eventDay?.querySelector(".calendar-view__event-count")?.textContent).toBe("1");
        expect(eventDay?.querySelector(".calendar-view__event-preview")?.textContent).toBe("<b>Launch</b>");

        const eventButton = eventDay?.querySelector('[data-testid="calendar-event-button"]');
        expect(eventButton?.tagName).toBe("BUTTON");
        eventButton?.click();

        await vi.waitFor(() => expect(refreshTableUnifiedMock).toHaveBeenCalled());
        expect(localStorage.getItem("events_view")).toBe("card");
        expect(setUnifiedTableStateMock).toHaveBeenCalledWith("events", {
            cardView: {
                collapsed: true,
                expandedId: 1,
                returnView: "calendar",
            },
        });
        expect(refreshTableUnifiedMock).toHaveBeenCalledWith("events", {
            skipUrlParams: true,
        });
        expect(openRowArticleViewMock).not.toHaveBeenCalled();
    });

    test("switches to a seven-column week grid from the internal tabs", () => {
        const view = create_calendar_view(
            "events",
            ["id", "title", "event_date"],
            [{ id: 1, title: "Launch", event_date: "2026-04-15" }],
            {}
        );

        document.body.appendChild(view);
        view.querySelector('[data-mode="week"]').click();

        expect(view.querySelector('[data-testid="calendar-week-grid"]')).not.toBeNull();
        expect(view.querySelectorAll(".calendar-view__week-day")).toHaveLength(7);
        expect(view.querySelector('[data-mode="week"]').getAttribute("aria-pressed")).toBe("true");
    });

    test("compacts dense month cells into a six-row text budget", () => {
        const rows = Array.from({ length: 6 }, (_, index) => ({
            id: index + 1,
            title: `Long event title ${index + 1}`,
            event_date: "2026-04-15",
        }));
        const view = create_calendar_view(
            "events",
            ["id", "title", "event_date"],
            rows,
            {}
        );

        document.body.appendChild(view);

        const eventDay = view.querySelector('[data-date="2026-04-15"]');
        const previewList = eventDay?.querySelector(".calendar-view__event-preview-list");

        expect(previewList?.style.getPropertyValue("--calendar-month-event-lines")).toBe("1");
        expect(eventDay?.querySelectorAll(".calendar-view__event-preview")).toHaveLength(5);
        expect(eventDay?.querySelector(".calendar-view__event-preview-more")?.textContent).toBe("+1");
    });

    test("renders day mode as one slice of the week grid", () => {
        const view = create_calendar_view(
            "events",
            ["id", "title", "event_date"],
            [{ id: 1, title: "Launch", event_date: "2026-04-15" }],
            {}
        );

        document.body.appendChild(view);
        view.querySelector('[data-mode="day"]').click();

        expect(view.querySelector('[data-testid="calendar-day-grid"]')).not.toBeNull();
        expect(view.querySelectorAll(".calendar-view__week-day")).toHaveLength(1);
        expect(view.querySelector(".calendar-view__week-day")?.dataset.date).toBe("2026-04-15");
    });

    test("renders agenda days compactly and collapses consecutive empty days", () => {
        const view = create_calendar_view(
            "events",
            ["id", "title", "event_date"],
            [
                { id: 1, title: "Kickoff", event_date: "2026-04-02" },
                { id: 2, title: "Review", event_date: "2026-04-05" },
            ],
            {}
        );

        document.body.appendChild(view);
        view.querySelector('[data-mode="agenda"]').click();

        const agenda = view.querySelector('[data-testid="calendar-agenda-list"]');
        const emptyRanges = Array.from(
            view.querySelectorAll('[data-testid="calendar-empty-date-range"]')
        );

        expect(agenda).not.toBeNull();
        expect(view.querySelectorAll(".calendar-view__day-section[data-date]")).toHaveLength(2);
        expect(emptyRanges.map((section) => section.dataset.dateRange)).toEqual([
            "2026-04-01:2026-04-01",
            "2026-04-03:2026-04-04",
            "2026-04-06:2026-04-30",
        ]);
        expect(emptyRanges[1]?.querySelector(".calendar-view__day-empty")?.textContent).toBe("No events");
        expect(emptyRanges[1]?.querySelector(".calendar-view__day-empty")?.dataset.langKey).toBe("calendar_no_events");
    });

    test("refreshes multilingual event titles from retained raw data", () => {
        const rawTitle = JSON.stringify({
            en: "Planning session",
            fi: "Suunnittelutuokio",
        });
        const row = {
            id: 1,
            title: rawTitle,
            event_date: "2026-04-15",
        };
        const view = create_calendar_view(
            "events",
            ["id", "title", "event_date"],
            [row],
            { title: { data_type: "text", is_multilingual: true } }
        );
        document.body.appendChild(view);

        expect(view.querySelector(".calendar-view__event-title")?.textContent)
            .toBe("Planning session");

        refreshCalendarLanguages("fi");

        expect(view.querySelector(".calendar-view__event-title")?.textContent)
            .toBe("Suunnittelutuokio");
        expect(row.title).toBe(rawTitle);
    });
});
