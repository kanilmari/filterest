// admin_tree_builder.js
// Initializes admin navigation and permission-selector trees.
// Bridges admin page data and DOM containers and drag-and-drop and context-menu tree interactions.
// Exists to consolidate admin tree setup, rendering, and related callbacks in one module.
//
// Exports:
//   initializeTreeCallAdmin() — called at page load; renders nav_tree, sets up d&d/context menu
//   renderTableSelectorTree() — renders the checkbox tree into #table_selector_tree on demand
//                                (called by manage_permissions.js after creating the container)

import { render_tree } from "../../../reusable_components/vanilla_tree/vanilla_tree_builder.js";
import { custom_views } from "../../navigation/admin_and_user_tools/custom_view_reader.js";
import { handle_all_navigation } from "../../navigation/nav_engine/navigation_handler.js";
import { initTabs } from "../../navigation/main_tabs/main_tab_printer.js";
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { hasDatasetPermission, hasRoutePermission } from "../../route_permission_checker.js";
import { openRenameDialog } from "./tree_node_rename_editor.js";
import { loadDatabaseView } from "../../database_view_fetcher.js";
import { showConfirmModal, showInputModal } from "../../../reusable_components/modal/confirm_modal_builder.js";
import { setAllSpecs } from "../../state_stores/table_specs_reader.js";
import { showAccessDeniedToast, showErrorToast, showSuccessToast } from "../../../reusable_components/notifications/toast_notification_printer.js";

// Shared config for the table-selector (permissions) checkbox tree.
const TABLE_SELECTOR_TREE_CONFIG = {
    container_id: "table_selector_tree",
    id_suffix: "_table_rights",
    render_mode: "checkbox",
    checkbox_mode: "all",
    use_icons: false,
    populate_checkbox_selection: false,
    max_recursion_depth: 32,
    tree_model: "flat",
    initial_open_level: 1,
    show_node_count: true,
    show_search: true,
    use_data_lang_key: true,
};

const PROJECT_CONTAINER_NAMES = new Set(['apps', 'app_projects']);
const LEGACY_OTHER_TABLES_NAME = 'other_tables';
const DATABASE_ROOT_NAME = 'database';
const TREE_CACHE_KEY = 'full_tree_data';
const TREE_CACHE_TS_KEY = 'full_tree_data_cached_at';
const TREE_CACHE_TTL_MS = 5 * 60 * 1000;

function isTreeRootParent(parentId) {
    return parentId == null || parentId === '' || parentId === 'null';
}

function readCachedTreeData() {
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

function isTreeCacheFresh() {
    const cachedAtRaw = localStorage.getItem(TREE_CACHE_TS_KEY);
    const cachedAt = Number.parseInt(cachedAtRaw || '', 10);
    if (!Number.isFinite(cachedAt) || cachedAt <= 0) {
        return false;
    }
    return (Date.now() - cachedAt) < TREE_CACHE_TTL_MS;
}

function persistTreeCache(data) {
    localStorage.setItem(TREE_CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(TREE_CACHE_TS_KEY, String(Date.now()));
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

function getParentFolderNode(node, nodesById) {
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

function getFolderProjectScope(folderNode, nodesById) {
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

export function decorateCurrentProjectFolderBadges(treeContainer, currentProjectFolderIds) {
    if (!(treeContainer instanceof HTMLElement)) {
        return;
    }

    treeContainer.querySelectorAll('.tree-current-project-badge').forEach((badge) => badge.remove());
    treeContainer.querySelectorAll('.node[data-current-project="true"]').forEach((nodeEl) => {
        nodeEl.removeAttribute('data-current-project');
    });

    if (!Array.isArray(currentProjectFolderIds) || currentProjectFolderIds.length === 0) {
        return;
    }

    currentProjectFolderIds.forEach((nodeId) => {
        const nodeEl = treeContainer.querySelector(`.node[data-node-id="${nodeId}"]`);
        if (!(nodeEl instanceof HTMLElement)) {
            return;
        }

        const row = nodeEl.querySelector('.node-row');
        if (!(row instanceof HTMLElement)) {
            return;
        }

        const labelWrap = Array.from(row.children).find((child) => child.tagName === 'SPAN');
        if (!(labelWrap instanceof HTMLElement)) {
            return;
        }

        const badge = document.createElement('span');
        badge.className = 'tree-current-project-badge';
        badge.dataset.testid = 'current-project-badge';
        badge.dataset.langKey = 'current';
        badge.textContent = 'Current';
        labelWrap.appendChild(badge);
        nodeEl.setAttribute('data-current-project', 'true');
    });
}

export function describeTreeMoveImpact({ draggedNode, targetFolderNode, nodesById }) {
    if (!draggedNode || !targetFolderNode || !nodesById) {
        return null;
    }

    const isTable = Boolean(draggedNode.table_uid);
    const sourceFolderNode = isTable ? getParentFolderNode(draggedNode, nodesById) : draggedNode;
    const sourceScope = getFolderProjectScope(sourceFolderNode, nodesById);
    const targetScope = getFolderProjectScope(targetFolderNode, nodesById);
    const sourceProjectId = sourceScope.projectRootNode?.id || null;
    const targetProjectId = targetScope.projectRootNode?.id || null;
    const crossProjectBoundary = sourceProjectId !== targetProjectId;

    return {
        itemType: isTable ? 'table' : 'folder',
        itemName: String(draggedNode.name || '').trim(),
        sourceProjectName: sourceScope.projectName,
        targetProjectName: targetScope.projectName,
        crossProjectBoundary,
        changesTopTabVisibility: isTable &&
            !crossProjectBoundary &&
            Boolean(sourceProjectId || targetProjectId) &&
            sourceScope.isTopLevel !== targetScope.isTopLevel,
        targetWillBeVisibleInTabs: isTable && targetScope.isTopLevel,
    };
}

export function buildMoveConfirmationModalOptions(moveImpact) {
    if (!moveImpact) {
        return null;
    }

    if (moveImpact.crossProjectBoundary) {
        const fromProject = moveImpact.sourceProjectName;
        const toProject = moveImpact.targetProjectName;
        let message = `Move ${moveImpact.itemType} "${moveImpact.itemName}" across a project boundary?`;
        if (fromProject && toProject) {
            message = `Move ${moveImpact.itemType} "${moveImpact.itemName}" from project "${fromProject}" to project "${toProject}"?`;
        } else if (fromProject) {
            message = `Move ${moveImpact.itemType} "${moveImpact.itemName}" out of project "${fromProject}"?`;
        } else if (toProject) {
            message = `Move ${moveImpact.itemType} "${moveImpact.itemName}" into project "${toProject}"?`;
        }
        if (moveImpact.itemType === 'folder') {
            message += ' All tables inside the folder move with it.';
        } else {
            message += ' This changes which project includes the table.';
        }

        return {
            modalOptions: {
                titlePlainText: 'Move to another project?',
                messagePlainText: message,
                confirmText: 'Move',
                isDanger: true,
            },
            confirmFlags: {
                confirm_cross_project_move: true,
                confirm_tab_visibility_change: false,
            },
        };
    }

    if (moveImpact.itemType === 'table' && moveImpact.changesTopTabVisibility) {
        const message = moveImpact.targetWillBeVisibleInTabs
            ? `Move table "${moveImpact.itemName}" to the project root? It will appear in the project's main SVG tabs.`
            : `Move table "${moveImpact.itemName}" into a subfolder? It will stay in the project but disappear from the project's main SVG tabs.`;

        return {
            modalOptions: {
                titlePlainText: 'Change tab visibility?',
                messagePlainText: message,
                confirmText: 'Move',
            },
            confirmFlags: {
                confirm_cross_project_move: false,
                confirm_tab_visibility_change: true,
            },
        };
    }

    return null;
}

export function buildCreateSubfolderInputModalOptions() {
    return {
        titleLangKey: 'create_subfolder',
        titlePlainText: 'Create subfolder',
        labelLangKey: 'folder_name',
        labelPlainText: 'Folder name:',
        confirmLangKey: 'create_subfolder',
        confirmText: 'Create subfolder',
        cancelLangKey: 'cancel',
        cancelText: 'Cancel',
    };
}

/**
 * Renders the checkbox tree into #table_selector_tree using cached data from localStorage.
 * Called by manage_permissions.js after it creates the container element.
 * Safe to call at any time — returns silently if no cached data is available.
 */
export async function renderTableSelectorTree() {
    const data = readCachedTreeData();
    if (data?.nodes) {
        await render_tree(normalizeLegacyOtherTablesNodes(data.nodes), { ...TABLE_SELECTOR_TREE_CONFIG });
    }
}

/**
 * Kutsutaan vain, jos käyttäjällä on oikeus nav_tree-näkymään. Luo ja piirtää puut, sekä hoitaa mm. drag-and-dropin.
 */
export async function initializeTreeCallAdmin({ forceRefresh = false } = {}) {
    if (!hasRoutePermission('/ui/nav_tree')) {
        return;
    }

    let tableNodesByDbId = new Map();
    let treeNodesById = new Map();
    
    // Drag-and-drop -funktio
    async function enable_drag_and_drop_for_folders_and_tables(refreshCallback) {
        const canMoveFolders = hasRoutePermission('/api/update-folder');
        const canMoveTables = hasRoutePermission('/api/update-table-folder');
        if (!canMoveFolders && !canMoveTables) {
            return;
        }

        // Etsitään kaikki .node-elementit (#nav_tree)
        const all_nodes = document.querySelectorAll("#nav_tree .node");

        all_nodes.forEach((node_element) => {
            // Onko kansio
            const isFolder = node_element.getAttribute("data-is-folder") === "true";
            // Kantatietueen dbId
            const dbIdStr = node_element.getAttribute("data-db-id");
            const nodeIdStr = node_element.getAttribute("data-node-id");
            const canDragNode = isFolder ? canMoveFolders : canMoveTables;

            if (canDragNode) {
                node_element.setAttribute("draggable", "true");
            } else {
                node_element.removeAttribute("draggable");
            }

            // 2) dragstart
            if (canDragNode) {
                node_element.addEventListener("dragstart", (event) => {
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = "move";

                    // Asetetaan data: node_db_id & node_type
                    event.dataTransfer.setData("node_db_id", dbIdStr);
                    event.dataTransfer.setData("node_id", nodeIdStr);
                    event.dataTransfer.setData("node_type", isFolder ? "folder" : "table");

                });
            }

            // 3) dragover — sallitaan kaikille nodeille (kansio ja taulu)
            // Jos kohde on taulu, etsitään DOM-puusta lähin isäkansio.
            node_element.addEventListener("dragover", (event) => {
                event.stopPropagation();
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
            });

            // 4) drop — toimii sekä kansio- että taulunodeille.
            // Kansio: siirretään suoraan tähän kansioon.
            // Taulu: etsitään DOM-puusta lähin isäkansio ja siirretään sinne naapuriksi.
            node_element.addEventListener("drop", async (event) => {
                event.stopPropagation();
                event.preventDefault();

                const draggedNodeDbIdStr = event.dataTransfer.getData("node_db_id");
                const draggedNodeIdStr = event.dataTransfer.getData("node_id");
                const draggedNodeType = event.dataTransfer.getData("node_type");

                // Etsitään kohdekansio: jos pudotettiin kansion päälle, käytetään sitä.
                // Jos pudotettiin taulun päälle, etsitään lähin isäkansio DOM-puusta.
                let targetFolderNode = null;
                if (isFolder) {
                    targetFolderNode = node_element;
                } else {
                    // Taulu on kansion .children-divin sisällä → etsitään lähin isä-.node[data-is-folder="true"]
                    targetFolderNode = node_element.parentElement?.closest('.node[data-is-folder="true"]');
                }

                if (!targetFolderNode) {
                    console.warn('[drop] Kohdekansioita ei löytynyt DOM-puusta');
                    return;
                }

                const targetFolderDbIdStr = targetFolderNode.getAttribute("data-db-id");
                const targetFolderNodeIdStr = targetFolderNode.getAttribute("data-node-id");

                // Jos yritetään pudottaa kansiota itseensä
                if (draggedNodeIdStr === targetFolderNodeIdStr && draggedNodeType === "folder") {
                    return;
                }

                // Jos raahattu node on jo tässä kansiossa, ei tehdä mitään
                if (!isFolder) {
                    const draggedNode = document.querySelector(`#nav_tree .node[data-node-id="${draggedNodeIdStr}"]`);
                    if (draggedNode) {
                        const draggedParentFolder = draggedNode.parentElement?.closest('.node[data-is-folder="true"]');
                        if (draggedParentFolder === targetFolderNode) {
                            return;
                        }
                    }
                }

                const draggedIdNum = parseInt(draggedNodeDbIdStr, 10);
                const folderIdNum = parseInt(targetFolderDbIdStr, 10);
                const draggedNodeData = treeNodesById.get(draggedNodeIdStr);
                const targetFolderData = treeNodesById.get(targetFolderNodeIdStr);
                if (!draggedNodeData || !targetFolderData) {
                    console.warn('[drop] Missing tree metadata for move', { draggedNodeIdStr, targetFolderNodeIdStr });
                    return;
                }

                const moveImpact = describeTreeMoveImpact({
                    draggedNode: draggedNodeData,
                    targetFolderNode: targetFolderData,
                    nodesById: treeNodesById,
                });
                const moveConfirmation = buildMoveConfirmationModalOptions(moveImpact);
                let confirmFlags = {
                    confirm_cross_project_move: false,
                    confirm_tab_visibility_change: false,
                };
                if (moveConfirmation) {
                    const confirmed = await showConfirmModal(moveConfirmation.modalOptions);
                    if (!confirmed) {
                        return;
                    }
                    confirmFlags = moveConfirmation.confirmFlags;
                }

                try {
                    if (draggedNodeType === "folder") {
                        if (!canMoveFolders) {
                            showAccessDeniedToast('/api/update-folder');
                            return;
                        }
                        await endpoint_router('updateFolder', {
                            method: 'POST',
                            body_data: {
                                item_id: draggedIdNum,
                                item_type: draggedNodeType,
                                new_folder_id: folderIdNum,
                                ...confirmFlags,
                            },
                        });
                    } else {
                        if (!canMoveTables) {
                            showAccessDeniedToast('/api/update-table-folder');
                            return;
                        }

                        const draggedTableNode = tableNodesByDbId.get(draggedNodeDbIdStr);
                        if (!draggedTableNode || !draggedTableNode.table_uid) {
                            console.warn('[drop] Missing table metadata for table move', draggedNodeDbIdStr);
                            return;
                        }

                        const hasTableMoveRight = await hasDatasetPermission('/api/update-table-folder', draggedTableNode.name);
                        if (!hasTableMoveRight) {
                            showAccessDeniedToast('/api/update-table-folder');
                            return;
                        }

                        await endpoint_router('updateTableFolder', {
                            method: 'POST',
                            body_data: {
                                item_id: draggedIdNum,
                                item_type: draggedNodeType,
                                dataset_uid: parseInt(draggedTableNode.table_uid, 10),
                                dataset_name: draggedTableNode.name,
                                new_folder_id: folderIdNum,
                                ...confirmFlags,
                            },
                        });
                    }
                    if (typeof refreshCallback === 'function') await refreshCallback();
                } catch (err) {
                    console.warn("Virhe pudotuksessa:", err);
                }
            });
        });
    }
    // Kontekstivalikko: "Luo alikansio", "Poista kansio", "Nimeä uudelleen"
    // Toimii sekä kansio- että taulunodeilla (rename kaikille, create/delete vain kansioille)
    function enable_tree_context_menu(refreshCallback) {
        const canCreate = hasRoutePermission('/api/create-folder');
        const canDelete = hasRoutePermission('/api/delete-folder');
        const canRename = hasRoutePermission('/api/rename-tree-node');
        const canSetCurrentProject = hasRoutePermission('/api/set-current-project-folder');
        if (!canCreate && !canDelete && !canRename && !canSetCurrentProject) return;

        const allNodes = document.querySelectorAll("#nav_tree .node");

        // Poista mahdollinen vanha kontekstivalikko klikatessa muualle
        document.addEventListener('click', () => {
            const existing = document.querySelector('.tree-context-menu');
            if (existing) existing.remove();
        });

        allNodes.forEach(nodeEl => {
            const isFolder = nodeEl.getAttribute("data-is-folder") === "true";
            // Kansioille: create, delete, rename. Tauluille: vain rename.
            if (!isFolder && !canRename) return;

            nodeEl.addEventListener('contextmenu', (e) => {
                // Alt+rightclick → let it bubble to dev lang key editor
                if (e.altKey) return;
                e.preventDefault();
                e.stopPropagation();

                // Poistetaan mahdollinen vanha valikko
                const existing = document.querySelector('.tree-context-menu');
                if (existing) existing.remove();

                const dbId = parseInt(nodeEl.getAttribute("data-db-id"), 10);
                const nodeId = nodeEl.getAttribute("data-node-id");
                const nodeData = nodeId ? (treeNodesById.get(String(nodeId)) || null) : null;
                // Haetaan noden nimi data-lang-key -attribuutista tai tekstisisällöstä
                const nameEl = nodeEl.querySelector('[data-lang-key]');
                const currentName = nameEl ? nameEl.getAttribute('data-lang-key') : '';

                const menu = document.createElement('div');
                menu.className = 'tree-context-menu';
                menu.dataset.testid = 'admin-tree-context-menu';
                menu.setAttribute('role', 'menu');
                menu.style.position = 'fixed';
                menu.style.left = e.clientX + 'px';
                menu.style.top = e.clientY + 'px';
                menu.style.background = 'var(--bg_color_2)';
                menu.style.color = 'var(--text_color)';
                menu.style.border = '1px solid var(--border_color)';
                menu.style.borderRadius = '4px';
                menu.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
                menu.style.zIndex = '9999';
                menu.style.padding = '4px 0';
                menu.style.minWidth = '160px';

                // Apufunktio kontekstivalikon rivin luomiseen
                function addMenuItem(text, langKey, onClick, color = '') {
                    const item = document.createElement('div');
                    item.textContent = text;
                    item.dataset.langKey = langKey;
                    item.dataset.testid = `admin-tree-menu-${langKey}`;
                    item.setAttribute('role', 'menuitem');
                    item.style.padding = '6px 16px';
                    item.style.cursor = 'pointer';
                    if (color) item.style.color = color;
                    item.addEventListener('mouseenter', () => item.style.background = 'var(--button_hover_bg_color)');
                    item.addEventListener('mouseleave', () => item.style.background = '');
                    item.addEventListener('click', async () => { menu.remove(); await onClick(); });
                    menu.appendChild(item);
                }

                // "Nimeä uudelleen" — kansioille ja tauluille
                if (canRename) {
                    addMenuItem('Rename', 'rename', async () => {
                        const renamed = await openRenameDialog({
                            itemId: dbId,
                            itemType: isFolder ? 'folder' : 'table',
                            currentName: currentName,
                        });
                        if (renamed && typeof refreshCallback === 'function') {
                            await refreshCallback();
                        }
                    });
                }

                if (isFolder && canSetCurrentProject && isProjectRootFolderNode(nodeData, treeNodesById)) {
                    addMenuItem('Set as current project', 'set_as_current_project', async () => {
                        try {
                            const response = await endpoint_router('setCurrentProjectFolder', {
                                method: 'POST',
                                body_data: { folder_id: dbId },
                            });
                            if (typeof refreshCallback === 'function') {
                                await refreshCallback();
                            }
                            await initTabs({ dataAlreadyLoaded: false });
                            showSuccessToast(response?.message || `Current project set to ${nodeData?.name || currentName || 'selected folder'}`);
                        } catch (err) {
                            console.warn('Error setting current project:', err);
                            showErrorToast(err?.message || 'Setting current project failed');
                        }
                    });
                }

                // "Luo alikansio" — vain kansioille
                if (isFolder && canCreate) {
                    addMenuItem('Create subfolder', 'create_subfolder', async () => {
                        const folderName = await showInputModal(buildCreateSubfolderInputModalOptions());
                        if (!folderName || !folderName.trim()) return;
                        try {
                            await endpoint_router('createFolder', {
                                method: 'POST',
                                body_data: { folder_name: folderName.trim(), parent_id: dbId }
                            });
                            if (typeof refreshCallback === 'function') await refreshCallback();
                        } catch (err) {
                            console.warn('Error creating folder:', err);
                        }
                    });
                }

                // "Poista kansio" — vain kansioille
                if (isFolder && canDelete) {
                    addMenuItem('Delete folder', 'delete_folder', async () => {
                        const ok = await showConfirmModal({
                            messagePlainText: 'Delete this folder? Only empty folders can be deleted.',
                            messageLangKey: 'confirm_delete_folder',
                            isDanger: true,
                        });
                        if (!ok) return;
                        try {
                            await endpoint_router('deleteFolder', {
                                method: 'POST',
                                body_data: { folder_id: dbId }
                            });
                            if (typeof refreshCallback === 'function') await refreshCallback();
                        } catch (err) {
                            console.warn('Error deleting folder:', err);
                        }
                    }, 'var(--danger-color, #c00)');
                }

                document.body.appendChild(menu);
            });
        });
    }

    // ── Hakee puun datan ja piirtää molemmat puut + liittää drag & drop ja kontekstivalikon ──
    async function applyTreeData(treeResponse) {
        const data = {
            ...treeResponse,
            nodes: normalizeLegacyOtherTablesNodes(treeResponse?.nodes),
        };
        const currentProjectFolderIds = getCurrentProjectRootFolderIds(data.nodes);
        tableNodesByDbId = new Map(
            data.nodes
                .filter((node) => node.table_uid)
                .map((node) => [String(node.db_id), node])
        );
        treeNodesById = new Map(
            data.nodes.map((node) => [String(node.id), node])
        );

        // Tallennetaan koko vastaus localStorageen
        persistTreeCache(data);

        // Kerätään taulujen table_uid + default_view_name + filterbar oletus
        const tableSpecsMap = {};
        data.nodes.forEach((node) => {
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
                };
            }
        });
        setAllSpecs(tableSpecsMap);

        // 1) Piirretään navigointipuu
        await render_tree(data.nodes, {
            container_id: "nav_tree",
            id_suffix: "_nav",
            render_mode: "button",
            checkbox_mode: "none",
            use_icons: false,
            populate_checkbox_selection: false,
            max_recursion_depth: 32,
            tree_model: "flat",
            initial_open_level: 0,
            show_node_count: false,
            show_search: true,
            use_data_lang_key: true,
            button_action_function: async (nodeData) => {
                if (nodeData.is_view) {
                    // Database views use a dedicated loader instead of the normal table flow
                    await handleDatabaseViewNavigation(nodeData.name);
                } else {
                    await handle_all_navigation(nodeData.name, custom_views);
                }
            },
        });
        decorateCurrentProjectFolderBadges(document.getElementById('nav_tree'), currentProjectFolderIds);

        // 2) Drag & drop
        await enable_drag_and_drop_for_folders_and_tables(refreshNavTree);
        // 3) Kontekstivalikko (kansion luonti/poisto/uudelleennimeäminen)
        enable_tree_context_menu(refreshNavTree);
        // 4) Piirretään toinen puu (checkbox-käyttöoikeudet) – vain jos konttaineri on jo DOMissa.
        //    Jos ei ole (käyttäjä ei ole avannut Permissions-sivua), manage_permissions.js
        //    kutsuu renderTableSelectorTree() elementin luonnin jälkeen.
        if (document.getElementById('table_selector_tree')) {
            render_tree(data.nodes, { ...TABLE_SELECTOR_TREE_CONFIG });
        }
    }

    async function refreshNavTree() {
        const treeResponse = await endpoint_router('fetchTreeData');
        await applyTreeData(treeResponse);
    }

    try {
        const cachedTreeData = readCachedTreeData();
        const cacheIsFresh = Boolean(cachedTreeData?.nodes?.length) && isTreeCacheFresh();
        let appliedCachedTree = false;
        if (cacheIsFresh) {
            await applyTreeData(cachedTreeData);
            appliedCachedTree = true;
            if (!forceRefresh && isTreeCacheFresh()) {
                return;
            }
        }

        try {
            await refreshNavTree();
        } catch (error) {
            if (!appliedCachedTree && cachedTreeData?.nodes?.length) {
                await applyTreeData(cachedTreeData);
            }
            throw error;
        }
    } catch (error) {
        console.warn("Virhe:", error);
    }
}

/**
 * Navigates to a database view (PostgreSQL view) using the dedicated view loader.
 * Handles URL update, active button highlighting, and container visibility
 * similarly to the normal table navigation flow.
 *
 * @param {string} viewName - Name of the database view to load
 */
async function handleDatabaseViewNavigation(viewName) {
    const containerId = `dbview_${viewName}_container`;

    // Update URL
    history.pushState({}, '', `/${viewName}`);

    // Update active button highlighting
    const allButtons = document.querySelectorAll('.general_button_nav, .general_button_admin');
    allButtons.forEach(btn => {
        if (btn.dataset.langKey === viewName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Hide all other content containers
    const allContainers = document.querySelectorAll('#tabs_container > .content_div');
    allContainers.forEach(c => c.classList.add('hidden'));

    // Load and show the view data
    await loadDatabaseView(viewName);

    const container = document.getElementById(containerId);
    if (container) {
        container.classList.remove('hidden');
    }
}
