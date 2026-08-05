// @vitest-environment jsdom
// filterbar_section_order_handler.test.js
// Verifies compact filterbar section-order normalization.
// Bridges admin layout persistence payloads and DOM section ordering.
// Exists so unknown or duplicate section keys cannot corrupt the saved layout.

import { describe, expect, test, vi } from "vitest";
import {
    applySectionCollapsedState,
    DEFAULT_FILTERBAR_SECTION_ORDER,
    normalizeFilterbarSectionCollapsed,
    normalizeFilterbarSectionOrder,
    setupFilterbarSectionOrdering,
} from "./filterbar_section_order_handler.js";

describe("normalizeFilterbarSectionOrder", () => {
    test("keeps known unique keys and appends missing defaults", () => {
        expect(normalizeFilterbarSectionOrder([
            "filters",
            "unknown",
            "tools",
            "filters",
            "chat",
        ])).toEqual([
            "filters",
            "tools",
            "chat",
            "search_overview",
            "search_controls",
            "views",
            "field_sets",
        ]);
    });

    test("falls back to the default order for empty input", () => {
        expect(normalizeFilterbarSectionOrder()).toEqual(DEFAULT_FILTERBAR_SECTION_ORDER);
    });

    test("upgrades the previous default order to the current default", () => {
        expect(normalizeFilterbarSectionOrder([
            "search_controls",
            "tools",
            "views",
            "field_sets",
            "filters",
            "chat",
        ])).toEqual(DEFAULT_FILTERBAR_SECTION_ORDER);
    });

    test("applies the current default order without adding a separate drag handle", () => {
        const container = document.createElement("div");
        [
            "search_controls",
            "tools",
            "views",
            "field_sets",
            "filters",
            "chat",
            "search_overview",
        ].forEach((key) => {
            const section = document.createElement("section");
            section.dataset.filterbarSectionKey = key;
            const header = document.createElement("button");
            header.classList.add("animated-disclosure-header");
            section.appendChild(header);
            container.appendChild(section);
        });

        setupFilterbarSectionOrdering(container);

        expect(Array.from(container.children).map((section) => section.dataset.filterbarSectionKey))
            .toEqual(DEFAULT_FILTERBAR_SECTION_ORDER);
        expect(container.querySelector(".filterbar-section-drag-grip")).toBeNull();
    });
});

describe("normalizeFilterbarSectionCollapsed", () => {
    test("keeps true known keys and drops unknown or open entries", () => {
        expect(normalizeFilterbarSectionCollapsed({
            filters: true,
            tools: false,
            unknown: true,
            chat: true,
        })).toEqual({
            filters: true,
            chat: true,
        });
    });

    test("falls back to no collapsed sections for empty input", () => {
        expect(normalizeFilterbarSectionCollapsed()).toEqual({});
    });

    test("remote layout never reopens initially closed sidebar sections", async () => {
        const container = document.createElement("div");
        const filters = document.createElement("section");
        filters.dataset.filterbarSectionKey = "filters";
        filters.classList.add("is-collapsed");
        filters.expand = vi.fn();
        filters.collapse = vi.fn();

        const tools = document.createElement("section");
        tools.dataset.filterbarSectionKey = "tools";
        tools.expand = vi.fn();
        tools.collapse = vi.fn(() => {
            tools.classList.add("is-collapsed");
            return Promise.resolve();
        });
        container.append(filters, tools);

        await applySectionCollapsedState(container, {
            filters: false,
            tools: true,
        });

        expect(filters.expand).not.toHaveBeenCalled();
        expect(filters.classList.contains("is-collapsed")).toBe(true);
        expect(tools.collapse).toHaveBeenCalledWith({ animate: false });
        expect(tools.classList.contains("is-collapsed")).toBe(true);
    });
});
