// @vitest-environment jsdom
// lang_panel_printer.test.js
// Verifies reusable language-selector rendering, switching, and isolation.
// Bridges the shared language catalog with saved preference and translation.
// Exists so authentication forms and application chrome can share one picker.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { translatePage } = vi.hoisted(() => ({
    translatePage: vi.fn(async () => {}),
}));
vi.mock("./translation_handler.js", () => ({ translatePage }));

import { initializeLanguageSelector } from "./lang_panel_printer.js";
import { getUiLanguageOptions } from "./ui_language_catalog.js";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

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

    test("keeps the compact language control on a uniform one-pixel border", () => {
        const css = readFileSync(resolve(CURRENT_DIR, "lang_panel.css"), "utf8");
        const buttonRule = css.match(/\.language-button\s*\{([\s\S]*?)\n\}/)?.[1] || "";

        expect(buttonRule).toContain("border: 1px solid var(--border_color)");
        expect(buttonRule).not.toContain("inset 0 1px 0");
    });

    test("renders the centrally configured authentication languages", () => {
        const selector = document.createElement("div");
        selector.classList.add("button");
        document.body.appendChild(selector);

        initializeLanguageSelector(selector, { languages: getUiLanguageOptions("auth") });

        const languageButton = selector.querySelector('[data-testid="language-menu-button"]');
        const languagePanel = selector.querySelector('[data-testid="language-menu-panel"]');
        expect(selector.classList.contains("button")).toBe(false);
        expect(selector.querySelectorAll("button")).toHaveLength(1);
        expect(languageButton?.getAttribute("aria-controls")).toBe(languagePanel?.id);
        expect(languageButton?.getAttribute("aria-expanded")).toBe("false");
        expect(selector.querySelectorAll('[data-testid^="language-menu-option-"]')).toHaveLength(4);
        expect(selector.querySelector('[data-testid="language-menu-option-ch"]')).not.toBeNull();
        expect(selector.querySelector(".language-code-label")?.textContent).toBe("EN");
        expect(translatePage).toHaveBeenCalledWith("en");

        languageButton?.click();
        expect(languagePanel?.classList.contains("hidden")).toBe(false);
        expect(languageButton?.getAttribute("aria-expanded")).toBe("true");

        selector.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(languagePanel?.classList.contains("hidden")).toBe(true);
        expect(languageButton?.getAttribute("aria-expanded")).toBe("false");
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
