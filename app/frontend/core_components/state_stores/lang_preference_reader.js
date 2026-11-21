// lang_preference_reader.js
// Centralizes which interface language is active: an enabled ?lang= address, the stored choice, the browser.
// Between language selection UIs, the page address, and components that read the active language.
// Exists to prevent scattered reads/writes and keep fallback logic consistent.

import { getUiLanguageOptions } from '../lang/ui_language_catalog.js';

const STORAGE_KEY = 'chosen_language';
const DEFAULT_LANGUAGE = 'en';
const ADDRESS_LANGUAGE_PARAMETER = 'lang';

// The raw ?lang= value of the address this page was loaded from. It is read
// once, while the app's modules load and before the app rewrites the address,
// so in-app navigation in the same tab keeps the language that a search engine
// or a shared link asked for (WL175). It is never written as the stored choice,
// so the visitor's own preference is unchanged on their next ordinary visit; an
// explicit choice in the language selector (setLanguage) ends it.
let addressLanguageRequest = readAddressLanguageRequest();

function readAddressLanguageRequest() {
    try {
        const addressQuery = globalThis.location?.search || '';
        return new URLSearchParams(addressQuery).get(ADDRESS_LANGUAGE_PARAMETER)?.trim() || '';
    } catch {
        return '';
    }
}

function normalizeLanguageCode(lang) {
    const normalized = String(lang || '').trim().toLowerCase().replaceAll('_', '-');
    if (normalized === 'yue' || normalized.startsWith('yue-')) return 'yue';
    if (normalized === 'ch') return 'ch';
    if (
        normalized === 'zh-hk'
        || normalized === 'zh-mo'
        || normalized.startsWith('zh-hant-hk')
        || normalized.startsWith('zh-hant-mo')
    ) return 'zh-HK';
    if (
        normalized === 'zh-tw'
        || normalized === 'zh-hant'
        || normalized.startsWith('zh-hant-tw')
    ) return 'zh-TW';
    if (
        normalized === 'zh'
        || normalized === 'zh-cn'
        || normalized === 'zh-sg'
        || normalized.startsWith('zh-hans')
    ) return 'zh-CN';
    const primary = normalized.split('-')[0];
    return /^[a-z]{2,3}$/.test(primary) ? primary : '';
}

/**
 * Returns the language the page address asked for, or '' when it asked for
 * none of the site's enabled interface languages.
 * The value must name an enabled language exactly, the rule the server applies
 * when it writes the page head in that language (explicitAddressLanguage in
 * router/public_article_document.go), so the head and the app always agree.
 * The enabled list is the shared catalogue, read at each call: until the
 * administrator-approved catalogue has loaded it is the bundled list, so a
 * bundled language is accepted provisionally and dropped again if the loaded
 * catalogue does not enable it. That is safe because every reader of the
 * active language already copes with a code the site does not offer (the
 * browser language is returned unchecked), and the app's first translation
 * (main.js) waits for the catalogue, so no text is drawn in a provisional one.
 * @returns {string}
 */
function getAddressLanguage() {
    if (!addressLanguageRequest) return '';
    const isEnabledLanguage = getUiLanguageOptions('application')
        .some((language) => language.value === addressLanguageRequest);
    return isEnabledLanguage ? normalizeLanguageCode(addressLanguageRequest) : '';
}

/**
 * Returns the ?lang= value exactly as the page address gave it, when it names
 * one of the site's enabled interface languages, or ''. Links the application
 * writes carry it on (live_link_address.js), so a page opened from one of them
 * in a new tab, or by a search engine, is in the same language and gets the
 * same server-written head (explicitAddressLanguage). An explicit choice in the
 * language selector ends it, as it ends the address language itself.
 * @returns {string}
 */
export function getAddressLanguageParameter() {
    return getAddressLanguage() ? addressLanguageRequest : '';
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
 * Returns the first supported language in address, stored, then browser-preference order.
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

    const addressLanguage = getAddressLanguage();
    if (addressLanguage && normalizedAvailableLanguages.includes(addressLanguage)) {
        return addressLanguage;
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
 * Returns the active interface language: an enabled ?lang= address language,
 * then the stored preference, then the normalized browser language or 'en'.
 * @returns {string}
 */
export function getLanguageWithBrowserFallback() {
    return getAddressLanguage()
        || normalizeLanguageCode(getLanguage())
        || getBrowserLanguageCandidates()[0]
        || DEFAULT_LANGUAGE;
}

/**
 * Stores the user's explicit language choice from a language selector.
 * The choice also ends the page address's ?lang= language for the rest of this
 * page, so from then on the visitor's own choice wins.
 * @param {string} lang - language code (e.g., 'en', 'fi', 'yue')
 */
export function setLanguage(lang) {
    const normalized = normalizeLanguageCode(lang);
    localStorage.setItem(STORAGE_KEY, normalized || DEFAULT_LANGUAGE);
    addressLanguageRequest = '';
}
