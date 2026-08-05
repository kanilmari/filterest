// calendar_view_helpers.test.js
// Verifies calendar date-column inference and local-day event grouping.
// Bridges future metadata roles, name heuristics, and row date ranges under test.
// Exists to keep the no-dependency calendar view stable as metadata support grows.

import { describe, expect, test } from "vitest";
import {
    groupCalendarRowsByDate,
    inferCalendarColumns,
    getMonthDateKeys,
    parseCalendarDate,
    toLocalDateKey,
} from "./calendar_view_helpers.js";

describe("calendar_view_helpers", () => {
    test("prefers explicit metadata roles for start and end columns", () => {
        const inferred = inferCalendarColumns(
            ["id", "planned_from", "planned_until", "name"],
            {
                planned_from: { calendar_role: "calendar_start" },
                planned_until: { calendar_role: "calendar_end" },
            }
        );

        expect(inferred.startColumn).toBe("planned_from");
        expect(inferred.endColumn).toBe("planned_until");
        expect(inferred.titleColumn).toBe("name");
        expect(inferred.source).toBe("metadata_range");
    });

    test("falls back to conservative date-name and type heuristics", () => {
        expect(inferCalendarColumns(["id", "created_at"], {}).dateColumn)
            .toBe("created_at");

        expect(inferCalendarColumns(["id", "custom_when"], {
            custom_when: { data_type: "timestamp with time zone" },
        }).dateColumn).toBe("custom_when");
    });

    test("parses date-only values as local dates without UTC day shifting", () => {
        const parsed = parseCalendarDate("2026-04-29");

        expect(toLocalDateKey(parsed)).toBe("2026-04-29");
    });

    test("builds every local date key for the active agenda month", () => {
        expect(getMonthDateKeys(new Date(2026, 1, 10))).toHaveLength(28);
        expect(getMonthDateKeys(new Date(2026, 1, 10)).at(0)).toBe("2026-02-01");
        expect(getMonthDateKeys(new Date(2026, 1, 10)).at(-1)).toBe("2026-02-28");
    });

    test("groups range events onto every occupied local date", () => {
        const calendarColumns = inferCalendarColumns(
            ["id", "title", "start_date", "end_date"],
            {}
        );
        const grouped = groupCalendarRowsByDate(
            [
                {
                    id: 1,
                    title: "Release window",
                    start_date: "2026-04-29",
                    end_date: "2026-05-01",
                },
            ],
            calendarColumns,
            ["id", "title", "start_date", "end_date"]
        );

        expect(Array.from(grouped.keys())).toEqual([
            "2026-04-29",
            "2026-04-30",
            "2026-05-01",
        ]);
        expect(grouped.get("2026-04-30")?.[0]?.title).toBe("Release window");
    });

    test("shows only the active language in calendar titles without changing raw rows", () => {
        const rawTitle = JSON.stringify({
            en: "Service review",
            fi: "Palvelukatselmus",
            yue: "服務檢視",
        });
        const row = {
            id: 7,
            title: rawTitle,
            event_date: "2026-04-29",
        };
        const calendarColumns = inferCalendarColumns(
            ["id", "title", "event_date"],
            {}
        );

        const grouped = groupCalendarRowsByDate(
            [row],
            calendarColumns,
            ["id", "title", "event_date"],
            "fi",
            { title: { is_multilingual: true } }
        );

        expect(grouped.get("2026-04-29")?.[0]?.title).toBe("Palvelukatselmus");
        expect(row.title).toBe(rawTitle);
    });

    test("preserves ordinary JSON when metadata explicitly disables multilingual rendering", () => {
        const ordinaryJson = JSON.stringify({ name: "Service review", count: 2 });
        const calendarColumns = inferCalendarColumns(
            ["id", "title", "event_date"],
            {}
        );

        const grouped = groupCalendarRowsByDate(
            [{ id: 8, title: ordinaryJson, event_date: "2026-04-30" }],
            calendarColumns,
            ["id", "title", "event_date"],
            "fi",
            { title: { is_multilingual: false } }
        );

        expect(grouped.get("2026-04-30")?.[0]?.title).toBe(ordinaryJson);
    });
});
