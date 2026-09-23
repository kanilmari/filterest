// row_article_child_tabs_helpers.js
// Pure helpers for article-view related-tab link behavior.
// Bridges DOM click-event semantics and related-dataset param construction.
// Exists to keep SPA-link rules testable without pulling the whole related-tab UI into unit tests.

export function shouldHandleSpaNavigationClick(eventLike = {}) {
    if (eventLike.defaultPrevented) return false;
    return (eventLike.button ?? 0) === 0
        && !eventLike.metaKey
        && !eventLike.ctrlKey
        && !eventLike.shiftKey
        && !eventLike.altKey;
}

export function buildRelatedDatasetParams(columnName, rowId) {
    return {
        [columnName]: String(rowId),
    };
}

export function getRelatedTableFilterValue(relatedTable = {}, fallbackRowId = "") {
    if (relatedTable?.filter_value !== undefined && relatedTable?.filter_value !== null) {
        return relatedTable.filter_value;
    }
    return fallbackRowId;
}

export function getRelatedTableReferenceDirection(relatedTable = {}) {
    return String(relatedTable?.reference_direction || "").trim().toLowerCase();
}

export function isOutgoingRelatedTable(relatedTable = {}) {
    return getRelatedTableReferenceDirection(relatedTable) === "outgoing";
}

export function getRelatedTableRowCount(relatedTable = {}) {
    const parsedCount = Number.parseInt(String(relatedTable?.row_count ?? ""), 10);
    if (Number.isFinite(parsedCount) && parsedCount >= 0) {
        return parsedCount;
    }

    return Array.isArray(relatedTable?.rows) ? relatedTable.rows.length : 0;
}

export function shouldLazyLoadRelatedTableRows(relatedTable = {}) {
    return getRelatedTableRowCount(relatedTable) > 0
        && (!Array.isArray(relatedTable?.rows) || relatedTable.rows.length === 0);
}

export function isBridgeRelationTable(relatedTable = {}) {
    const relationKind = String(relatedTable?.relation_kind || "").trim().toLowerCase();
    if (relationKind === "many_to_many_bridge" || relationKind === "bridge_relation") {
        return true;
    }

    const datasetName = String(relatedTable?.dataset || "").trim().toLowerCase();
    return datasetName.endsWith("_relation");
}

export function buildRelatedTabKey(relatedTable = {}) {
    return [
        String(relatedTable?.dataset || ""),
        String(relatedTable?.column || ""),
        getRelatedTableReferenceDirection(relatedTable),
    ].join("__");
}

export function shouldOpenRelatedTab(preferredTabKey, tabKey, fallbackStillOpen) {
    if (preferredTabKey) {
        return preferredTabKey === tabKey;
    }
    return Boolean(fallbackStillOpen);
}

export function clickFallbackRelatedTabIfNoneActive(tabBar) {
    if (!(tabBar instanceof HTMLElement) || tabBar.querySelector(".related_tab_button.active")) {
        return;
    }
    tabBar.querySelector(".related_tab_button")?.click();
}

export function findMatchingRelatedTableEntry(childTables = [], datasetName = "", columnName = "", referenceDirection = "") {
    if (!Array.isArray(childTables)) {
        return null;
    }

    const normalizedReferenceDirection = String(referenceDirection || "").trim().toLowerCase();
    return childTables.find((childTable) =>
        childTable?.dataset === datasetName && childTable?.column === columnName
        && (
            !normalizedReferenceDirection
            || getRelatedTableReferenceDirection(childTable) === normalizedReferenceDirection
        )
    ) || null;
}
