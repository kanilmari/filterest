// @vitest-environment jsdom
// accordion_filter_builder.test.js
// Verifies the favefox accordion filter builder uses the shared collapsible height behavior safely.
// Bridges filter section DOM and local state persistence in a jsdom harness without depending on full browser layout.
// Exists to prevent regressions in accordion opening and first-visit defaults.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    build_favefox_style_filter_bar_from_columns,
    create_favefox_style_filter_bar,
} from "./accordion_filter_builder.js";
import { getOpenedFilters } from "../../filterbar_engine/filterbar_state_saver.js";

/** Mode buttons shaped like filter_column_builder.js's: each stops propagation in its own click handler. */
function buildModeControls(onMode = () => {}) {
    const controls = document.createElement("div");
    controls.classList.add("filter-display-mode-controls");
    for (const mode of ["value", "range", "expression"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.filterDisplayMode = mode;
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            onMode(mode);
        });
        controls.appendChild(button);
    }
    return controls;
}

function buildSections(count) {
    return Array.from({ length: count }, (_, index) => {
        const content = document.createElement("div");
        content.textContent = `Section ${index + 1}`;
        return {
            key: `section_${index + 1}`,
            title: `Section ${index + 1}`,
            content,
        };
    });
}

describe("create_favefox_style_filter_bar", () => {
    let originalMatchMedia;
    let originalResizeObserver;

    beforeEach(() => {
        document.body.innerHTML = "";
        localStorage.clear();
        originalMatchMedia = window.matchMedia;
        originalResizeObserver = globalThis.ResizeObserver;

        window.matchMedia = vi.fn().mockImplementation(() => ({
            matches: true,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));

        globalThis.ResizeObserver = class {
            observe() {}
            disconnect() {}
        };
    });

    afterEach(() => {
        window.matchMedia = originalMatchMedia;
        if (originalResizeObserver === undefined) {
            delete globalThis.ResizeObserver;
        } else {
            globalThis.ResizeObserver = originalResizeObserver;
        }
    });

    test("opens the first section on first visit without show-more overflow controls", () => {
        const wrapper = create_favefox_style_filter_bar("users", buildSections(6), {
            layoutMode: "accordion",
        });
        document.body.appendChild(wrapper);

        const firstContent = wrapper.querySelector(".filter-content");
        const barContainer = wrapper.querySelector(".favefox-filterbar");

        expect(firstContent.classList.contains("expanded")).toBe(true);
        expect(firstContent.hidden).toBe(false);
        expect(typeof barContainer.adjustSideModeHeight).toBe("function");
        expect(barContainer.classList.contains("side-mode")).toBe(false);
        expect(wrapper.classList.contains("has-overflow")).toBe(false);
        expect(wrapper.querySelector(".favefox-show-more")).toBeNull();
        expect(wrapper.querySelector(".favefox-show-less")).toBeNull();
    });

    test("toggles section content with the shared height controller", () => {
        const wrapper = create_favefox_style_filter_bar("users", buildSections(3), {
            layoutMode: "accordion",
        });
        document.body.appendChild(wrapper);

        const secondSection = wrapper.querySelectorAll(".filter-section")[1];
        const secondContent = secondSection.querySelector(".filter-content");
        const secondToggle = secondSection.querySelector(".toggle-filters-button");
        Object.defineProperty(secondContent, "scrollHeight", {
            configurable: true,
            get: () => 64,
        });

        expect(secondContent.hidden).toBe(true);
        expect(secondToggle.getAttribute("aria-expanded")).toBe("false");

        secondToggle.click();

        expect(secondContent.hidden).toBe(false);
        expect(secondContent.classList.contains("expanded")).toBe(true);
        expect(secondToggle.getAttribute("aria-expanded")).toBe("true");
    });

    // WO75: an input-mode button opens its collapsed section and never closes it; the sort button does not open it.
    test("an input-mode button opens its collapsed section through the shared path and never closes it", () => {
        const modes = [];
        const sections = buildSections(3);
        const sortButton = document.createElement("button");
        sortButton.setAttribute("data-sort-state", "none");
        sections[1].displayModeControls = buildModeControls((mode) => modes.push(mode));
        sections[1].sortButton = sortButton;
        const wrapper = create_favefox_style_filter_bar("users", sections, { layoutMode: "accordion" });
        document.body.appendChild(wrapper);

        const section = wrapper.querySelectorAll(".filter-section")[1];
        const content = section.querySelector(".filter-content");
        const toggleButton = section.querySelector(".toggle-filters-button");
        const modeButtons = section.querySelectorAll("button[data-filter-display-mode]");
        const expectOpen = () => {
            expect(content.hidden).toBe(false);
            expect(content.classList.contains("expanded")).toBe(true);
            expect(section.classList.contains("section-expanded")).toBe(true);
            expect(toggleButton.getAttribute("aria-expanded")).toBe("true");
            expect(toggleButton.textContent).toBe("▾");
            expect(getOpenedFilters("users")).toContain("section_2");
        };
        expect(content.hidden).toBe(true);

        sortButton.click();
        expect(content.hidden).toBe(true);
        expect(toggleButton.getAttribute("aria-expanded")).toBe("false");
        expect(getOpenedFilters("users")).not.toContain("section_2");

        // A keyboard Enter/Space on a button dispatches this same click event.
        modeButtons[1].click();
        expect(modes).toEqual(["range"]);
        expectOpen();
        modeButtons[1].click();
        modeButtons[2].click();
        modeButtons[0].click();
        expect(modes).toEqual(["range", "range", "expression", "value"]);
        expectOpen();
        expect(getOpenedFilters("users").filter((key) => key === "section_2")).toHaveLength(1);

        // The header toggle still closes it, through the same path.
        toggleButton.click();
        expect(content.classList.contains("expanded")).toBe(false);
        expect(getOpenedFilters("users")).not.toContain("section_2");
    });

    test("input-mode buttons leave the inline-open (phone) layout unchanged", () => {
        const sections = buildSections(2);
        sections[1].displayModeControls = buildModeControls();
        const wrapper = create_favefox_style_filter_bar("users", sections, { layoutMode: "inline-open" });
        document.body.appendChild(wrapper);
        const storage = () => JSON.stringify(Object.entries({ ...localStorage }).sort());
        const before = storage();

        wrapper.querySelectorAll(".filter-section")[1].querySelector("button[data-filter-display-mode='range']").click();

        wrapper.querySelectorAll(".filter-content").forEach((content) => {
            expect(content.hidden).toBe(false);
            expect(content.classList.contains("expanded")).toBe(true);
        });
        expect(wrapper.querySelector(".toggle-filters-button")).toBeNull();
        expect(storage()).toBe(before);   // no opened-state write in the inline-open layout
    });

    test("the real column builder's mode buttons open a collapsed column section and keep it open", () => {
        const wrapper = build_favefox_style_filter_bar_from_columns(
            "tasks",
            ["title", "id"],
            { title: { data_type: "text", co_number: 1 }, id: { data_type: "integer", co_number: 2 } },
            true,
            { layoutMode: "accordion" },
        );
        document.body.appendChild(wrapper);
        const section = [...wrapper.querySelectorAll(".filter-section")]
            .find((candidate) => candidate.querySelector(".filter-section-title").dataset.langKey === "id");
        const content = section.querySelector(".filter-content");
        const modeButtons = section.querySelectorAll("button[data-filter-display-mode]");
        expect(modeButtons.length).toBeGreaterThan(1);
        expect(content.classList.contains("expanded")).toBe(false);

        modeButtons[1].click();
        expect(content.classList.contains("expanded")).toBe(true);
        expect(section.querySelector(".toggle-filters-button").getAttribute("aria-expanded")).toBe("true");
        expect(modeButtons[1].getAttribute("aria-pressed")).toBe("true");
        expect(getOpenedFilters("tasks")).toContain("id");

        modeButtons[0].click();
        expect(content.classList.contains("expanded")).toBe(true);
        expect(modeButtons[0].getAttribute("aria-pressed")).toBe("true");
    });

    test("renders all accordion sections without a show-more footer", () => {
        const wrapper = create_favefox_style_filter_bar("users", buildSections(6), {
            layoutMode: "accordion",
        });
        document.body.appendChild(wrapper);

        const barContainer = wrapper.querySelector(".favefox-filterbar");

        expect(barContainer.classList.contains("side-mode")).toBe(false);
        expect(wrapper.querySelectorAll(".filter-section")).toHaveLength(6);
        expect(wrapper.querySelector(".favefox-filterbar-footer")).toBeNull();
        expect(wrapper.querySelector(".favefox-fade-strip")).toBeNull();
        expect(wrapper.querySelector(".favefox-show-more")).toBeNull();
        expect(wrapper.querySelector(".favefox-show-less")).toBeNull();
    });

    test("renders inline-open layout without accordion toggle controls", () => {
        const inlineSortButton = document.createElement("button");
        inlineSortButton.textContent = "sort";
        inlineSortButton.setAttribute("data-sort-state", "none");

        const sections = buildSections(6);
        sections[0].sortButton = inlineSortButton;

        const wrapper = create_favefox_style_filter_bar("users", sections, {
            layoutMode: "inline-open",
        });
        document.body.appendChild(wrapper);

        const barContainer = wrapper.querySelector(".favefox-filterbar");
        const allContents = wrapper.querySelectorAll(".filter-content");
        const firstInlineActions = wrapper.querySelector(".filter-section-hover-actions");

        expect(wrapper.classList.contains("favefox-filterbar-wrapper--inline-open")).toBe(true);
        expect(barContainer.classList.contains("favefox-filterbar--inline-open")).toBe(true);
        expect(wrapper.querySelector(".toggle-filters-button")).toBeNull();
        expect(wrapper.querySelector(".favefox-show-more")).toBeNull();
        expect(wrapper.querySelector(".favefox-show-less")).toBeNull();
        expect(firstInlineActions).not.toBeNull();
        expect(firstInlineActions.querySelector("button[data-sort-state]")).not.toBeNull();

        allContents.forEach((content) => {
            expect(content.hidden).toBe(false);
            expect(content.classList.contains("expanded")).toBe(true);
        });
    });

    test("omits redundant generated FK display aliases from favefox filter sections", () => {
        const wrapper = build_favefox_style_filter_bar_from_columns(
            "tasks",
            ["status", "status_name", "title"],
            {
                status: { data_type: "text", foreign_table: "task_statuses" },
                title: { data_type: "text" },
            },
            false,
        );
        document.body.appendChild(wrapper);

        const sectionKeys = Array.from(wrapper.querySelectorAll(".filter-section .filter-section-title")).map(
            (heading) => heading.dataset.langKey
        );

        expect(sectionKeys).toContain("status");
        expect(sectionKeys).toContain("title");
        expect(sectionKeys).not.toContain("status_name");
    });

    test("builds favefox column sections from shared controls without a legacy field header", () => {
        const wrapper = build_favefox_style_filter_bar_from_columns(
            "tasks",
            ["title"],
            {
                title: { data_type: "text" },
            },
            true,
        );
        document.body.appendChild(wrapper);

        const section = wrapper.querySelector(".filter-section");
        const row = section.querySelector(".row-container");
        const content = section.querySelector(".filter-content");
        const sortButton = section.querySelector("button[data-sort-state]");
        const header = section.querySelector(".filter-header");

        expect(row.dataset.testid).toBe("column-filter-row-tasks-title");
        expect(content.querySelector(".filter-field-header")).toBeNull();
        expect(content.querySelector("label")).toBeNull();
        expect(content.querySelector("input[type='text']")).not.toBeNull();
        expect(sortButton).not.toBeNull();
        expect(content.querySelector(".column-visibility-toggle")).toBeNull();
        expect(header.querySelector(".column-visibility-toggle")).not.toBeNull();
    });

    test("puts accordion arrow on the left and filter actions on the right", () => {
        const wrapper = build_favefox_style_filter_bar_from_columns(
            "tasks",
            ["id"],
            {
                id: { data_type: "integer" },
            },
            true,
            { layoutMode: "accordion" },
        );
        document.body.appendChild(wrapper);

        const section = wrapper.querySelector(".filter-section");
        const header = section.querySelector(".filter-header");
        const lead = header.querySelector(".filter-header-lead");
        const toggle = lead.querySelector(".toggle-filters-button");
        const title = lead.querySelector(".filter-section-title");
        const hoverActions = header.querySelector(".filter-section-hover-actions");
        const displayModes = hoverActions.querySelector(".filter-display-mode-controls");
        const visibilityToggle = header.querySelector(".filter-section-persistent-actions .column-visibility-toggle");

        expect(lead.firstElementChild).toBe(toggle);
        expect(toggle.textContent).toBe("▾");
        expect(title.textContent).toBe("id");
        expect(displayModes.querySelectorAll("button[data-filter-display-mode]")).toHaveLength(3);
        expect(hoverActions.querySelector("button[data-sort-state]")).not.toBeNull();
        expect(visibilityToggle).not.toBeNull();
        expect(section.querySelector(".filter-content .column-visibility-toggle")).toBeNull();
    });

    test("passes explicit layout mode through the column-section builder", () => {
        const wrapper = build_favefox_style_filter_bar_from_columns(
            "tasks",
            ["title"],
            {
                title: { data_type: "text" },
            },
            true,
            { layoutMode: "accordion" },
        );
        document.body.appendChild(wrapper);

        expect(wrapper.classList.contains("favefox-filterbar-wrapper--inline-open")).toBe(false);
        expect(wrapper.querySelector(".toggle-filters-button")).not.toBeNull();
    });

    test("can prepend shared sections before column filter sections", () => {
        const searchContent = document.createElement("div");
        searchContent.textContent = "Search";
        const wrapper = build_favefox_style_filter_bar_from_columns(
            "tasks",
            ["title"],
            {
                title: { data_type: "text" },
            },
            true,
            {
                prependSections: [{
                    key: "text_search",
                    title: "Tekstihaku",
                    content: searchContent,
                }],
            },
        );
        document.body.appendChild(wrapper);

        const sectionKeys = Array.from(wrapper.querySelectorAll(".filter-section .filter-section-title")).map(
            (heading) => heading.dataset.langKey
        );

        expect(sectionKeys).toEqual(["text_search", "title"]);
    });
});
