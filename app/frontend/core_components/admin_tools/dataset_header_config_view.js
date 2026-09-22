// dataset_header_config_view.js
// Renders the admin view for dataset hero copy and dataset presentation media.
// Bridges dataset config endpoints, table-spec refreshes, and framework.css-based form layout.
// Exists to give admins a dedicated editor for dataset header content without code changes.

import { endpoint_router } from '../endpoints/endpoint_router.js';
import { fetchDatasetHeaderConfig, saveDatasetHeaderConfig } from '../endpoints/stable_endpoint_router.js';
import { createVanillaDropdown } from '../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js';
import { showErrorToast, showInfoToast, showSuccessToast, showWarningToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import { getTranslationForKey, translatePage } from '../lang/translation_handler.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { getAllSpecs, setAllSpecs } from '../state_stores/table_specs_reader.js';
import { refreshMainTabPresentation } from '../navigation/main_tabs/main_tab_active_state.js';
import { encodeCssUrlValue, resolveDatasetMediaDisplayPath } from '../table_views/storage_media_urls.js';

/** @typedef {import('../../generated/go_contract_types').DatasetHeaderConfigResponse} DatasetHeaderConfigResponse */
/** @typedef {import('../../generated/go_contract_types').DatasetHeaderTextConfig} DatasetHeaderTextConfig */
/**
 * @typedef {object} DatasetHeaderConfigSaveResponse
 * @property {string} [status]
 * @property {string} [message]
 * @property {DatasetHeaderConfigResponse} [config]
 */

/**
 * One text of this screen in the reader's language. The site's reviewed
 * translation comes first; the screen's own copy
 * (dataset_header_config_translation_fallbacks.js) stands in for a key the
 * installation does not have yet, so the screen never shows a raw key.
 */
function headerText(key) {
    return getTranslationForKey(key, { countUsage: false });
}

/** Gives an element one text of this screen; the page translator keeps it current. */
function setHeaderText(element, key) {
    element.dataset.langKey = key;
    element.textContent = headerText(key);
    return element;
}

export async function generate_dataset_header_config_view(
    container,
    {
        initialDatasetName = '',
        onDismiss = null,
        onSaved = null,
    } = {}
) {
    if (!container) return;
    container.replaceChildren();

    let selectedDataset = '';
    // The dataset whose settings the form now shows. Saving is allowed only
    // for it, so a failed load can never write one dataset's texts into another.
    let loadedDataset = '';
    let loadFailed = false;
    let saving = false;

    const root = document.createElement('div');
    root.classList.add('dataset-header-config-view', 'fw-container', 'fw-flex', 'fw-flex-col', 'fw-gap-4');

    const introCard = document.createElement('section');
    introCard.classList.add('fw-card', 'fw-flex', 'fw-flex-col', 'fw-gap-2');

    const introHeadingRow = document.createElement('div');
    introHeadingRow.classList.add('fw-flex', 'fw-items-center', 'fw-justify-between', 'fw-gap-2');

    const introTitle = setHeaderText(document.createElement('h2'), 'dataset_header_config');
    introHeadingRow.appendChild(introTitle);

    if (typeof onDismiss === 'function') {
        const dismissButton = document.createElement('button');
        dismissButton.type = 'button';
        dismissButton.classList.add('dataset-header-config-dismiss', 'fw-btn', 'fw-btn--ghost');
        dismissButton.textContent = '×';
        dismissButton.dataset.titleLangKey = 'close';
        dismissButton.dataset.ariaLabelLangKey = 'close';
        dismissButton.title = headerText('close');
        dismissButton.setAttribute('aria-label', headerText('close'));
        dismissButton.addEventListener('click', onDismiss);
        introHeadingRow.appendChild(dismissButton);
    }
    introCard.appendChild(introHeadingRow);

    const introText = setHeaderText(document.createElement('p'), 'dataset_header_config_intro');
    introText.classList.add('fw-text-muted');
    introCard.appendChild(introText);
    root.appendChild(introCard);

    const form = document.createElement('form');
    form.classList.add('dataset-header-config-form', 'fw-grid', 'fw-gap-4');

    const datasetCard = document.createElement('section');
    datasetCard.classList.add('fw-card', 'fw-flex', 'fw-flex-col', 'fw-gap-4');

    const datasetSelectorLabel = setHeaderText(document.createElement('label'), 'dataset');
    datasetSelectorLabel.classList.add('fw-label');
    datasetCard.appendChild(datasetSelectorLabel);

    const datasetDropdownContainer = document.createElement('div');
    datasetDropdownContainer.classList.add('dataset-header-config-dataset-dropdown');
    datasetCard.appendChild(datasetDropdownContainer);

    const formGrid = document.createElement('div');
    formGrid.classList.add('fw-grid', 'fw-grid-2', 'fw-gap-4');

    const copyCard = document.createElement('section');
    copyCard.classList.add('fw-card', 'fw-flex', 'fw-flex-col', 'fw-gap-4');

    copyCard.appendChild(setHeaderText(document.createElement('h3'), 'dataset_header_config_text_keys'));

    const copyHint = setHeaderText(document.createElement('p'), 'dataset_header_config_text_keys_hint');
    copyHint.classList.add('fw-text-muted', 'fw-text-sm');
    copyCard.appendChild(copyHint);

    const titleEditor = createLangKeyEditor('title');
    const sloganEditor = createLangKeyEditor('dataset_header_config_slogan');
    const placeholderEditor = createLangKeyEditor('search_placeholder');
    copyCard.appendChild(titleEditor.wrapper);
    copyCard.appendChild(sloganEditor.wrapper);
    copyCard.appendChild(placeholderEditor.wrapper);

    const coverEditor = createDatasetMediaEditor({
        titleKey: 'dataset_header_config_cover_title',
        hintKey: 'dataset_header_config_cover_hint',
        fileFieldName: 'cover_image',
        removeFieldName: 'remove_cover_image',
    });
    const backgroundEditor = createDatasetMediaEditor({
        titleKey: 'dataset_header_config_background_title',
        hintKey: 'dataset_header_config_background_hint',
        fileFieldName: 'background_image',
        removeFieldName: 'remove_background_image',
    });

    formGrid.appendChild(copyCard);
    formGrid.appendChild(coverEditor.wrapper);
    formGrid.appendChild(backgroundEditor.wrapper);
    datasetCard.appendChild(formGrid);
    form.appendChild(datasetCard);

    const actionRow = document.createElement('div');
    actionRow.classList.add('dataset-header-config-actions', 'fw-flex', 'fw-gap-2', 'fw-wrap');
    const saveButton = setHeaderText(document.createElement('button'), 'save');
    saveButton.type = 'submit';
    saveButton.classList.add('fw-btn', 'fw-btn--primary');
    actionRow.appendChild(saveButton);
    // Says why saving is off when the selected dataset's settings did not load.
    const saveStatus = setHeaderText(document.createElement('p'), 'dataset_header_config_not_loaded');
    saveStatus.classList.add('dataset-header-config-save-status', 'fw-text-muted', 'fw-text-sm');
    saveStatus.setAttribute('role', 'status');
    saveStatus.hidden = true;
    actionRow.appendChild(saveStatus);
    form.appendChild(actionRow);

    root.appendChild(form);
    container.appendChild(root);

    const datasetOptions = await loadDatasetOptions();
    const datasetDropdown = createVanillaDropdown({
        containerElement: datasetDropdownContainer,
        options: datasetOptions || [],
        placeholder: headerText('dataset_select_target'),
        searchPlaceholder: headerText('search'),
        onChange: async (datasetName) => {
            selectedDataset = datasetName || '';
            // Drop picked files and removal ticks before loading the next
            // dataset: if that load fails, they must not be saved to it.
            coverEditor.resetSelection();
            backgroundEditor.resetSelection();
            await loadDatasetConfig();
        },
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!selectedDataset) {
            showInfoToast(headerText('dataset_select_target'));
            return;
        }
        if (loadedDataset !== selectedDataset) {
            showInfoToast(headerText('dataset_header_config_not_loaded'));
            return;
        }

        const payload = new FormData();
        payload.append('dataset_name', selectedDataset);
        appendLangKeyPayload(payload, 'title', titleEditor);
        appendLangKeyPayload(payload, 'slogan', sloganEditor);
        appendLangKeyPayload(payload, 'placeholder', placeholderEditor);
        coverEditor.appendPayload(payload);
        backgroundEditor.appendPayload(payload);

        saving = true;
        refreshSaveAvailability();

        try {
            const response = /** @type {DatasetHeaderConfigSaveResponse} */ (await saveDatasetHeaderConfig(payload));

            const savedConfig = response?.config;
            if (!savedConfig) {
                showErrorToast(headerText('save_failed'));
                return;
            }

            applyConfigToForm(savedConfig);
            syncDatasetPresentationMedia(
                selectedDataset,
                savedConfig.cover_image_path || '',
                savedConfig.background_image_path || ''
            );
            await translatePage(getLanguageWithBrowserFallback());
            showSuccessToast(headerText('saved'));
            if (typeof onSaved === 'function') {
                await onSaved(savedConfig);
            }
        } catch (error) {
            // The request pipeline has already told the reader, in their own
            // language, why the request failed; the raw error is for the console.
            console.warn('dataset_header_config_view: save failed', error);
        } finally {
            saving = false;
            refreshSaveAvailability();
        }
    });

    if (datasetOptions?.length > 0) {
        const requestedDataset = String(initialDatasetName || '').trim();
        const initialOption = datasetOptions.find(
            (option) => option.value === requestedDataset
        );
        selectedDataset = initialOption?.value || datasetOptions[0].value;
        datasetDropdown.setValue(selectedDataset);
        await loadDatasetConfig();
    } else if (datasetOptions) {
        // A list that failed to load is not an empty one; the pipeline said so.
        showWarningToast(headerText('dataset_header_config_no_datasets'));
    }

    async function loadDatasetConfig() {
        const requestedDataset = selectedDataset;
        loadedDataset = '';
        loadFailed = false;
        refreshSaveAvailability();
        if (!requestedDataset) {
            applyLangKeyConfig(titleEditor, null);
            applyLangKeyConfig(sloganEditor, null);
            applyLangKeyConfig(placeholderEditor, null);
            coverEditor.applyPath('');
            backgroundEditor.applyPath('');
            return;
        }

        try {
            const config = await fetchDatasetHeaderConfig(requestedDataset);
            // A later dataset switch owns the form now; its own load decides.
            if (requestedDataset !== selectedDataset) return;
            applyConfigToForm(config);
            loadedDataset = requestedDataset;
        } catch (error) {
            if (requestedDataset !== selectedDataset) return;
            // The request pipeline has reported the failure; the status line
            // beside the save button says what it means for this form.
            loadFailed = true;
            console.warn('dataset_header_config_view: load failed', error);
        } finally {
            refreshSaveAvailability();
        }
    }

    // Saving stays off while a dataset is loading or after its load failed;
    // only the failure needs words, a load in progress ends by itself.
    function refreshSaveAvailability() {
        const notLoaded = Boolean(selectedDataset) && loadedDataset !== selectedDataset;
        saveButton.disabled = saving || notLoaded;
        saveStatus.hidden = !(notLoaded && loadFailed);
    }

    /**
     * @param {DatasetHeaderConfigResponse | null | undefined} config
     */
    function applyConfigToForm(config) {
        applyLangKeyConfig(titleEditor, config?.title);
        applyLangKeyConfig(sloganEditor, config?.slogan);
        applyLangKeyConfig(placeholderEditor, config?.search_placeholder);
        coverEditor.applyPath(config?.cover_image_path || '');
        backgroundEditor.applyPath(config?.background_image_path || '');
    }
}

/**
 * Keeps the active dataset content areas and the shared table-spec cache in sync
 * with a successful media save. The authoritative values still come from the
 * backend response; this only avoids making the administrator reload the page.
 */
function syncDatasetPresentationMedia(datasetName, coverImagePath, backgroundImagePath) {
    if (!datasetName) return;

    const specs = getAllSpecs();
    const nextDatasetSpec = { ...(specs[datasetName] || {}) };
    setOptionalSpecPath(nextDatasetSpec, 'dataset_cover_image_path', coverImagePath);
    setOptionalSpecPath(nextDatasetSpec, 'dataset_background_image_path', backgroundImagePath);
    setAllSpecs({
        ...specs,
        [datasetName]: nextDatasetSpec,
    });
    const tabButton = Array.from(document.querySelectorAll('.navtablinks'))
        .find((button) => button.dataset.id === datasetName);
    if (tabButton instanceof HTMLElement) {
        tabButton.dataset.hasPresentationMedia = String(
            Boolean(coverImagePath || backgroundImagePath)
        );
    }

    for (const hero of document.querySelectorAll('.filterbar-inline-hero')) {
        if (hero.dataset.filterbarInlineHeroFor !== datasetName) continue;
        applyPresentationImage(
            hero,
            'filterbar-inline-hero--has-cover',
            '--dataset-cover-image',
            coverImagePath
        );
    }

    for (const contentArea of document.querySelectorAll('.tab-content-area')) {
        if (contentArea.dataset.tableName !== datasetName) continue;
        applyPresentationImage(
            contentArea,
            'tab-content-area--has-dataset-background',
            '--dataset-background-image',
            backgroundImagePath
        );
    }
    refreshMainTabPresentation();
}

function setOptionalSpecPath(spec, key, path) {
    const normalizedPath = typeof path === 'string' ? path.trim() : '';
    if (normalizedPath) {
        spec[key] = normalizedPath;
        return;
    }
    delete spec[key];
}

function applyPresentationImage(element, enabledClass, propertyName, path) {
    const normalizedPath = typeof path === 'string' ? path.trim() : '';
    element.classList.toggle(enabledClass, Boolean(normalizedPath));
    if (!normalizedPath) {
        element.style.removeProperty(propertyName);
        return;
    }
    element.style.setProperty(
        propertyName,
        encodeCssUrlValue(resolveDatasetMediaDisplayPath(normalizedPath))
    );
}

function createDatasetMediaEditor({
    titleKey,
    hintKey,
    fileFieldName,
    removeFieldName,
}) {
    let currentPath = '';
    let pendingPreviewUrl = '';

    const wrapper = document.createElement('section');
    wrapper.classList.add('fw-card', 'fw-flex', 'fw-flex-col', 'fw-gap-4', 'dataset-header-config-media-card');

    wrapper.appendChild(setHeaderText(document.createElement('h3'), titleKey));

    const description = setHeaderText(document.createElement('p'), hintKey);
    description.classList.add('fw-text-muted', 'fw-text-sm');
    wrapper.appendChild(description);

    const preview = document.createElement('div');
    preview.classList.add('dataset-header-config-media-preview', 'fw-panel');
    wrapper.appendChild(preview);

    const fileLabel = document.createElement('label');
    fileLabel.classList.add('fw-flex', 'fw-flex-col', 'fw-gap-2');
    const fileLabelText = setHeaderText(document.createElement('span'), 'dataset_header_config_replace_image');
    fileLabelText.classList.add('fw-label');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.name = fileFieldName;
    fileInput.accept = '.png,.jpg,.jpeg,.webp,.svg,.gif';
    fileInput.classList.add('fw-form-control');
    fileLabel.append(fileLabelText, fileInput);
    wrapper.appendChild(fileLabel);

    const removeLabel = document.createElement('label');
    removeLabel.classList.add('dataset-header-config-checkbox', 'fw-flex', 'fw-gap-2', 'fw-items-center');
    const removeCheckbox = document.createElement('input');
    removeCheckbox.type = 'checkbox';
    removeCheckbox.name = removeFieldName;
    const removeText = setHeaderText(document.createElement('span'), 'dataset_header_config_remove_image');
    removeLabel.append(removeCheckbox, removeText);
    wrapper.appendChild(removeLabel);

    function clearPendingPreview() {
        if (!pendingPreviewUrl) return;
        URL.revokeObjectURL(pendingPreviewUrl);
        pendingPreviewUrl = '';
    }

    function renderPreview(src, isPending = false) {
        preview.replaceChildren();
        if (!src) {
            const emptyState = setHeaderText(document.createElement('p'), 'dataset_header_config_no_image');
            emptyState.classList.add('fw-text-muted', 'fw-text-sm');
            preview.appendChild(emptyState);
            return;
        }
        const image = document.createElement('img');
        image.src = src;
        image.alt = '';
        image.classList.add('dataset-header-config-media-image');
        preview.appendChild(image);
        if (isPending) {
            const badge = setHeaderText(document.createElement('span'), 'unsaved_changes');
            badge.classList.add('fw-badge');
            preview.appendChild(badge);
        }
    }

    // Forgets a picked file and the removal tick, and shows the saved image again.
    function resetSelection() {
        removeCheckbox.checked = false;
        fileInput.value = '';
        clearPendingPreview();
        renderPreview(currentPath);
    }

    function applyPath(path) {
        currentPath = path || '';
        resetSelection();
    }

    fileInput.addEventListener('change', () => {
        clearPendingPreview();
        removeCheckbox.checked = false;
        const [file] = fileInput.files || [];
        if (!file) {
            renderPreview(currentPath);
            return;
        }
        pendingPreviewUrl = URL.createObjectURL(file);
        renderPreview(pendingPreviewUrl, true);
    });

    removeCheckbox.addEventListener('change', () => {
        if (removeCheckbox.checked) {
            clearPendingPreview();
            fileInput.value = '';
            renderPreview('');
            return;
        }
        renderPreview(currentPath);
    });

    return {
        wrapper,
        applyPath,
        resetSelection,
        appendPayload(payload) {
            payload.append(removeFieldName, removeCheckbox.checked ? 'true' : 'false');
            const [file] = fileInput.files || [];
            if (file) payload.append(fileFieldName, file);
        },
    };
}

async function loadDatasetOptions() {
    try {
        const datasetNames = await endpoint_router('datasetNames');
        if (!Array.isArray(datasetNames)) {
            return [];
        }

        return datasetNames
            .slice()
            .sort((left, right) => left.localeCompare(right))
            .map((datasetName) => ({
                value: datasetName,
                label: datasetName,
            }));
    } catch (error) {
        // Reported to the reader by the request pipeline; null tells the caller
        // the list failed, rather than that there are no datasets.
        console.warn('dataset_header_config_view: dataset list failed', error);
        return null;
    }
}

function createLangKeyEditor(titleKey) {
    const wrapper = document.createElement('section');
    wrapper.classList.add('dataset-header-config-text-card', 'fw-panel', 'fw-flex', 'fw-flex-col', 'fw-gap-3');
    wrapper.appendChild(setHeaderText(document.createElement('h4'), titleKey));

    const keyInput = createTextInput();
    keyInput.readOnly = true;
    keyInput.classList.add('dataset-header-config-readonly-key');
    wrapper.appendChild(createLabeledField(setHeaderText(document.createElement('span'), 'lang_key'), keyInput));

    const translationsGrid = document.createElement('div');
    translationsGrid.classList.add('dataset-header-config-translation-grid');
    const fiInput = createTextInput();
    const enInput = createTextInput();
    const chInput = createTextInput();
    translationsGrid.append(
        createLabeledField(createLanguageCaption('fi'), fiInput),
        createLabeledField(createLanguageCaption('en'), enInput),
        createLabeledField(createLanguageCaption('ch'), chInput),
    );
    wrapper.appendChild(translationsGrid);

    const usageExplanationInput = document.createElement('textarea');
    usageExplanationInput.classList.add('fw-form-control');
    usageExplanationInput.rows = 3;
    usageExplanationInput.placeholder = headerText('dataset_header_config_usage_placeholder');
    wrapper.appendChild(createLabeledField(
        setHeaderText(document.createElement('span'), 'usage_explanation'),
        usageExplanationInput
    ));

    return { wrapper, keyInput, fiInput, enInput, chInput, usageExplanationInput };
}

function createTextInput() {
    const input = document.createElement('input');
    input.type = 'text';
    input.classList.add('fw-form-control');
    return input;
}

/** A caption above its control, inside one label so the caption focuses the control. */
function createLabeledField(caption, control) {
    const wrapper = document.createElement('label');
    wrapper.classList.add('fw-flex', 'fw-flex-col', 'fw-gap-2');
    caption.classList.add('fw-label');
    wrapper.append(caption, control);
    return wrapper;
}

/** A language's name with its code, such as "Finnish (FI)"; only the name is translated. */
function createLanguageCaption(code) {
    const caption = document.createElement('span');
    caption.classList.add('dataset-header-config-language-caption');
    caption.append(setHeaderText(document.createElement('span'), code), ` (${code.toUpperCase()})`);
    return caption;
}

/**
 * @param {ReturnType<typeof createLangKeyEditor>} editor
 * @param {DatasetHeaderTextConfig | null | undefined} config
 */
function applyLangKeyConfig(editor, config) {
    editor.keyInput.value = config?.lang_key || '';
    editor.fiInput.value = config?.fi || '';
    editor.enInput.value = config?.en || '';
    editor.chInput.value = config?.ch || '';
    editor.usageExplanationInput.value = config?.usage_explanation || '';
}

function appendLangKeyPayload(payload, prefix, editor) {
    payload.append(`${prefix}_fi`, editor.fiInput.value.trim());
    payload.append(`${prefix}_en`, editor.enInput.value.trim());
    payload.append(`${prefix}_ch`, editor.chInput.value.trim());
    payload.append(`${prefix}_usage_explanation`, editor.usageExplanationInput.value.trim());
}
