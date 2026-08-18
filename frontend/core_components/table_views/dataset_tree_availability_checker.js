// dataset_tree_availability_checker.js
// Resolves whether a dataset has a real hierarchy that the tree view can render.
// Bridges dataset column/FK metadata with the view selector and tree renderer.
// Exists so ordinary flat datasets do not advertise a misleading tree presentation.

const DATABASE_CATALOG_TREE_DATASETS = new Set([
    "system_table_folders",
    "system_db_tables",
]);

function normalizeIdentifier(value) {
    return String(value || "").trim().toLowerCase();
}

function getColumnMetadata(dataTypes, columnName) {
    const metadata = dataTypes?.[columnName];
    return metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? metadata
        : null;
}

/**
 * Tells whether a dataset uses the dedicated database-catalog tree renderer.
 * Operates between dataset identity and the existing catalog-tree endpoint.
 * Exists because catalog trees combine folders and datasets instead of one self-FK table.
 */
export function isDatabaseCatalogTreeDataset(datasetName) {
    return DATABASE_CATALOG_TREE_DATASETS.has(normalizeIdentifier(datasetName));
}

/**
 * Resolves an ordinary dataset's verified self-parent columns.
 * Operates between backend FK metadata and the flat-node tree renderer.
 * Exists to reject name-only `parent_*` guesses that are not real self-relations.
 */
export function resolveDatasetTreeStructure(datasetName, columns = [], dataTypes = {}) {
    const normalizedDatasetName = normalizeIdentifier(datasetName);
    if (!normalizedDatasetName || !Array.isArray(columns)) {
        return null;
    }

    const columnNamesByNormalizedName = new Map(
        columns.map((columnName) => [normalizeIdentifier(columnName), columnName])
    );

    for (const parentColumn of columns) {
        const metadata = getColumnMetadata(dataTypes, parentColumn);
        if (!metadata) continue;

        const foreignTable = normalizeIdentifier(metadata.foreign_table);
        const foreignColumn = normalizeIdentifier(metadata.foreign_column);
        const idColumn = columnNamesByNormalizedName.get(foreignColumn);
        if (
            foreignTable === normalizedDatasetName
            && idColumn
            && normalizeIdentifier(parentColumn) !== foreignColumn
        ) {
            return {
                idColumn,
                parentColumn,
            };
        }
    }

    return null;
}

/**
 * Tells whether the tree presentation is meaningful for a dataset.
 * Operates between selector availability and the two supported tree models.
 * Exists so both the selector and renderer apply the same fail-closed rule.
 */
export function datasetSupportsTreeView(datasetName, columns = [], dataTypes = {}) {
    return isDatabaseCatalogTreeDataset(datasetName)
        || Boolean(resolveDatasetTreeStructure(datasetName, columns, dataTypes));
}
