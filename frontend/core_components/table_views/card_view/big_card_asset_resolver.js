// big_card_asset_resolver.js
// Resolves which child relation big-card media sections should use.
// Bridges image-asset status rows and shared asset rows into one deterministic choice.
// Exists so the big-card opener can prefer canonical shared assets without embedding more branching logic.

import { resolveRowArticleImageRows } from "./row_article_image_gallery.js";
import { isBridgeRelationTable } from "./big_card_child_tabs_helpers.js";

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

export function filterNonMediaChildTables(childTables = []) {
    if (!Array.isArray(childTables)) {
        return [];
    }

    return childTables.filter((childTable) =>
        !isMediaChildTable(childTable) && !isBridgeRelationTable(childTable)
    );
}

export function resolveDynamicAssetChildren(childTables = []) {
    if (!Array.isArray(childTables)) {
        return { imagesChild: null, assetsChild: null };
    }

    return {
        imagesChild: childTables.find((childTable) => isImageAssetChildTable(childTable)) || null,
        assetsChild: childTables.find((childTable) => isSharedAssetChildTable(childTable)) || null,
    };
}

/**
 * Converts image-role values stored on the parent row into gallery-compatible rows.
 * Parent-row images have no child-row id, so the gallery displays them without
 * exposing child-asset edit, primary, or delete actions.
 */
export function resolveParentRowImageRows(parentRow = {}, imageColumns = []) {
    if (!parentRow || typeof parentRow !== "object" || !Array.isArray(imageColumns)) {
        return [];
    }

    return imageColumns.flatMap((column, index) => {
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
            is_primary: index === 0,
            parent_image_column: column,
        }];
    });
}

/**
 * Resolves the child relation used by the big-card attachment list.
 * Bridges attachment-linking status and live shared-asset rows so detail views
 * can stay metadata-first even when the shared child table has no current rows.
 */
export function resolveAttachmentListChild(parentTableName, attachmentLinking, assetsChild) {
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
 * Resolves the child relation used by the big-card image gallery.
 * Bridges image-linking metadata and live child rows so canonical shared assets win when they can actually serve images.
 * Exists to keep shared <parent>_assets rollout logic small, testable, and isolated from the big-card opener.
 */
export function resolveImageGalleryChild(parentTableName, tableHasImageRole, imageLinking, imagesChild, assetsChild) {
    const linkedAssetsTable = imageLinkingPointsToSharedAssets(imageLinking, assetsChild);
    if (linkedAssetsTable) {
        return assetsChild || {
            dataset: imageLinking.child_table,
            column: resolveStubForeignKeyColumn(parentTableName, assetsChild, imageLinking),
            rows: [],
            relation_kind: readLinkingRelationKind(imageLinking) || "shared_asset",
        };
    }

    if (hasSharedAssetImages(assetsChild)) {
        return assetsChild;
    }

    if (imagesChild) {
        return imagesChild;
    }

    if (
        tableHasImageRole
        && isSharedAssetChildTable(assetsChild)
        && canUseSharedAssetsForImageUploads(imageLinking, assetsChild)
    ) {
        return assetsChild;
    }

    return null;
}

function imageLinkingPointsToSharedAssets(imageLinking, assetsChild) {
    const childTableName = String(imageLinking?.child_table || "").trim();
    const relationKind = readLinkingRelationKind(imageLinking);
    if (!childTableName) {
        return false;
    }

    if (relationKind === "shared_asset") {
        return true;
    }
    if (relationKind === "image_asset") {
        return false;
    }

    if (assetsChild?.dataset && childTableName === assetsChild.dataset) {
        return true;
    }

    return false;
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

function hasSharedAssetImages(assetsChild) {
    return resolveRowArticleImageRows(assetsChild?.rows || []).length > 0;
}

function canUseSharedAssetsForImageUploads(imageLinking, assetsChild) {
    if (!isSharedAssetChildTable(assetsChild)) {
        return false;
    }

    if (imageLinkingPointsToSharedAssets(imageLinking, assetsChild)) {
        return true;
    }

    return Boolean(imageLinking?.enabled && !String(imageLinking?.child_table || "").trim());
}

export const filterRowArticleNonMediaChildTables = filterNonMediaChildTables;
export const isRowArticleImageAssetChildTable = isImageAssetChildTable;
export const isRowArticleMediaChildTable = isMediaChildTable;
export const isRowArticleSharedAssetChildTable = isSharedAssetChildTable;
export const resolveRowArticleAttachmentListChild = resolveAttachmentListChild;
export const resolveRowArticleDynamicAssetChildren = resolveDynamicAssetChildren;
export const resolveRowArticleImageGalleryChild = resolveImageGalleryChild;
export const resolveRowArticleParentImageRows = resolveParentRowImageRows;
