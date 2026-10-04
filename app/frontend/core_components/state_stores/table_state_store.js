// table_state_store.js
// Reads and writes a dataset's unified table state: its sorting, filters and paging,
// which every browser tab shares, and the row its views hold open, which is this tab's own.
// Bridges table refresh flows with localStorage for the shared part and the tab's session
// storage (tab_session_storage.js, page memory when the browser refuses it) for the open row.
// Exists to centralise table-state persistence and avoid circular dependencies in table modules.

import { readTabSessionValue, removeTabSessionValue, writeTabSessionValue } from "./tab_session_storage.js";

const SHARED_STATE_KEY_SUFFIX = "_sorting_and_filtering_specs";
const OPEN_ROW_STATE_KEY_SUFFIX = "_open_row";

/**
 * The parts of the state that describe the row the article view and the card
 * view hold open, with what belongs to that row: where closing it returns, its
 * scroll position and related tab, and whether the first listed row should open
 * next. Owner decision K143 (3.10.2026) keeps them per browser tab, so a tab
 * never opens or closes an article because of another tab. Everything else in
 * the state -- sorting, filters, paging -- stays shared by every tab.
 */
const OPEN_ROW_STATE_PARTS = Object.freeze(["articleView", "cardView"]);

/**
 * What the article view remembers about its open row's reading position: the
 * related tab, whether the related rows are open, and the scroll position.
 * This is the one list of those fields: row_article_view_restore_state.js reads,
 * writes and clears exactly these, and a reload of that row's own address keeps
 * them (forgetOpenRow).
 */
export const ARTICLE_READING_POSITION_FIELDS = Object.freeze(["relatedTabKey", "relatedRowsOpen", "scrollTop"]);

function buildDefaultTableState() {
    return {
        sort: {
            column: null,
            direction: null
        },
        filters: {},
        offset: 0,
        articleView: { collapsed: false, expandedId: null },
        cardView: {
            collapsed: false,
            expandedId: null
        }
    };
}

function getSharedStateKey(tableName) {
    return `${tableName}${SHARED_STATE_KEY_SUFFIX}`;
}

function getOpenRowStateKey(tableName) {
    return `${tableName}${OPEN_ROW_STATE_KEY_SUFFIX}`;
}

/** Splits a state, or part of one, into what every tab shares and this tab's open row. */
function splitTableState(state) {
    const shared = {};
    const openRow = {};
    for (const [key, value] of Object.entries(state || {})) {
        if (OPEN_ROW_STATE_PARTS.includes(key)) {
            openRow[key] = value;
        } else {
            shared[key] = value;
        }
    }
    return { shared, openRow };
}

/**
 * Reads the shared sorting, filters and paging. An open row that an earlier
 * version stored here belongs to whichever tab wrote it, so it is ignored, and
 * the next shared write leaves it out.
 */
function readSharedTableState(tableName) {
    const storageKey = getSharedStateKey(tableName);
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
        return {};
    }
    try {
        return splitTableState(JSON.parse(raw)).shared;
    } catch (err) {
        console.warn(`Virhe parsing localStorage avaimella ${storageKey}:`, err);
        return {};
    }
}

/** Reads this tab's open row; an unreadable one reads as none. */
function readOpenRowState(tableName) {
    const raw = readTabSessionValue(getOpenRowStateKey(tableName));
    if (!raw) {
        return {};
    }
    try {
        return splitTableState(JSON.parse(raw)).openRow;
    } catch {
        return {};
    }
}

/** Writes this tab's open row; a browser that refuses session storage keeps it in page memory. */
function writeOpenRowState(tableName, openRowState) {
    writeTabSessionValue(getOpenRowStateKey(tableName), JSON.stringify(openRowState));
}

/**
 * Returns a dataset's unified state: the shared sorting, filters and paging,
 * with this tab's open row laid over them. A missing or corrupted part reads
 * as its defaults.
 */
export function getUnifiedTableState(tableName) {
    return {
        ...buildDefaultTableState(),
        ...readSharedTableState(tableName),
        ...readOpenRowState(tableName),
    };
}

/**
 * Merges a partial change, such as { sort: {...}, filters: {...}, offset: 99 },
 * into a dataset's unified state and returns the result. Each part goes to its
 * own store, and only a part the change touches is written: the open row to
 * this tab, the sorting, filters and paging to every tab.
 */
export function setUnifiedTableState(tableName, partialState) {
    const currentState = getUnifiedTableState(tableName);
    const newState = {
        ...currentState,
        ...partialState
    };
    for (const part of OPEN_ROW_STATE_PARTS) {
        if (partialState[part]) {
            newState[part] = {
                ...currentState[part],
                ...partialState[part],
            };
        }
    }
    const { shared, openRow } = splitTableState(newState);
    const touched = splitTableState(partialState);
    if (Object.keys(touched.shared).length > 0) {
        localStorage.setItem(getSharedStateKey(tableName), JSON.stringify(shared));
    }
    if (Object.keys(touched.openRow).length > 0) {
        writeOpenRowState(tableName, openRow);
    }
    return newState;
}

/**
 * Tells whether two row ids name the same row, so 5 and "5" match and a
 * missing id matches nothing. The article view's restore state compares rows
 * with it as well.
 */
export function isSameOpenRow(left, right) {
    return left != null && right != null && String(left) === String(right);
}

/**
 * Forgets which row a dataset had open in this tab and keeps its sorting,
 * filters and paging. A fresh page opens a row only when its address names
 * one; a row left open on an earlier visit would otherwise reopen its article
 * every time. Only this tab's own open row is touched: another tab keeps the
 * article it has open.
 *
 * A reload of the open article's own address is that same reading continuing,
 * so when `addressRowId` names the row this tab had open, its reading position
 * -- related tab, related rows, scroll -- is kept while the rest is forgotten.
 *
 * A duplicated browser tab starts with a copy of this tab's session storage.
 * When it loads the same row's address it is the same reading copied, so it
 * keeps that position too: duplicating a tab copies the page, and that is
 * intended (WL137). From then on each tab's changes stay its own.
 *
 * @param {string} tableName
 * @param {string|number|null} [addressRowId] The article row the loaded page's address names.
 */
export function forgetOpenRow(tableName, addressRowId = null) {
    const storageKey = getOpenRowStateKey(tableName);
    const raw = readTabSessionValue(storageKey);
    if (!raw) {
        return;
    }
    let state;
    try {
        state = splitTableState(JSON.parse(raw)).openRow;
    } catch {
        // An unreadable open row already reads as none.
        removeTabSessionValue(storageKey);
        return;
    }
    const previousArticle = state.articleView || {};
    state.articleView = { collapsed: false, expandedId: null };
    if (isSameOpenRow(previousArticle.expandedId, addressRowId)) {
        for (const field of ARTICLE_READING_POSITION_FIELDS) {
            if (Object.hasOwn(previousArticle, field)) state.articleView[field] = previousArticle[field];
        }
    }
    state.cardView = { ...(state.cardView || {}), collapsed: false, expandedId: null };
    writeTabSessionValue(storageKey, JSON.stringify(state));
}
