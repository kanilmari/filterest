// @vitest-environment jsdom
// filterbar_section_order_handler.test.js
// Verifies compact filterbar section-order normalization.
// Bridges admin layout persistence payloads and DOM section ordering.
// Exists so unknown or duplicate section keys cannot corrupt the saved layout.

import { describe, expect, test, vi } from "vitest";
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn(async () => ({})) }));
vi.mock('../auth/session_generation_store.js', () => ({
    getSessionGeneration: () => 0, subscribeToSessionGeneration: () => () => {},
    revalidateSessionIdentity: async () => 0,
}));
import {
    applySectionCollapsedState,
    DEFAULT_FILTERBAR_SECTION_ORDER,
    normalizeFilterbarSectionCollapsed,
    normalizeFilterbarSectionOrder,
    shouldPersistFilterbarSectionToggle,
    setupFilterbarSectionOrdering,
} from "./filterbar_section_order_handler.js";
import { endpoint_router } from "../endpoints/endpoint_router.js";
import { loadFilterbarPreferences } from "./filterbar_preferences_controller.js";

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
            "style",
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
            "style",
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

    test("marks sections that replace pending mounts as reorderable", async () => {
        sessionStorage.setItem("user_permissions", JSON.stringify([
            "/api/filterbar-section-layout",
            "/api/filterbar-section-layout/save",
        ]));
        const container = document.createElement("div");
        document.body.appendChild(container);
        const pending = document.createElement("div");
        pending.dataset.filterbarSectionKey = "tools";
        pending.dataset.filterbarSectionPending = "true";
        container.appendChild(pending);

        const ordering = setupFilterbarSectionOrdering(container);
        const section = document.createElement("section");
        section.dataset.filterbarSectionKey = "tools";
        const header = document.createElement("button");
        header.classList.add("animated-disclosure-header");
        section.appendChild(header);
        pending.replaceWith(section);

        await vi.waitFor(() => {
            expect(section.classList.contains("filterbar-disclosure-section--reorderable")).toBe(true);
        });
        expect(header.dataset.filterbarDragReady).toBe("true");
        ordering.destroy();
        sessionStorage.clear();
        container.remove();
    });

    // B4 (WL103) inserts a spacer before the field-set section to reach the viewport bottom. A child that is not a
    // section must not re-apply the layout: that moved every section after the spacer and re-collapsed field_sets.
    test("a non-section child leaves the section order and open sections alone", async () => {
        // The saved shared layout keeps field_sets closed, as on the dev instance.
        endpoint_router.mockImplementation(async (route) => (route === "getFilterbarSectionLayout"
            ? { section_order: DEFAULT_FILTERBAR_SECTION_ORDER, section_collapsed: { field_sets: true } } : {}));
        await loadFilterbarPreferences({ refresh: true });
        const container = document.createElement("div");
        document.body.appendChild(container);
        const sections = DEFAULT_FILTERBAR_SECTION_ORDER.map((key) => {
            const section = document.createElement("section");
            section.dataset.filterbarSectionKey = key;
            section.expand = vi.fn(() => { section.classList.remove("is-collapsed"); return Promise.resolve(); });
            section.collapse = vi.fn(() => { section.classList.add("is-collapsed"); return Promise.resolve(); });
            container.appendChild(section);
            return section;
        });
        const ordering = setupFilterbarSectionOrdering(container);
        await ordering.ready;
        const fieldSets = sections.find((section) => section.dataset.filterbarSectionKey === "field_sets");
        expect(fieldSets.classList.contains("is-collapsed")).toBe(true); // the saved layout was applied
        // B4 opens it for this page only, without saving the layout.
        fieldSets.classList.remove("is-collapsed");
        sections.forEach((section) => { section.expand.mockClear(); section.collapse.mockClear(); });

        const spacer = document.createElement("div");
        fieldSets.before(spacer);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(fieldSets.previousElementSibling).toBe(spacer);
        expect(Array.from(container.children).filter((child) => child !== spacer)
            .map((section) => section.dataset.filterbarSectionKey)).toEqual(DEFAULT_FILTERBAR_SECTION_ORDER);
        sections.forEach((section) => {
            expect(section.collapse).not.toHaveBeenCalled();
            expect(section.expand).not.toHaveBeenCalled();
        });
        expect(fieldSets.classList.contains("is-collapsed")).toBe(false);

        // A real replacement section is still adopted by the loaded layout (positive control).
        const chat = sections.find((section) => section.dataset.filterbarSectionKey === "chat");
        const late = document.createElement("section");
        late.dataset.filterbarSectionKey = "chat";
        chat.replaceWith(late);
        await vi.waitFor(() => expect(late.dataset.filterbarOrderMounted).toBe("true"));
        ordering.destroy();
        container.remove();
        endpoint_router.mockImplementation(async () => ({}));
        await loadFilterbarPreferences({ refresh: true });
    });
});

describe("normalizeFilterbarSectionCollapsed", () => {
    test("keeps explicit open and collapsed states for known sections", () => {
        expect(normalizeFilterbarSectionCollapsed({
            filters: true,
            tools: false,
            unknown: true,
            chat: true,
        })).toEqual({
            filters: true,
            tools: false,
            chat: true,
        });
    });

    test("falls back to no collapsed sections for empty input", () => {
        expect(normalizeFilterbarSectionCollapsed()).toEqual({});
    });

    test("remote layout restores both open and collapsed sidebar sections", async () => {
        const container = document.createElement("div");
        const filters = document.createElement("section");
        filters.dataset.filterbarSectionKey = "filters";
        filters.classList.add("is-collapsed");
        filters.expand = vi.fn(() => {
            filters.classList.remove("is-collapsed");
            return Promise.resolve();
        });
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

        expect(filters.expand).toHaveBeenCalledWith({ animate: false });
        expect(filters.classList.contains("is-collapsed")).toBe(false);
        expect(tools.collapse).toHaveBeenCalledWith({ animate: false });
        expect(tools.classList.contains("is-collapsed")).toBe(true);
    });

    test("legacy layouts with missing open entries keep component defaults", async () => {
        const container = document.createElement("div");
        const filters = document.createElement("section");
        filters.dataset.filterbarSectionKey = "filters";
        filters.classList.add("is-collapsed");
        filters.expand = vi.fn();
        filters.collapse = vi.fn();
        container.appendChild(filters);

        await applySectionCollapsedState(container, {});

        expect(filters.expand).not.toHaveBeenCalled();
        expect(filters.collapse).not.toHaveBeenCalled();
        expect(filters.classList.contains("is-collapsed")).toBe(true);
    });
});

describe("shouldPersistFilterbarSectionToggle", () => {
    test("rejects the coordinator's temporary disclosure operations", () => {
        const container = document.createElement("div");
        const section = document.createElement("section");
        section.dataset.filterbarSectionKey = "filters";
        container.appendChild(section);

        expect(shouldPersistFilterbarSectionToggle(section, container)).toBe(true);

        section.dataset.filterbarTemporaryDisclosureOperation = "true";
        expect(shouldPersistFilterbarSectionToggle(section, container)).toBe(false);
    });
});
