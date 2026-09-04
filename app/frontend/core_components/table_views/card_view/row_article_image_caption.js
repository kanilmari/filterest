// row_article_image_caption.js
// Localizes image descriptions and attaches them only to article media surfaces.
// Bridges shared asset rows with ordinary and image-first article presentations.
// Exists so image credits never leak into compact cards and change with the UI language.

import { setLocalizedDatasetText } from "../dataset_value_localizer.js";
import { resolveImagePath } from "./row_article_content_builder_helpers.js";
import { resolveRowArticleImageRows } from "./row_article_image_rows.js";

function normalizeImagePath(filename = "") {
    const resolvedPath = resolveImagePath(String(filename || "").trim());
    try {
        return new URL(resolvedPath, window.location.href).pathname;
    } catch {
        return resolvedPath;
    }
}
function resolveInlineImagePath(container) {
    const image = container?.querySelector?.("img:not([aria-hidden='true'])");
    const source = image?.dataset?.imageFirstSrc || image?.getAttribute?.("src") || "";
    try {
        return new URL(source, window.location.href).pathname;
    } catch {
        return source;
    }
}

/**
 * Writes one image-row description and hides the caption when no text exists.
 * Missing column metadata intentionally uses the conservative multilingual-value heuristic.
 */
export function setRowArticleImageCaption(captionElement, imageRow) {
    if (!(captionElement instanceof HTMLElement)) return;
    setLocalizedDatasetText(captionElement, imageRow?.description, null, {
        afterRender: (renderedValue) => {
            captionElement.hidden = String(renderedValue || "").trim() === "";
        },
    });
}

/**
 * Synchronizes child image descriptions below ordinary article-view images.
 * Exact path matching wins; a lone image may use the sole canonical asset row.
 */
export function syncRowArticleInlineImageCaptions(articleContent, imageRows = []) {
    if (!(articleContent instanceof HTMLElement)) return;
    const imageContainers = Array.from(
        articleContent.querySelectorAll(".big_card_image[data-row-article-image-column]"),
    );
    const canonicalRows = resolveRowArticleImageRows(imageRows);

    imageContainers.forEach((container) => {
        container.querySelector(":scope > .row_article_inline_image_caption")?.remove();
        const inlinePath = resolveInlineImagePath(container);
        const matchingRow = canonicalRows.find(
            (row) => normalizeImagePath(row?.filename) === inlinePath,
        ) || (imageContainers.length === 1 && canonicalRows.length === 1
            ? canonicalRows[0]
            : null);
        if (!matchingRow) return;

        const caption = document.createElement("p");
        caption.classList.add("row_article_image_caption", "row_article_inline_image_caption");
        caption.dataset.testid = "row-article-inline-image-caption";
        setRowArticleImageCaption(caption, matchingRow);
        if (!caption.hidden) {
            container.appendChild(caption);
        }
    });
}
