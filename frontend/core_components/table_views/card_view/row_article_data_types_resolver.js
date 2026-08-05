// row_article_data_types_resolver.js
// Resolves card metadata for row article rendering from selected cards and stored dataset state.
// Bridges public dataset aliases and canonical table metadata without expanding the opener module.
// Exists so row article media/detail roles survive public alias navigation and stale local storage.

import { getInternalDatasetName } from "../../navigation/nav_engine/dataset_aliases.js";

function isUsableDataTypes(candidate) {
    return candidate
        && typeof candidate === "object"
        && !Array.isArray(candidate)
        && Object.keys(candidate).length > 0;
}

function readStoredDataTypes(tableName = "") {
    if (!tableName) {
        return {};
    }
    try {
        const parsed = JSON.parse(localStorage.getItem(`${tableName}_dataTypes`) || "{}");
        return isUsableDataTypes(parsed) ? parsed : {};
    } catch (err) {
        console.warn(
            "could not parse data_types for table",
            tableName,
            err
        );
        return {};
    }
}

export function resolveRowArticleDataTypes(tableName = "", selectedCard = null) {
    if (isUsableDataTypes(selectedCard?._data_types)) {
        return selectedCard._data_types;
    }

    const internalTableName = getInternalDatasetName(tableName);
    const candidateNames = Array.from(new Set([
        tableName,
        internalTableName,
    ].filter(Boolean)));

    for (const candidateName of candidateNames) {
        const storedDataTypes = readStoredDataTypes(candidateName);
        if (isUsableDataTypes(storedDataTypes)) {
            return storedDataTypes;
        }
    }

    return {};
}
