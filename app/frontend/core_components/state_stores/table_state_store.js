// table_state_store.js
// Reads and writes unified table view state in localStorage.
// Bridges table refresh flows and persisted sort, filter, offset, and card-view state.
// Exists to centralise table-state persistence and avoid circular dependencies in table modules.

/**
 * Palauttaa taulun unified-tilan (sort, filters, offset, jne.)
 * localStoragesta. Jos tila puuttuu tai on korruptoitunut, palauttaa oletukset.
 */
export function getUnifiedTableState(tableName) {
    const datasetName = tableName;
    const storageKey = `${datasetName}_sorting_and_filtering_specs`;
    const defaultState = {
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

    const raw = localStorage.getItem(storageKey);
    if (!raw) {
        return defaultState;
    }
    try {
        const parsed = JSON.parse(raw);
        // Only old article aliases migrate the former card detail state.
        // Ordinary card settings remain untouched and independent.
        const storedView = localStorage.getItem(`${datasetName}_view`);
        const articleView = parsed.articleView || (
            ["article", "big_card", "row_article"].includes(storedView)
                ? { ...parsed.cardView }
                : defaultState.articleView
        );
        return { ...defaultState, ...parsed, articleView };
    } catch (err) {
        console.warn(`Virhe parsing localStorage avaimella ${storageKey}:`, err);
        return defaultState;
    }
}

/**
 * Asettaa (ja tallentaa localStorageen) taulun unified-tilan.
 * partialState voi sisältää esim. { sort: {...}, filters: {...}, offset: 99 }
 * tai vain osan noista.
 */
export function setUnifiedTableState(tableName, partialState) {
    const datasetName = tableName;
    const storageKey = `${datasetName}_sorting_and_filtering_specs`;
    const currentState = getUnifiedTableState(tableName);
    const newState = {
        ...currentState,
        ...partialState
    };
    if (partialState.articleView) {
        newState.articleView = {
            ...currentState.articleView,
            ...partialState.articleView,
        };
    }
    if (partialState.cardView) {
        newState.cardView = {
            ...currentState.cardView,
            ...partialState.cardView
        };
    }
    localStorage.setItem(storageKey, JSON.stringify(newState));
    return newState;
}

/**
 * Forgets which row a dataset had open and keeps its sorting, filters and
 * paging. A fresh page opens a row only when its address names one; a row
 * left open on an earlier visit would otherwise reopen its article every time.
 */
export function forgetOpenRow(tableName) {
    const storageKey = `${tableName}_sorting_and_filtering_specs`;
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
        return;
    }
    let state;
    try {
        state = JSON.parse(raw);
    } catch {
        // An unreadable state already reads as the defaults.
        localStorage.removeItem(storageKey);
        return;
    }
    state.articleView = { collapsed: false, expandedId: null };
    state.cardView = { ...(state.cardView || {}), collapsed: false, expandedId: null };
    try {
        localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
        // A full or blocked storage keeps the stored sorting, filters and
        // paging as they were; only the open row could not be forgotten.
    }
}
