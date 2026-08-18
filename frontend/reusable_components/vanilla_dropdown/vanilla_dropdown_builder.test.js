// vanilla_dropdown_builder.test.js
// Verifies the vanilla dropdown renders its chevron as a CSS-mask icon.
// Bridges dropdown DOM construction with compatibility-safe icon assertions in jsdom.
// Exists to keep shared dropdown controls from regressing back to inline SVG markup.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

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

    test("keeps ordinary option markup action-free unless the caller opts in", async () => {
        const { createVanillaDropdown } = await import("./vanilla_dropdown_builder.js");
        const container = document.createElement("div");
        document.body.appendChild(container);

        const dropdown = createVanillaDropdown({
            containerElement: container,
            options: [{ value: "asc", label: "Ascending" }],
            useSearch: false,
            showClearButton: false,
        });
        dropdown.open();

        expect(document.querySelector(".vdw-option-trailing-action")).toBeNull();
        expect(document.querySelector(".vdw-option")?.textContent).toBe("Ascending");
    });

    test("renders an opt-in trailing action without selecting the option", async () => {
        const { createVanillaDropdown } = await import("./vanilla_dropdown_builder.js");
        const onChange = vi.fn();
        const onAction = vi.fn();
        const container = document.createElement("div");
        document.body.appendChild(container);

        const dropdown = createVanillaDropdown({
            containerElement: container,
            options: [{ value: "created:DESC", label: "Newest" }],
            useSearch: false,
            showClearButton: false,
            onChange,
            renderOptionTrailingAction: () => {
                const button = document.createElement("button");
                button.type = "button";
                button.classList.add("vdw-option-trailing-action");
                button.textContent = "Set default";
                button.addEventListener("click", onAction);
                return button;
            },
        });
        dropdown.open();

        document.querySelector(".vdw-option-trailing-action")?.click();

        expect(onAction).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
        expect(dropdown.getValue()).toBeNull();
    });

    test("keeps an opt-in menu width inside the viewport", async () => {
        const { createVanillaDropdown } = await import("./vanilla_dropdown_builder.js");
        const container = document.createElement("div");
        document.body.appendChild(container);
        Object.defineProperty(window, "innerWidth", { configurable: true, value: 240 });

        const dropdown = createVanillaDropdown({
            containerElement: container,
            options: [{ value: "created:DESC", label: "Newest first" }],
            useSearch: false,
            showClearButton: false,
            menuMaxWidth: 300,
        });
        container.querySelector(".vdw-dropdown-input-row").getBoundingClientRect = () => ({
            bottom: 48,
            height: 40,
            left: 190,
            right: 230,
            top: 8,
            width: 40,
        });

        dropdown.open();

        const list = document.querySelector(".vdw-dropdown-list");
        expect(list.style.width).toBe("224px");
        expect(list.style.left).toBe("8px");
    });
});
