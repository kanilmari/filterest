// table_creator_folder_helpers.js
// Pure folder-option helpers for the create-table view.
// Bridges cached tree nodes and form select defaults without DOM access.
// Exists so folder placement rules stay testable and consistent across refreshes.

function trimToEmpty(value) {
    return String(value ?? '').trim();
}

function normalizeFolderSegment(value) {
    return trimToEmpty(value).toLowerCase();
}

function parseFolderId(node) {
    if (!node || typeof node !== 'object') {
        return null;
    }
    if (Number.isInteger(node.db_id) && node.db_id > 0 && String(node.id || '').startsWith('f_')) {
        return node.db_id;
    }
    if (typeof node.id === 'string' && node.id.startsWith('f_')) {
        const parsed = Number.parseInt(node.id.slice(2), 10);
        if (Number.isInteger(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return null;
}

export function buildFolderOptionsFromNodes(nodes = []) {
    const folders = nodes
        .map((node) => {
            const folderId = parseFolderId(node);
            if (!folderId) {
                return null;
            }
            return {
                folderId,
                nodeId: `f_${folderId}`,
                parentNodeId: typeof node.parent_id === 'string' ? node.parent_id : 'null',
                name: trimToEmpty(node.name) || `Folder ${folderId}`,
            };
        })
        .filter(Boolean);

    const foldersByNodeId = new Map(folders.map((folder) => [folder.nodeId, folder]));

    function buildFolderLabel(folder, seen = new Set()) {
        if (!folder || seen.has(folder.nodeId)) {
            return folder?.name || '';
        }
        seen.add(folder.nodeId);
        const parentFolder = foldersByNodeId.get(folder.parentNodeId);
        if (!parentFolder) {
            return folder.name;
        }
        return `${buildFolderLabel(parentFolder, seen)} / ${folder.name}`;
    }

    return folders
        .map((folder) => ({
            value: String(folder.folderId),
            label: buildFolderLabel(folder),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

export function findCanonicalOtherTablesFolderValue(folderOptions = []) {
    let fallbackValue = '';

    for (const option of folderOptions) {
        const label = trimToEmpty(option?.label);
        if (!label) {
            continue;
        }

        const parts = label
            .split('/')
            .map((segment) => normalizeFolderSegment(segment))
            .filter(Boolean);
        const leaf = parts.at(-1);

        if (!fallbackValue && leaf === 'other_tables') {
            fallbackValue = trimToEmpty(option?.value);
        }
        if (parts.at(-2) === 'database' && leaf === 'other_tables') {
            return trimToEmpty(option?.value);
        }
    }

    return fallbackValue;
}

export function resolveFolderSelectionDefaults(folderOptions = [], preferredExistingValue = '') {
    const preferredValue = trimToEmpty(preferredExistingValue);
    const canonicalOtherTablesValue = findCanonicalOtherTablesFolderValue(folderOptions);
    const existingFolderValue = preferredValue || canonicalOtherTablesValue || '';
    const newFolderParentValue = existingFolderValue || canonicalOtherTablesValue || '';

    return {
        canonicalOtherTablesValue,
        existingFolderValue,
        newFolderParentValue,
    };
}
