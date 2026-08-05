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
 * Extract a single language value from a raw cell value.
 * @param {*} rawVal           — raw value (may be JSON string or plain text)
 * @param {string} chosenLang  — ISO 639-1 language code, default 'en'
 * @param {boolean|null} isMultilingual — metadata flag from system_column_details;
 *                              true  = always treat as multilingual JSON,
 *                              false = never treat as multilingual,
 *                              null/undefined = fall back to heuristic detection.
 * @returns {string}
 */
export function extractLangValue(rawVal, chosenLang = 'en', isMultilingual = null) {
    if (rawVal == null) return '';
    const isObjectValue = typeof rawVal === 'object' && !Array.isArray(rawVal);
    const str = isObjectValue ? JSON.stringify(rawVal) : String(rawVal).trim();

    if (!isObjectValue && !(str.startsWith('{') && str.endsWith('}'))) {
        return str;
    }
    if (isMultilingual === false) {
        return str;
    }
    if (isMultilingual !== true && !looksLikeLangValue(rawVal)) {
        return str;
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
                if (typeof parsed[languageKey] === 'string') {
                    return String(parsed[languageKey]);
                }
            }
            const firstKey = keys.find(k => typeof parsed[k] === 'string');
            if (firstKey) return String(parsed[firstKey]);
        }
    } catch (_e) {
        // fall through on parse error
    }
    return str;
}
