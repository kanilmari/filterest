// dataset_row_selection_store.js
// Maintains selected dataset-row identities independently from the active visual renderer.
// Bridges table, card, article-card, delete, and row-permission action surfaces.
// Exists so a view switch or rerender does not silently change which stable rows an action targets.

const selectedRowsByDataset = new Map();

function normalizeDatasetName(datasetName) {
    return String(datasetName || "").trim();
}

function normalizeRowID(rowID) {
    const normalized = Number(rowID);
    return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function emitSelectionChange(datasetName) {
    const selection = getDatasetRowSelection(datasetName);
    document.dispatchEvent(new CustomEvent("dataset-row-selection-change", {
        detail: {
            datasetName,
            ids: selection.ids,
            count: selection.ids.length,
        },
    }));
}

export function setDatasetRowSelected(datasetName, rowID, rowData, selected) {
    const dataset = normalizeDatasetName(datasetName);
    const id = normalizeRowID(rowID);
    if (!dataset || id === null) return false;

    let selection = selectedRowsByDataset.get(dataset);
    if (!selection) {
        selection = new Map();
        selectedRowsByDataset.set(dataset, selection);
    }

    const existed = selection.has(id);
    if (selected) {
        selection.set(id, rowData && typeof rowData === "object" ? rowData : { id });
    } else {
        selection.delete(id);
        if (selection.size === 0) selectedRowsByDataset.delete(dataset);
    }

    if (existed !== Boolean(selected)) {
        emitSelectionChange(dataset);
    }
    return true;
}

export function isDatasetRowSelected(datasetName, rowID) {
    const dataset = normalizeDatasetName(datasetName);
    const id = normalizeRowID(rowID);
    return Boolean(dataset && id !== null && selectedRowsByDataset.get(dataset)?.has(id));
}

export function getDatasetRowSelection(datasetName) {
    const dataset = normalizeDatasetName(datasetName);
    const selection = selectedRowsByDataset.get(dataset);
    if (!selection) return { ids: [], rows: [] };

    const entries = Array.from(selection.entries()).sort(([left], [right]) => left - right);
    return {
        ids: entries.map(([id]) => id),
        rows: entries.map(([, row]) => row),
    };
}

export function clearDatasetRowSelection(datasetName) {
    const dataset = normalizeDatasetName(datasetName);
    if (!dataset || !selectedRowsByDataset.delete(dataset)) return false;
    emitSelectionChange(dataset);
    return true;
}

export function resetDatasetRowSelectionStoreForTests() {
    selectedRowsByDataset.clear();
}
