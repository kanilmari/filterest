// row_article_content_builder_helpers.js
// Exposes article-view content helper names on top of the legacy big-card helper module.
// Bridges newer row_article imports with the pure formatting helpers used by detail content.
// Exists to keep helper imports moving toward row_article without changing runtime behavior.

export {
    classifyRole,
    extractSuffixNumber,
    matchesRole,
    resolveImagePath,
    splitKeywords,
} from "./big_card_content_builder_helpers.js";
