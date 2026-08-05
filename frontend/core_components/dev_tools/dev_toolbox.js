// dev_toolbox.js
// Opens a DEV-only toolbox for runtime UI tuning.
// Bridges keyboard diagnostics, shared modal chrome, and CSS custom properties.
// Exists so local visual timing tweaks can be tested without code edits.

import { createModal, showModal } from "../../reusable_components/modal/modal_builder.js";

const DEV_TOOLBOX_STORAGE_KEY = "easelect_dev_toolbox_settings";
const NAVTAB_DURATION_PROPERTY = "--navtab-presentation-transition-duration";
const DEFAULT_NAVTAB_PRESENTATION_DURATION_MS = 150;
const MIN_NAVTAB_PRESENTATION_DURATION_MS = 0;
const MAX_NAVTAB_PRESENTATION_DURATION_MS = 5000;
const NAVTAB_PRESENTATION_DURATION_STEP_MS = 50;

let keydownHandler = null;
let initializedDocument = null;

export function isDevToolboxEnabled(doc = document) {
    return doc?.querySelector?.('meta[name="app-env"]')?.content === "dev";
}

export function normalizeNavTabPresentationDurationMs(value, fallbackMs = DEFAULT_NAVTAB_PRESENTATION_DURATION_MS) {
    const parsedValue = Number.parseInt(String(value ?? ""), 10);
    const finiteFallback = Number.isFinite(fallbackMs)
        ? fallbackMs
        : DEFAULT_NAVTAB_PRESENTATION_DURATION_MS;

    if (!Number.isFinite(parsedValue)) {
        return finiteFallback;
    }

    return Math.min(
        MAX_NAVTAB_PRESENTATION_DURATION_MS,
        Math.max(MIN_NAVTAB_PRESENTATION_DURATION_MS, parsedValue)
    );
}

function getStorage(doc = document) {
    try {
        return doc?.defaultView?.localStorage || window.localStorage;
    } catch {
        return null;
    }
}

function readDevToolboxSettings(doc = document) {
    const storage = getStorage(doc);
    if (!storage) return {};

    try {
        return JSON.parse(storage.getItem(DEV_TOOLBOX_STORAGE_KEY) || "{}");
    } catch {
        return {};
    }
}

function writeDevToolboxSettings(settings, doc = document) {
    const storage = getStorage(doc);
    if (!storage) return;
    storage.setItem(DEV_TOOLBOX_STORAGE_KEY, JSON.stringify(settings));
}

function parseCssDurationToMs(rawValue) {
    const value = String(rawValue || "").trim();
    if (!value) return null;

    if (value.endsWith("ms")) {
        const milliseconds = Number.parseFloat(value);
        return Number.isFinite(milliseconds) ? Math.round(milliseconds) : null;
    }

    if (value.endsWith("s")) {
        const seconds = Number.parseFloat(value);
        return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
    }

    const numericValue = Number.parseFloat(value);
    return Number.isFinite(numericValue) ? Math.round(numericValue) : null;
}

function resolveNavbarElement(doc = document) {
    return doc.getElementById("navbar");
}

function readCurrentNavTabPresentationDurationMs(doc = document) {
    const navbar = resolveNavbarElement(doc);
    if (!navbar) {
        return DEFAULT_NAVTAB_PRESENTATION_DURATION_MS;
    }

    const computedDuration = doc.defaultView
        ?.getComputedStyle(navbar)
        ?.getPropertyValue(NAVTAB_DURATION_PROPERTY);
    return parseCssDurationToMs(computedDuration)
        ?? DEFAULT_NAVTAB_PRESENTATION_DURATION_MS;
}

export function applyNavTabPresentationDurationMs(value, { doc = document, persist = true } = {}) {
    const durationMs = normalizeNavTabPresentationDurationMs(value);
    const navbar = resolveNavbarElement(doc);
    if (navbar) {
        navbar.style.setProperty(NAVTAB_DURATION_PROPERTY, `${durationMs}ms`);
    }

    if (persist) {
        writeDevToolboxSettings({
            ...readDevToolboxSettings(doc),
            navtabPresentationDurationMs: durationMs,
        }, doc);
    }

    return durationMs;
}

function resetNavTabPresentationDuration(doc = document) {
    const navbar = resolveNavbarElement(doc);
    if (navbar) {
        navbar.style.removeProperty(NAVTAB_DURATION_PROPERTY);
    }

    const settings = readDevToolboxSettings(doc);
    delete settings.navtabPresentationDurationMs;
    writeDevToolboxSettings(settings, doc);

    return readCurrentNavTabPresentationDurationMs(doc);
}

function applyStoredDevToolboxSettings(doc = document) {
    const settings = readDevToolboxSettings(doc);
    if (settings.navtabPresentationDurationMs != null) {
        applyNavTabPresentationDurationMs(settings.navtabPresentationDurationMs, {
            doc,
            persist: false,
        });
    }
}

function createDurationControl(doc = document) {
    const field = doc.createElement("label");
    field.className = "dev-toolbox-field";

    const labelText = doc.createElement("span");
    labelText.className = "dev-toolbox-label";
    labelText.textContent = "Tab transition duration";

    const controlRow = doc.createElement("span");
    controlRow.className = "dev-toolbox-control-row";

    const input = doc.createElement("input");
    input.className = "dev-toolbox-number-input";
    input.type = "number";
    input.min = String(MIN_NAVTAB_PRESENTATION_DURATION_MS);
    input.max = String(MAX_NAVTAB_PRESENTATION_DURATION_MS);
    input.step = String(NAVTAB_PRESENTATION_DURATION_STEP_MS);
    input.value = String(readCurrentNavTabPresentationDurationMs(doc));

    const valueText = doc.createElement("span");
    valueText.className = "dev-toolbox-value";

    function updateValueText(durationMs) {
        valueText.textContent = `${durationMs} ms`;
    }

    function applyInputValue() {
        const durationMs = applyNavTabPresentationDurationMs(input.value, { doc });
        input.value = String(durationMs);
        updateValueText(durationMs);
    }

    input.addEventListener("input", applyInputValue);
    input.addEventListener("change", applyInputValue);

    updateValueText(Number.parseInt(input.value, 10));
    controlRow.append(input, valueText);
    field.append(labelText, controlRow);

    return {
        element: field,
        refresh() {
            const durationMs = readCurrentNavTabPresentationDurationMs(doc);
            input.value = String(durationMs);
            updateValueText(durationMs);
        },
    };
}

export function openDevToolbox(doc = document) {
    if (!isDevToolboxEnabled(doc)) {
        return false;
    }

    const toolbox = doc.createElement("div");
    toolbox.className = "dev-toolbox";

    const intro = doc.createElement("p");
    intro.className = "dev-toolbox-note";
    intro.textContent = "Local DEV-only visual controls.";

    const durationControl = createDurationControl(doc);

    const resetButton = doc.createElement("button");
    resetButton.type = "button";
    resetButton.className = "fw-btn dev-toolbox-reset-button";
    resetButton.textContent = "Reset tab timing";
    resetButton.addEventListener("click", () => {
        const durationMs = resetNavTabPresentationDuration(doc);
        durationControl.refresh();
        resetButton.dataset.lastResetValue = String(durationMs);
    });

    toolbox.append(intro, durationControl.element, resetButton);

    createModal({
        titlePlainText: "DEV toolbox",
        contentElements: [toolbox],
        width: "min(560px, calc(100vw - 32px))",
        maxWidth: "calc(100vw - 32px)",
    });
    showModal();
    return true;
}

function isDevToolboxShortcut(event) {
    return event.shiftKey
        && event.altKey
        && !event.ctrlKey
        && !event.metaKey
        && String(event.key || "").toLowerCase() === "t";
}

export function initDevToolbox(doc = document) {
    if (!isDevToolboxEnabled(doc)) {
        return false;
    }

    if (initializedDocument === doc && keydownHandler) {
        return true;
    }

    if (initializedDocument && keydownHandler) {
        initializedDocument.removeEventListener("keydown", keydownHandler);
    }

    applyStoredDevToolboxSettings(doc);

    keydownHandler = (event) => {
        if (!isDevToolboxShortcut(event)) {
            return;
        }
        event.preventDefault();
        openDevToolbox(doc);
    };
    initializedDocument = doc;
    doc.addEventListener("keydown", keydownHandler);
    return true;
}

export function resetDevToolboxForTests() {
    if (initializedDocument && keydownHandler) {
        initializedDocument.removeEventListener("keydown", keydownHandler);
    }
    initializedDocument = null;
    keydownHandler = null;
}
