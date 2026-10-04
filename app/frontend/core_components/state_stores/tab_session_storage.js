// tab_session_storage.js
// Keeps the values that belong to one browser tab -- the view each dataset shows and the
// row it holds open -- in the tab's session storage, or in this page's memory while the
// browser refuses that storage.
// Bridges dataset_view_choice_saver.js and the open-row part of table_state_store.js with
// sessionStorage, and gives the sign-out reset one place to forget the page-memory copy.
// Exists because a browser that refuses session storage otherwise loses a choice the moment
// it is made: a deep-linked article never opened, and a chosen view never reached the redraw.

/*
 * A value moves into page memory only when the browser refuses to store it,
 * and leaves it again once a write succeeds. Reading prefers page memory,
 * because a refused write can leave an older value behind in a storage that
 * still reads (a full one does). Page memory ends with the page, so in such a
 * browser a reload starts from what its address names; sign-out forgets it at
 * once (logout_shell_reset.js).
 */
const pageMemory = new Map();
let fallbackAnnounced = false;

function announceFallback(error) {
    if (fallbackAnnounced) return;
    fallbackAnnounced = true;
    console.warn("This browser refuses session storage; this page keeps its views and open rows in memory.", error);
}

/**
 * Reads a value this tab stored, or null when it has none.
 *
 * @param {string} key
 * @returns {string|null}
 */
export function readTabSessionValue(key) {
    if (pageMemory.has(key)) return pageMemory.get(key);
    try {
        return sessionStorage.getItem(key);
    } catch {
        return null;
    }
}

/**
 * Stores a value for this tab: in session storage, or in this page's memory
 * when the browser refuses the write.
 *
 * @param {string} key
 * @param {string} value
 */
export function writeTabSessionValue(key, value) {
    const text = String(value);
    try {
        sessionStorage.setItem(key, text);
        pageMemory.delete(key);
    } catch (error) {
        pageMemory.set(key, text);
        announceFallback(error);
    }
}

/**
 * Forgets a value this tab stored, wherever it was kept.
 *
 * @param {string} key
 */
export function removeTabSessionValue(key) {
    pageMemory.delete(key);
    try {
        sessionStorage.removeItem(key);
    } catch {
        // A storage the browser refuses holds nothing of this page's to remove.
    }
}

/** Forgets every value this page kept in memory because the browser refused session storage. */
export function forgetTabSessionFallback() {
    pageMemory.clear();
    fallbackAnnounced = false;
}
