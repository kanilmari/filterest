// vanilla_dropdown_builder.test.js
// Verifies the vanilla dropdown renders its chevron as a CSS-mask icon.
// Bridges dropdown DOM construction with compatibility-safe icon assertions in jsdom.
// Exists to keep shared dropdown controls from regressing back to inline SVG markup.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from "vitest";

describe("createVanillaDropdown", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    test("renders the trigger chevron without inline svg markup", async () => {
        const { createVanillaDropdown } = await import("./vanilla_dropdown_builder.js");
        const container = document.createElement("div");
        document.body.appendChild(container);

        createVanillaDropdown({
            containerElement: container,
            options: [{ value: "asc", label: "Ascending" }],
            useSearch: false,
            showClearButton: false,
        });

        const chevron = container.querySelector(".vdw-dropdown-chevron");
        expect(chevron).not.toBeNull();
        expect(chevron?.tagName).toBe("SPAN");
        expect(chevron?.querySelector("svg")).toBeNull();
        expect(chevron?.style.maskImage).toContain("chevron-down-icon.svg");
    });

    test("falls back to the option label when a lang-key translation is missing", async () => {
        const { createVanillaDropdown } = await import("./vanilla_dropdown_builder.js");
        const container = document.createElement("div");
        document.body.appendChild(container);

        const dropdown = createVanillaDropdown({
            containerElement: container,
            options: [
                {
                    value: "",
                    label: "Search relevance",
                    langKey: "search_relevance",
                },
            ],
            useSearch: false,
            showClearButton: false,
        });

        dropdown.setValue("");

        const trigger = container.querySelector(".vdw-dropdown-input");
        expect(trigger.value).toBe("Search relevance");
        expect(trigger.value).not.toBe("undefined");
    });
});
