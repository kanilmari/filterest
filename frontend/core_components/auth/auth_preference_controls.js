// auth_preference_controls.js
// Builds shared theme and language controls for standalone authentication forms.
// Bridges form placeholders with the reusable theme and language components.
// Exists so future pre-login forms opt in without copying control markup or logic.

import { initializeThemeToggle } from "../theme.js";
import { initializeLanguageSelector } from "../lang/lang_panel_printer.js";
import { getUiLanguageOptions } from "../lang/ui_language_catalog.js";

const AUTH_CONTROLS_SELECTOR = "[data-auth-preference-controls]";
const initializedControlGroups = new WeakSet();

function normalizeContextName(value) {
    return String(value || "auth")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "auth";
}

function buildThemeToggle(contextName) {
    const themeButton = document.createElement("button");
    themeButton.type = "button";
    themeButton.className = "button auth-toolbar-button auth-theme-toggle";
    themeButton.dataset.themeToggle = "";
    themeButton.dataset.testid = `${contextName}-theme-toggle`;
    return themeButton;
}

function buildLanguageSelector(contextName) {
    const languageSelector = document.createElement("div");
    languageSelector.className = "language-selection menu-language-selection auth-language-selection";
    languageSelector.dataset.testid = `${contextName}-language-selection`;
    languageSelector.dataset.languageSelectorId = `${contextName}-language-selector`;
    return languageSelector;
}

/**
 * Builds all marked authentication preference-control groups below a root node.
 * A future form only needs an empty element with data-auth-preference-controls.
 *
 * @param {Document|HTMLElement} root
 */
export function initializeAuthPreferenceControls(root = document) {
    root.querySelectorAll(AUTH_CONTROLS_SELECTOR).forEach((controlGroup) => {
        if (!(controlGroup instanceof HTMLElement) || initializedControlGroups.has(controlGroup)) {
            return;
        }

        initializedControlGroups.add(controlGroup);
        const contextName = normalizeContextName(controlGroup.dataset.authControlsContext);
        const themeButton = buildThemeToggle(contextName);
        const languageSelector = buildLanguageSelector(contextName);
        controlGroup.append(themeButton, languageSelector);

        initializeThemeToggle(themeButton);
        initializeLanguageSelector(languageSelector, {
            languages: getUiLanguageOptions("auth"),
        });
    });
}

initializeAuthPreferenceControls(document);
