// @vitest-environment jsdom
// filterbar_section_heading_builder.test.js
// Verifies filterbar section headings can opt into the shared animated disclosure primitive.
// Bridges filterbar icon headings with the reusable measured disclosure section.
// Exists to keep tools, view modes, visible fields, and filters on one disclosure contract.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildFilterbarDisclosureSection } from "./filterbar_section_heading_builder.js";

describe("buildFilterbarDisclosureSection", () => {
    let originalMatchMedia;
    let originalResizeObserver;
    let resizeObserveCalls;

    beforeEach(() => {
        document.body.innerHTML = "";
        originalMatchMedia = window.matchMedia;
        originalResizeObserver = globalThis.ResizeObserver;
        resizeObserveCalls = 0;
        window.matchMedia = vi.fn().mockImplementation(() => ({
            matches: true,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        globalThis.ResizeObserver = class {
            observe() {
                resizeObserveCalls += 1;
            }

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

    test("wraps filterbar content in an accessible disclosure that starts closed", async () => {
        const content = document.createElement("div");
        content.classList.add("tools-content");
        content.textContent = "Controls";

        const section = buildFilterbarDisclosureSection({
            iconPath: "/frontend/icons/general/table-tools-icon.svg",
            iconClassName: "table-tools-icon",
            langKey: "tools",
            fallbackText: "Työkalut",
            contentElement: content,
            sectionClassNames: "dataset-filter-tools-section",
            contentClassNames: "dataset-filter-tools-content",
        });
        const heading = section.querySelector("button.filterbar-section-heading");
        const contentShell = section.querySelector(".animated-disclosure-content-shell");

        expect(section.classList.contains("filterbar-disclosure-section")).toBe(true);
        expect(section.classList.contains("dataset-filter-tools-section")).toBe(true);
        expect(heading?.classList.contains("animated-disclosure-header")).toBe(true);
        expect(heading?.getAttribute("aria-expanded")).toBe("false");
        expect(heading?.getAttribute("aria-controls")).toBe(contentShell?.id);
        expect(heading?.querySelector('[data-lang-key="tools"]')?.textContent).toBe("Työkalut");
        expect(heading?.querySelector(".table-tools-icon")).toBeTruthy();
        expect(content.classList.contains("filterbar-disclosure-content")).toBe(true);
        expect(content.classList.contains("dataset-filter-tools-content")).toBe(true);
        expect(resizeObserveCalls).toBe(0);

        expect(section.classList.contains("is-collapsed")).toBe(true);
        expect(contentShell?.hidden).toBe(true);

        await section.expand();

        expect(heading?.getAttribute("aria-expanded")).toBe("true");
        expect(contentShell?.style.height).toBe("auto");
        expect(resizeObserveCalls).toBe(0);

        await section.collapse();

        expect(heading?.getAttribute("aria-expanded")).toBe("false");
        expect(contentShell?.hidden).toBe(true);
    });
});
