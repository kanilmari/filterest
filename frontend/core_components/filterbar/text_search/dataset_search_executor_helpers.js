// dataset_search_executor_helpers.js
// Provides pure row-processing helpers for intelligent search result handling.
// Bridges streamed search payloads and filter evaluation without touching DOM state.
// Exists to keep dataset_search_executor focused on UI orchestration and side effects.

import { rowMatchesFilters } from "../filter_list/row_filter_checker.js";
import { IMAGE_FIRST_SORT_COLUMN } from "../top_row_buttons/sort_dropdown_builder_helpers.js";

export function initSearchCache() {
    return {
        columns: [],
        data: [],
        aiData: [],
        types: {},
        filters: {},
        renderedOnce: false,
    };
}

export function deduplicateRows(existingData, existingAiData, newRows, columns) {
    const safeExistingData = Array.isArray(existingData) ? existingData : [];
    const safeExistingAiData = Array.isArray(existingAiData) ? existingAiData : [];
    const safeNewRows = Array.isArray(newRows) ? newRows : [];
    const safeColumns = Array.isArray(columns) ? columns : [];
    const primaryKey = safeColumns.includes("header") ? "header" : null;
    const allKeys = new Set(
        [...safeExistingData, ...safeExistingAiData].map((row) =>
            primaryKey ? row?.[primaryKey] : JSON.stringify(row)
        )
    );

    return safeNewRows.filter((row) => {
        const key = primaryKey ? row?.[primaryKey] : JSON.stringify(row);
        if (allKeys.has(key)) return false;
        allKeys.add(key);
        return true;
    });
}

export function filterRows(rows, filters, tableName, columnTypes) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const hasFilters = filters && Object.keys(filters).length > 0;
    if (!hasFilters) return safeRows;

    return safeRows.filter((row) =>
        rowMatchesFilters(row, filters, tableName, columnTypes)
    );
}

export function countVisibleRows(allData, filters, tableName, columnTypes) {
    return filterRows(allData, filters, tableName, columnTypes).length;
}

function normalizeSortScalar(value, dataType = "") {
    if (value == null) {
        return null;
    }

    const normalizedType = String(dataType || "").toLowerCase();
    if (
        normalizedType.includes("int") ||
        normalizedType.includes("numeric") ||
        normalizedType.includes("double") ||
        normalizedType.includes("real")
    ) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : String(value).toLowerCase();
    }

    if (normalizedType.includes("date") || normalizedType.includes("timestamp")) {
        const timestamp = Date.parse(String(value));
        return Number.isFinite(timestamp) ? timestamp : String(value).toLowerCase();
    }

    if (normalizedType === "boolean") {
        if (value === true || String(value).toLowerCase() === "true") return 1;
        if (value === false || String(value).toLowerCase() === "false") return 0;
    }

    return String(value).toLowerCase();
}

function compareNormalizedScalars(leftValue, rightValue) {
    if (typeof leftValue === "number" && typeof rightValue === "number") {
        return leftValue - rightValue;
    }

    return String(leftValue).localeCompare(String(rightValue), undefined, {
        numeric: true,
        sensitivity: "base",
    });
}

function hasImageValue(value) {
    if (value == null) return false;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return normalized !== "" && normalized !== "null" && normalized !== "undefined";
    }
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
}

function resolveImageSortColumns(rows, columnTypes) {
    const metadataColumns = Object.entries(columnTypes || {})
        .filter(([, metadata]) => {
            if (metadata && typeof metadata === "object") {
                const cardElement = String(metadata.card_element || "").toLowerCase();
                const dataType = String(metadata.data_type || "").toLowerCase();
                return cardElement.includes("image") || dataType === "image";
            }
            return String(metadata || "").toLowerCase() === "image";
        })
        .map(([column]) => column);
    if (metadataColumns.length > 0) return metadataColumns;

    return ["cached_image", "image"].filter((column) =>
        rows.some((row) => Object.prototype.hasOwnProperty.call(row || {}, column))
    );
}

function sortRowsByImagePresence(rows, columnTypes) {
    const imageColumns = resolveImageSortColumns(rows, columnTypes);
    return rows
        .map((row, index) => ({ row, index }))
        .sort((left, right) => {
            const leftHasImage = imageColumns.some((column) => hasImageValue(left.row?.[column]));
            const rightHasImage = imageColumns.some((column) => hasImageValue(right.row?.[column]));
            if (leftHasImage !== rightHasImage) return leftHasImage ? -1 : 1;

            const leftId = normalizeSortScalar(left.row?.id, columnTypes?.id?.data_type || columnTypes?.id || "integer");
            const rightId = normalizeSortScalar(right.row?.id, columnTypes?.id?.data_type || columnTypes?.id || "integer");
            if (leftId != null && rightId != null) {
                const idComparison = compareNormalizedScalars(leftId, rightId);
                if (idComparison !== 0) return -idComparison;
            }

            return left.index - right.index;
        })
        .map((entry) => entry.row);
}

export function sortRows(rows, sortColumn, sortOrder, columnTypes = {}) {
    const safeRows = Array.isArray(rows) ? [...rows] : [];
    const column = String(sortColumn || "").trim();
    const direction = String(sortOrder || "").trim().toUpperCase();
    if (!column || !["ASC", "DESC"].includes(direction)) {
        return safeRows;
    }

    if (column === IMAGE_FIRST_SORT_COLUMN) {
        return sortRowsByImagePresence(safeRows, columnTypes);
    }

    const columnType = columnTypes?.[column] || "";

    return safeRows
        .map((row, index) => ({ row, index }))
        .sort((left, right) => {
            const leftValue = normalizeSortScalar(left.row?.[column], columnType);
            const rightValue = normalizeSortScalar(right.row?.[column], columnType);

            if (leftValue == null && rightValue == null) {
                return left.index - right.index;
            }
            if (leftValue == null) {
                return 1;
            }
            if (rightValue == null) {
                return -1;
            }

            const comparison = compareNormalizedScalars(leftValue, rightValue);

            if (comparison !== 0) {
                return direction === "DESC" ? -comparison : comparison;
            }

            if (column !== "id") {
                const leftId = normalizeSortScalar(left.row?.id, columnTypes?.id || "integer");
                const rightId = normalizeSortScalar(right.row?.id, columnTypes?.id || "integer");
                if (leftId != null && rightId != null) {
                    const idComparison = compareNormalizedScalars(leftId, rightId);
                    if (idComparison !== 0) {
                        return direction === "DESC" ? -idComparison : idComparison;
                    }
                }
            }

            return left.index - right.index;
        })
        .map((entry) => entry.row);
}
