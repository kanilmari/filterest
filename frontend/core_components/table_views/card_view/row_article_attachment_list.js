// row_article_attachment_list.js
// Exposes article-view attachment list names on top of the legacy big-card attachment module.
// Bridges newer row_article imports with the existing attachment rendering and upload helpers.
// Exists to keep the rename moving without changing attachment behavior or test anchors.

export {
    buildAcceptAttribute,
    buildAttachmentList,
    buildPdfPreviewSrc,
    buildPdfThumbnailSrc,
    buildRowArticleAttachmentList,
    canPreviewAttachment,
    classifyAttachmentKind,
    filterAttachmentRows,
    filterUploadableAttachmentFiles,
    formatAttachmentSize,
    resolveAttachmentDescription,
    resolveAttachmentDisplayName,
    resolveAttachmentDownloadName,
    resolveAttachmentKind,
    resolveAttachmentOriginalName,
} from "./big_card_attachment_list.js";
