// row_article_opener.js
// Exposes article-view opener names on top of the legacy big-card module.
// Bridges newer row_article imports with the existing big-card implementation file.
// Exists to let callers migrate naming safely without breaking older big_card imports.

export {
    openRowArticleView,
    open_big_card_view,
} from "./big_card_opener.js";
