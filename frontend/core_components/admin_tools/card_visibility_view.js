// card_visibility_view.js
// Renders the admin view for managing per-column card visibility flags.
// Bridges visibility configuration endpoints, tree selection, and the reusable checkbox-table editor.
// Exists to give admins a dedicated place to control what fields appear in card views.

import { fetchCardVisibility, saveCardVisibility } from '../endpoints/stable_endpoint_router.js';
import { showSuccessToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import { showConfirmModal } from '../../reusable_components/modal/confirm_modal_builder.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { render_tree } from '../../reusable_components/vanilla_tree/vanilla_tree_builder.js';
import { createVanillaCheckboxTable } from '../../reusable_components/vanilla_checkbox_table/index.js';
import { extractFirstSelectedTableName } from './tree_selection_helpers.js';
import {
    CARD_DETAILS_LAYOUT_OPTIONS,
    CARD_DETAILS_LAYOUT_VALUES,
    CARD_STYLE_VARIANT_OPTIONS,
    CARD_STYLE_VARIANT_VALUES,
    normalizeClientCardDetailsLayout,
    normalizeClientCardStyleVariant,
} from '../table_views/card_view/card_detail_layout_options.js';
import { getCardDetailIconOptions } from '../table_views/card_view/card_detail_icon_builder.js';

/** @typedef {import('../../generated/go_contract_types').CardVisibilityColumn} CardVisibilityColumn */
/** @typedef {import('../../generated/go_contract_types').CardVisibilityResponse} CardVisibilityResponse */

const CARD_ELEMENT_OPTIONS = [
    'details',
    'header',
    'header+lang_key',
    'image',
    'description1',
    'description1+lang_key',
    'description2',
    'description2+lang_key',
];

const CARD_DETAIL_LABEL_MODE_OPTIONS = [
    'label',
    'icon',
    'both',
];

const VISIBILITY_FLAGS = [
    { key: 'card_element',               type: 'select', options: CARD_ELEMENT_OPTIONS },
    { key: 'card_detail_capitalization', type: 'checkbox' },
    { key: 'show_key_on_card',           type: 'checkbox' },
    { key: 'show_value_on_card',         type: 'checkbox' },
    { key: 'hide_everywhere',            type: 'checkbox' },
    { key: 'hide_on_small_card',         type: 'checkbox' },
    { key: 'hide_false_null_on_sml_crd', type: 'checkbox' },
    { key: 'hide_false_null_on_big_crd', type: 'checkbox' },
    { key: 'hide_on_bg_crd_if_not_own',  type: 'checkbox' },
    { key: 'hide_in_filter_panel',       type: 'checkbox' },
    { key: 'card_detail_label_mode',     type: 'select', options: CARD_DETAIL_LABEL_MODE_OPTIONS },
    { key: 'card_detail_icon_key',       type: 'select', options: getCardDetailIconOptions() },
    { key: 'card_detail_icon_svg',       type: 'text', width: '18rem' },
];

function getCardDetailsLayoutLabel(value) {
    const normalizedValue = normalizeClientCardDetailsLayout(value);
    return CARD_DETAILS_LAYOUT_OPTIONS.find((option) => option.value === normalizedValue)?.label
        || normalizedValue;
}

function getCardStyleVariantLabel(value) {
    const normalizedValue = normalizeClientCardStyleVariant(value);
    return CARD_STYLE_VARIANT_OPTIONS.find((option) => option.value === normalizedValue)?.label
        || normalizedValue;
}

function cloneColumnsData(columns) {
    return JSON.parse(JSON.stringify(Array.isArray(columns) ? columns : []));
}

function buildDraftStorageKey(tableName) {
    return `card_visibility_draft_${tableName}`;
}

function getCardVisibilityUiText(key, fiFallback, enFallback) {
    const fallback = getLanguageWithBrowserFallback() === 'fi'
        ? fiFallback
        : enFallback;
    const translated = getTranslationForKey(key, { fallback });
    return translated === key ? fallback : translated;
}

function buildEditorColumns() {
    const normalizeSelectOptions = (options) => options.map((option) => {
        if (option && typeof option === 'object') {
            return {
                value: option.value,
                label: option.label || option.value,
            };
        }
        return { value: option, label: option };
    });

    return [
        {
            key: 'column_name',
            label: getTranslationForKey('column_name') || 'Column',
            type: 'static',
            editable: false,
            className: 'cv-column-name',
            width: '12rem',
            minWidth: '12rem',
            maxWidth: '12rem',
        },
        ...VISIBILITY_FLAGS.map((flag) => ({
            key: flag.key,
            label: getTranslationForKey(flag.key) || flag.key,
            type: flag.type,
            width: flag.width || (flag.type === 'select' ? '8.5rem' : '6.25rem'),
            minWidth: flag.width || (flag.type === 'select' ? '8.5rem' : '6.25rem'),
            maxWidth: flag.width || (flag.type === 'select' ? '8.5rem' : '6.25rem'),
            options: flag.type === 'select' && Array.isArray(flag.options)
                ? normalizeSelectOptions(flag.options)
                : [],
        })),
    ];
}

function renderInstructions(matrixContainer) {
    matrixContainer.replaceChildren();
    matrixContainer.classList.add('mp-placeholder-state');
    matrixContainer.style.display = 'block';
    matrixContainer.style.gridTemplateColumns = '';

    const instructions = document.createElement('div');
    instructions.classList.add('cv-instructions');

    const title = document.createElement('strong');
    title.textContent = getCardVisibilityUiText(
        'card_visibility',
        'Korttien näkyvyysasetukset',
        'Card visibility settings'
    );
    instructions.appendChild(title);

    const ol = document.createElement('ol');
    const steps = [
        getCardVisibilityUiText(
            'card_visibility_step_select_dataset',
            'Valitse datasetti vasemman reunan puurakenteesta.',
            'Select a dataset from the tree on the left.'
        ),
        getCardVisibilityUiText(
            'card_visibility_step_start_editing',
            'Aloita muokkaus.',
            'Start editing.'
        ),
        getCardVisibilityUiText(
            'card_visibility_step_adjust_columns',
            'Muuta sarakkeiden näkyvyysasetuksia editorissa.',
            'Adjust column visibility in the editor.'
        ),
        getCardVisibilityUiText(
            'card_visibility_step_save_changes',
            'Tallenna muutokset.',
            'Save the changes.'
        ),
    ];
    steps.forEach((text) => {
        const li = document.createElement('li');
        li.textContent = text;
        ol.appendChild(li);
    });
    instructions.appendChild(ol);
    matrixContainer.appendChild(instructions);
}

function renderNoColumnsMessage(matrixContainer) {
    matrixContainer.replaceChildren();
    matrixContainer.classList.add('mp-placeholder-state');
    matrixContainer.style.display = 'block';
    matrixContainer.style.gridTemplateColumns = '';

    const noColumnsMessage = document.createElement('div');
    noColumnsMessage.classList.add('cv-instructions');
    noColumnsMessage.dataset.langKey = 'no_columns_found';
    noColumnsMessage.textContent = getTranslationForKey('no_columns_found') || 'No columns found for this table.';
    matrixContainer.appendChild(noColumnsMessage);
}

function renderLoadingMessage(matrixContainer) {
    matrixContainer.replaceChildren();
    matrixContainer.classList.add('mp-placeholder-state');
    matrixContainer.style.display = 'block';
    matrixContainer.style.gridTemplateColumns = '';

    const loadingMessage = document.createElement('div');
    loadingMessage.classList.add('cv-instructions');
    loadingMessage.textContent = getTranslationForKey('loading') || 'Loading...';
    matrixContainer.appendChild(loadingMessage);
}

function addCardVisibilityTestIds(matrixContainer) {
    const editButton = matrixContainer.querySelector('.vct-btn-edit');
    const saveButton = matrixContainer.querySelector('.vct-btn-save');
    const cancelButton = matrixContainer.querySelector('.vct-btn-cancel');

    if (editButton instanceof HTMLButtonElement) {
        editButton.dataset.testid = 'card-visibility-edit-button';
    }
    if (saveButton instanceof HTMLButtonElement) {
        saveButton.dataset.testid = 'card-visibility-save-button';
    }
    if (cancelButton instanceof HTMLButtonElement) {
        cancelButton.dataset.testid = 'card-visibility-cancel-button';
    }
}

export async function generate_card_visibility_form(container) {
    if (!container) return;
    container.replaceChildren();

    let currentTableName = null;
    /** @type {CardVisibilityColumn[]} */
    let columnsData = [];
    /** @type {CardVisibilityColumn[]} */
    let originalData = [];
    let cardDetailsLayout = CARD_DETAILS_LAYOUT_VALUES.CONDITIONAL_MULTILINE;
    let originalCardDetailsLayout = CARD_DETAILS_LAYOUT_VALUES.CONDITIONAL_MULTILINE;
    let cardStyleVariant = CARD_STYLE_VARIANT_VALUES.STANDARD;
    let originalCardStyleVariant = CARD_STYLE_VARIANT_VALUES.STANDARD;
    let checkboxTable = null;
    let layoutSelect = null;
    let styleVariantSelect = null;
    let layoutSaveButton = null;
    let layoutStatus = null;
    let loadRequestSequence = 0;

    const containerWithModeButtons = document.createElement('div');
    containerWithModeButtons.classList.add('mp-container-with-mode-buttons');

    const mainWrapper = document.createElement('div');
    mainWrapper.classList.add('mp-main-wrapper');
    mainWrapper.style.gridTemplateColumns = '300px 1fr';
    containerWithModeButtons.appendChild(mainWrapper);

    const leftContainer = document.createElement('div');
    leftContainer.classList.add('mp-left-container');

    const tableSelectorTreeContainer = document.createElement('div');
    tableSelectorTreeContainer.classList.add('mp-table-selector-tree-container');

    const tableSelectorTree = document.createElement('div');
    tableSelectorTree.id = 'cv_table_selector_tree';
    tableSelectorTreeContainer.appendChild(tableSelectorTree);
    leftContainer.appendChild(tableSelectorTreeContainer);

    const matrixContainer = document.createElement('div');
    matrixContainer.id = 'cv_matrix_container';
    matrixContainer.classList.add('mp-permission-form');

    mainWrapper.appendChild(leftContainer);
    mainWrapper.appendChild(matrixContainer);
    container.appendChild(containerWithModeButtons);

    function unmountCheckboxTable() {
        matrixContainer.replaceChildren();
        checkboxTable = null;
        layoutSelect = null;
        styleVariantSelect = null;
        layoutSaveButton = null;
        layoutStatus = null;
    }

    function isLayoutDirty() {
        return (
            normalizeClientCardDetailsLayout(cardDetailsLayout) !==
                normalizeClientCardDetailsLayout(originalCardDetailsLayout)
            || normalizeClientCardStyleVariant(cardStyleVariant) !==
                normalizeClientCardStyleVariant(originalCardStyleVariant)
        );
    }

    function hasPendingChanges() {
        return Boolean(checkboxTable?.isDirty?.()) || isLayoutDirty();
    }

    function syncLayoutControls() {
        if (layoutSelect instanceof HTMLSelectElement) {
            layoutSelect.value = normalizeClientCardDetailsLayout(cardDetailsLayout);
        }
        if (styleVariantSelect instanceof HTMLSelectElement) {
            styleVariantSelect.value = normalizeClientCardStyleVariant(cardStyleVariant);
        }
        if (layoutSaveButton instanceof HTMLButtonElement) {
            layoutSaveButton.disabled = !isLayoutDirty();
        }
        if (layoutStatus instanceof HTMLElement) {
            layoutStatus.textContent = isLayoutDirty()
                ? getTranslationForKey('unsaved_changes') || 'Unsaved changes'
                : `${getTranslationForKey('current_layout') || 'Current'}: ${getCardDetailsLayoutLabel(cardDetailsLayout)}, ${getCardStyleVariantLabel(cardStyleVariant)}`;
            layoutStatus.dataset.state = isLayoutDirty() ? 'dirty' : 'clean';
        }
    }

    function discardDraftChanges() {
        if (checkboxTable) {
            checkboxTable.cancelChanges();
        }
        columnsData = cloneColumnsData(originalData);
        cardDetailsLayout = normalizeClientCardDetailsLayout(originalCardDetailsLayout);
        cardStyleVariant = normalizeClientCardStyleVariant(originalCardStyleVariant);
        syncLayoutControls();
    }

    async function persistCardVisibility(
        nextRows,
        nextLayout = cardDetailsLayout,
        nextStyleVariant = cardStyleVariant
    ) {
        if (!currentTableName) return;

        const normalizedLayout = normalizeClientCardDetailsLayout(nextLayout);
        const normalizedStyleVariant = normalizeClientCardStyleVariant(nextStyleVariant);
        const response = await saveCardVisibility({
            table_name: currentTableName,
            card_details_layout: normalizedLayout,
            card_style_variant: normalizedStyleVariant,
            columns: nextRows,
        });
        columnsData = cloneColumnsData(nextRows);
        originalData = cloneColumnsData(nextRows);
        cardDetailsLayout = normalizedLayout;
        cardStyleVariant = normalizedStyleVariant;
        originalCardDetailsLayout = normalizedLayout;
        originalCardStyleVariant = normalizedStyleVariant;
        localStorage.removeItem(`${currentTableName}_dataTypes`);
        localStorage.removeItem(`${currentTableName}_tableMeta`);
        syncLayoutControls();
        const message = response?.message || getTranslationForKey('saved') || 'Saved';
        showSuccessToast(message);
    }

    function createCardDetailsLayoutPanel() {
        const panel = document.createElement('div');
        panel.classList.add('cv-layout-panel');

        const label = document.createElement('label');
        label.classList.add('cv-layout-label');
        label.htmlFor = 'cv_card_details_layout_select';
        label.textContent = getTranslationForKey('card_details_layout') || 'Card details layout';

        layoutSelect = document.createElement('select');
        layoutSelect.id = 'cv_card_details_layout_select';
        layoutSelect.classList.add('cv-layout-select');
        layoutSelect.dataset.testid = 'card-details-layout-select';
        CARD_DETAILS_LAYOUT_OPTIONS.forEach((option) => {
            const optionNode = document.createElement('option');
            optionNode.value = option.value;
            optionNode.textContent = getTranslationForKey(option.value) || option.label;
            layoutSelect.appendChild(optionNode);
        });
        layoutSelect.addEventListener('change', () => {
            cardDetailsLayout = normalizeClientCardDetailsLayout(layoutSelect.value);
            syncLayoutControls();
        });

        const styleLabel = document.createElement('label');
        styleLabel.classList.add('cv-layout-label');
        styleLabel.htmlFor = 'cv_card_style_variant_select';
        styleLabel.textContent = getTranslationForKey('card_style_variant') || 'Card style';

        styleVariantSelect = document.createElement('select');
        styleVariantSelect.id = 'cv_card_style_variant_select';
        styleVariantSelect.classList.add('cv-layout-select');
        styleVariantSelect.dataset.testid = 'card-style-variant-select';
        CARD_STYLE_VARIANT_OPTIONS.forEach((option) => {
            const optionNode = document.createElement('option');
            optionNode.value = option.value;
            optionNode.textContent = getTranslationForKey(option.value) || option.label;
            styleVariantSelect.appendChild(optionNode);
        });
        styleVariantSelect.addEventListener('change', () => {
            cardStyleVariant = normalizeClientCardStyleVariant(styleVariantSelect.value);
            syncLayoutControls();
        });

        layoutSaveButton = document.createElement('button');
        layoutSaveButton.type = 'button';
        layoutSaveButton.classList.add('mp-button', 'cv-layout-save-button');
        layoutSaveButton.dataset.testid = 'card-details-layout-save-button';
        layoutSaveButton.textContent = getTranslationForKey('save') || 'Save';
        layoutSaveButton.addEventListener('click', () => {
            void doSave();
        });

        layoutStatus = document.createElement('span');
        layoutStatus.classList.add('cv-layout-status');

        panel.appendChild(label);
        panel.appendChild(layoutSelect);
        panel.appendChild(styleLabel);
        panel.appendChild(styleVariantSelect);
        panel.appendChild(layoutSaveButton);
        panel.appendChild(layoutStatus);
        syncLayoutControls();
        return panel;
    }

    function mountCheckboxTable() {
        unmountCheckboxTable();
        matrixContainer.classList.remove('mp-placeholder-state');
        matrixContainer.style.display = 'block';
        matrixContainer.style.gridTemplateColumns = '';
        matrixContainer.style.width = '100%';
        matrixContainer.style.minWidth = '0';
        matrixContainer.style.overflowX = 'auto';

        const layoutPanel = createCardDetailsLayoutPanel();
        const tableHost = document.createElement('div');
        tableHost.classList.add('cv-column-settings-table');
        matrixContainer.appendChild(layoutPanel);
        matrixContainer.appendChild(tableHost);

        checkboxTable = createVanillaCheckboxTable({
            containerElement: tableHost,
            columns: buildEditorColumns(),
            rows: columnsData,
            rowIdKey: 'column_uid',
            storageKey: currentTableName ? buildDraftStorageKey(currentTableName) : '',
            editLabel: getTranslationForKey('edit') || 'Edit',
            saveLabel: getTranslationForKey('save') || 'Save',
            cancelLabel: getTranslationForKey('cancel') || 'Cancel',
            dirtyLabel: getTranslationForKey('unsaved_changes') || 'Unsaved changes',
            cleanLabel: '',
            onSave: async ({ rows }) => {
                await persistCardVisibility(rows, cardDetailsLayout);
            },
        });

        addCardVisibilityTestIds(matrixContainer);
    }

    async function doSave() {
        if (!checkboxTable) {
            if (isLayoutDirty()) {
                await persistCardVisibility(columnsData, cardDetailsLayout);
            }
            return true;
        }

        try {
            let didSave = false;
            if (checkboxTable.isDirty()) {
                didSave = await checkboxTable.saveChanges();
            } else if (isLayoutDirty()) {
                await persistCardVisibility(columnsData, cardDetailsLayout);
                didSave = true;
            }
            columnsData = checkboxTable.getRows();
            originalData = cloneColumnsData(columnsData);
            return didSave || !hasPendingChanges();
        } catch (err) {
            console.warn('card_visibility_view: save failed', err);
            return false;
        }
    }

    async function confirmBeforeContextChange() {
        if (!hasPendingChanges()) {
            return true;
        }

        const save = await showConfirmModal({
            messagePlainText: 'Save changes before switching tables?',
            messageLangKey: 'confirm_save_card_visibility',
        });

        if (save) {
            return doSave();
        }

        discardDraftChanges();
        return true;
    }

    async function loadColumnsForTable(tableName) {
        const requestSequence = ++loadRequestSequence;
        currentTableName = tableName;
        columnsData = [];
        originalData = [];
        cardDetailsLayout = CARD_DETAILS_LAYOUT_VALUES.CONDITIONAL_MULTILINE;
        originalCardDetailsLayout = CARD_DETAILS_LAYOUT_VALUES.CONDITIONAL_MULTILINE;
        cardStyleVariant = CARD_STYLE_VARIANT_VALUES.STANDARD;
        originalCardStyleVariant = CARD_STYLE_VARIANT_VALUES.STANDARD;
        renderLoadingMessage(matrixContainer);

        try {
            const response = /** @type {CardVisibilityResponse | CardVisibilityColumn[]} */ (await fetchCardVisibility(tableName));
            if (requestSequence !== loadRequestSequence) {
                return;
            }
            columnsData = Array.isArray(response) ? response : (response.columns || []);
            cardDetailsLayout = Array.isArray(response)
                ? CARD_DETAILS_LAYOUT_VALUES.CONDITIONAL_MULTILINE
                : normalizeClientCardDetailsLayout(response.card_details_layout);
            cardStyleVariant = Array.isArray(response)
                ? CARD_STYLE_VARIANT_VALUES.STANDARD
                : normalizeClientCardStyleVariant(response.card_style_variant);
            originalCardDetailsLayout = cardDetailsLayout;
            originalCardStyleVariant = cardStyleVariant;
            originalData = cloneColumnsData(columnsData);
        } catch (err) {
            if (requestSequence !== loadRequestSequence) {
                return;
            }
            console.warn('card_visibility_view: failed to load columns', err);
            columnsData = [];
            originalData = [];
            cardDetailsLayout = CARD_DETAILS_LAYOUT_VALUES.CONDITIONAL_MULTILINE;
            originalCardDetailsLayout = CARD_DETAILS_LAYOUT_VALUES.CONDITIONAL_MULTILINE;
            cardStyleVariant = CARD_STYLE_VARIANT_VALUES.STANDARD;
            originalCardStyleVariant = CARD_STYLE_VARIANT_VALUES.STANDARD;
        }

        if (columnsData.length === 0) {
            renderNoColumnsMessage(matrixContainer);
            return;
        }

        mountCheckboxTable();
    }

    const rawTreeData = localStorage.getItem('full_tree_data');
    if (rawTreeData) {
        try {
            const treeData = JSON.parse(rawTreeData);
            if (treeData && treeData.nodes) {
                await render_tree(treeData.nodes, {
                    container_id: 'cv_table_selector_tree',
                    id_suffix: '_cv_tree',
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
            console.warn('card_visibility_view: failed to parse tree data', err);
        }
    }

    const listenerController = new AbortController();
    container.__cleanupListeners = () => {
        listenerController.abort();
        unmountCheckboxTable();
    };

    document.addEventListener('checkboxSelectionChanged', async (event) => {
        const selectedCategories = event.detail.selectedCategories;
        const tableName = extractFirstSelectedTableName(selectedCategories);

        if (!tableName) {
            const canClearSelection = await confirmBeforeContextChange();
            if (!canClearSelection) {
                return;
            }

            loadRequestSequence += 1;
            currentTableName = null;
            columnsData = [];
            originalData = [];
            cardDetailsLayout = CARD_DETAILS_LAYOUT_VALUES.CONDITIONAL_MULTILINE;
            originalCardDetailsLayout = CARD_DETAILS_LAYOUT_VALUES.CONDITIONAL_MULTILINE;
            cardStyleVariant = CARD_STYLE_VARIANT_VALUES.STANDARD;
            originalCardStyleVariant = CARD_STYLE_VARIANT_VALUES.STANDARD;
            unmountCheckboxTable();
            renderInstructions(matrixContainer);
            return;
        }

        if (tableName === currentTableName) {
            return;
        }

        const canSwitchTables = await confirmBeforeContextChange();
        if (!canSwitchTables) {
            return;
        }

        await loadColumnsForTable(tableName);
    }, { signal: listenerController.signal });

    renderInstructions(matrixContainer);
}
