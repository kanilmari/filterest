// dataset_folder_options.js
// Pure folder rules of the dataset form: the folder choices the navigation tree
// offers, where a new dataset goes by default, and where a dataset sits now.
// Bridges the tree's flat node list with the form's folder control, without
// DOM or network access, so the rules stay testable.
// Exists so a new dataset lands where the site navigation lists it — directly
// in the current project's folder — unless the person chooses otherwise. The
// server applies the same default (resolveCreateTableFolderID).

function trimToEmpty(value) {
    return String(value ?? "").trim();
}

function parseFolderId(node) {
    if (!node || typeof node !== "object") return null;
    if (Number.isInteger(node.db_id) && node.db_id > 0 && String(node.id || "").startsWith("f_")) {
        return node.db_id;
    }
    if (typeof node.id === "string" && node.id.startsWith("f_")) {
        const parsed = Number.parseInt(node.id.slice(2), 10);
        if (Number.isInteger(parsed) && parsed > 0) return parsed;
    }
    return null;
}

/**
 * Every folder of the tree as one choice, labelled by its whole path and
 * sorted by it. The current project's folder says so, because only the
 * datasets directly in it appear in the site navigation.
 *
 * @param {object[]} nodes - the navigation tree's flat node list
 * @returns {{value: string, label: string, isCurrentProject: boolean}[]}
 */
export function buildFolderOptionsFromNodes(nodes = []) {
    const folders = (Array.isArray(nodes) ? nodes : [])
        .map((node) => {
            const folderId = parseFolderId(node);
            if (!folderId) return null;
            return {
                folderId,
                nodeId: `f_${folderId}`,
                parentNodeId: typeof node.parent_id === "string" ? node.parent_id : "null",
                name: trimToEmpty(node.name) || `Folder ${folderId}`,
                isCurrentProject: node.is_current_project === true,
            };
        })
        .filter(Boolean);

    const foldersByNodeId = new Map(folders.map((folder) => [folder.nodeId, folder]));

    function buildFolderLabel(folder, seen = new Set()) {
        if (!folder || seen.has(folder.nodeId)) return folder?.name || "";
        seen.add(folder.nodeId);
        const parentFolder = foldersByNodeId.get(folder.parentNodeId);
        if (!parentFolder) return folder.name;
        return `${buildFolderLabel(parentFolder, seen)} / ${folder.name}`;
    }

    return folders
        .map((folder) => ({
            value: String(folder.folderId),
            label: buildFolderLabel(folder),
            isCurrentProject: folder.isCurrentProject,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

/** The folder database / other_tables, or failing that any other_tables folder. */
export function findCanonicalOtherTablesFolderValue(folderOptions = []) {
    let fallbackValue = "";
    for (const option of folderOptions) {
        const parts = trimToEmpty(option?.label).split("/")
            .map((segment) => trimToEmpty(segment).toLowerCase())
            .filter(Boolean);
        const leaf = parts.at(-1);
        if (!fallbackValue && leaf === "other_tables") fallbackValue = trimToEmpty(option?.value);
        if (parts.at(-2) === "database" && leaf === "other_tables") return trimToEmpty(option?.value);
    }
    return fallbackValue;
}

/** The current project's folder, whose direct datasets the site navigation lists. */
export function findCurrentProjectFolderValue(folderOptions = []) {
    return trimToEmpty(folderOptions.find((option) => option?.isCurrentProject === true)?.value);
}

/**
 * Where a new dataset goes unless the person chooses otherwise: a folder they
 * already chose, else the current project's folder, else database / other_tables.
 * A new folder is made, by default, under the same folder.
 *
 * @param {object[]} folderOptions - from buildFolderOptionsFromNodes
 * @param {string} [preferredExistingValue] - a folder the person already chose
 */
export function resolveFolderSelectionDefaults(folderOptions = [], preferredExistingValue = "") {
    const preferredValue = trimToEmpty(preferredExistingValue);
    const known = preferredValue && folderOptions.some((option) => trimToEmpty(option?.value) === preferredValue);
    const currentProjectValue = findCurrentProjectFolderValue(folderOptions);
    const canonicalOtherTablesValue = findCanonicalOtherTablesFolderValue(folderOptions);
    const existingFolderValue = (known ? preferredValue : "") || currentProjectValue || canonicalOtherTablesValue || "";
    return {
        currentProjectValue,
        canonicalOtherTablesValue,
        existingFolderValue,
        newFolderParentValue: existingFolderValue,
    };
}

/**
 * Where one dataset currently sits in the navigation tree.
 * A dataset the tree does not describe reports empty identities, so the form
 * can say so instead of moving the wrong row.
 */
export function findDatasetPlacement(nodes = [], datasetName = "") {
    const node = (Array.isArray(nodes) ? nodes : []).find(
        (candidate) => candidate?.table_uid && String(candidate?.name || "") === String(datasetName)
    );
    const parentNodeId = String(node?.parent_id || "");
    return {
        folderId: parentNodeId.startsWith("f_") ? parentNodeId.slice(2) : "",
        itemId: Number(node?.db_id) || 0,
        datasetUID: Number(node?.table_uid) || 0,
    };
}
