// filterbar_state_saver.js
// Persists filterbar UI state in localStorage.
// Bridges dataset-specific filterbar interactions with browser storage for reopen and restore behavior.
// Exists to centralize filterbar persistence logic outside rendering and event-handling modules.

import {
    buildOpenFiltersKey,
    buildOverflowExpandedKey,
    parseOpenFilters,
    parseOverflowExpanded,
    serializeOpenFilters,
    serializeOverflowExpanded,
} from './filterbar_state_saver_helpers.js';

export function getOpenedFilters(tableName) {
    return parseOpenFilters(localStorage.getItem(buildOpenFiltersKey(tableName)));
}

export function hasOpenedFiltersSaved(tableName) {
    return localStorage.getItem(buildOpenFiltersKey(tableName)) !== null;
}

export function saveOpenedFilters(tableName, opened = []) {
    localStorage.setItem(buildOpenFiltersKey(tableName), serializeOpenFilters(opened));
}

export function clearOpenedFilters(tableName) {
    localStorage.removeItem(buildOpenFiltersKey(tableName));
}

export function getOverflowExpandedState(tableName) {
    return parseOverflowExpanded(localStorage.getItem(buildOverflowExpandedKey(tableName)));
}

export function saveOverflowExpandedState(tableName, isExpanded) {
    localStorage.setItem(
        buildOverflowExpandedKey(tableName),
        serializeOverflowExpanded(isExpanded)
    );
}

export function clearOverflowExpandedState(tableName) {
    localStorage.removeItem(buildOverflowExpandedKey(tableName));
}
