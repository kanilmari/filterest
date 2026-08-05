// translation_handler_helpers.js
// Pure translation helper functions extracted from the main frontend translation handler.
// Bridges translation_handler.js and its unit tests without any DOM or network coupling.
// Exists to keep key parsing and fallback logic easy to reason about and test in isolation.

/**
 * Split a translation key on the '+' separator.
 * Keys like "manage_table+dev_dating_profiles" have a base key and a variable part.
 *
 * @param {string} translationKey - The raw translation key (may contain '+')
 * @returns {{ baseKey: string, variablePart: string|null }}
 */
export function splitTranslationKey(translationKey) {
    if (!translationKey) return { baseKey: '', variablePart: null };
    const parts = translationKey.split('+');
    return {
        baseKey: parts[0],
        variablePart: parts[1] || null,
    };
}

/**
 * Format a missing translation key into a human-readable display string.
 * Replaces underscores with spaces and capitalises the first character.
 * If a variable part is present, it is appended after a space.
 *
 * @param {string} baseKey - The base key (e.g. "manage_table")
 * @param {string|null} variablePart - Optional variable suffix (e.g. "dev_dating_profiles")
 * @returns {string} Formatted display string
 */
export function formatMissingKey(baseKey, variablePart) {
    if (!baseKey) return '';
    const formatted = baseKey
        .replace(/_/g, ' ')
        .replace(/^\w/, char => char.toUpperCase());
    return variablePart ? `${formatted} ${variablePart}` : formatted;
}

/**
 * Replace supported placeholders in a translation string with the variable part.
 * Currently supports both $table_name and $site_name so existing dataset-driven
 * translations and login-page site-aware copy can share the same key syntax.
 *
 * @param {string} translation - The translation text (may contain "$table_name")
 * @param {string|null} variablePart - The value to substitute, or null to skip
 * @returns {string} Translation with placeholder replaced
 */
export function applyTranslationVariable(translation, variablePart) {
    if (!translation) return '';
    if (!variablePart) return translation;
    return translation
        .split('$table_name').join(variablePart)
        .split('$site_name').join(variablePart);
}

/**
 * Append optional context to translated image alt text.
 *
 * @param {string|null|undefined} translation - Base translated alt label
 * @param {string|null|undefined} altContext - Optional row or dataset context
 * @returns {string} Final alt text with readable context when available
 */
export function appendAltContext(translation, altContext) {
    const baseText = String(translation ?? '').trim();
    const contextText = String(altContext ?? '').trim();

    if (!baseText) {
        return contextText;
    }

    if (!contextText) {
        return baseText;
    }

    if (/[:-]\s*$/.test(baseText)) {
        return `${baseText} ${contextText}`;
    }

    return `${baseText}: ${contextText}`;
}

/**
 * Resolve a translation for a base key by looking up primary data,
 * then falling back to default (English) data.
 * Returns null if neither source has the key.
 *
 * @param {string} baseKey - The base translation key
 * @param {Object} primaryData - Translations in the chosen language
 * @param {Object} fallbackData - Default (English) translations
 * @returns {string|null} The resolved translation, or null if not found
 */
export function resolveTranslation(baseKey, primaryData, fallbackData) {
    if (!baseKey) return null;
    const primary = primaryData?.[baseKey];
    if (primary) return primary;
    const fallback = fallbackData?.[baseKey];
    if (fallback) return fallback;
    return null;
}
