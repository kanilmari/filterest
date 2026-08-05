// row_article_image_gallery.js
// Exposes article-view image gallery names on top of the legacy big-card gallery module.
// Bridges newer row_article imports with the existing image gallery and upload helpers.
// Exists to keep card-view rename work incremental instead of doing a risky file move first.

export {
    buildImageGallery,
    buildRowArticleImageGallery,
    canUploadImageToChildDataset,
    canUploadImageToRowArticleChildDataset,
    resolveImageRows,
    resolveRowArticleImageRows,
} from "./big_card_image_gallery.js";
