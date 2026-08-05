// row_article_ui_handler.js
// Exposes article-view UI helper names on top of the legacy big-card UI module.
// Bridges newer row_article imports with the existing big-card interaction utilities.
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
    resolveLocalizedValue,
    resolveRowArticleLocalizedValue,
    restoreScrollAfterBigCard,
    restoreScrollAfterRowArticle,
    saveScrollBeforeBigCard,
    saveScrollBeforeRowArticle,
    updateHighlightedCard,
} from "./big_card_ui_handler.js";
