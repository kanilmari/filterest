// row_article_content_builder.js
// Exposes article-view content-builder names from the canonical article_view module.
// Bridges newer row_article imports with the canonical article_view implementation file.
// Exists to let callers migrate naming safely without breaking older big_card imports.

export {
    buildRowArticleContent,
    buildBigCardContent,
} from "./article_view_content_builder.js";
