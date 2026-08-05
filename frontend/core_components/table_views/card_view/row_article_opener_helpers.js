// row_article_opener_helpers.js
// Exposes article-view opener helper names on top of the legacy big-card helper module.
// Bridges newer row_article imports with the pure URL/ordering helpers used by detail views.
// Exists to keep the row_article rename moving without forcing a risky deep rename.

export {
    buildCardUrl,
    buildCreationSeed,
    buildSlug,
    extractRowId,
    sortColumnsByRole,
} from "./big_card_opener_helpers.js";
