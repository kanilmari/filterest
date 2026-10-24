// front_page_search_history.js
// Owns a state-only entry for the phone Home search dialog.
// The navigation handler consults it before hydration or view restoration.
// No listeners or writes run on import, including desktop and reload.

import { ensureHistoryEntryId, HISTORY_ENTRY_ID, writeHistoryEntry } from '../navigation/nav_engine/history_entry_state.js';

let owner = null;

/** Give this opening a distinct identity and remember exactly the Home entry under it. */
export function openHomeSearchHistory(onClose) {
    const parentId = ensureHistoryEntryId();
    const url = location.href;
    const entryId = writeHistoryEntry(url, { homeSearch: true });
    const visit = { parentId, url, entryId, onClose, closing: null, resolve: null };
    owner = visit;
    return {
        close() {
            if (visit.closing) return visit.closing;
            onClose();
            if (owner !== visit || history.state?.[HISTORY_ENTRY_ID] !== entryId) {
                if (owner === visit) owner = null;
                return Promise.resolve();
            }
            // Repeated close gestures share this one Back and its completion.
            visit.closing = new Promise(resolve => { visit.resolve = resolve; });
            history.back();
            return visit.closing;
        },
    };
}

/** Consume only the dialog's same-address return; a real departure still navigates.
 * A retained entry after reload/Forward is inert: never reopen or restore a view for it.
 */
export function consumeHomeSearchHistoryNavigation() {
    if (owner && history.state?.[HISTORY_ENTRY_ID] !== owner.entryId) {
        const visit = owner;
        owner = null;
        visit.onClose();
        visit.resolve?.();
        if (location.href === visit.url && history.state?.[HISTORY_ENTRY_ID] === visit.parentId) return true;
    }
    return history.state?.homeSearch === true;
}
