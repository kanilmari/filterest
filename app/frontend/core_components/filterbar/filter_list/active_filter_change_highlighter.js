// active_filter_change_highlighter.js
// Highlights the surviving active-filter chips after their semantic set changes.
// Bridges stable filter signatures with one short, theme-aware visual acknowledgement.
// Exists to avoid flashing on ordinary rerenders while still confirming real filter edits.

const FILTER_CHANGE_HIGHLIGHT_CLASS = "active-filters--change-highlight";
const FILTER_CHANGE_HIGHLIGHT_DURATION_MS = 720;
const highlightTimers = new WeakMap();

function normalizeSignatures(signatures) {
    return [...new Set(signatures.map((value) => String(value)))].sort();
}

/**
 * Synchronize a filter container's signature and highlight only a real set change.
 * Between active-filter rendering and the short CSS acknowledgement state.
 * Exists so host moves, repeated renders, and result-count updates never cause flicker.
 */
export function highlightActiveFilterSetChange(container, signatures) {
    if (!(container instanceof HTMLElement)) return false;

    const normalizedSignatures = normalizeSignatures(signatures);
    const nextSignature = JSON.stringify(normalizedSignatures);
    const previousSignature = container.dataset.activeFilterSetSignature;
    container.dataset.activeFilterSetSignature = nextSignature;

    if (
        previousSignature === undefined ||
        previousSignature === nextSignature ||
        normalizedSignatures.length === 0
    ) {
        return false;
    }

    const previousTimer = highlightTimers.get(container);
    if (previousTimer) {
        window.clearTimeout(previousTimer);
    }
    container.classList.remove(FILTER_CHANGE_HIGHLIGHT_CLASS);
    void container.offsetWidth;
    container.classList.add(FILTER_CHANGE_HIGHLIGHT_CLASS);
    const timer = window.setTimeout(() => {
        container.classList.remove(FILTER_CHANGE_HIGHLIGHT_CLASS);
        highlightTimers.delete(container);
    }, FILTER_CHANGE_HIGHLIGHT_DURATION_MS);
    highlightTimers.set(container, timer);
    return true;
}
