// child_tab_config_view.js
// Renders the admin view for managing reverse-FK tab ordering and visibility.
// Bridges tree selection, referring-tab metadata, and sortable visibility controls into one editor.
// Exists to give admins a dedicated workflow for configuring how referring records appear in the article view.

import { endpoint_router } from '../endpoints/endpoint_router.js';
import { fetchChildTabConfig, saveChildTabConfig } from '../endpoints/stable_endpoint_router.js';
import { showSuccessToast, showInfoToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import { showConfirmModal } from '../../reusable_components/modal/confirm_modal_builder.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import { render_tree } from '../../reusable_components/vanilla_tree/vanilla_tree_builder.js';
import { format_column_name } from '../table_views/card_view/card_field_formatter.js';
import { filterNonMediaChildTables } from '../table_views/card_view/row_article_asset_resolver.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { extractFirstSelectedTableName } from './tree_selection_helpers.js';

/** @typedef {import('../../generated/go_contract_types').ChildTabConfigRow} ChildTabConfigRow */
/**
 * @typedef {object} ChildTabConfigDraft
 * @property {string} tab_key
 * @property {number} tab_order
 * @property {boolean} hidden
 */

export async function generate_child_tab_config_form(container) {
    if (!container) return;
    container.replaceChildren();

    let editMode = false;
    let currentTableName = null;
    /** @type {ChildTabConfigDraft[]} */
    let tabsData = [];
    /** @type {ChildTabConfigDraft[]} */
    let originalData = [];
    let dirty = false;

    // --- Top wrapper with mode buttons
    const containerWithModeButtons = document.createElement('div');
    containerWithModeButtons.classList.add('mp-container-with-mode-buttons');

    const modeButtonsContainer = document.createElement('div');
    modeButtonsContainer.classList.add('mp-mode-buttons-container');

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.dataset.langKey = 'edit';
    editButton.classList.add('mp-button');
    modeButtonsContainer.appendChild(editButton);

    containerWithModeButtons.appendChild(modeButtonsContainer);

    // --- Main wrapper (grid: 300px left + 1fr right)
    const mainWrapper = document.createElement('div');
    mainWrapper.classList.add('mp-main-wrapper');
    mainWrapper.style.gridTemplateColumns = '300px 1fr';

    containerWithModeButtons.appendChild(mainWrapper);

    // --- Left panel
    const leftContainer = document.createElement('div');
    leftContainer.classList.add('mp-left-container');

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.dataset.langKey = 'save';
    saveButton.classList.add('mp-button', 'mp-disabled');
    saveButton.disabled = true;

    const tableSelectorTreeContainer = document.createElement('div');
    tableSelectorTreeContainer.classList.add('mp-table-selector-tree-container');

    const tableSelectorTree = document.createElement('div');
    tableSelectorTree.id = 'ctc_table_selector_tree';
    tableSelectorTreeContainer.appendChild(tableSelectorTree);

    leftContainer.appendChild(editButton);
    leftContainer.appendChild(saveButton);
    leftContainer.appendChild(tableSelectorTreeContainer);

    mainWrapper.appendChild(leftContainer);

    // --- Right panel: tab list
    const listContainer = document.createElement('div');
    listContainer.id = 'ctc_list_container';
    listContainer.classList.add('mp-permission-form');
    mainWrapper.appendChild(listContainer);

    container.appendChild(containerWithModeButtons);

    // --- Render tree using cached data
    const rawTreeData = localStorage.getItem('full_tree_data');
    if (rawTreeData) {
        try {
            const treeData = JSON.parse(rawTreeData);
            if (treeData && treeData.nodes) {
                await render_tree(treeData.nodes, {
                    container_id: 'ctc_table_selector_tree',
                    id_suffix: '_ctc_tree',
                    render_mode: 'checkbox',
                    selection_mode: 'single',
                    checkbox_mode: 'leaf',
                    use_icons: false,
                    populate_checkbox_selection: false,
                    max_recursion_depth: 32,
                    tree_model: 'flat',
                    initial_open_level: 1,
                    show_node_count: true,
                    show_search: true,
                    use_data_lang_key: true,
                });
            }
        } catch (err) {
            console.warn('child_tab_config_view: failed to parse tree data', err);
        }
    }

    // --- Edit mode toggle
    function setEditMode(on) {
        editMode = on;
        editButton.dataset.langKey = on ? 'stop_editing' : 'edit';
        saveButton.disabled = !on;
        if (on) {
            saveButton.classList.remove('mp-disabled');
        } else {
            saveButton.classList.add('mp-disabled');
        }
        renderList();
    }

    editButton.addEventListener('click', async () => {
        if (editMode) {
            if (dirty) {
                const save = await showConfirmModal({
                    messagePlainText: 'Tallenna muutokset ennen muokkauksen lopettamista?',
                    messageLangKey: 'confirm_save_child_tab_config',
                });
                if (save) {
                    await doSave();
                } else {
                    tabsData = JSON.parse(JSON.stringify(originalData));
                    dirty = false;
                }
            }
            setEditMode(false);
        } else {
            setEditMode(true);
        }
    });

    // --- Save button
    saveButton.addEventListener('click', async () => {
        if (!editMode) {
            showInfoToast(getTranslationForKey('start_editing_hint') || 'Aloita muokkaus painamalla Edit');
            return;
        }
        await doSave();
    });

    async function doSave() {
        if (!currentTableName || tabsData.length === 0) return;
        try {
            await saveChildTabConfig({
                parent_table: currentTableName,
                tabs: tabsData,
            });
            originalData = JSON.parse(JSON.stringify(tabsData));
            dirty = false;
            showSuccessToast(getTranslationForKey('saved') || 'Tallennettu');
            setEditMode(false);
        } catch (err) {
            console.warn('child_tab_config_view: save failed', err);
        }
    }

    // --- Load reverse-FK tab candidates + existing config for selected parent table
    async function loadConfigForTable(tableName) {
        currentTableName = tableName;
        tabsData = [];
        originalData = [];
        dirty = false;
        renderList();

        try {
            // Fetch FK-discovered tables that refer to the selected parent table.
            const dynResponse = await endpoint_router('fetchDynamicChildren', {
                method: 'POST',
                url_params: `?dataset=${encodeURIComponent(tableName)}`,
                body_data: {
                    parent_dataset: tableName,
                    metadata_only: true,
                },
            });

            const referringDatasets = filterNonMediaChildTables(dynResponse?.child_tables || []).map(c => c.dataset);
            // Deduplicate because the same dataset can refer to the parent through multiple FKs.
            const uniqueKeys = [...new Set(referringDatasets)];
            // Always include __comments
            uniqueKeys.push('__comments');

            // Fetch existing config
            const existingConfigRaw = await fetchChildTabConfig(tableName);
            /** @type {Record<string, ChildTabConfigRow>} */
            const configMap = {};
            /** @type {ChildTabConfigRow[]} */
            const existingConfig = Array.isArray(existingConfigRaw) ? existingConfigRaw : [];
            existingConfig.forEach(c => {
                configMap[c.tab_key] = c;
            });

            // Merge: use existing config where available, fill defaults for the rest
            tabsData = uniqueKeys.map((key, idx) => {
                if (configMap[key]) {
                    return {
                        tab_key: key,
                        tab_order: configMap[key].tab_order,
                        hidden: configMap[key].hidden,
                    };
                }
                return {
                    tab_key: key,
                    tab_order: idx * 10,
                    hidden: false,
                };
            });

            // Sort by tab_order
            tabsData.sort((a, b) => a.tab_order - b.tab_order);
            // Re-index orders to be sequential
            tabsData.forEach((t, i) => { t.tab_order = i * 10; });

            originalData = JSON.parse(JSON.stringify(tabsData));
        } catch (err) {
            console.warn('child_tab_config_view: failed to load config', err);
            tabsData = [];
            originalData = [];
        }
        renderList();
    }

    // getTranslationForKey() already supports fallbacks in app runtime.
    // The extra key echo guard keeps the copy stable in isolated tests that
    // intentionally mock translation lookups by returning the raw key.
    function getPreferredUiText(key, fiFallback, enFallback) {
        const fallback = getLanguageWithBrowserFallback() === 'fi'
            ? fiFallback
            : enFallback;
        const translated = getTranslationForKey(key, { fallback });
        return translated === key ? fallback : translated;
    }

    // --- Render the sortable list
    function renderList() {
        listContainer.replaceChildren();

        if (!currentTableName) {
            listContainer.classList.add('mp-placeholder-state');

            const instructions = document.createElement('div');
            instructions.classList.add('cv-instructions');

            const title = document.createElement('strong');
            title.textContent = getPreferredUiText(
                'referring_tab_config_title',
                'Viittaavien välilehtien asetukset',
                'Referring tab settings'
            );
            instructions.appendChild(title);

            const ol = document.createElement('ol');
            const steps = [
                getPreferredUiText(
                    'referring_tab_step_1',
                    'Valitse taulu vasemmasta puurakenteesta.',
                    'Select a table from the tree on the left.'
                ),
                getPreferredUiText(
                    'referring_tab_step_2',
                    'Paina Edit aloittaaksesi muokkauksen.',
                    'Press Edit to start configuring the tabs.'
                ),
                getPreferredUiText(
                    'referring_tab_step_3',
                    'Vedä rivejä järjestääksesi viittaavat välilehdet uudelleen.',
                    'Drag rows to reorder the referring tabs.'
                ),
                getPreferredUiText(
                    'referring_tab_step_4',
                    'Paina silmäkuvaketta piilottaaksesi tai näyttääksesi välilehden.',
                    'Click the eye icon to hide or show a tab.'
                ),
                getPreferredUiText(
                    'referring_tab_step_5',
                    'Paina Save tallentaaksesi muutokset.',
                    'Press Save to store the changes.'
                ),
            ];
            steps.forEach(text => {
                const li = document.createElement('li');
                li.textContent = text;
                ol.appendChild(li);
            });
            instructions.appendChild(ol);
            listContainer.appendChild(instructions);
            return;
        }

        if (tabsData.length === 0) {
            listContainer.classList.add('mp-placeholder-state');
            const msg = document.createElement('div');
            msg.classList.add('cv-instructions');
            msg.textContent = getPreferredUiText(
                'no_referring_tabs',
                'Ei viittaavia välilehtiä tälle taululle.',
                'No referring tabs for this table.'
            );
            listContainer.appendChild(msg);
            return;
        }

        listContainer.classList.remove('mp-placeholder-state');

        // Header row
        const header = document.createElement('div');
        header.classList.add('ctc-header');
        const orderHeader = document.createElement('span');
        orderHeader.classList.add('ctc-col-order');
        orderHeader.textContent = '#';
        header.appendChild(orderHeader);

        const nameHeader = document.createElement('span');
        nameHeader.classList.add('ctc-col-name');
        nameHeader.textContent = getTranslationForKey('tab_name') || 'Välilehti';
        header.appendChild(nameHeader);

        const visibleHeader = document.createElement('span');
        visibleHeader.classList.add('ctc-col-visible');
        visibleHeader.textContent = getTranslationForKey('visible') || 'Näkyvissä';
        header.appendChild(visibleHeader);
        listContainer.appendChild(header);

        let dragSrcIdx = null;

        tabsData.forEach((tab, idx) => {
            const row = document.createElement('div');
            row.classList.add('ctc-row');
            if (tab.hidden) row.classList.add('ctc-row-hidden');
            row.dataset.idx = idx;

            // Order number
            const orderSpan = document.createElement('span');
            orderSpan.classList.add('ctc-col-order');
            orderSpan.textContent = idx + 1;
            row.appendChild(orderSpan);

            // Tab name
            const nameSpan = document.createElement('span');
            nameSpan.classList.add('ctc-col-name');
            if (tab.tab_key === '__comments') {
                nameSpan.textContent = getTranslationForKey('comments') || 'Kommentit';
            } else {
                nameSpan.textContent = format_column_name(tab.tab_key);
            }
            row.appendChild(nameSpan);

            // Visibility toggle
            const visSpan = document.createElement('span');
            visSpan.classList.add('ctc-col-visible');

            if (editMode) {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = !tab.hidden;
                checkbox.addEventListener('change', () => {
                    tabsData[idx].hidden = !checkbox.checked;
                    dirty = true;
                    renderList();
                });
                visSpan.appendChild(checkbox);
            } else {
                visSpan.textContent = tab.hidden ? '—' : '✓';
            }
            row.appendChild(visSpan);

            // Drag support in edit mode
            if (editMode) {
                row.draggable = true;
                row.classList.add('ctc-draggable');

                row.addEventListener('dragstart', (e) => {
                    dragSrcIdx = idx;
                    row.classList.add('ctc-dragging');
                    e.dataTransfer.effectAllowed = 'move';
                });

                row.addEventListener('dragend', () => {
                    row.classList.remove('ctc-dragging');
                    dragSrcIdx = null;
                });

                row.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    row.classList.add('ctc-drag-over');
                });

                row.addEventListener('dragleave', () => {
                    row.classList.remove('ctc-drag-over');
                });

                row.addEventListener('drop', (e) => {
                    e.preventDefault();
                    row.classList.remove('ctc-drag-over');
                    if (dragSrcIdx === null || dragSrcIdx === idx) return;

                    // Move item
                    const moved = tabsData.splice(dragSrcIdx, 1)[0];
                    tabsData.splice(idx, 0, moved);
                    // Re-index orders
                    tabsData.forEach((t, i) => { t.tab_order = i * 10; });
                    dirty = true;
                    renderList();
                });
            }

            listContainer.appendChild(row);
        });
    }

    // --- Tree selection listener
    const listenerController = new AbortController();
    container.__cleanupListeners = () => listenerController.abort();

    document.addEventListener('checkboxSelectionChanged', async (e) => {
        const selectedCategories = e.detail.selectedCategories;
        const tableName = extractFirstSelectedTableName(selectedCategories);

        if (!tableName) {
            if (dirty) {
                const save = await showConfirmModal({
                    messagePlainText: 'Tallenna muutokset ennen taulun vaihtoa?',
                    messageLangKey: 'confirm_save_child_tab_config',
                });
                if (save) {
                    await doSave();
                } else {
                    dirty = false;
                }
            }
            currentTableName = null;
            tabsData = [];
            originalData = [];
            dirty = false;
            renderList();
            return;
        }

        if (tableName === currentTableName) return;

        if (dirty) {
            const save = await showConfirmModal({
                messagePlainText: 'Tallenna muutokset ennen taulun vaihtoa?',
                messageLangKey: 'confirm_save_child_tab_config',
            });
            if (save) {
                await doSave();
            } else {
                tabsData = JSON.parse(JSON.stringify(originalData));
                dirty = false;
            }
        }

        await loadConfigForTable(tableName);
    }, { signal: listenerController.signal });

    // Initial state: show placeholder
    renderList();
}
