// vanilla_tree_builder.js
// Builds the reusable vanilla tree component and coordinates its top-level behavior.
// Bridges tree data, checkbox-state helpers, and node rendering into a hierarchical UI widget.
// Exists to centralize tree rendering logic for navigation and admin tools without a framework dependency.

import {
    handle_checkbox_change,
    collect_checkbox_states,
    apply_checkbox_states,
    update_parent_state,
} from './van_tr_components/checkbox_state_handler.js';
import { createTreeNode } from './van_tr_components/tree_node_printer.js';
import { createCollapsibleHeightController } from '../collapsible_height/collapsible_height_controller.js';
import { wait_until_appears } from '../dom_element_checker.js';

const IS_DEV_MODE = document.querySelector('meta[name="app-env"]')?.content === 'dev';

/* ------------ pienehköt top-level-apu-funktiot (entiset) ------------- */

function getAllDescendantLeaves(nodeEl) {
    const leaves = [];
    nodeEl.querySelectorAll('.node').forEach((n) => {
        const cc = n.querySelector('.children');
        if (!cc || cc.children.length === 0) leaves.push(n.id);
    });
    return leaves;
}
function collectSelectedLeafNodesWithFolders(container) {
    const sel = [];
    container.querySelectorAll('.node').forEach((n) => {
        const cb = n.querySelector('input[type="checkbox"]');
        if (!cb) return;
        const cc = n.querySelector('.children');
        const isFolder = !!cc;
        const fully =
            isFolder &&
            cb.checked &&
            !cb.indeterminate &&
            n.getAttribute('data-folder-fully-selected') === 'true';
        if (fully) getAllDescendantLeaves(n).forEach((id) => sel.includes(id) || sel.push(id));
    });
    container
        .querySelectorAll('input[type="checkbox"]:checked')
        .forEach((cb) => {
            const n = cb.closest('.node');
            if (!n) return;
            const cc = n.querySelector('.children');
            if (cc && cc.children.length) return;
            if (!sel.includes(n.id)) sel.push(n.id);
        });
    return sel;
}

/* ==================================================================== */
/* =======================  UUSI RENDER_TREE  ========================= */
/* ==================================================================== */

export async function render_tree(data, config = {}) {

    /* ---------- vakiot & asetukset ---------- */
    const global_config = {
        container_id: config.container_id || 'vanillaTree',
        id_suffix: config.id_suffix || '',
        render_mode: config.render_mode || 'checkbox',
        selection_mode: config.selection_mode || 'multiple',
        checkbox_mode: config.checkbox_mode || 'all',
        use_icons: config.use_icons || false,
        populate_checkbox_selection: config.populate_checkbox_selection || false,
        max_recursion_depth: config.max_recursion_depth || 32,
        tree_model: config.tree_model || 'flat',
        initial_open_level: config.initial_open_level || 0,
        show_node_count: config.show_node_count !== false, // oletus true
        show_search: config.show_search !== false, // oletus true
        title_text: config.title_text || '',
        button_action_function: config.button_action_function || null,
        use_data_lang_key: config.use_data_lang_key !== false,
    };

    const { container_id, id_suffix, render_mode } = global_config;
    const search_input_id = 'tree_search' + id_suffix;

    /* ---------- juoksevat tilat ---------- */
    const nodes_to_open = [];
    let checkbox_states = {};
    let single_selection_state = '';
    let prev_expanded = null;

    /* ---------- LocalStorage-apuja ---------- */
    const lsKey = () => 'expanded_nodes' + id_suffix;
    const loadExpanded = () => {
        try {
            const raw = localStorage.getItem(lsKey());
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            if (IS_DEV_MODE) console.log(e);
            return [];
        }
    };
    const saveExpanded = (arr) => localStorage.setItem(lsKey(), JSON.stringify(arr));

    const lsCheckboxKey = () => 'checkbox_states' + id_suffix;
    const loadCheckboxStates = () => {
        try {
            const raw = localStorage.getItem(lsCheckboxKey());
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            if (IS_DEV_MODE) console.log(e);
            return {};
        }
    };
    const saveCheckboxStates = (obj) =>
        localStorage.setItem(lsCheckboxKey(), JSON.stringify(obj));

    const lsSingleSelectionKey = () => 'single_selection' + id_suffix;
    const loadSingleSelection = () => {
        try {
            return localStorage.getItem(lsSingleSelectionKey()) || '';
        } catch (e) {
            if (IS_DEV_MODE) console.log(e);
            return '';
        }
    };
    const saveSingleSelection = (nodeId) => {
        if (!nodeId) {
            localStorage.removeItem(lsSingleSelectionKey());
            return;
        }
        localStorage.setItem(lsSingleSelectionKey(), nodeId);
    };

    /* ---------- DOM-apuja ---------- */
    const getContainer = () => document.getElementById(container_id);
    const getTreeContainer = () => document.getElementById('vanillaTree' + id_suffix);
    const getSearchInput = () => document.getElementById(search_input_id);
    const getChildrenAnimator = (childContainer) =>
        createCollapsibleHeightController(childContainer, {
            startExpanded: !childContainer.hidden,
            hiddenWhenCollapsed: true,
            durationMs: 220,
        });

    const updateNodeExpandedVisuals = (nodeEl, isExpanded) => {
        const toggle = nodeEl.querySelector(':scope > .node-row > .toggle');
        if (toggle) {
            toggle.classList.toggle('rotated', isExpanded);
            toggle.setAttribute('aria-expanded', String(isExpanded));
        }
        nodeEl.dataset.expanded = isExpanded ? 'true' : 'false';
    };

    const createStructure = () => {
        const root = getContainer();
        if (!root) return null;
        root.replaceChildren();

        if (global_config.title_text) {
            const h2 = document.createElement('h2');
            h2.textContent = global_config.title_text;
            root.appendChild(h2);
        }

        let searchInput = null;
        if (global_config.show_search) {
            searchInput = document.createElement('input');
            searchInput.id = search_input_id;
            searchInput.setAttribute('placeholder', 'Search...');
            searchInput.dataset.langKey = 'search';
            root.appendChild(searchInput);
        }

        const treeDiv = document.createElement('div');
        treeDiv.id = 'vanillaTree' + id_suffix;
        treeDiv.className = 'tree-container';
        root.appendChild(treeDiv);

        return { searchInput, treeContainer: treeDiv };
    };

    /* ---------- avaa / sulje kansion lapset ---------- */
    const openChildren = (nodeEl, options = {}) => {
        const c = nodeEl.querySelector(':scope > .children');
        if (!c) return;
        const animator = getChildrenAnimator(c);
        animator.expand({ animate: options.animate !== false });
        updateNodeExpandedVisuals(nodeEl, true);
        const exp = loadExpanded();
        if (!exp.includes(nodeEl.id)) {
            exp.push(nodeEl.id);
            saveExpanded(exp);
        }
    };
    const closeChildren = (nodeEl, options = {}) => {
        const c = nodeEl.querySelector(':scope > .children');
        if (!c) return;
        const animator = getChildrenAnimator(c);
        animator.collapse({ animate: options.animate !== false });
        const exp = loadExpanded().filter((id) => id !== nodeEl.id);
        saveExpanded(exp);
        updateNodeExpandedVisuals(nodeEl, false);
    };
    const toggleChildrenVisibility = (childC, options = {}) => {
        const n = childC.closest('.node');
        if (!n) return false;
        const animator = getChildrenAnimator(childC);
        if (animator.isExpanded()) {
            closeChildren(n, options);
            return false;
        }
        openChildren(n, options);
        return true;
    };

    /* ---------- checkbox-tilojen tallennus ---------- */
    const updateCheckboxStates = () => {
        if (global_config.selection_mode === 'single') {
            const checkedRadio = getTreeContainer()?.querySelector('.node input[type="radio"]:checked');
            single_selection_state = checkedRadio?.closest('.node')?.id || '';
            saveSingleSelection(single_selection_state);
            return;
        }
        checkbox_states = collect_checkbox_states(getTreeContainer());
        saveCheckboxStates(checkbox_states);
    };
    const restoreCheckboxStates = () => {
        if (global_config.selection_mode === 'single') {
            const treeContainer = getTreeContainer();
            if (!treeContainer) return;
            treeContainer.querySelectorAll('.node input[type="radio"]').forEach((radio) => {
                const nodeId = radio.closest('.node')?.id || '';
                radio.checked = nodeId !== '' && nodeId === single_selection_state;
            });
            return;
        }
        apply_checkbox_states(checkbox_states, getTreeContainer());
    };

    const collectSelectedNodeIds = (container) => {
        if (!container) return [];
        if (global_config.selection_mode === 'single') {
            const checkedRadio = container.querySelector('.node input[type="radio"]:checked');
            const nodeId = checkedRadio?.closest('.node')?.id || '';
            return nodeId ? [nodeId] : [];
        }
        return collectSelectedLeafNodesWithFolders(container);
    };

    /* ---------- haku + folder-count ---------- */
    const filterTreeNodes = (term) => {
        const tc = getTreeContainer();
        if (!tc) return;
        if (!term) {
            tc.querySelectorAll('.node').forEach((n) => n.classList.remove('hidden'));
            return;
        }
        tc.querySelectorAll('.node').forEach((n) => {
            const el = n.querySelector('span,button');
            const txt = (el?.textContent || '').toLowerCase();
            const langKey = (el?.dataset?.langKey || '').toLowerCase();
            const searchTerm = term.toLowerCase();
            if (txt.includes(searchTerm) || langKey.includes(searchTerm)) {
                n.classList.remove('hidden');
                let p = n.parentElement?.closest('.node');
                while (p) {
                    p.classList.remove('hidden');
                    const cc = p.querySelector('.children');
                    if (cc && cc.hidden) {
                        openChildren(p, { animate: false });
                    }
                    p = p.parentElement?.closest('.node');
                }
            } else n.classList.add('hidden');
        });
    };

    const updateFolderCounts = () => {
        if (!global_config.show_node_count) return;
        const tc = getTreeContainer();
        if (!tc) return;

        const countLeaves = (n) => {
            const cc = n.querySelector(':scope > .children');
            const hidden = n.classList.contains('hidden');
            if (!cc) return hidden ? 0 : 1;
            let cnt = 0;
            cc.querySelectorAll(':scope > .node').forEach((c) => (cnt += countLeaves(c)));
            return cnt;
        };

        tc.querySelectorAll('.node > .children').forEach((c) => {
            const par = c.parentElement;
            const span = par.querySelector('.node-count');
            if (span) span.textContent = `(${countLeaves(par)})`;
        });
    };

    const restoreTreeState = () => {
        const tc = getTreeContainer();
        if (!tc) return;
        tc.querySelectorAll('.node').forEach((n) => n.classList.remove('hidden'));
        const expanded = prev_expanded || [];
        saveExpanded(expanded);
        tc.querySelectorAll('.node').forEach((n) => {
            const cc = n.querySelector('.children');
            if (!cc) return;
            if (expanded.includes(n.id)) {
                openChildren(n, { animate: false });
            } else {
                closeChildren(n, { animate: false });
            }
        });
        prev_expanded = null;
        restoreCheckboxStates();
        updateFolderCounts();
    };

    /* ---------- VARSINAINEN RENDER ---------- */
    async function doRender(treeData) {
        await wait_until_appears('#' + container_id);

        const { treeContainer } = createStructure() || {};
        if (!treeContainer) return;
        treeContainer.replaceChildren();

        const ctx = {
            global_config,
            render_mode,
            id_suffix,
            nodes_to_open,
            openChildren,
            toggleChildrenVisibility,
            handle_checkbox_change,
            collectSelectedLeafNodesWithFolders,
            update_parent_state,
            updateCheckboxStates,
        };

        let roots;
        if (global_config.tree_model === 'flat') {
            roots = buildTree(treeData);
        } else {
            roots = Array.isArray(treeData) ? treeData : [treeData];
        }

        const depth = calculateDepth(roots);
        if (depth > global_config.max_recursion_depth) {
            console.warn(
                `tree depth (${depth}) exceeds max_recursion_depth (${global_config.max_recursion_depth})`,
            );
        }

        roots.forEach((rootNode) => treeContainer.appendChild(createTreeNode(rootNode, 0, ctx)));

        restoreCheckboxStates();

        /* LS & initial open */
        setTimeout(() => {
            nodes_to_open.forEach((n) => {
                openChildren(n, { animate: false });
            });

            loadExpanded().forEach((id) => {
                const n = document.getElementById(id);
                if (!n) return;
                let anc = n.parentElement?.closest('.node');
                while (anc) {
                    if (!loadExpanded().includes(anc.id)) return;
                    anc = anc.parentElement?.closest('.node');
                }
                openChildren(n, { animate: false });
            });

            updateFolderCounts();
            const sel = collectSelectedNodeIds(treeContainer);
            document.dispatchEvent(
                new CustomEvent('checkboxSelectionChanged', {
                    detail: { selectedCategories: sel },
                }),
            );
        }, 0);

        /* haku-kenttä */
        getSearchInput()?.addEventListener('input', function () {
            updateCheckboxStates();
            const term = this.value;
            if (term) {
                if (prev_expanded === null) prev_expanded = loadExpanded();
                filterTreeNodes(term);
            } else {
                restoreTreeState();
            }
            const sel = collectSelectedNodeIds(treeContainer);
            document.dispatchEvent(
                new CustomEvent('checkboxSelectionChanged', { detail: { selectedCategories: sel } }),
            );
            if (term) updateFolderCounts();
        });
    }

    /* renderöi! */
    if (global_config.selection_mode === 'single') {
        single_selection_state = loadSingleSelection();
    } else {
        checkbox_states = loadCheckboxStates();
    }
    await doRender(data);
}

/* ---------- flat → hierarkia ---------- */
function buildTree(flat) {
    const nodes = Object.fromEntries(flat.map((n) => [n.id, { ...n, children: [] }]));
    const roots = [];
    flat.forEach((n) =>
        n.parent_id == null || n.parent_id === 'null'
            ? roots.push(nodes[n.id])
            : nodes[n.parent_id]?.children.push(nodes[n.id]),
    );
    return roots;
}

function calculateDepth(nodes) {
    let maxDepth = 0;
    const traverse = (node, depth) => {
        if (depth > maxDepth) maxDepth = depth;
        if (Array.isArray(node.children) && node.children.length) {
            node.children.forEach((c) => traverse(c, depth + 1));
        }
    };
    (Array.isArray(nodes) ? nodes : [nodes]).forEach((n) => traverse(n, 1));
    return maxDepth;
}
