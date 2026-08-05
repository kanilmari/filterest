// @vitest-environment jsdom
// collapsible_section_builder.test.js
// Verifies the legacy collapsible-section API delegates safely to animated disclosure.
// Bridges old filter/chat callers with the shared measured disclosure builder.
// Exists to keep legacy class names and chat blur behavior stable during the migration.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { create_collapsible_section } from "./collapsible_section_builder.js";

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

describe("create_collapsible_section", () => {
    let originalMatchMedia;

    beforeEach(() => {
        document.body.innerHTML = "";
        originalMatchMedia = window.matchMedia;
        window.matchMedia = vi.fn().mockImplementation(() => ({
            matches: true,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
    });

    afterEach(() => {
        window.matchMedia = originalMatchMedia;
    });

    test("keeps legacy collapsed and hidden classes on toggle", async () => {
        const content = document.createElement("div");
        const wrapper = create_collapsible_section("filters", content, true);
        const header = wrapper.querySelector(".collapsible-header");

        expect(wrapper.classList.contains("collapsible-section")).toBe(true);
        expect(content.classList.contains("collapsible-content")).toBe(true);
        expect(header?.classList.contains("collapsed")).toBe(false);
        expect(content.classList.contains("hidden")).toBe(false);

        header.click();
        await flushMicrotasks();

        expect(header?.classList.contains("collapsed")).toBe(true);
        expect(content.classList.contains("hidden")).toBe(true);
    });

    test("preserves chat blur behavior", async () => {
        const panel = document.createElement("div");
        panel.classList.add("dataset-filter-panel");
        const content = document.createElement("div");
        const wrapper = create_collapsible_section("Chat", content, false);
        panel.appendChild(wrapper);
        document.body.appendChild(panel);

        wrapper.querySelector(".collapsible-header")?.click();
        await flushMicrotasks();

        expect(panel.classList.contains("filter-blur")).toBe(true);

        wrapper.querySelector(".collapsible-header")?.click();
        await flushMicrotasks();

        expect(panel.classList.contains("filter-blur")).toBe(false);
    });
});
