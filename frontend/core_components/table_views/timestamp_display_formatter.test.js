// timestamp_display_formatter.test.js
// Verifies compact timestamp display values keep precise hover text available.
// Bridges shared timestamp formatting and table/card/article render paths.
// Exists so seconds stay out of visible UI without losing full timestamp context.

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
    DATE_TIME_DISPLAY_SEPARATOR,
    formatTimestampDisplayParts,
    formatTimestampDisplayText,
    isTimestampColumn,
    normalizeTimestampDisplayMode,
    TIMESTAMP_DISPLAY_MODE_DATE_ONLY,
    TIMESTAMP_DISPLAY_MODE_DATE_TIME,
} from "./timestamp_display_formatter.js";

function displayDateTime(dateText, timeText) {
    return `${dateText}${DATE_TIME_DISPLAY_SEPARATOR}${timeText}`;
}

describe("timestamp_display_formatter", () => {
    const originalTimezone = process.env.TZ;

    beforeAll(() => {
        process.env.TZ = "Asia/Hong_Kong";
    });

    afterAll(() => {
        if (originalTimezone === undefined) {
            delete process.env.TZ;
        } else {
            process.env.TZ = originalTimezone;
        }
    });

    test("formats timestamp metadata without visible seconds", () => {
        expect(formatTimestampDisplayParts("2026-06-15T21:36:10", "timestamp")).toEqual({
            displayText: displayDateTime("2026-06-15", "21:36"),
            titleText: "2026-06-15 21:36:10",
        });
    });

    test("accepts object-style column metadata", () => {
        expect(formatTimestampDisplayText(
            "2026-06-15T21:50:05",
            { data_type: "timestamp with time zone" },
        )).toBe(displayDateTime("2026-06-15", "21:50"));
    });

    test("keeps date-only values date-only", () => {
        expect(formatTimestampDisplayParts("2026-06-15", "timestamp")).toEqual({
            displayText: "2026-06-15",
            titleText: "2026-06-15",
        });
    });

    test("renders DATE metadata as a calendar date even when a legacy payload includes midnight", () => {
        expect(formatTimestampDisplayParts("2026-01-15 00:00:00", "date")).toEqual({
            displayText: "2026-01-15",
            titleText: "2026-01-15",
        });
    });

    test("preserves a timestamp-without-time-zone wall clock", () => {
        expect(formatTimestampDisplayParts(
            "2026-06-14 09:30:00",
            "timestamp without time zone",
        )).toEqual({
            displayText: displayDateTime("2026-06-14", "09:30"),
            titleText: "2026-06-14 09:30:00",
        });
    });

    test("converts an explicit timestamp-with-time-zone instant to browser local time", () => {
        expect(formatTimestampDisplayParts(
            "2026-06-14T01:30:00Z",
            "timestamp with time zone",
        )).toEqual({
            displayText: displayDateTime("2026-06-14", "09:30"),
            titleText: "2026-06-14 09:30:00",
        });
    });

    test("renders article date_time values in a human-readable UI locale", () => {
        expect(formatTimestampDisplayParts(
            "2026-06-14 09:30:10",
            "timestamp without time zone",
            { displayMode: TIMESTAMP_DISPLAY_MODE_DATE_TIME, locale: "en" },
        )).toEqual({
            displayText: "14 Jun 2026, 09:30",
            titleText: "2026-06-14 09:30:10",
        });
    });

    test("renders date_only without discarding the precise hover value", () => {
        expect(formatTimestampDisplayParts(
            "2026-06-14 09:30:10",
            "timestamp without time zone",
            { displayMode: TIMESTAMP_DISPLAY_MODE_DATE_ONLY, locale: "fi" },
        )).toEqual({
            displayText: "14.6.2026",
            titleText: "2026-06-14 09:30:10",
        });
    });

    test("normalizes missing and unsupported presentation modes to date_time", () => {
        expect(normalizeTimestampDisplayMode(TIMESTAMP_DISPLAY_MODE_DATE_ONLY))
            .toBe(TIMESTAMP_DISPLAY_MODE_DATE_ONLY);
        expect(normalizeTimestampDisplayMode("raw_iso"))
            .toBe(TIMESTAMP_DISPLAY_MODE_DATE_TIME);
        expect(normalizeTimestampDisplayMode())
            .toBe(TIMESTAMP_DISPLAY_MODE_DATE_TIME);
    });

    test("formats time-only columns without seconds but keeps seconds in title", () => {
        expect(formatTimestampDisplayParts("09:04:07", "time without time zone")).toEqual({
            displayText: "09:04",
            titleText: "09:04:07",
        });
    });

    test("does not rewrite ordinary prose", () => {
        expect(formatTimestampDisplayParts("2026 release window", "text")).toBeNull();
    });

    test("recognizes timestamp column metadata", () => {
        expect(isTimestampColumn("timestamp with time zone")).toBe(true);
        expect(isTimestampColumn({ data_type: "text" })).toBe(false);
    });
});
