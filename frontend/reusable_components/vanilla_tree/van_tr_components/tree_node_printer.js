// tree_node_printer.js
// Renders individual node DOM elements for the reusable vanilla tree.
// Bridges per-node tree data, icon helpers, and context settings into the node markup.
// Exists to keep node-level tree rendering separate from top-level tree orchestration.

import { createSvgIcon, createSvgToggle, createEmptySvg } from './tree_icon_creator.js';

const IS_DEV_MODE = document.querySelector('meta[name="app-env"]')?.content === 'dev';

/**
 * Luo yhden .node-elementin Vanilla-puuhun (rekursiivinen).
 *
 * @param {Object}  nodeData puun tämän solmun data
 * @param {number}  level     syvyystaso (root = 0)
 * @param {Object}  ctx       injektoidut apu-/asetearvot, ks. render_tree
 */
export function createTreeNode(nodeData, level, ctx) {

    const {
        global_config,
        render_mode,
        id_suffix,
        nodes_to_open,
        // openChildren,
        toggleChildrenVisibility,
        handle_checkbox_change,
        collectSelectedLeafNodesWithFolders,
        update_parent_state,
        updateCheckboxStates,
    } = ctx;

    const treeContainer = document.getElementById('vanillaTree' + id_suffix);
    if (!treeContainer) {
        const ph = document.createElement('div');
        ph.textContent = '[vanilla tree placeholder]';
        return ph;
    }

    const normalizedSuffix = id_suffix.replace(/^_+/, '');
    const testIdPrefix = normalizedSuffix ? `${normalizedSuffix}-tree` : 'tree';

    /* ---------- runko ---------- */
    const nodeEl = document.createElement('div');
    nodeEl.className = 'node';
    nodeEl.id = 'tree_node_' + nodeData.id + id_suffix;
    nodeEl.dataset.testid = `${testIdPrefix}-node-${nodeData.id}`;
    nodeEl.setAttribute('data-db-id', nodeData.db_id);
    nodeEl.setAttribute('data-node-id', nodeData.id);
    if (nodeData.table_uid) {
        nodeEl.setAttribute('data-table-uid', nodeData.table_uid);
    }

    const hasChildren = Array.isArray(nodeData.children) && nodeData.children.length > 0;
    // A node is a folder if it has children OR if it lacks table_uid (backend
    // gives folders f_-prefixed IDs and no table_uid). This ensures empty
    // folders are still treated as folders for drag-drop and context menus.
    // Database views (is_view=true) are leaf nodes, not folders.
    // Explicit is_leaf=true (e.g. admin tools) overrides the heuristic.
    const isFolder = hasChildren || (!nodeData.table_uid && !nodeData.is_view && !nodeData.is_leaf);
    nodeEl.setAttribute('data-is-folder', isFolder ? 'true' : 'false');

    const row = document.createElement('div');
    row.className = 'node-row';

    /* ---------- toggle-ikoni ---------- */
    const toggleWrap = document.createElement('div');
    toggleWrap.classList.add('toggle');
    if (isFolder) {
        toggleWrap.dataset.testid = 'tree-toggle';
        toggleWrap.setAttribute('aria-expanded', 'false');
    }

    if (isFolder) {
        const t = createSvgToggle();
        toggleWrap.appendChild(t);
        toggleWrap.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const childC = nodeEl.querySelector('.children');
            if (childC) {
                toggleChildrenVisibility(childC);
            }
        });
    } else {
        toggleWrap.appendChild(createEmptySvg());
    }
    row.appendChild(toggleWrap);

    /* ---------- checkbox / button ---------- */
    const isLeaf = !isFolder;
    const inputType =
        render_mode === 'checkbox' && global_config.selection_mode === 'single'
            ? 'radio'
            : 'checkbox';
    const shouldHaveCheckbox =
        render_mode === 'checkbox' &&
        (global_config.checkbox_mode === 'all' ||
            (global_config.checkbox_mode === 'leaf' && isLeaf));

    const setLang = (el, val) => {
        if (global_config.use_data_lang_key && el) el.dataset.langKey = val;
    };

    if (shouldHaveCheckbox) {
        const cb = document.createElement('input');
        cb.type = inputType;
        cb.dataset.testid = 'tree-checkbox';
        cb.setAttribute('data-indeterminate', 'false');
        cb.style.margin = '0 10px 0 5px';
        if (inputType === 'radio') {
            cb.name = 'vanilla_tree_selection' + id_suffix;
        }
        row.appendChild(cb);

        cb.addEventListener('change', (e) => {
            if (inputType === 'radio') {
                if (!cb.checked) return;
                updateCheckboxStates();
            } else {
                handle_checkbox_change(e);
                updateCheckboxStates();

                /* kansioiden “täysin valittu” -status */
                const currentNode = e.target.closest('.node');
                const childCont = currentNode.querySelector('.children');
                const isFolderNode = !!childCont;

                if (isFolderNode) {
                    if (cb.checked && !cb.indeterminate) currentNode.setAttribute('data-folder-fully-selected', 'true');
                    else currentNode.removeAttribute('data-folder-fully-selected');
                } else {
                    let anc = currentNode.parentElement?.closest('.node');
                    while (anc) {
                        const ancCb = anc.querySelector('input[type="checkbox"]');
                        if (ancCb) update_parent_state(ancCb);
                        anc = anc.parentElement?.closest('.node');
                    }
                }
            }

            const sel = inputType === 'radio'
                ? [nodeEl.id]
                : collectSelectedLeafNodesWithFolders(treeContainer);
            document.dispatchEvent(
                new CustomEvent('checkboxSelectionChanged', { detail: { selectedCategories: sel } }),
            );
        });
    } else if (render_mode === 'button' && isLeaf) {
        const btn = document.createElement('button');
        btn.textContent = nodeData.name;
        btn.dataset.testid = `${testIdPrefix}-btn-${nodeData.id}`;
        setLang(btn, nodeData.name);
        btn.style.marginRight = '10px';
        btn.className = 'general_button' + id_suffix;
        btn.addEventListener('click', (evt) => {
            evt.stopPropagation();
            if (typeof global_config.button_action_function === 'function') {
                global_config.button_action_function(nodeData);
            } else if (IS_DEV_MODE) console.log('klikattiin nappia:', nodeData.name);
        });
        row.appendChild(btn);
    }

    /* ---------- mahdollinen kansio-ikoni ---------- */
    if (global_config.use_icons) {
        const iconW = document.createElement('div');
        iconW.classList.add('icon');
        iconW.appendChild(createSvgIcon());
        row.appendChild(iconW);
    }

    /* ---------- otsikko + lasten määrä ---------- */
    if (!(render_mode === 'button' && isLeaf)) {
        const labelWrap = document.createElement('span');
        
        // Make folder labels clickable to toggle expansion
        if (isFolder) {
            labelWrap.dataset.testid = `${testIdPrefix}-folder-${nodeData.id}`;
            labelWrap.style.cursor = 'pointer';
            labelWrap.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                try {
                    const childC = nodeEl.querySelector('.children');
                    if (childC) {
                        toggleChildrenVisibility(childC);
                    }
                } catch (err) {
                    console.warn('Error toggling folder:', err);
                }
            });
        }

        if (!isFolder) {
            labelWrap.dataset.testid = `${testIdPrefix}-label-${nodeData.id}`;
        }

        const label = document.createElement('span');
        label.textContent = nodeData.name;
        setLang(label, nodeData.name);
        labelWrap.appendChild(label);

        if (global_config.show_node_count && isFolder) {
            const c = document.createElement('span');
            c.className = 'node-count';
            c.style.cssText = 'margin-left:5px;font-size:0.9em;color:#666;';
            labelWrap.appendChild(c);
        }
        row.appendChild(labelWrap);
    } else if (render_mode === 'button' && isLeaf) {
        // If it's a button mode leaf, we don't add the label here because it was added as a button above.
        // However, the original code structure was:
        // if (shouldHaveCheckbox) { ... } else if (render_mode === 'button' && isLeaf) { ... }
        // AND THEN:
        // if (!(render_mode === 'button' && isLeaf)) { ... label ... }
        
        // So if it IS a button leaf, we skip this block.
        // But wait, the button logic above adds the button to 'row'.
        // The label logic adds a label to 'row'.
        // So for button leaves, we have a button. For others, we have a label.
    }

    nodeEl.appendChild(row);

    /* ---------- klikkaus koko riviltä ---------- */
    row.addEventListener('click', (ev) => {
        if (
            ev.target.closest('.toggle') ||
            ['input', 'button'].includes(ev.target.tagName.toLowerCase())
        )
            return;
        ev.preventDefault();
        ev.stopPropagation();

        // If we clicked the label (which has its own handler), we shouldn't be here due to stopPropagation.
        // But if we clicked empty space in the row, we toggle.
        
        const childC = nodeEl.querySelector('.children');
        if (childC) {
            toggleChildrenVisibility(childC);
        }

        if (render_mode === 'checkbox') {
            const cb = row.querySelector('input[type="checkbox"], input[type="radio"]');
            if (cb) {
                if (cb.type === 'radio') {
                    cb.checked = true;
                } else {
                    cb.indeterminate ? (cb.indeterminate = false) : (cb.checked = !cb.checked);
                }
                cb.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });

    /* ---------- rekursio ---------- */
    if (isFolder) {
        const childC = document.createElement('div');
        childC.className = 'children';
        childC.dataset.testid = 'tree-children';
        childC.hidden = true;
        childC.style.height = '0px';
        childC.style.overflow = 'hidden';

        if (hasChildren) {
            nodeData.children.forEach((cd) => childC.appendChild(createTreeNode(cd, level + 1, ctx)));
        }
        nodeEl.appendChild(childC);

        if (level < global_config.initial_open_level) nodes_to_open.push(nodeEl);
    }

    return nodeEl;
}
