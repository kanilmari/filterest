// row_article_opener.js
// Exposes article-view opener names from the canonical article_view module.
// Bridges newer row_article imports with the canonical article_view implementation file.
// Exists to let callers migrate naming safely without breaking older big_card imports.

export {
    openRowArticleView,
    open_big_card_view,
} from "./article_view_opener.js";
