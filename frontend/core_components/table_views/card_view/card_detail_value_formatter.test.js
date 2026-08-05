// card_detail_value_formatter.test.js
// Verifies card-detail display capitalization stays metadata-scoped and conservative.
// Bridges card_detail_capitalization metadata and all card detail layout renderers.
// Exists so enum-like lowercase values can be polished without corrupting dates or links.

import { describe, expect, test } from "vitest";
import { DATE_TIME_DISPLAY_SEPARATOR } from "../timestamp_display_formatter.js";

import {
    capitalizeCardDetailDisplayText,
    formatCardDetailEntryForCardDisplay,
} from "./card_detail_value_formatter.js";

function displayDateTime(dateText, timeText) {
    return `${dateText}${DATE_TIME_DISPLAY_SEPARATOR}${timeText}`;
}

describe("card_detail_value_formatter", () => {
    test("capitalizes lowercase detail values when metadata enables it", () => {
        const entry = formatCardDetailEntryForCardDisplay({
            column: "problem_type",
            rawValue: "task",
        }, {
            problem_type: {
                card_element: "details",
                card_detail_capitalization: true,
            },
        });

        expect(entry.rawValue).toBe("Task");
    });

    test("keeps capitalization disabled when metadata opts out", () => {
        const entry = formatCardDetailEntryForCardDisplay({
            column: "username",
            rawValue: "valveque",
        }, {
            username: {
                card_element: "details",
                card_detail_capitalization: false,
            },
        });

        expect(entry.rawValue).toBe("valveque");
    });

    test("does not capitalize non-detail card roles", () => {
        const entry = formatCardDetailEntryForCardDisplay({
            column: "title",
            rawValue: "task title",
        }, {
            title: {
                card_element: "header",
                card_detail_capitalization: true,
            },
        });

        expect(entry.rawValue).toBe("task title");
    });

    test("formats detail timestamps without visible seconds and stores precise hover text", () => {
        const entry = formatCardDetailEntryForCardDisplay({
            column: "created",
            rawValue: "2026-06-15T21:36:10",
        }, {
            created: {
                card_element: "details",
                data_type: "timestamp with time zone",
            },
        });

        expect(entry.rawValue).toBe(displayDateTime("2026-06-15", "21:36"));
        expect(entry.titleValue).toBe("2026-06-15 21:36:10");
    });

    test("leaves dates, numbers, JSON, URLs, and links untouched", () => {
        expect(capitalizeCardDetailDisplayText("2026-05-07 10:00:00")).toBe("2026-05-07 10:00:00");
        expect(capitalizeCardDetailDisplayText("16")).toBe("16");
        expect(capitalizeCardDetailDisplayText("{\"type\":\"task\"}")).toBe("{\"type\":\"task\"}");
        expect(capitalizeCardDetailDisplayText("https://example.test")).toBe("https://example.test");

        const linkEntry = formatCardDetailEntryForCardDisplay({
            column: "website",
            rawValue: "https://example.test",
            isLink: true,
        }, {
            website: {
                card_element: "details",
                card_detail_capitalization: true,
            },
        });
        expect(linkEntry.rawValue).toBe("https://example.test");
    });
});
