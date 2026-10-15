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

export function writeHistoryEntry(url, state = {}, { replace = false } = {}) {
    releaseHistoryEntryAddress();
    const previous = { ...(history.state || {}) };
    // Only navigation-owned fields are replaced; other history owners survive.
    for (const key of ["bigCard", "dataset", "rowId", "articleReturnAvailable", "articleOriginEntry", "imageFirstView", HISTORY_DATASET_VIEW]) delete previous[key];
    const nextState = replace
        ? { ...previous, ...state, [HISTORY_ENTRY_ID]: ensureHistoryEntryId() }
        : { ...state, [HISTORY_ENTRY_ID]: freshEntryId() };
    history[replace ? "replaceState" : "pushState"](nextState, "", url);
    return nextState[HISTORY_ENTRY_ID];
}
