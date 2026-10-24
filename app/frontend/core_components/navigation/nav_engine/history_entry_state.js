// history_entry_state.js
// Gives navigations stable identities without owning the browser history stack.
// Bridges list URL changes and row-article history entries.
// Exists so a mounted return view can validate its original history entry.

export const HISTORY_ENTRY_ID = "__filterestEntryId";
const HISTORY_DATASET_VIEW = "__filterestDatasetView";
let nextEntry = 0;
let retainedAddress = null;

/** A denied restoration retains the browser's entry, even when the mounted view differs.
 * Address reconciliation and filter cleanup consult this until navigation leaves it.
 * Do not ensure an ID here: even adding an identity would alter the denied entry.
 */
export function retainHistoryEntryAddress() {
    retainedAddress = { url: location.href, entryId: history.state?.[HISTORY_ENTRY_ID] ?? null };
}

export function isHistoryEntryAddressRetained() {
    return retainedAddress?.url === location.href
        && retainedAddress.entryId === (history.state?.[HISTORY_ENTRY_ID] ?? null);
}

/** Explicit navigation or an authorized restoration can take ownership again. */
export function releaseHistoryEntryAddress() {
    retainedAddress = null;
}

function freshEntryId() {
    return globalThis.crypto?.randomUUID?.() || `entry-${Date.now()}-${++nextEntry}`;
}

export function ensureHistoryEntryId() {
    const existing = history.state?.[HISTORY_ENTRY_ID];
    if (typeof existing === "string" && existing) return existing;
    const entryId = freshEntryId();
    history.replaceState({ ...(history.state || {}), [HISTORY_ENTRY_ID]: entryId }, "", window.location.href);
    return entryId;
}

/** The current entry remembers its rendered view without changing its URL. */
export function rememberHistoryDatasetView(dataset, view) {
    if (!dataset || !view) return;
    ensureHistoryEntryId();
    history.replaceState({ ...(history.state || {}),
        [HISTORY_DATASET_VIEW]: { dataset, path: location.pathname, view },
    }, "", location.href);
}

export function getHistoryDatasetView(dataset) {
    const remembered = history.state?.[HISTORY_DATASET_VIEW];
    return remembered?.dataset === dataset && remembered.path === location.pathname
        && typeof remembered.view === "string" ? remembered.view : null;
}

/** Home's cold load at the bare root gets its identity at boot; any other entry, a denied bookmark included, is
 * left exactly as the browser loaded it until navigation owns it. */
export function ensureRootEntryIdentity() {
    if (location.pathname !== "/" || location.search) return null;
    return ensureHistoryEntryId();
}

// Only a state whose own values are all primitives can be proved unchanged (Object.is, so undefined is not null).
// A state holding any object, array or Date is written as before, whatever it contains.
function samePrimitiveState(a, b) {
    if (!a || !b) return false;
    const primitive = value => value === null || (typeof value !== "object" && typeof value !== "function");
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key)
        && primitive(a[key]) && Object.is(a[key], b[key]));
}

export function writeHistoryEntry(url, state = {}, { replace = false } = {}) {
    releaseHistoryEntryAddress();
    const previous = { ...(history.state || {}) };
    // Only navigation-owned fields are replaced; other history owners survive.
    for (const key of ["bigCard", "dataset", "rowId", "articleReturnAvailable", "articleOriginEntry", "imageFirstView", "homeSearch", HISTORY_DATASET_VIEW]) delete previous[key];
    const nextState = replace
        ? { ...previous, ...state, [HISTORY_ENTRY_ID]: ensureHistoryEntryId() }
        : { ...state, [HISTORY_ENTRY_ID]: freshEntryId() };
    // An unchanged replacement is not written: it would still be a same-document navigation, and one landing while
    // Back or Forward loads another document is taken for that navigation's end (G5: Home's boot write of '/').
    if (replace && new URL(url, location.href).href === location.href && samePrimitiveState(nextState, history.state)) {
        return nextState[HISTORY_ENTRY_ID];
    }
    history[replace ? "replaceState" : "pushState"](nextState, "", url);
    return nextState[HISTORY_ENTRY_ID];
}
