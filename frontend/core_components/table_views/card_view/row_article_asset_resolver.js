// row_article_asset_resolver.js
// Exposes article-view asset resolver names on top of the legacy big-card resolver.
// Bridges newer row_article imports with the existing big-card media decision helpers.
// Exists to let callers migrate naming safely without changing asset-selection behavior.

export {
    filterNonMediaChildTables,
    filterRowArticleNonMediaChildTables,
    isImageAssetChildTable,
    isMediaChildTable,
    isRowArticleImageAssetChildTable,
    isRowArticleMediaChildTable,
    isRowArticleSharedAssetChildTable,
    isSharedAssetChildTable,
    resolveAttachmentListChild,
    resolveDynamicAssetChildren,
    resolveImageGalleryChild,
    resolveParentRowImageRows,
    resolveRowArticleAttachmentListChild,
    resolveRowArticleDynamicAssetChildren,
    resolveRowArticleImageGalleryChild,
    resolveRowArticleParentImageRows,
} from "./big_card_asset_resolver.js";
