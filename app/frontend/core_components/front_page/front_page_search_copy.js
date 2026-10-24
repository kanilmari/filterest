// front_page_search_copy.js
// Supplies reviewed phone Home search copy before database translations arrive.
// Registered by the shared fallback catalogue; components still request language keys.
// Matches the fi/en migration seed and leaves other languages to translation review.

export const HOME_SEARCH_TRANSLATION_FALLBACKS = Object.freeze({
    front_page_search_site: { fi: 'Hae sivustolta', en: 'Search the site' },
    front_page_search_title: { fi: 'Haku', en: 'Search' },
    front_page_search_close: { fi: 'Sulje haku', en: 'Close search' },
    front_page_search_searching: { fi: 'Haetaan…', en: 'Searching…' },
    front_page_search_no_results: { fi: 'Ei osumia', en: 'No results' },
    front_page_search_failed: { fi: 'Hakua ei voitu suorittaa. Yritä uudelleen.', en: 'Search could not be completed. Try again.' },
});
