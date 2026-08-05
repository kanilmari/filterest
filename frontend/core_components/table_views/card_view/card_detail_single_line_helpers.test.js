// card_detail_single_line_helpers.test.js
// Verifies single-line card detail SVG sanitization, label fallback, and KV class reuse.
// Bridges metadata-driven icon settings and the conditional-style card detail row DOM.
// Exists to keep SVG handling safe while preserving one-line detail rendering.
// @vitest-environment jsdom

import { describe, expect, test } from "vitest";

import {
    appendSafeCardDetailSvg,
    renderSingleLineCardDetails,
} from "./card_detail_single_line_helpers.js";

describe("card_detail_single_line_helpers", () => {
    test("appendSafeCardDetailSvg strips dangerous attributes from otherwise valid SVG", () => {
        const container = document.createElement("span");

        const rendered = appendSafeCardDetailSvg(
            container,
            '<svg viewBox="0 0 16 16" onload="alert(1)"><path d="M0 0" style="fill:red" href="https://bad.example" /></svg>'
        );

        expect(rendered).toBe(true);
        const svg = container.querySelector("svg");
        const path = container.querySelector("path");
        expect(svg).not.toBeNull();
        expect(svg?.getAttribute("viewBox")).toBe("0 0 16 16");
        expect(svg?.getAttribute("onload")).toBeNull();
        expect(path?.getAttribute("style")).toBeNull();
        expect(path?.getAttribute("href")).toBeNull();
    });

    test("appendSafeCardDetailSvg keeps child shape dimensions while CSS owns root size", () => {
        const container = document.createElement("span");

        const rendered = appendSafeCardDetailSvg(
            container,
            '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="4" y="5" width="16" height="15" rx="2" /></svg>'
        );

        expect(rendered).toBe(true);
        const svg = container.querySelector("svg");
        const rect = container.querySelector("rect");
        expect(svg?.getAttribute("width")).toBeNull();
        expect(svg?.getAttribute("height")).toBeNull();
        expect(rect?.getAttribute("width")).toBe("16");
        expect(rect?.getAttribute("height")).toBe("15");
    });

    test("appendSafeCardDetailSvg rejects disallowed SVG content", () => {
        const container = document.createElement("span");

        expect(
            appendSafeCardDetailSvg(
                container,
                '<svg viewBox="0 0 16 16"><image href="https://bad.example/icon.png" /></svg>'
            )
        ).toBe(false);
        expect(container.children).toHaveLength(0);
    });

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

        expect(container.querySelector(".card_detail_row_icon_svg")).not.toBeNull();
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

        const svg = container.querySelector(".card_detail_row_icon_svg");
        expect(svg).not.toBeNull();
        expect(svg?.getAttribute("viewBox")).toBe("0 -960 960 960");
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

    test("renderSingleLineCardDetails uses the generic icon when icon SVG is rejected", () => {
        const container = document.createElement("div");

        renderSingleLineCardDetails(container, [{
            column: "custom_field",
            label: "Owner",
            rawValue: "Alice",
        }], {
            custom_field: {
                card_detail_label_mode: "icon",
                card_detail_icon_svg: '<svg viewBox="0 0 16 16"><image href="https://bad.example/icon.png" /></svg>',
            },
        });

        const label = container.querySelector(".card_detail_row_label");
        const svg = container.querySelector(".card_detail_row_icon_svg");

        expect(svg).not.toBeNull();
        expect(svg?.querySelector("image")).toBeNull();
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
