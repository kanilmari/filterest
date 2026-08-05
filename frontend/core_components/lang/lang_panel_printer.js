// lang_panel_printer.js
// Renders reusable language selectors and wires them to page translation.
// Bridges the language catalog, saved preference, and translation system.
// Exists so application chrome and standalone forms share one selector behavior.

import { translatePage } from "./translation_handler.js";
import {
    getPreferredAvailableLanguage,
    setLanguage,
} from "../state_stores/lang_preference_reader.js";
import { createMaskIconSpan } from "../../icons/icon_mask_builder.js";
import { getUiLanguageOptions } from "./ui_language_catalog.js";

const MENU_LANGUAGE_ICON_PATH = "/frontend/icons/navigation/language-globe-icon.svg";
const initializedSelectors = new WeakSet();
const selectorLanguageOptions = new WeakMap();
let selectorSequence = 0;

function ensureMenuLanguageIcon(buttonElement) {
    if (!buttonElement) return null;

    let iconElement = buttonElement.querySelector(".language-button-icon");
    if (iconElement) return iconElement;

    iconElement = createMaskIconSpan(MENU_LANGUAGE_ICON_PATH, ["language-button-icon"]);
    buttonElement.prepend(iconElement);
    return iconElement;
}

function ensureMenuLanguageLabel(buttonElement) {
    if (!buttonElement) return null;

    let labelElement = buttonElement.querySelector(".language-code-label");
    if (labelElement) return labelElement;

    labelElement = document.createElement("span");
    labelElement.className = "language-code-label";
    buttonElement.appendChild(labelElement);
    return labelElement;
}

function syncMenuLanguageButton(buttonElement, languageCode, languageOptions) {
    if (!buttonElement) return;

    ensureMenuLanguageIcon(buttonElement);
    const labelElement = ensureMenuLanguageLabel(buttonElement);
    const selectedLanguage = languageOptions.find((language) => language.value === languageCode);
    labelElement.textContent = selectedLanguage?.shortLabel || String(languageCode || "EN").toUpperCase();
}

function buildLanguageButton() {
    const languageButton = document.createElement("button");
    languageButton.type = "button";
    languageButton.classList.add("language-button", "button");
    languageButton.dataset.testid = "language-menu-button";
    return languageButton;
}

function buildLanguagePanel(languageOptions, selectorId) {
    const floatingPanel = document.createElement("div");
    floatingPanel.classList.add("floating-language-panel", "hidden");
    floatingPanel.dataset.testid = "language-menu-panel";

    const panelContent = document.createElement("div");
    panelContent.classList.add("panel-content");

    const heading = document.createElement("label");
    const headingText = document.createElement("b");
    heading.dataset.langKey = "select_menu_language";
    heading.appendChild(headingText);
    panelContent.appendChild(heading);

    languageOptions.forEach((language) => {
        const optionContainer = document.createElement("div");
        optionContainer.classList.add("language-option");

        const inputElement = document.createElement("input");
        inputElement.id = `${selectorId}-${language.id}`;
        inputElement.type = "radio";
        inputElement.name = `${selectorId}-menu-lang`;
        inputElement.value = language.value;
        inputElement.title = language.title;
        inputElement.dataset.testid = `language-menu-option-${language.value}`;

        const optionLabel = document.createElement("label");
        optionLabel.setAttribute("for", inputElement.id);
        optionLabel.textContent = language.label;

        optionContainer.append(inputElement, optionLabel);
        panelContent.appendChild(optionContainer);
    });

    floatingPanel.appendChild(panelContent);
    return floatingPanel;
}

function setDefaultMenuLanguage(languageSelector, languageOptions) {
    const availableValues = languageOptions.map((language) => language.value);
    const savedLanguage = getPreferredAvailableLanguage(availableValues);
    const matchingRadio = languageSelector.querySelector(
        `.floating-language-panel input[value="${savedLanguage}"]`
    ) || languageSelector.querySelector('.floating-language-panel input[value="en"]')
        || languageSelector.querySelector('.floating-language-panel input[type="radio"]');

    if (!matchingRadio) return savedLanguage;
    matchingRadio.checked = true;
    return matchingRadio.value;
}

/**
 * Initializes one reusable language selector.
 *
 * @param {HTMLElement} languageSelector
 * @param {{languages?: Array<object>}} options
 * @returns {string|null} initially selected language
 */
export function initializeLanguageSelector(
    languageSelector,
    { languages = getUiLanguageOptions("application") } = {}
) {
    if (!(languageSelector instanceof HTMLElement) || initializedSelectors.has(languageSelector)) {
        return null;
    }
    if (!Array.isArray(languages) || languages.length === 0) return null;

    initializedSelectors.add(languageSelector);
    selectorLanguageOptions.set(languageSelector, languages);
    selectorSequence += 1;

    const selectorId = languageSelector.dataset.languageSelectorId
        || `language-selector-${selectorSequence}`;
    languageSelector.dataset.languageSelectorId = selectorId;
    languageSelector.style.position = "relative";

    const languageButton = buildLanguageButton();
    const floatingPanel = buildLanguagePanel(languages, selectorId);
    languageSelector.append(languageButton, floatingPanel);

    const initialLanguage = setDefaultMenuLanguage(languageSelector, languages);
    syncMenuLanguageButton(languageButton, initialLanguage, languages);
    void translatePage(initialLanguage);

    languageButton.addEventListener("click", (event) => {
        event.stopPropagation();
        document.querySelectorAll(".floating-language-panel").forEach((panel) => {
            if (panel !== floatingPanel) panel.classList.add("hidden");
        });
        floatingPanel.style.minWidth = `${Math.max(languageButton.offsetWidth + 132, 220)}px`;
        floatingPanel.classList.toggle("hidden");
    });

    floatingPanel.querySelectorAll('input[type="radio"]').forEach((radio) => {
        radio.addEventListener("change", () => {
            setLanguage(radio.value);
            syncMenuLanguageButton(languageButton, radio.value, languages);
            void translatePage(radio.value);
            floatingPanel.classList.add("hidden");
        });
    });

    document.addEventListener("click", (event) => {
        if (!languageSelector.contains(event.target)) floatingPanel.classList.add("hidden");
    });

    return initialLanguage;
}

/**
 * Initializes every uninitialized language selector below a root node.
 *
 * @param {Document|HTMLElement} root
 */
export function initializeLanguageSelectors(root = document) {
    root.querySelectorAll(".language-selection.menu-language-selection").forEach((selector) => {
        initializeLanguageSelector(selector);
    });
}

/**
 * Synchronizes selector button labels after an external language change.
 *
 * @param {string|null} nextLanguage
 * @param {HTMLElement|null} targetSelector
 */
export async function updateMenuLanguageDisplay(nextLanguage = null, targetSelector = null) {
    const selectors = targetSelector
        ? [targetSelector]
        : Array.from(document.querySelectorAll(".language-selection.menu-language-selection"));

    selectors.forEach((selector) => {
        const languages = selectorLanguageOptions.get(selector) || getUiLanguageOptions("application");
        const availableValues = languages.map((language) => language.value);
        const chosenLanguage = nextLanguage
            || selector.querySelector('.floating-language-panel input[type="radio"]:checked')?.value
            || getPreferredAvailableLanguage(availableValues);
        syncMenuLanguageButton(selector.querySelector(".language-button"), chosenLanguage, languages);
    });
}

document.addEventListener("DOMContentLoaded", () => initializeLanguageSelectors(document));
