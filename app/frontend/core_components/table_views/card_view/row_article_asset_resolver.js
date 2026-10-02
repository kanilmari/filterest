// row_article_asset_resolver.js
// Resolves which child relations the article view's media sections use, and which pictures they show.
// Bridges the related-rows response, which names the gallery and the card picture, and the attachment linking status.
// Exists so the article and image-first views show the server's choice of pictures instead of making their own.

import { composeRowArticleImageRows, resolveRowArticleImageRows } from "./row_article_image_rows.js";
import { isBridgeRelationTable } from "./row_article_child_tabs_helpers.js";

function readRelationKind(childTableData) {
    return String(childTableData?.relation_kind || "").trim().toLowerCase();
}

function readLinkingRelationKind(linkingStatus) {
    return String(linkingStatus?.relation_kind || "").trim().toLowerCase();
}

function resolveStubForeignKeyColumn(parentTableName, childTableData, linkingStatus) {
    const candidates = [
        linkingStatus?.foreign_key_column,
        childTableData?.column,
        `${parentTableName}_id`,
    ];
    return candidates.find((value) => typeof value === "string" && value.trim() !== "") || "";
}

export function isImageAssetChildTable(childTableData) {
    return readRelationKind(childTableData) === "image_asset";
}

export function isSharedAssetChildTable(childTableData) {
    return readRelationKind(childTableData) === "shared_asset";
}

export function isMediaChildTable(childTableData) {
    return isImageAssetChildTable(childTableData) || isSharedAssetChildTable(childTableData);
}

export function filterRowArticleNonMediaChildTables(childTables = []) {
    if (!Array.isArray(childTables)) {
        return [];
    }

    return childTables.filter((childTable) =>
        !isMediaChildTable(childTable) && !isBridgeRelationTable(childTable)
    );
}

/**
 * Picks the first shared-asset child of a response, the relation whose files the
 * attachment list shows. The image gallery never uses it: the response names the gallery.
 */
export function resolveRowArticleSharedAssetChild(childTables = []) {
    if (!Array.isArray(childTables)) {
        return null;
    }

    return childTables.find((childTable) => isSharedAssetChildTable(childTable)) || null;
}

/**
 * Converts image-role values stored on the parent row into gallery-compatible rows,
 * in column order. Parent-row images have no child-row id, so the gallery displays
 * them without exposing child-asset edit, primary, or delete actions. They stand in
 * only while no related-rows response could be used.
 */
export function resolveRowArticleParentImageRows(parentRow = {}, imageColumns = []) {
    if (!parentRow || typeof parentRow !== "object" || !Array.isArray(imageColumns)) {
        return [];
    }

    return imageColumns.flatMap((column) => {
        const filename = typeof parentRow[column] === "string"
            ? parentRow[column].trim()
            : "";
        if (!filename) {
            return [];
        }

        return [{
            asset_kind: "image",
            filename,
            is_parent_row_image: true,
            parent_image_column: column,
        }];
    });
}

/**
 * Resolves the child relation used by the article view's attachment list.
 * Bridges attachment-linking status and live shared-asset rows so detail views
 * can stay metadata-first even when the shared child table has no current rows.
 */
export function resolveRowArticleAttachmentListChild(parentTableName, attachmentLinking, assetsChild) {
    if (isSharedAssetChildTable(assetsChild)) {
        return assetsChild;
    }

    if (attachmentLinkingPointsToSharedAssets(attachmentLinking, assetsChild)) {
        return {
            dataset: attachmentLinking.child_table,
            column: resolveStubForeignKeyColumn(parentTableName, assetsChild, attachmentLinking),
            rows: [],
            relation_kind: readLinkingRelationKind(attachmentLinking) || "shared_asset",
        };
    }

    return null;
}

/**
 * Reads the parent's one gallery that a dynamic-children response names
 * (`gallery_relation`), or null when it names none. The server chooses it with the
 * same rule as the card picture, so the browser never chooses a gallery itself.
 */
function readGalleryRelation(dynamicChildren) {
    const relation = dynamicChildren?.gallery_relation;
    const dataset = typeof relation?.dataset === "string" ? relation.dataset.trim() : "";
    const column = typeof relation?.column === "string" ? relation.column.trim() : "";
    return dataset && column ? { dataset, column } : null;
}

/**
 * Resolves the article's image gallery from one related-rows response (dynamicChildren):
 * the child_tables entry with the dataset and column the response names as the parent's
 * gallery, otherwise null. The server names a gallery only when this viewer may read it,
 * so a response without a name means no gallery, never one the browser picks instead.
 */
export function resolveRowArticleImageGalleryChild(dynamicChildren) {
    const galleryRelation = readGalleryRelation(dynamicChildren);
    if (!galleryRelation) {
        return null;
    }

    const childTables = Array.isArray(dynamicChildren.child_tables) ? dynamicChildren.child_tables : [];
    return childTables.find((childTable) =>
        childTable?.dataset === galleryRelation.dataset
        && childTable?.column === galleryRelation.column
    ) || null;
}

/**
 * Resolves the pictures an article shows. Once a related-rows response (dynamicChildren)
 * arrived it alone decides: the gallery rows in the server's order with a card-only
 * picture first, or without a gallery only the picture the server says the card shows
 * (`card_picture`), and nothing when that is empty or absent. The row's own image fields
 * (rowImageRows) never join a response, so a picture deleted or withheld since the row
 * was read cannot return; they stand in only while there is no response (null).
 */
export function resolveRowArticleDisplayedImageRows(dynamicChildren, galleryChild, rowImageRows = []) {
    if (!dynamicChildren) {
        return resolveRowArticleImageRows(rowImageRows);
    }
    return composeRowArticleImageRows(galleryChild?.rows, dynamicChildren.card_picture);
}

function attachmentLinkingPointsToSharedAssets(attachmentLinking, assetsChild) {
    const childTableName = String(attachmentLinking?.child_table || "").trim();
    const relationKind = readLinkingRelationKind(attachmentLinking);
    if (!childTableName) {
        return false;
    }

    if (relationKind === "shared_asset") {
        return true;
    }
    if (relationKind) {
        return false;
    }

    if (assetsChild?.dataset && childTableName === assetsChild.dataset) {
        return true;
    }

    // Attachment linking is currently implemented only on top of the shared
    // asset contract, so a configured child table is enough even when the
    // fetchDynamicChildren payload is temporarily empty.
    return true;
}
