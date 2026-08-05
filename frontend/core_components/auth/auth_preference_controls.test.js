// @vitest-environment jsdom
// auth_preference_controls.test.js
// Verifies reusable standalone-form preference controls and idempotent setup.
// Bridges marked form placeholders with mocked theme and language components.
// Exists so future forms can opt in without copying login-specific markup.

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    initializeThemeToggle,
    initializeLanguageSelector,
    authLanguages,
} = vi.hoisted(() => ({
    initializeThemeToggle: vi.fn(),
    initializeLanguageSelector: vi.fn(),
    authLanguages: [{ value: "en" }, { value: "fi" }, { value: "ch" }, { value: "yue" }],
}));

vi.mock("../theme.js", () => ({ initializeThemeToggle }));
vi.mock("../lang/lang_panel_printer.js", () => ({ initializeLanguageSelector }));
vi.mock("../lang/ui_language_catalog.js", () => ({
    getUiLanguageOptions: vi.fn(() => authLanguages),
}));

import { initializeAuthPreferenceControls } from "./auth_preference_controls.js";

describe("auth_preference_controls", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    test("builds shared controls from a context-only placeholder", () => {
        document.body.innerHTML = `
            <div data-auth-preference-controls data-auth-controls-context="first-run"></div>
        `;

        initializeAuthPreferenceControls(document);

        const themeButton = document.querySelector('[data-testid="first-run-theme-toggle"]');
        const languageSelector = document.querySelector('[data-testid="first-run-language-selection"]');
        expect(themeButton?.matches("[data-theme-toggle]")).toBe(true);
        expect(languageSelector?.classList.contains("auth-language-selection")).toBe(true);
        expect(initializeThemeToggle).toHaveBeenCalledWith(themeButton);
        expect(initializeLanguageSelector).toHaveBeenCalledWith(languageSelector, {
            languages: authLanguages,
        });
    });

    test("supports multiple form contexts without duplicate controls", () => {
        document.body.innerHTML = `
            <div data-auth-preference-controls data-auth-controls-context="login"></div>
            <div data-auth-preference-controls data-auth-controls-context="password-reset"></div>
        `;

        initializeAuthPreferenceControls(document);
        initializeAuthPreferenceControls(document);

        expect(document.querySelectorAll("[data-theme-toggle]")).toHaveLength(2);
        expect(document.querySelector('[data-testid="login-theme-toggle"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="password-reset-theme-toggle"]')).not.toBeNull();
        expect(initializeThemeToggle).toHaveBeenCalledTimes(2);
        expect(initializeLanguageSelector).toHaveBeenCalledTimes(2);
    });
});
