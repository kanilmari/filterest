// workline_observatory_selection_storage.js
// Persists the owner's current Observatory row selection between page loads.
// Bridges ephemeral view state with best-effort browser storage.
// Exists separately so the main view renderer stays focused on presentation.

const WORKLINE_SELECTION_STORAGE_KEY = 'easelect.workline-observatory.selection.v1';

export function readPersistedWorklineSelection() {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(WORKLINE_SELECTION_STORAGE_KEY) || 'null');
        if (!parsed || !Array.isArray(parsed.selectedWorklineIds)) return null;
        return {
            selectedWorklineIds: parsed.selectedWorklineIds
                .map(Number)
                .filter((id) => Number.isSafeInteger(id) && id > 0),
            selectedWorklineId: Number.isSafeInteger(Number(parsed.selectedWorklineId))
                ? Number(parsed.selectedWorklineId)
                : null,
        };
    } catch {
        return null;
    }
}

export function persistWorklineSelection(state) {
    try {
        window.localStorage.setItem(WORKLINE_SELECTION_STORAGE_KEY, JSON.stringify({
            selectedWorklineIds: state.selectedWorklineIds || [],
            selectedWorklineId: state.selectedWorklineId ?? null,
        }));
    } catch {
        // Private browsing or owner policy may deny storage; selection still works for this view lifetime.
    }
}
