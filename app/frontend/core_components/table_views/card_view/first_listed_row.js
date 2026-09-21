// first_listed_row.js
// Decides which row a card or article view that is waiting for one opens.
// Bridges the view's stored article state with whatever just drew the dataset's list.
// Exists so "the first match" has one rule: the first row of the list just drawn.
// While a search is committed that list is the searched listing, so its first
// row is the first search match; no caller chooses a row of its own.

import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";

/** Which part of the stored table state belongs to this view's article. */
export function getArticleStateKey(viewKey) {
    return viewKey === "article_view" ? "articleView" : "cardView";
}

/**
 * When the view waits for its first row, take the first row of the list just
 * drawn as the open one and return it for the caller to open.
 *
 * Two stored flags say "waiting": one is set when a search is committed and one
 * when none is. They mean the same thing now that a search is browsed through
 * the dataset's own list, and both names stay because the state is kept in the
 * browser between visits.
 *
 * @param {string} tableName
 * @param {string} viewKey the view the list was drawn in.
 * @param {Array<Object>} rows the rows just drawn, in the order shown.
 * @returns {Object|null} the row to open, or null when nothing is waiting or
 *          the list has no row that can be opened.
 */
export function claimFirstListedRow(tableName, viewKey, rows = []) {
    const stateKey = getArticleStateKey(viewKey);
    const articleState = getUnifiedTableState(tableName)?.[stateKey] || {};
    const waiting = articleState.collapsed === true
        && articleState.expandedId == null
        && (articleState.pendingAutoOpenFirstRenderedResult === true
            || articleState.pendingAutoOpenFirstSearchResult === true);
    if (!waiting) return null;

    const firstRow = (Array.isArray(rows) ? rows : []).find((row) => row?.id != null) || null;
    if (!firstRow) return null;

    setUnifiedTableState(tableName, {
        [stateKey]: {
            ...articleState,
            expandedId: firstRow.id,
            pendingAutoOpenFirstRenderedResult: false,
            pendingAutoOpenFirstSearchResult: false,
        },
    });
    return firstRow;
}
