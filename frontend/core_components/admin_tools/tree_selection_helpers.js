// tree_selection_helpers.js
// Filters checkbox-tree selections down to concrete dataset nodes for admin tools.
// Bridges generic vanilla-tree node ids and the permission/card/child-tab editors
// that only operate on real tables, not folders or database views.
// Exists to keep dataset-only selection rules centralized instead of duplicating DOM checks in each editor.

function readNodeTableName(nodeEl) {
    if (!nodeEl) return null;
    if (!nodeEl.getAttribute('data-table-uid')) return null;

    const labelEl = nodeEl.querySelector('span[data-lang-key], button[data-lang-key]');
    const tableName = labelEl?.getAttribute('data-lang-key')?.trim();
    return tableName || null;
}

export function extractSelectedTableNames(selectedNodeIds, root = document) {
    if (!Array.isArray(selectedNodeIds) || selectedNodeIds.length === 0) {
        return [];
    }

    const names = [];
    selectedNodeIds.forEach((nodeId) => {
        const tableName = readNodeTableName(root.getElementById(nodeId));
        if (!tableName || names.includes(tableName)) {
            return;
        }
        names.push(tableName);
    });
    return names;
}

export function extractFirstSelectedTableName(selectedNodeIds, root = document) {
    return extractSelectedTableNames(selectedNodeIds, root)[0] || null;
}
