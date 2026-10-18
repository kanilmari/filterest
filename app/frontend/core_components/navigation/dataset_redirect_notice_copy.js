// dataset_redirect_notice_copy.js
// Bootstrap copy for the notice shown when a dataset address leads back to the
// default view, because the dataset was not found or had been deleted.
// Bridges the root redirect toast and the page translator with an installation
// whose reviewed translations have not arrived yet; the site's own copy wins.
// Exists because the notice appears during startup, before any translation has
// been fetched, and must read as a sentence instead of a key name.

// $table_name is the dataset. The page translator fills it from the notice's
// data-lang-variable, so the name never becomes part of a key; a notice without
// a name reads its own sentence. The copy is Finnish and English, as seeded by
// 20261015000014_seed_redirect_notice_language_keys.sql.
const COPY = {
    dataset_redirect_missing_named: {
        fi: "Näkymää $table_name ei löytynyt. Siirryttiin oletusnäkymään.",
        en: "View $table_name was not found. Switched to the default view.",
    },
    dataset_redirect_missing: {
        fi: "Valittua näkymää ei löytynyt. Siirryttiin oletusnäkymään.",
        en: "The selected view was not found. Switched to the default view.",
    },
    dataset_redirect_deleted_named: {
        fi: "Taulu $table_name on poistettu. Siirryttiin oletusnäkymään.",
        en: "Dataset $table_name has been deleted. Switched to the default view.",
    },
    dataset_redirect_deleted: {
        fi: "Taulu on poistettu. Siirryttiin oletusnäkymään.",
        en: "The dataset has been deleted. Switched to the default view.",
    },
};

/** The copy in the { fi, en } shape the page translator's fallbacks use. */
export const DATASET_REDIRECT_NOTICE_TRANSLATION_FALLBACKS = Object.freeze(COPY);

/**
 * Picks the bootstrap sentence of one notice key for the page's language.
 * A Finnish page reads Finnish; every other language reads English, as the
 * page translator does for a language the site has not translated.
 *
 * @param {string} langKey - One of the notice keys above
 * @param {string} [languageCode] - The page's language tag, e.g. "fi" or "en-GB"
 * @returns {string} The sentence, or an empty string for an unknown key
 */
export function resolveDatasetRedirectNoticeFallback(langKey, languageCode = "en") {
    const copy = COPY[langKey];
    if (!copy) return "";
    return String(languageCode || "").trim().toLowerCase().startsWith("fi") ? copy.fi : copy.en;
}
