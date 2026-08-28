// @vitest-environment jsdom
// animated_disclosure_builder.test.js
// Verifies reusable animated disclosure sections keep header-only collapse behavior.
// Bridges arbitrary caller content with the shared height controller and accessible button state.
// Exists so filterbar and legacy collapsible sections can share one measured disclosure primitive.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAnimatedDisclosureSection } from "./animated_disclosure_builder.js";

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

describe("createAnimatedDisclosureSection", () => {
    let originalMatchMedia;
    let originalResizeObserver;

    beforeEach(() => {
        document.body.innerHTML = "";
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

    test("builds an accessible expanded section around caller content", () => {
        const content = document.createElement("div");
        content.id = "caller-owned-content";
        content.textContent = "Useful controls";

        const section = createAnimatedDisclosureSection({
            titleLangKey: "tools",
            titleText: "Tools",
            iconPath: "/frontend/icons/general/table-tools-icon.svg",
            iconClassName: "tools-icon",
            contentElement: content,
            sectionClassNames: "tools-section",
            headerClassNames: "tools-heading",
            contentClassNames: "tools-content",
            startOpen: true,
        });

        const header = section.querySelector("button.animated-disclosure-header");
        const shell = section.querySelector(".animated-disclosure-content-shell");

        expect(section.classList.contains("tools-section")).toBe(true);
        expect(section.dataset.disclosureState).toBe("expanded");
        expect(header?.getAttribute("aria-expanded")).toBe("true");
        expect(header?.getAttribute("aria-controls")).toBe(shell?.id);
        expect(shell?.id).not.toBe(content.id);
        expect(content.parentElement).toBe(shell);
        expect(content.classList.contains("tools-content")).toBe(true);
        expect(section.querySelector('[data-lang-key="tools"]')?.textContent).toBe("Tools");
        expect(section.querySelector(".tools-icon")?.getAttribute("aria-hidden")).toBe("true");
    });

    test("collapses to the header and emits disclosure state changes", async () => {
        const content = document.createElement("div");
        const section = createAnimatedDisclosureSection({
            titleText: "Filters",
            contentElement: content,
            startOpen: true,
        });
        const header = section.querySelector("button");
        const shell = section.querySelector(".animated-disclosure-content-shell");
        const toggleListener = vi.fn();
        section.addEventListener("animated-disclosure-toggle", toggleListener);

        header.click();
        await flushMicrotasks();

        expect(section.dataset.disclosureState).toBe("collapsed");
        expect(section.classList.contains("is-collapsed")).toBe(true);
        expect(header.getAttribute("aria-expanded")).toBe("false");
        expect(shell.hidden).toBe(true);
        expect(toggleListener).toHaveBeenCalledWith(expect.objectContaining({
            detail: expect.objectContaining({ expanded: false, section }),
        }));

        await section.expand({ animate: false });

        expect(section.dataset.disclosureState).toBe("expanded");
        expect(header.getAttribute("aria-expanded")).toBe("true");
        expect(shell.hidden).toBe(false);
    });
});
