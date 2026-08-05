// card_image_render_options.js
// Collects optional image rendering metadata from row companion fields.
// Bridges canonical asset rows and card media builders without changing normal image values.
// Exists so typed media such as service-catalog icons can opt into special presentation.

function readCompanionValue(rowItem, columnName, suffix) {
    if (!rowItem || typeof rowItem !== "object") {
        return undefined;
    }

    const exactKey = `${columnName}_${suffix}`;
    if (Object.prototype.hasOwnProperty.call(rowItem, exactKey)) {
        return rowItem[exactKey];
    }

    if (columnName !== "cached_image") {
        return undefined;
    }

    const cachedKey = `cached_image_${suffix}`;
    if (Object.prototype.hasOwnProperty.call(rowItem, cachedKey)) {
        return rowItem[cachedKey];
    }

    return undefined;
}

export const CARD_IMAGE_RENDER_SLOTS = Object.freeze({
    CARD_MEDIA: "card_media",
    SMALL_THUMBNAIL: "small_thumbnail",
    ROW_ARTICLE_INLINE: "row_article_inline",
    STANDALONE: "standalone",
});

export function buildCardImageRenderOptions(
    rowItem,
    columnName = "cached_image",
    tableName = "",
    rowLabel = "",
    renderSlot = CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA
) {
    const safeColumnName = String(columnName || "cached_image");

    return {
        tableName,
        rowLabel,
        renderSlot,
        imageTypeId: readCompanionValue(rowItem, safeColumnName, "type_id"),
        imageMetadata: readCompanionValue(rowItem, safeColumnName, "metadata_json"),
        imageTitle: readCompanionValue(rowItem, safeColumnName, "title"),
        imageOriginalName: readCompanionValue(rowItem, safeColumnName, "original_name"),
    };
}
