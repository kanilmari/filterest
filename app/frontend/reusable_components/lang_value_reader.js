// lang_value_reader.js
// Reads localized values from multilingual field payloads.
// Bridges raw database cell values and column metadata with the frontend's chosen-language rendering.
// Exists to centralize multilingual value extraction instead of duplicating JSON parsing heuristics.

const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(?:[-_][a-z]{2,4})?$/i;

/**
 * Check whether a value is shaped like a multilingual language map.
 * Missing metadata uses this deliberately narrow heuristic so ordinary JSON
 * objects keep their complete representation instead of losing fields.
 *
 * @param {*} rawVal
 * @returns {boolean}
 */
export function looksLikeLangValue(rawVal) {
    if (rawVal == null) return false;
    const isObjectValue = typeof rawVal === 'object' && !Array.isArray(rawVal);
    const str = isObjectValue ? JSON.stringify(rawVal) : String(rawVal).trim();
    if (!isObjectValue && !(str.startsWith('{') && str.endsWith('}'))) {
        return false;
    }

    try {
        const parsed = isObjectValue ? rawVal : JSON.parse(str);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return false;
        }
        const keys = Object.keys(parsed);
        return keys.length > 0
            && keys.every((key) => LANGUAGE_CODE_PATTERN.test(key))
            && keys.every((key) => typeof parsed[key] === 'string');
    } catch {
        return false;
    }
}

/**
 * Resolve the shown text and its actual stored language in one selection.
 * @param {*} rawVal           — raw value (may be JSON string or plain text)
 * @param {string} chosenLang  — ISO 639-1 language code, default 'en'
 * @param {boolean|null} isMultilingual — metadata flag from system_column_details;
 *                              true  = always treat as multilingual JSON,
 *                              false = never treat as multilingual,
 *                              null/undefined = fall back to heuristic detection.
 * @returns {{text: string, language: string}}
 */
export function resolveLangValue(rawVal, chosenLang = 'en', isMultilingual = null) {
    if (rawVal == null) return { text: '', language: '' };
    const isObjectValue = typeof rawVal === 'object' && !Array.isArray(rawVal);
    const str = isObjectValue ? JSON.stringify(rawVal) : String(rawVal).trim();

    if (!isObjectValue && !(str.startsWith('{') && str.endsWith('}'))) {
        return { text: str, language: '' };
    }
    if (isMultilingual === false) {
        return { text: str, language: '' };
    }
    if (isMultilingual !== true && !looksLikeLangValue(rawVal)) {
        return { text: str, language: '' };
    }
    try {
        const parsed = isObjectValue ? rawVal : JSON.parse(str);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const keys = Object.keys(parsed);

            const normalizedChosenLang = String(chosenLang || 'en')
                .trim()
                .toLowerCase()
                .replaceAll('_', '-');
            const preferredLanguageKeys = [
                normalizedChosenLang,
                normalizedChosenLang.split('-')[0],
                'en',
            ].filter((key, index, keys) => key && keys.indexOf(key) === index);

            for (const languageKey of preferredLanguageKeys) {
                const storedKey = keys.find(key => key.trim().toLowerCase().replaceAll('_', '-') === languageKey
                    && typeof parsed[key] === 'string');
                if (storedKey !== undefined) {
                    return { text: parsed[storedKey], language: languageKey };
                }
            }
            const firstKey = keys.find(k => typeof parsed[k] === 'string');
            if (firstKey) return { text: parsed[firstKey], language: firstKey.trim().toLowerCase().replaceAll('_', '-') };
        }
    } catch (_e) {
        // fall through on parse error
    }
    return { text: str, language: '' };
}

/** Text-only projection for existing field renderers. */
export function extractLangValue(rawVal, chosenLang = 'en', isMultilingual = null) {
    return resolveLangValue(rawVal, chosenLang, isMultilingual).text;
}
