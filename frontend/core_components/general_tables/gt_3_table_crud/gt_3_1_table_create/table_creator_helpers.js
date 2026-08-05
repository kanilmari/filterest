// table_creator_helpers.js
// Pure request-shaping helpers for table_creator.js.
// Converts form snapshot values into validation outcomes and API payload pieces.
// Stays free of DOM and network access so Vitest can cover the core logic.

import { isValidIdentifier } from '../../../../reusable_components/dom_container_builder_helpers.js';

function trimToEmpty(value) {
    return String(value ?? '').trim();
}

function createTableCreationFailure(warningKey, warningFallback) {
    return {
        ok: false,
        warningKey,
        warningFallback,
    };
}

function buildTableCreationColumns({ columnNames = [], dataTypes = [], lengths = [] }) {
    const columns = {};

    for (let i = 0; i < columnNames.length; i++) {
        const colName = trimToEmpty(columnNames[i]);
        const dataType = trimToEmpty(dataTypes[i]);
        const length = trimToEmpty(lengths[i]);

        if (!colName) {
            continue;
        }
        if (!isValidIdentifier(colName)) {
            return createTableCreationFailure(
                'invalid_column_name',
                `Virheellinen sarakenimi "${colName}". Käytä vain a-z, A-Z, numeroita ja alaviivaa.`
            );
        }
        if (!dataType) {
            return createTableCreationFailure(
                'missing_data_type',
                `Tietotyyppi puuttuu sarakkeelle "${colName}".`
            );
        }

        columns[colName] = dataType === 'VARCHAR' && length ? `${dataType}(${length})` : dataType;
    }

    if (Object.keys(columns).length === 0) {
        return createTableCreationFailure(
            'add_at_least_one_column',
            'Lisää vähintään yksi sarake.'
        );
    }

    return {
        ok: true,
        columns,
    };
}

function buildTableCreationForeignKeys({
    referencingColumns = [],
    referencedTables = [],
    referencedColumns = [],
}) {
    const foreignKeys = [];

    for (let i = 0; i < referencingColumns.length; i++) {
        const refCol = trimToEmpty(referencingColumns[i]);
        const refTable = trimToEmpty(referencedTables[i]);
        const refColumn = trimToEmpty(referencedColumns[i]);

        if (refCol && refTable && refColumn) {
            foreignKeys.push({
                referencing_column: refCol,
                referenced_dataset: refTable,
                referenced_column: refColumn,
            });
        }
    }

    return foreignKeys;
}

function normalizeOptionalPositiveInteger(value) {
    const normalized = trimToEmpty(value);
    if (!normalized) {
        return null;
    }

    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
}

/**
 * Convert the table creation form snapshot into a validated request payload.
 *
 * @param {Object} formSnapshot - Plain form values gathered from the DOM
 * @param {string} formSnapshot.tableName - Proposed dataset name
 * @param {Array<string>} formSnapshot.columnNames - Column name inputs
 * @param {Array<string>} formSnapshot.dataTypes - Column type inputs
 * @param {Array<string>} formSnapshot.lengths - Column length inputs
 * @param {Array<string>} formSnapshot.referencingColumns - FK source column inputs
 * @param {Array<string>} formSnapshot.referencedTables - FK target table inputs
 * @param {Array<string>} formSnapshot.referencedColumns - FK target column inputs
 * @param {boolean} formSnapshot.grantUsersRead - Users read permission toggle
 * @param {boolean} formSnapshot.grantGuestsRead - Guests read permission toggle
 * @param {boolean} formSnapshot.preventDeletion - Prevent deletion toggle
 * @param {string|number|null} formSnapshot.folderId - Selected existing target folder id
 * @param {string} formSnapshot.createFolderName - Optional inline new folder name
 * @param {string|number|null} formSnapshot.createFolderParentId - Optional parent id for inline folder creation
 * @returns {Object} Validation result and, on success, the API request payload
 */
export function buildTableCreationRequestData({
    tableName,
    columnNames,
    dataTypes,
    lengths,
    referencingColumns,
    referencedTables,
    referencedColumns,
    grantUsersRead,
    grantGuestsRead,
    preventDeletion,
    folderId,
    createFolderName,
    createFolderParentId,
}) {
    const normalizedTableName = trimToEmpty(tableName);
    if (!normalizedTableName) {
        return createTableCreationFailure(
            'table_name_required',
            'Taulun nimi on pakollinen.'
        );
    }
    if (!isValidIdentifier(normalizedTableName)) {
        return createTableCreationFailure(
            'invalid_table_name_chars',
            'Taulun nimessä saa käyttää vain kirjaimia A-Z, numeroita ja alaviivaa. Ääkköset eivät ole sallittuja.'
        );
    }

    const columnsResult = buildTableCreationColumns({
        columnNames,
        dataTypes,
        lengths,
    });
    if (!columnsResult.ok) {
        return columnsResult;
    }

    const foreignKeys = buildTableCreationForeignKeys({
        referencingColumns,
        referencedTables,
        referencedColumns,
    });

    const normalizedFolderId = normalizeOptionalPositiveInteger(folderId);
    const normalizedCreateFolderName = trimToEmpty(createFolderName);
    const normalizedCreateFolderParentId = normalizeOptionalPositiveInteger(createFolderParentId);

    const requestData = {
        dataset_name: normalizedTableName,
        columns: columnsResult.columns,
        foreign_keys: foreignKeys,
        grant_users_read: Boolean(grantUsersRead),
        grant_guests_read: Boolean(grantGuestsRead),
        prevent_deletion: Boolean(preventDeletion),
        folder_id: normalizedCreateFolderName ? null : normalizedFolderId,
        create_folder: normalizedCreateFolderName ? {
            folder_name: normalizedCreateFolderName,
            parent_id: normalizedCreateFolderParentId,
        } : null,
    };

    return {
        ok: true,
        tableName: normalizedTableName,
        columns: columnsResult.columns,
        foreignKeys,
        folderId: normalizedFolderId,
        createFolder: requestData.create_folder,
        requestData,
    };
}
