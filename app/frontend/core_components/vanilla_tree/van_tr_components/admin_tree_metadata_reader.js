// admin_tree_metadata_reader.js
// Normalizes and caches navigation-tree metadata and derives dataset specifications.
// Connects tree responses with the admin tree and downstream dataset presentation.
// Preserves stored media paths and visibility flags through the settings cache.

const PROJECT_CONTAINER_NAMES = new Set(['apps', 'app_projects']);
const LEGACY_OTHER_TABLES_NAME = 'other_tables';
const DATABASE_ROOT_NAME = 'database';
const TREE_CACHE_KEY = 'full_tree_data';
const TREE_CACHE_TS_KEY = 'full_tree_data_cached_at';
const TREE_CACHE_TTL_MS = 5 * 60 * 1000;

function isTreeRootParent(parentId) {
    return parentId == null || parentId === '' || parentId === 'null';
}

export function readCachedTreeData() {
    const raw = localStorage.getItem(TREE_CACHE_KEY);
    if (!raw) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
        console.warn('initializeTreeCallAdmin: failed to parse cached tree data', err);
        return null;
    }
}

export function isTreeCacheFresh() {
    const cachedAtRaw = localStorage.getItem(TREE_CACHE_TS_KEY);
    const cachedAt = Number.parseInt(cachedAtRaw || '', 10);
    if (!Number.isFinite(cachedAt) || cachedAt <= 0) {
        return false;
    }
    return (Date.now() - cachedAt) < TREE_CACHE_TTL_MS;
}

export function persistTreeCache(data) {
    localStorage.setItem(TREE_CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(TREE_CACHE_TS_KEY, String(Date.now()));
}

/** Keeps a saved media change from being undone by the cached tree on reload. */
export function syncCachedTreeDatasetMedia(datasetName, spec) {
    const data = readCachedTreeData();
    const node = Array.isArray(data?.nodes)
        ? data.nodes.find((entry) => entry.name === datasetName && entry.table_uid)
        : null;
    if (!node) return;
    for (const key of ['dataset_cover_image_path', 'dataset_cover_image_hidden',
        'dataset_background_image_path', 'dataset_background_image_hidden']) {
        if (spec[key] === undefined) delete node[key];
        else node[key] = spec[key];
    }
    try {
        // A media save does not renew the age of unrelated navigation metadata.
        localStorage.setItem(TREE_CACHE_KEY, JSON.stringify(data));
    } catch (error) {
        console.warn('dataset media: failed to update cached tree', error);
    }
}

function normalizeTreeFolderName(name) {
    return String(name || '').trim().toLowerCase();
}

function isFolderTreeNode(node) {
    return Boolean(node) && !node.table_uid && node.is_view !== true && String(node.id || '').startsWith('f_');
}

export function normalizeLegacyOtherTablesNodes(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
        return [];
    }

    const clonedNodes = nodes.map((node) => ({ ...node }));
    const databaseRootNode = clonedNodes.find((node) => (
        isFolderTreeNode(node)
        && isTreeRootParent(node.parent_id)
        && normalizeTreeFolderName(node.name) === DATABASE_ROOT_NAME
    ));
    if (!databaseRootNode) {
        return clonedNodes;
    }

    const canonicalOtherTablesNode = clonedNodes.find((node) => (
        isFolderTreeNode(node)
        && node.parent_id === databaseRootNode.id
        && normalizeTreeFolderName(node.name) === LEGACY_OTHER_TABLES_NAME
    ));
    if (!canonicalOtherTablesNode) {
        return clonedNodes;
    }

    const duplicateRootIds = new Map();
    clonedNodes.forEach((node) => {
        if (
            isFolderTreeNode(node)
            && isTreeRootParent(node.parent_id)
            && normalizeTreeFolderName(node.name) === LEGACY_OTHER_TABLES_NAME
            && node.id !== canonicalOtherTablesNode.id
        ) {
            duplicateRootIds.set(node.id, canonicalOtherTablesNode.id);
        }
    });
    if (duplicateRootIds.size === 0) {
        return clonedNodes;
    }

    return clonedNodes
        .filter((node) => !duplicateRootIds.has(node.id))
        .map((node) => {
            if (!duplicateRootIds.has(node.parent_id)) {
                return node;
            }
            return {
                ...node,
                parent_id: duplicateRootIds.get(node.parent_id),
            };
        });
}

function isFolderNode(node) {
    return Boolean(node) && !node.table_uid && node.is_view !== true;
}

export function getParentFolderNode(node, nodesById) {
    if (!node || !nodesById) return null;
    const parentId = typeof node.parent_id === 'string' ? node.parent_id : '';
    if (!parentId.startsWith('f_')) return null;
    return nodesById.get(parentId) || null;
}

function isProjectContainerNode(node) {
    if (!isFolderNode(node)) return false;
    return PROJECT_CONTAINER_NAMES.has(String(node.name || '').trim().toLowerCase());
}

function getProjectRootFolderNode(folderNode, nodesById) {
    if (!isFolderNode(folderNode) || !nodesById) return null;

    const seen = new Set();
    let currentNode = folderNode;
    while (currentNode && !seen.has(currentNode.id)) {
        seen.add(currentNode.id);
        const parentFolder = getParentFolderNode(currentNode, nodesById);
        if (!parentFolder) {
            return null;
        }
        if (isProjectContainerNode(parentFolder)) {
            return currentNode;
        }
        currentNode = parentFolder;
    }
    return null;
}

export function getFolderProjectScope(folderNode, nodesById) {
    const projectRootNode = getProjectRootFolderNode(folderNode, nodesById);
    return {
        projectRootNode,
        projectName: projectRootNode?.name || '',
        isTopLevel: Boolean(projectRootNode && folderNode && projectRootNode.id === folderNode.id),
    };
}

export function isProjectRootFolderNode(node, nodesById) {
    if (!isFolderNode(node) || !nodesById) {
        return false;
    }
    const scope = getFolderProjectScope(node, nodesById);
    return Boolean(scope.projectRootNode && scope.projectRootNode.id === node.id);
}

export function getCurrentProjectRootFolderIds(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
        return [];
    }

    const nodesById = new Map(nodes.map((node) => [String(node.id), node]));
    return nodes
        .filter((node) => node?.is_current_project === true && isProjectRootFolderNode(node, nodesById))
        .map((node) => String(node.id));
}

/** Copies the navigation metadata used by dataset pages, including image visibility. */
export function buildTreeDatasetSpecs(nodes) {
    const tableSpecsMap = {};
    nodes.forEach((node) => {
        if (node.table_uid) {
            const bannerIconUrlsByLang =
                node.banner_icon_urls_by_lang || node.banner_icons_by_lang;
            tableSpecsMap[node.name] = {
                table_uid: node.table_uid,
                default_view_name: node.default_view_name,
                filterbar_visible_by_default: node.filterbar_visible_by_default,
                ...(node.banner_icon_url
                    ? { banner_icon_url: node.banner_icon_url }
                    : {}),
                ...(bannerIconUrlsByLang
                    ? { banner_icon_urls_by_lang: bannerIconUrlsByLang }
                    : {}),
                ...(node.dataset_icon_url
                    ? { dataset_icon_url: node.dataset_icon_url }
                    : {}),
                ...(node.icon_key
                    ? { icon_key: node.icon_key }
                    : {}),
                ...(node.display_name
                    ? { display_name: node.display_name }
                    : {}),
                ...(node.search_slogan
                    ? { search_slogan: node.search_slogan }
                    : {}),
                ...(node.search_placeholder
                    ? { search_placeholder: node.search_placeholder }
                    : {}),
                ...(node.dataset_cover_image_path
                    ? { dataset_cover_image_path: node.dataset_cover_image_path,
                        dataset_cover_image_hidden: node.dataset_cover_image_hidden === true }
                    : {}),
                ...(node.dataset_background_image_path
                    ? { dataset_background_image_path: node.dataset_background_image_path,
                        dataset_background_image_hidden: node.dataset_background_image_hidden === true }
                    : {}),
            };
        }
    });
    return tableSpecsMap;
}
