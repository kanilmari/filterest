// @vitest-environment jsdom
// lang_panel_printer.test.js
// Verifies reusable language-selector rendering, switching, and isolation.
// Bridges the shared language catalog with saved preference and translation.
// Exists so authentication forms and application chrome can share one picker.

import { beforeEach, describe, expect, test, vi } from "vitest";

const { translatePage } = vi.hoisted(() => ({
    translatePage: vi.fn(async () => {}),
}));
vi.mock("./translation_handler.js", () => ({ translatePage }));

import { initializeLanguageSelector } from "./lang_panel_printer.js";
import { getUiLanguageOptions } from "./ui_language_catalog.js";

describe("lang_panel_printer", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        localStorage.clear();
        vi.clearAllMocks();
        Object.defineProperty(navigator, "languages", {
            configurable: true,
            value: ["en-US"],
        });
    });

    test("renders the centrally configured authentication languages", () => {
        const selector = document.createElement("div");
        document.body.appendChild(selector);

        initializeLanguageSelector(selector, { languages: getUiLanguageOptions("auth") });

        expect(selector.querySelectorAll('[data-testid^="language-menu-option-"]')).toHaveLength(4);
        expect(selector.querySelector('[data-testid="language-menu-option-ch"]')).not.toBeNull();
        expect(selector.querySelector(".language-code-label")?.textContent).toBe("EN");
        expect(translatePage).toHaveBeenCalledWith("en");
    });

    test("stores and applies a selected language", () => {
        const selector = document.createElement("div");
        document.body.appendChild(selector);
        initializeLanguageSelector(selector, { languages: getUiLanguageOptions("auth") });

        const cantoneseOption = selector.querySelector('[data-testid="language-menu-option-yue"]');
        cantoneseOption.checked = true;
        cantoneseOption.dispatchEvent(new Event("change", { bubbles: true }));

        expect(localStorage.getItem("chosen_language")).toBe("yue");
        expect(selector.querySelector(".language-code-label")?.textContent).toBe("粵");
        expect(translatePage).toHaveBeenLastCalledWith("yue");
    });

    test("keeps radio groups isolated when a page has multiple forms", () => {
        const firstSelector = document.createElement("div");
        const secondSelector = document.createElement("div");
        document.body.append(firstSelector, secondSelector);

        initializeLanguageSelector(firstSelector, { languages: getUiLanguageOptions("auth") });
        initializeLanguageSelector(secondSelector, { languages: getUiLanguageOptions("auth") });

        const firstRadioName = firstSelector.querySelector('input[type="radio"]')?.name;
        const secondRadioName = secondSelector.querySelector('input[type="radio"]')?.name;
        expect(firstRadioName).not.toBe(secondRadioName);
    });
});
