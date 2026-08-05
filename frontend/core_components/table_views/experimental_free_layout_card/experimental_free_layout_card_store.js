// experimental_free_layout_card_store.js
// Persists the experimental admin-only card style and its layout template in localStorage.
// Bridges the removable free-layout prototype and the existing card view without backend storage.
// Exists so the feature can stay lightly coupled now while remaining easy to delete or harden later.

export const STANDARD_CARD_STYLE_VARIANT = "standard";
export const EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT =
    "experimental_free_layout";

const EXPERIMENTAL_LAYOUT_TEMPLATE_VERSION = 1;

function safeParseJson(rawValue, fallbackValue) {
    if (!rawValue) {
        return fallbackValue;
    }

    try {
        return JSON.parse(rawValue);
    } catch {
        return fallbackValue;
    }
}

/**
 * Returns whether the dev-only experimental free-layout tooling should be available.
 *
 * @returns {boolean}
 */
export function isExperimentalFreeLayoutAvailable() {
    return (
        document.querySelector('meta[name="app-env"]')?.content === "dev"
    );
}

/**
 * Builds the storage key for the per-dataset card-style variant selector.
 *
 * @param {string} tableName
 * @returns {string}
 */
export function buildCardStyleStorageKey(tableName) {
    return `${tableName}_card_style_variant`;
}

/**
 * Builds the storage key for the experimental free-layout template JSON.
 *
 * @param {string} tableName
 * @returns {string}
 */
export function buildExperimentalLayoutStorageKey(tableName) {
    return `${tableName}_experimental_free_layout_card_template`;
}

/**
 * Builds the storage key for the local designer-mode toggle.
 *
 * @param {string} tableName
 * @returns {string}
 */
export function buildExperimentalDesignModeStorageKey(tableName) {
    return `${tableName}_experimental_free_layout_card_design_mode`;
}

/**
 * Returns the selected card-style variant for one dataset.
 *
 * @param {string} tableName
 * @returns {string}
 */
export function getCardStyleVariant(tableName) {
    const rawValue = localStorage.getItem(buildCardStyleStorageKey(tableName));

    if (
        rawValue === EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT ||
        rawValue === STANDARD_CARD_STYLE_VARIANT
    ) {
        return rawValue;
    }

    return STANDARD_CARD_STYLE_VARIANT;
}

/**
 * Returns the card-style variant that may actually be used in the current UI context.
 * Outside dev mode we always force the removable prototype off, even if localStorage
 * still contains the experimental variant from an earlier session.
 *
 * @param {string} tableName
 * @returns {string}
 */
export function getEffectiveCardStyleVariant(tableName) {
    if (!isExperimentalFreeLayoutAvailable()) {
        return STANDARD_CARD_STYLE_VARIANT;
    }

    return getCardStyleVariant(tableName);
}

/**
 * Persists the selected card-style variant for one dataset.
 *
 * @param {string} tableName
 * @param {string} variant
 * @returns {string}
 */
export function setCardStyleVariant(tableName, variant) {
    const normalizedVariant =
        variant === EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT
            ? EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT
            : STANDARD_CARD_STYLE_VARIANT;

    localStorage.setItem(
        buildCardStyleStorageKey(tableName),
        normalizedVariant
    );

    return normalizedVariant;
}

/**
 * Reads the experimental layout template JSON for one dataset.
 *
 * @param {string} tableName
 * @returns {{ version: number, columns: number, items: Record<string, object> } | null}
 */
export function loadExperimentalLayoutTemplate(tableName) {
    const parsed = safeParseJson(
        localStorage.getItem(buildExperimentalLayoutStorageKey(tableName)),
        null
    );

    if (
        !parsed ||
        typeof parsed !== "object" ||
        parsed.version !== EXPERIMENTAL_LAYOUT_TEMPLATE_VERSION ||
        typeof parsed.columns !== "number" ||
        !parsed.items ||
        typeof parsed.items !== "object"
    ) {
        return null;
    }

    return parsed;
}

/**
 * Persists the experimental layout template JSON for one dataset.
 *
 * @param {string} tableName
 * @param {{ version?: number, columns?: number, items?: Record<string, object> }} template
 * @returns {{ version: number, columns: number, items: Record<string, object> }}
 */
export function saveExperimentalLayoutTemplate(tableName, template) {
    const normalizedTemplate = {
        version: EXPERIMENTAL_LAYOUT_TEMPLATE_VERSION,
        columns:
            Number.isFinite(Number(template?.columns)) && Number(template.columns) > 0
                ? Number(template.columns)
                : 24,
        items:
            template?.items && typeof template.items === "object"
                ? template.items
                : {},
    };

    localStorage.setItem(
        buildExperimentalLayoutStorageKey(tableName),
        JSON.stringify(normalizedTemplate)
    );

    return normalizedTemplate;
}

/**
 * Clears the experimental layout template for one dataset.
 *
 * @param {string} tableName
 */
export function clearExperimentalLayoutTemplate(tableName) {
    localStorage.removeItem(buildExperimentalLayoutStorageKey(tableName));
}

/**
 * Returns whether the local designer mode is enabled for one dataset.
 *
 * @param {string} tableName
 * @returns {boolean}
 */
export function isExperimentalDesignModeEnabled(tableName) {
    return (
        localStorage.getItem(buildExperimentalDesignModeStorageKey(tableName)) ===
        "true"
    );
}

/**
 * Persists the local designer-mode toggle for one dataset.
 *
 * @param {string} tableName
 * @param {boolean} enabled
 */
export function setExperimentalDesignModeEnabled(tableName, enabled) {
    localStorage.setItem(
        buildExperimentalDesignModeStorageKey(tableName),
        enabled ? "true" : "false"
    );
}
