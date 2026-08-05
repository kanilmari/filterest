// row_article_task_progress_hydrator.js
// Inserts the task todo progress visual into an open row article.
// Bridges the task progress renderer and stable article tool-section ordering.
// Exists to keep big_card_opener from owning task-specific progress UI details.

import { buildRowArticleTaskProgressSection } from "./row_article_task_progress.js";
import { upsertRowArticleToolSection } from "./row_article_tool_section_inserter.js";

const TASK_PROGRESS_ANCHOR_SELECTOR = [
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
 * Fetches and inserts the task progress section when the current row has todos.
 *
 * @param {{
 *   rowArticleElement: HTMLElement,
 *   rowArticleContentElement: HTMLElement,
 *   tableName: string,
 *   rowId: number|string|null|undefined,
 * }} options
 * @returns {Promise<void>}
 */
export async function hydrateRowArticleTaskProgressSection({
    rowArticleElement,
    rowArticleContentElement,
    tableName,
    rowId,
}) {
    if (!rowId) {
        return;
    }

    try {
        const taskProgressSection = await buildRowArticleTaskProgressSection(tableName, rowId);
        upsertRowArticleToolSection({
            rowArticleElement,
            rowArticleContentElement,
            selector: ".row_article_task_progress_section",
            nextElement: taskProgressSection,
            anchorSelector: TASK_PROGRESS_ANCHOR_SELECTOR,
        });
    } catch (err) {
        console.warn("big-card task progress error:", err?.message || err);
    }
}
