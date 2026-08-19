// dataset_scroll_retention.js
// Preserves already-mounted dataset viewports while their parent tabs are hidden.
// Bridges browser-specific display:none scroll behavior with the SPA navigation shell.
// Exists because Firefox can reset descendant scrollTop when a dataset tab is hidden.

const datasetScrollSnapshots = new WeakMap();

const LOGICAL_ANCHOR_SELECTOR = [
    '.card[data-id]',
    '[data-testid="dataset-view-table"] tbody > tr',
].join(', ');

function resolveTopVisibleAnchor(scrollElement) {
    const scrollBounds = scrollElement.getBoundingClientRect();
    const candidates = scrollElement.querySelectorAll(LOGICAL_ANCHOR_SELECTOR);

    for (const candidate of candidates) {
        if (!(candidate instanceof HTMLElement)) {
            continue;
        }
        const bounds = candidate.getBoundingClientRect();
        if (bounds.bottom > scrollBounds.top + 1 && bounds.top < scrollBounds.bottom - 1) {
            return {
                element: candidate,
                blockOffset: bounds.top - scrollBounds.top,
            };
        }
    }

    return null;
}

/**
 * Captures each mounted dataset view without serializing row data or rebuilding DOM.
 */
export function captureDatasetScrollState(datasetContainer) {
    if (!(datasetContainer instanceof HTMLElement)) {
        return;
    }

    const snapshots = Array.from(datasetContainer.querySelectorAll('.scrollable_content'))
        .filter((element) => element instanceof HTMLElement)
        .map((element) => ({
            element,
            scrollTop: element.scrollTop,
            scrollLeft: element.scrollLeft,
            anchor: resolveTopVisibleAnchor(element),
        }));

    datasetScrollSnapshots.set(datasetContainer, snapshots);
}

/**
 * Restores the same mounted nodes. The logical anchor corrects small layout
 * shifts while the pixel position remains the fallback for non-row surfaces.
 */
export function restoreDatasetScrollState(datasetContainer) {
    if (!(datasetContainer instanceof HTMLElement)) {
        return;
    }

    const snapshots = datasetScrollSnapshots.get(datasetContainer) || [];
    snapshots.forEach((snapshot) => {
        const { element, anchor } = snapshot;
        if (!element.isConnected || !datasetContainer.contains(element)) {
            return;
        }

        element.scrollTop = snapshot.scrollTop;
        element.scrollLeft = snapshot.scrollLeft;

        if (anchor?.element?.isConnected && element.contains(anchor.element)) {
            const currentOffset = anchor.element.getBoundingClientRect().top
                - element.getBoundingClientRect().top;
            element.scrollTop += currentOffset - anchor.blockOffset;
        }
    });
}

export function clearDatasetScrollState(datasetContainer) {
    if (datasetContainer instanceof HTMLElement) {
        datasetScrollSnapshots.delete(datasetContainer);
    }
}
