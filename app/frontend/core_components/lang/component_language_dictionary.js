// component_language_dictionary.js
// Loads component dictionaries and resolves copy independently of the page language.
// Connects component callers to the handler's shared requests and live page state.
// Preserves one request cache, response unwrapper and missing-key tracker for all callers.
import {
    currentTranslations, currentChosenLang, defaultTranslations,
    globalMissingKeys, globalMissingKeySources,
    fetchTranslationsForLanguage, getTranslation,
} from './translation_handler.js';

const loadedLanguageTranslations = new Map();

/**
 * Loads a dictionary for a component's language without changing page language.
 * Shares the page loader's request cache and development-response unwrapping.
 * Administrator preferences can differ from the public menu's available languages.
 */
export async function loadTranslationsForLanguage(language) {
    const translations = await fetchTranslationsForLanguage(language);
    loadedLanguageTranslations.set(language, translations || {});
    return translations;
}

/** Reads page copy by default, or a loaded component dictionary when language is explicit. */
export function getTranslationForKey(
    key,
    { fallback = "", countUsage = true, language } = {}
) {
    if (!key) {
        return fallback;
    }

    const translations = language === undefined || language === currentChosenLang
        ? currentTranslations : loadedLanguageTranslations.get(language) || {};
    // An explicit component language must never read another language's page
    // dictionary. Only absent/blank copy falls through to the English dictionary.
    const translatedValue = language === undefined
        ? currentTranslations[key] ?? defaultTranslations[key]
        : [translations[key], (loadedLanguageTranslations.get('en') || defaultTranslations)[key]]
            .find(value => typeof value === 'string' && value.trim() !== '');

    if (
        (translatedValue === undefined || translatedValue === null || translatedValue === "") &&
        countUsage
    ) {
        if (!globalMissingKeys.includes(key)) {
            globalMissingKeys.push(key);
        }
        // Koodista kutsuttu avain: lähde on 'code'
        if (!globalMissingKeySources[key]) {
            globalMissingKeySources[key] = 'code::getTranslationForKey';
        }
    }

    if (typeof translatedValue === "string" && translatedValue.trim() !== "") {
        return translatedValue;
    }

    if (fallback) {
        return fallback;
    }

    return getTranslation(key, translations, language ?? currentChosenLang);
}
