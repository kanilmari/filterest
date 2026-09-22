// vanilla_dropdown_builder.test.js
// Verifies the vanilla dropdown renders its chevron as a CSS-mask icon.
// Bridges dropdown DOM construction with compatibility-safe icon assertions in jsdom.
// Exists to keep shared dropdown controls from regressing back to inline SVG markup.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../icons/icon_loader.js", () => ({
    setElementSvgContent: vi.fn(async () => undefined),
}));

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

    // A picture before an option's name belongs to the option, unlike a
    // trailing action, which is a control of its own.
    test("shows an opt-in picture before each option's name, and a click on it still chooses the option", async () => {
        const { createVanillaDropdown } = await import("./vanilla_dropdown_builder.js");
        const container = document.createElement("div");
        document.body.appendChild(container);
        const onChange = vi.fn();

        const dropdown = createVanillaDropdown({
            containerElement: container,
            options: [{ value: "star", label: "star" }, { value: "", label: "No symbol" }],
            useSearch: false,
            showClearButton: false,
            onChange,
            renderOptionLeadingIcon: (option) => {
                const icon = document.createElement("span");
                if (option.value) icon.dataset.pictureOf = option.value;
                return icon;
            },
        });
        dropdown.open();

        const rows = document.querySelectorAll(".vdw-option");
        expect(rows[0].classList.contains("vdw-option--with-leading-icon")).toBe(true);
        expect(rows[0].firstElementChild.dataset.pictureOf).toBe("star");
        expect(rows[0].firstElementChild.classList.contains("vdw-option-icon")).toBe(true);
        expect(rows[0].querySelector(".vdw-option-label").textContent).toBe("star");

        rows[0].querySelector(".vdw-option-icon").click();
        expect(onChange).toHaveBeenCalledWith("star");
    });

    test("options without an opt-in picture are drawn exactly as before", async () => {
        const { createVanillaDropdown } = await import("./vanilla_dropdown_builder.js");
        const container = document.createElement("div");
        document.body.appendChild(container);

        createVanillaDropdown({
            containerElement: container,
            options: [{ value: "asc", label: "Ascending" }],
            useSearch: false,
            showClearButton: false,
        });

        const option = document.querySelector(".vdw-option");
        expect(option.classList.contains("vdw-option--with-leading-icon")).toBe(false);
        expect(option.querySelector(".vdw-option-label")).toBeNull();
        expect(option.textContent).toBe("Ascending");
    });

    test("a dropdown that must not be used yet refuses a choice and closes", async () => {
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
        dropdown.setDisabled(true);

        const trigger = container.querySelector(".vdw-dropdown-input");
        expect(trigger.disabled).toBe(true);
        expect(document.querySelector(".vdw-dropdown-list").style.display).toBe("none");

        dropdown.setDisabled(false);
        expect(trigger.disabled).toBe(false);
    });
});

describe("createVanillaDropdown list layer", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    const buildDropdown = async (onChange = vi.fn()) => {
        const { createVanillaDropdown } = await import("./vanilla_dropdown_builder.js");
        const container = document.createElement("div");
        const dropdown = createVanillaDropdown({
            containerElement: container,
            options: [{ value: "orders", label: "orders" }],
            useSearch: false,
            showClearButton: false,
            onChange,
        });
        const list = () => document.querySelector(`.vdw-dropdown-list[style*="block"]`);
        return { container, dropdown, list };
    };

    test("a dropdown on a page opens its list on the page body as before", async () => {
        const { container, dropdown, list } = await buildDropdown();
        document.body.appendChild(container);

        dropdown.open();

        expect(list().parentElement).toBe(document.body);
    });

    test("a dropdown in a dialog opens its list on that dialog's overlay, where options can be picked", async () => {
        const { createModal, showModal } = await import("../modal/modal_builder.js");
        const onChange = vi.fn();
        // Built before it is placed in the dialog, as dialog forms are.
        const { container, dropdown, list } = await buildDropdown(onChange);
        const { modal_overlay: overlay } = createModal({ titlePlainText: "Add", contentElements: [container] });
        showModal();

        dropdown.open();

        expect(list().parentElement).toBe(overlay);
        expect(overlay.querySelector(".modal").contains(list())).toBe(false);
        list().querySelector(".vdw-option").click();
        expect(onChange).toHaveBeenCalledWith("orders");
    });

    test("a dropdown in a stacked dialog opens its list on the stacked overlay", async () => {
        const { createModal, createStackedModal, showModal } = await import("../modal/modal_builder.js");
        const below = await buildDropdown();
        const { modal_overlay: singletonOverlay } = createModal({ titlePlainText: "Manage", contentElements: [below.container] });
        showModal();
        const above = await buildDropdown();
        const stacked = createStackedModal({ titlePlainText: "Pick", contentElements: [above.container] });
        stacked.show();

        above.dropdown.open();

        expect(above.list().parentElement).toBe(stacked.modal_overlay);
        expect(stacked.modal_overlay).not.toBe(singletonOverlay);
        stacked.hide();
    });
});
