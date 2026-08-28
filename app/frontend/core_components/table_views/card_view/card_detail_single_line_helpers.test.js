// card_detail_single_line_helpers.test.js
// Verifies filesystem symbol rendering, legacy SVG rejection, and KV class reuse.
// Bridges metadata-driven icon settings and the conditional-style card detail row DOM.
// Exists so database-held raw SVG cannot return to the card rendering path.
// @vitest-environment jsdom

import { describe, expect, test } from "vitest";

import { renderSingleLineCardDetails } from "./card_detail_single_line_helpers.js";

describe("card_detail_single_line_helpers", () => {
    test("renderSingleLineCardDetails keeps translated label text for both mode", () => {
        const container = document.createElement("div");

        renderSingleLineCardDetails(container, [{
            column: "status",
            label: "Status",
            labelKey: "status",
            rawValue: "Active",
        }], {
            status: {
                card_detail_label_mode: "both",
                card_detail_icon_svg: '<svg viewBox="0 0 16 16"><path d="M1 1h14v14H1z" /></svg>',
            },
        });

        expect(container.querySelector(".card_detail_row_icon_svg")?.dataset.symbolKey)
            .toBe("check-circle");
        expect(container.querySelector("svg")).toBeNull();
        const labelText = container.querySelector(".card_detail_row_label_text");
        expect(labelText?.textContent).toBe("Status");
        expect(labelText?.getAttribute("data-lang-key")).toBe("status");
    });

    test("renderSingleLineCardDetails prefers icon keys over inline SVG markup", () => {
        const container = document.createElement("div");

        renderSingleLineCardDetails(container, [{
            column: "created_at",
            label: "Created",
            rawValue: "2026-05-07",
        }], {
            created_at: {
                card_detail_label_mode: "both",
                card_detail_icon_key: "calendar",
                card_detail_icon_svg: '<svg viewBox="0 0 16 16"><script /></svg>',
            },
        });

        const icon = container.querySelector(".card_detail_row_icon_svg");
        expect(icon).not.toBeNull();
        expect(icon?.dataset.symbolKey).toBe("calendar");
        expect(icon?.style.getPropertyValue("--metadata-symbol-url"))
            .toContain("/symbol-assets/calendar.svg");
        expect(icon?.querySelector("svg")).toBeNull();
        expect(container.querySelector(".card_detail_row_label_text")?.textContent).toBe("Created");
    });

    test("renderSingleLineCardDetails reuses conditional KV structure with desktop row metadata", () => {
        const container = document.createElement("div");

        renderSingleLineCardDetails(container, [
            { column: "status", label: "Status", rawValue: "Active" },
            { column: "owner", label: "Owner", rawValue: "Alice" },
            { column: "priority", label: "Priority", rawValue: "High" },
            { column: "team", label: "Team", rawValue: "Support" },
            { column: "stage", label: "Stage", rawValue: "Review" },
        ]);

        expect(container.classList.contains("card_details_single_line")).toBe(true);
        expect(container.classList.contains("kv-display")).toBe(true);
        expect(container.classList.contains("kv-conditional")).toBe(true);
        expect(container.style.getPropertyValue("--card-details-single-line-rows")).toBe("3");

        const row = container.querySelector(".card_detail_row_single_line");
        expect(row?.classList.contains("kv-pair-conditional")).toBe(true);
        expect(row?.querySelector(".card_detail_row_label")?.classList.contains("kv-conditional-key")).toBe(true);
        expect(row?.querySelector(".card_detail_row_value")?.classList.contains("kv-conditional-value")).toBe(true);
    });

    test("renderSingleLineCardDetails preserves detail hover text from titleValue", () => {
        const container = document.createElement("div");

        renderSingleLineCardDetails(container, [{
            column: "created",
            label: "Created",
            rawValue: "2026-06-15 21:36",
            titleValue: "2026-06-15 21:36:10",
        }]);

        const value = container.querySelector(".card_detail_row_value");

        expect(value?.textContent).toBe("2026-06-15 21:36");
        expect(value?.title).toBe("2026-06-15 21:36:10");
    });

    test("renderSingleLineCardDetails links safe URLs and leaves unsafe schemes as text", () => {
        const container = document.createElement("div");

        renderSingleLineCardDetails(container, [
            { column: "website", label: "Website", rawValue: "https://example.test", isLink: true },
            { column: "script", label: "Script", rawValue: "javascript:alert(1)", isLink: true },
        ]);

        const links = container.querySelectorAll(".card_detail_row_value_link");
        expect(links).toHaveLength(1);
        expect(links[0].getAttribute("href")).toBe("https://example.test");
        expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
        expect(container.textContent).toContain("javascript:alert(1)");
    });

    test("renderSingleLineCardDetails never renders legacy raw SVG and uses the key fallback", () => {
        const container = document.createElement("div");

        renderSingleLineCardDetails(container, [{
            column: "custom_field",
            label: "Owner",
            rawValue: "Alice",
        }], {
            custom_field: {
                card_detail_label_mode: "icon",
                card_detail_icon_svg: '<svg viewBox="0 0 16 16"><path d="M1 1h14v14H1z" /></svg>',
            },
        });

        const label = container.querySelector(".card_detail_row_label");
        const icon = container.querySelector(".card_detail_row_icon_svg");

        expect(icon).not.toBeNull();
        expect(icon?.dataset.symbolKey).toBe("info");
        expect(container.querySelector("svg")).toBeNull();
        expect(container.innerHTML).not.toContain("M1 1h14v14H1z");
        expect(label?.getAttribute("aria-label")).toBe("Owner");
        expect(container.querySelector(".card_detail_row_label_text")).toBeNull();
    });

    test("renderSingleLineCardDetails keeps icon-mode rows accessible through label metadata", () => {
        const container = document.createElement("div");

        renderSingleLineCardDetails(container, [{
            column: "location",
            label: "Location",
            rawValue: "Helsinki",
        }], {
            location: {
                card_detail_label_mode: "icon",
                card_detail_icon_svg: '<svg viewBox="0 0 16 16"><path d="M2 2h12v12H2z" /></svg>',
            },
        });

        const label = container.querySelector(".card_detail_row_label");
        expect(label?.getAttribute("aria-label")).toBe("Location");
        expect(label?.getAttribute("title")).toBe("Location");
        expect(container.querySelector(".card_detail_row_label_text")).toBeNull();
    });

    test("renderSingleLineCardDetails marks empty rows with shared KV empty state", () => {
        const container = document.createElement("div");

        renderSingleLineCardDetails(container, [{
            column: "assignee",
            label: "Assignee",
            rawValue: "",
        }]);

        expect(container.querySelector(".card_detail_row_label")?.classList.contains("kv-empty")).toBe(true);
        expect(container.querySelector(".card_detail_row_value")?.classList.contains("kv-empty")).toBe(true);
        expect(container.querySelector(".card_detail_row_value")?.textContent).toBe("—");
    });
});
