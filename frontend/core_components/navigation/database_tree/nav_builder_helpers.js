// nav_builder_helpers.js
// Pure helper functions extracted from nav_builder.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Group an array of view objects by their `group` property.
 *
 * @param {Array<{group: string, name: string}>} views - Array of view definitions
 * @returns {Object<string, Array>} Views grouped by group name
 */
export function groupViewsByGroup(views) {
    const groups = {};
    views.forEach(view => {
        if (!groups[view.group]) {
            groups[view.group] = [];
        }
        groups[view.group].push(view);
    });
    return groups;
}

/**
 * Recursively collect all node IDs from a tree structure.
 *
 * @param {Array<{id: string, children?: Array}>} nodes - Tree nodes
 * @returns {Set<string>} Set of all node IDs in the tree
 */
export function collectNodeIds(nodes) {
    const ids = new Set();
    function walk(nodeList) {
        nodeList.forEach(node => {
            ids.add(node.id);
            if (node.children) {
                walk(node.children);
            }
        });
    }
    walk(nodes);
    return ids;
}

function findNodeById(nodes, targetId) {
    for (const node of nodes) {
        if (node.id === targetId) {
            return node;
        }
        if (Array.isArray(node.children)) {
            const nestedMatch = findNodeById(node.children, targetId);
            if (nestedMatch) {
                return nestedMatch;
            }
        }
    }
    return null;
}

/**
 * Append admin views that are not already present in the structure
 * into the 'maintenance' subtree, sorted alphabetically.
 * Mutates the structure in-place.
 *
 * @param {Array<{id: string, children?: Array}>} structure - The admin tools tree structure
 * @param {Array<{name: string}>} views - All admin views from backend
 */
export function appendMissingAdminViews(structure, views) {
    const knownIds = collectNodeIds(structure);
    const maintenanceNode = findNodeById(structure, 'maintenance');

    if (!maintenanceNode || !maintenanceNode.children) {
        return;
    }

    const missingViews = views
        .filter(view => !knownIds.has(view.name))
        .sort((left, right) => left.name.localeCompare(right.name));

    missingViews.forEach(view => {
        maintenanceNode.children.push({
            id: view.name,
            name: view.name,
        });
    });
}

/**
 * Return the static admin tools tree structure.
 * This defines the ideal hierarchy of admin tool navigation items.
 * Each node's `name` is a translation key.
 *
 * @returns {Array<{id: string, name: string, children?: Array}>}
 */
export function getAdminToolsStructure() {
    return [
        { id: 'permissions', name: 'permissions' },
        { id: 'queen_chat', name: 'queen_chat' },
        {
            id: 'table_tools', name: 'table_tools', children: [
                { id: 'create_table', name: 'create_table' },
                { id: 'foreign_keys', name: 'foreign_keys' },
                { id: 'asset_linking', name: 'asset_linking' },
                { id: 'card_visibility', name: 'card_visibility' },
                { id: 'service_catalog_moderation', name: 'service_catalog_moderation' },
                { id: 'child_tab_config', name: 'child_tab_config' },
                { id: 'dataset_alias_management', name: 'dataset_alias_management' },
                { id: 'dataset_header_config', name: 'dataset_header_config' },
            ]
        },
        {
            id: 'maintenance', name: 'maintenance', children: [
                { id: 'add_notification_trigger', name: 'add_notification_trigger' },
                { id: 'refresh_embeddings', name: 'refresh_embeddings' },
                { id: 'check_json_columns', name: 'check_json_columns' },
                { id: 'database_consistency', name: 'database_consistency' },
                { id: 'empty_rows', name: 'empty_rows' },
                { id: 'fix_media_subfolders', name: 'fix_media_subfolders' },
                { id: 'fk_cache_triggers', name: 'fk_cache_triggers' },
                { id: 'translation_helper', name: 'translation_helper' },
                { id: 'text_index_maintenance', name: 'text_index_maintenance' },
            ],
        },
    ];
}
