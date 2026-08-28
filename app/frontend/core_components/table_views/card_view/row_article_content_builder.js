// row_article_content_builder.js
// Exposes article-view content-builder names on top of the legacy big-card module.
// Bridges newer row_article imports with the existing big-card implementation file.
// Exists to let callers migrate naming safely without breaking older big_card imports.

export {
    buildRowArticleContent,
    buildBigCardContent,
} from "./big_card_content_builder.js";
