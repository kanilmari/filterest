// row_article_tool_section_inserter.js
// Places collapsible article tool sections in a stable order below row details.
// Bridges async article tool hydrators and the shared row article content element.
// Exists so progress, media, attachments, and related rows do not race into odd positions.

const DEFAULT_ROW_ARTICLE_TOOL_ANCHOR_SELECTOR = [
    ".row_article_task_progress_section",
    ".row_article_image_gallery_section",
    ".row_article_attachment_list_section",
    ".row_article_related_items_section",
    ".row_article_image_gallery",
    ".big_card_image_gallery",
    ".row_article_attachment_list",
    ".big_card_attachment_list",
    ".related_tabs_container",
].join(", ");

/**
 * Inserts, replaces, or removes one article tool section.
 *
 * @param {{
 *   rowArticleElement: HTMLElement,
 *   rowArticleContentElement: HTMLElement,
 *   selector: string,
 *   nextElement: HTMLElement|null,
 *   anchorSelector?: string,
 * }} options
 * @returns {void}
 */
export function upsertRowArticleToolSection({
    rowArticleElement,
    rowArticleContentElement,
    selector,
    nextElement,
    anchorSelector = DEFAULT_ROW_ARTICLE_TOOL_ANCHOR_SELECTOR,
}) {
    if (!rowArticleElement?.isConnected) {
        return;
    }

    const oldElement = rowArticleContentElement.querySelector(selector);
    if (oldElement && nextElement) {
        oldElement.replaceWith(nextElement);
        return;
    }
    if (oldElement && !nextElement) {
        oldElement.remove();
        return;
    }
    if (!nextElement) {
        return;
    }

    const anchor = anchorSelector
        ? rowArticleContentElement.querySelector(anchorSelector)
        : null;
    rowArticleContentElement.insertBefore(nextElement, anchor || null);
}
