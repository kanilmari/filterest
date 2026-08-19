// Pure allowlist and normalization helpers for article-content placement.
// Bridges site configuration and image-first rendering without a DOM dependency.
// Exists so invalid configuration cannot create ambiguous article ordering.

export const ROW_ARTICLE_DETAILS_POSITIONS = Object.freeze({
    BETWEEN_TITLE_AND_DESCRIPTION: "between_title_and_description",
    AFTER_DESCRIPTION: "after_description",
});

export function normalizeRowArticleDetailsPosition(value) {
    return String(value || "").trim().toLowerCase()
        === ROW_ARTICLE_DETAILS_POSITIONS.BETWEEN_TITLE_AND_DESCRIPTION
        ? ROW_ARTICLE_DETAILS_POSITIONS.BETWEEN_TITLE_AND_DESCRIPTION
        : ROW_ARTICLE_DETAILS_POSITIONS.AFTER_DESCRIPTION;
}
