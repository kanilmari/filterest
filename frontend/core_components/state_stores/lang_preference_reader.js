// lang_preference_reader.js
// Centralizes access to the user's chosen language preference via localStorage.
// Between language selection UIs and components that read the active language.
// Exists to prevent scattered reads/writes and keep fallback logic consistent.

const STORAGE_KEY = 'chosen_language';
const DEFAULT_LANGUAGE = 'en';

function normalizeLanguageCode(lang) {
    const normalized = String(lang || '').trim().toLowerCase().replaceAll('_', '-');
    if (normalized === 'yue' || normalized.startsWith('yue-')) return 'yue';
    if (normalized === 'zh-hk' || normalized.startsWith('zh-hant')) return 'yue';
    if (normalized === 'zh' || normalized.startsWith('zh-')) return 'ch';
    const primary = normalized.split('-')[0];
    return /^[a-z]{2,3}$/.test(primary) ? primary : '';
}

/**
 * Returns browser language candidates in preference order as supported codes.
 * @returns {string[]}
 */
export function getBrowserLanguageCandidates() {
    const navigatorLanguages = Array.isArray(navigator.languages) && navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language || DEFAULT_LANGUAGE];
    const normalizedLanguages = navigatorLanguages
        .map(normalizeLanguageCode)
        .filter(Boolean);
    return normalizedLanguages.length > 0 ? normalizedLanguages : [DEFAULT_LANGUAGE];
}

/**
 * Returns true when the user has manually stored a language preference.
 * @returns {boolean}
 */
export function hasStoredLanguagePreference() {
    return Boolean(getLanguage());
}

/**
 * Returns the first supported language from stored or browser-preference order.
 * @param {string[]} availableLanguages - supported two- or three-letter codes
 * @param {string} fallbackLanguage - fallback when no candidate matches
 * @returns {string}
 */
export function getPreferredAvailableLanguage(availableLanguages = [], fallbackLanguage = DEFAULT_LANGUAGE) {
    const normalizedAvailableLanguages = availableLanguages
        .map(normalizeLanguageCode)
        .filter(Boolean);
    const normalizedFallbackLanguage = normalizeLanguageCode(fallbackLanguage) || DEFAULT_LANGUAGE;

    if (normalizedAvailableLanguages.length === 0) {
        return getLanguageWithBrowserFallback();
    }

    const storedLanguage = normalizeLanguageCode(getLanguage());
    if (storedLanguage && normalizedAvailableLanguages.includes(storedLanguage)) {
        return storedLanguage;
    }

    for (const candidate of getBrowserLanguageCandidates()) {
        if (normalizedAvailableLanguages.includes(candidate)) {
            return candidate;
        }
    }

    if (normalizedAvailableLanguages.includes(normalizedFallbackLanguage)) {
        return normalizedFallbackLanguage;
    }

    return normalizedAvailableLanguages[0];
}

/**
 * Returns the stored language preference, or null if not set.
 * @returns {string|null}
 */
export function getLanguage() {
    return localStorage.getItem(STORAGE_KEY);
}

/**
 * Returns the stored language preference with a browser-language fallback.
 * Falls back to the normalized browser language or 'en'.
 * @returns {string}
 */
export function getLanguageWithBrowserFallback() {
    return getLanguage() || getBrowserLanguageCandidates()[0] || DEFAULT_LANGUAGE;
}

/**
 * Stores the user's language preference.
 * @param {string} lang - language code (e.g., 'en', 'fi', 'yue')
 */
export function setLanguage(lang) {
    localStorage.setItem(STORAGE_KEY, lang);
}
