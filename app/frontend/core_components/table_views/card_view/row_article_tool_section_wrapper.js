// row_article_tool_section_wrapper.js
// Wraps existing article-view tool widgets in the shared disclosure section style.
// Bridges media, attachment, and related-row widgets with the row_article disclosure primitive.
// Exists so all tools below Details can be opened and closed the same way.

import { buildRowArticleDisclosureSection } from "./row_article_disclosure_section_builder.js";

const TABLE_TOOLS_ICON_PATH = "/frontend/icons/general/table-tools-icon.svg";
const VISIBLE_FIELDS_ICON_PATH = "/frontend/icons/general/visible-fields-icon.svg";

/**
 * Wraps a rendered article tool element in a collapsible disclosure section.
 *
 * @param {{
 *   contentElement: HTMLElement|null,
 *   titleLangKey: string,
 *   titleText: string,
 *   sectionClassNames: string|string[],
 *   iconPath?: string,
 *   startOpen?: boolean,
 * }} options
 * @returns {HTMLElement|null}
 */
export function wrapRowArticleToolSection({
    contentElement,
    titleLangKey,
    titleText,
    sectionClassNames,
    iconPath = TABLE_TOOLS_ICON_PATH,
    startOpen = true,
}) {
    if (!(contentElement instanceof HTMLElement)) {
        return null;
    }

    return buildRowArticleDisclosureSection({
        titleLangKey,
        titleText,
        iconPath,
        contentElement,
        startOpen,
        sectionClassNames,
    });
}

export function wrapRowArticleImageGallerySection(galleryElement) {
    return wrapRowArticleToolSection({
        contentElement: galleryElement,
        titleLangKey: "row_article_section_images",
        titleText: "Images",
        iconPath: VISIBLE_FIELDS_ICON_PATH,
        sectionClassNames: "row_article_image_gallery_section",
    });
}

export function wrapRowArticleAttachmentSection(attachmentElement) {
    return wrapRowArticleToolSection({
        contentElement: attachmentElement,
        titleLangKey: "row_article_section_attachments",
        titleText: "Attachments",
        iconPath: TABLE_TOOLS_ICON_PATH,
        sectionClassNames: "row_article_attachment_list_section",
    });
}

export function wrapRowArticleRelatedRowsSection(relatedRowsElement) {
    return wrapRowArticleToolSection({
        contentElement: relatedRowsElement,
        titleLangKey: "row_article_section_related_rows",
        titleText: "Related rows",
        iconPath: TABLE_TOOLS_ICON_PATH,
        sectionClassNames: "row_article_related_items_section",
    });
}
