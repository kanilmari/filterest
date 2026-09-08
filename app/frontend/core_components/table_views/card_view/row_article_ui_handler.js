// row_article_ui_handler.js
// Exposes article-view UI helper names from the canonical article_view UI module.
// Bridges newer row_article imports with the canonical article_view interaction utilities.
// Exists to let callers migrate naming safely without breaking older big_card imports.

export {
    closeBigCard,
    closeRowArticle,
    createLinkTwoLine,
    createRowArticleKeyValueElement,
    createRowArticleLinkTwoLine,
    createRowArticleNavigableElement,
    createNavigableTwoLineElement,
    createTwoLineKeyValueElement,
    dispatchCardArticleToggle,
    resolveLocalizedValue,
    resolveRowArticleLocalizedValue,
    restoreScrollAfterBigCard,
    restoreScrollAfterRowArticle,
    saveScrollBeforeBigCard,
    saveScrollBeforeRowArticle,
    updateHighlightedCard,
} from "./article_view_ui_handler.js";
