// row_article_image_rows.js
// Normalizes and orders image rows shared by article galleries and image-first views.
// Bridges parent-row image fields and related media rows without depending on either view.
// Exists to keep image-first rendering separate from the ordinary article gallery module.

import { resolveImagePath } from "./row_article_content_builder_helpers.js";

export function resolveRowArticleImageRows(rows, supplementaryRows = []) {
    const canonicalRows = Array.isArray(rows) ? rows : [];
    const fallbackRows = Array.isArray(supplementaryRows) ? supplementaryRows : [];
    const seenPaths = new Set();

    return [...canonicalRows, ...fallbackRows]
        .filter((row) => {
            const assetKind = String(row?.asset_kind || "").toLowerCase();
            const hasFilename = typeof row?.filename === "string" && row.filename.trim() !== "";
            if (!hasFilename || !(assetKind === "image" || assetKind === "")) {
                return false;
            }

            const resolvedPath = resolveImagePath(row.filename.trim());
            if (seenPaths.has(resolvedPath)) {
                return false;
            }
            seenPaths.add(resolvedPath);
            return true;
        })
        .sort(compareImageRowsByPriority);
}

function compareImageRowsByPriority(left, right) {
    const primaryDelta = Number(rowIsPrimary(right)) - Number(rowIsPrimary(left));
    if (primaryDelta !== 0) {
        return primaryDelta;
    }

    const leftSortOrder = normalizeSortOrder(left?.sort_order);
    const rightSortOrder = normalizeSortOrder(right?.sort_order);
    if (leftSortOrder !== rightSortOrder) {
        return leftSortOrder - rightSortOrder;
    }

    const leftCreated = normalizeCreatedValue(left?.created);
    const rightCreated = normalizeCreatedValue(right?.created);
    if (leftCreated !== rightCreated) {
        return leftCreated.localeCompare(rightCreated);
    }

    return normalizeNumericId(left?.id) - normalizeNumericId(right?.id);
}

function rowIsPrimary(row) {
    return row?.is_primary === true || row?.is_primary === 1 || row?.is_primary === "true";
}

function normalizeSortOrder(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}

function normalizeCreatedValue(value) {
    return value == null ? "" : String(value);
}

function normalizeNumericId(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}
