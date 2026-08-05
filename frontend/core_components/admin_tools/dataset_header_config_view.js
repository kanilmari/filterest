// dataset_header_config_view.js
// Renders the admin view for editing dataset hero copy and the shared project banner.
// Bridges dataset config endpoints, table spec cache updates, and framework.css-based form layout.
// Exists to give admins a dedicated editor for dataset header content without code changes.

import { endpoint_router } from '../endpoints/endpoint_router.js';
import { fetchDatasetHeaderConfig, saveDatasetHeaderConfig } from '../endpoints/stable_endpoint_router.js';
import { createVanillaDropdown } from '../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js';
import { showErrorToast, showInfoToast, showSuccessToast, showWarningToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import { translatePage } from '../lang/translation_handler.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';

/** @typedef {import('../../generated/go_contract_types').DatasetHeaderConfigResponse} DatasetHeaderConfigResponse */
/** @typedef {import('../../generated/go_contract_types').DatasetHeaderTextConfig} DatasetHeaderTextConfig */
/**
 * @typedef {object} DatasetHeaderConfigSaveResponse
 * @property {string} [status]
 * @property {string} [message]
 * @property {DatasetHeaderConfigResponse} [config]
 */

export async function generate_dataset_header_config_view(container) {
    if (!container) return;
    container.replaceChildren();

    let selectedDataset = '';
    let currentBannerPath = '';
    let pendingPreviewUrl = '';

    const root = document.createElement('div');
    root.classList.add('dataset-header-config-view', 'fw-container', 'fw-flex', 'fw-flex-col', 'fw-gap-4');

    const introCard = document.createElement('section');
    introCard.classList.add('fw-card', 'fw-flex', 'fw-flex-col', 'fw-gap-2');

    const introTitle = document.createElement('h2');
    introTitle.textContent = 'Dataset Header Configuration';
    introCard.appendChild(introTitle);

    const introText = document.createElement('p');
    introText.classList.add('fw-text-muted');
    introText.textContent = 'Edit the predefined dataset-specific language keys for title, slogan, and search placeholder here. The banner image is shared across the current project.';
    introCard.appendChild(introText);
    root.appendChild(introCard);

    const form = document.createElement('form');
    form.classList.add('dataset-header-config-form', 'fw-grid', 'fw-gap-4');

    const datasetCard = document.createElement('section');
    datasetCard.classList.add('fw-card', 'fw-flex', 'fw-flex-col', 'fw-gap-4');

    const datasetSelectorLabel = document.createElement('label');
    datasetSelectorLabel.classList.add('fw-label');
    datasetSelectorLabel.textContent = 'Dataset';
    datasetCard.appendChild(datasetSelectorLabel);

    const datasetDropdownContainer = document.createElement('div');
    datasetDropdownContainer.classList.add('dataset-header-config-dataset-dropdown');
    datasetCard.appendChild(datasetDropdownContainer);

    const formGrid = document.createElement('div');
    formGrid.classList.add('fw-grid', 'fw-grid-2', 'fw-gap-4');

    const copyCard = document.createElement('section');
    copyCard.classList.add('fw-card', 'fw-flex', 'fw-flex-col', 'fw-gap-4');

    const copyTitle = document.createElement('h3');
    copyTitle.textContent = 'Dataset Text Keys';
    copyCard.appendChild(copyTitle);

    const copyHint = document.createElement('p');
    copyHint.classList.add('fw-text-muted', 'fw-text-sm');
    copyHint.textContent = 'The ready-made lang keys are shown directly below. Save translations and AI context here; the dataset view will keep using those keys.';
    copyCard.appendChild(copyHint);

    const titleEditor = createLangKeyEditor('Header title');
    const sloganEditor = createLangKeyEditor('Slogan');
    const placeholderEditor = createLangKeyEditor('Search placeholder');
    copyCard.appendChild(titleEditor.wrapper);
    copyCard.appendChild(sloganEditor.wrapper);
    copyCard.appendChild(placeholderEditor.wrapper);



    const bannerCard = document.createElement('section');
    bannerCard.classList.add('fw-card', 'fw-flex', 'fw-flex-col', 'fw-gap-4');

    const bannerTitle = document.createElement('h3');
    bannerTitle.textContent = 'Project Banner';
    bannerCard.appendChild(bannerTitle);

    const bannerHint = document.createElement('p');
    bannerHint.classList.add('fw-text-muted', 'fw-text-sm');
    bannerHint.textContent = 'This image is shared by every dataset in the current project.';
    bannerCard.appendChild(bannerHint);

    const bannerPreview = document.createElement('div');
    bannerPreview.classList.add('dataset-header-config-banner-preview', 'fw-panel');
    bannerCard.appendChild(bannerPreview);

    const fileFieldWrapper = document.createElement('div');
    fileFieldWrapper.classList.add('fw-flex', 'fw-flex-col', 'fw-gap-2');
    const fileLabel = document.createElement('label');
    fileLabel.classList.add('fw-label');
    fileLabel.textContent = 'Replace banner image';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.name = 'project_banner_image';
    fileInput.accept = '.png,.jpg,.jpeg,.webp,.svg,.gif';
    fileInput.classList.add('fw-form-control');
    fileFieldWrapper.appendChild(fileLabel);
    fileFieldWrapper.appendChild(fileInput);
    bannerCard.appendChild(fileFieldWrapper);

    const removeBannerWrapper = document.createElement('label');
    removeBannerWrapper.classList.add('dataset-header-config-checkbox', 'fw-flex', 'fw-gap-2', 'fw-items-center');
    const removeBannerCheckbox = document.createElement('input');
    removeBannerCheckbox.type = 'checkbox';
    removeBannerCheckbox.name = 'remove_project_banner';
    const removeBannerText = document.createElement('span');
    removeBannerText.textContent = 'Remove current project banner on save';
    removeBannerWrapper.appendChild(removeBannerCheckbox);
    removeBannerWrapper.appendChild(removeBannerText);
    bannerCard.appendChild(removeBannerWrapper);

    formGrid.appendChild(copyCard);
    formGrid.appendChild(bannerCard);
    datasetCard.appendChild(formGrid);
    form.appendChild(datasetCard);

    const actionRow = document.createElement('div');
    actionRow.classList.add('dataset-header-config-actions', 'fw-flex', 'fw-gap-2', 'fw-wrap');
    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.classList.add('fw-btn', 'fw-btn--primary');
    saveButton.textContent = 'Save dataset header config';
    actionRow.appendChild(saveButton);
    form.appendChild(actionRow);

    root.appendChild(form);
    container.appendChild(root);

    const datasetOptions = await loadDatasetOptions();
    const datasetDropdown = createVanillaDropdown({
        containerElement: datasetDropdownContainer,
        options: datasetOptions,
        placeholder: 'Select dataset...',
        searchPlaceholder: 'Search datasets...',
        onChange: async (datasetName) => {
            selectedDataset = datasetName || '';
            clearPendingPreview();
            fileInput.value = '';
            removeBannerCheckbox.checked = false;
            await loadDatasetConfig();
        },
    });

    fileInput.addEventListener('change', () => {
        clearPendingPreview();
        removeBannerCheckbox.checked = false;
        const [file] = fileInput.files || [];
        if (!file) {
            renderBannerPreview(currentBannerPath, false);
            return;
        }

        pendingPreviewUrl = URL.createObjectURL(file);
        renderBannerPreview(pendingPreviewUrl, true);
    });

    removeBannerCheckbox.addEventListener('change', () => {
        if (removeBannerCheckbox.checked) {
            clearPendingPreview();
            fileInput.value = '';
            renderBannerPreview('', false);
            return;
        }
        renderBannerPreview(currentBannerPath, false);
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!selectedDataset) {
            showInfoToast('Select a dataset before saving.');
            return;
        }

        const payload = new FormData();
        payload.append('dataset_name', selectedDataset);
        payload.append('remove_project_banner', removeBannerCheckbox.checked ? 'true' : 'false');
        appendLangKeyPayload(payload, 'title', titleEditor);
        appendLangKeyPayload(payload, 'slogan', sloganEditor);
        appendLangKeyPayload(payload, 'placeholder', placeholderEditor);

        const [bannerFile] = fileInput.files || [];
        if (bannerFile) {
            payload.append('project_banner_image', bannerFile);
        }

        saveButton.disabled = true;

        try {
            const response = /** @type {DatasetHeaderConfigSaveResponse} */ (await saveDatasetHeaderConfig(payload));

            const savedConfig = response?.config;
            if (!savedConfig) {
                throw new Error('Missing saved config in response');
            }

            applyConfigToForm(savedConfig);
            syncProjectLogoMeta(savedConfig.project_logo_path || '');
            await translatePage(getLanguageWithBrowserFallback());
            showSuccessToast(response?.message || 'Dataset header config saved');
        } catch (error) {
            console.warn('dataset_header_config_view: save failed', error);
            showErrorToast(error?.message || 'Saving dataset header config failed');
        } finally {
            saveButton.disabled = false;
        }
    });

    if (datasetOptions.length > 0) {
        selectedDataset = datasetOptions[0].value;
        datasetDropdown.setValue(selectedDataset);
        await loadDatasetConfig();
    } else {
        showWarningToast('No datasets available for header configuration.');
        renderBannerPreview('', false);
    }

    async function loadDatasetConfig() {
        if (!selectedDataset) {
            applyLangKeyConfig(titleEditor, null);
            applyLangKeyConfig(sloganEditor, null);
            applyLangKeyConfig(placeholderEditor, null);
            currentBannerPath = '';
            renderBannerPreview('', false);
            return;
        }

        try {
            const config = await fetchDatasetHeaderConfig(selectedDataset);
            applyConfigToForm(config);
        } catch (error) {
            console.warn('dataset_header_config_view: load failed', error);
            showErrorToast(error?.message || 'Loading dataset header config failed');
        }
    }

    /**
     * @param {DatasetHeaderConfigResponse | null | undefined} config
     */
    function applyConfigToForm(config) {
        applyLangKeyConfig(titleEditor, config?.title);
        applyLangKeyConfig(sloganEditor, config?.slogan);
        applyLangKeyConfig(placeholderEditor, config?.search_placeholder);
        currentBannerPath = config?.project_logo_path || '';
        removeBannerCheckbox.checked = false;
        fileInput.value = '';
        clearPendingPreview();
        renderBannerPreview(currentBannerPath, false);
    }

    function renderBannerPreview(src, isPending) {
        bannerPreview.replaceChildren();
        if (!src) {
            const emptyState = document.createElement('p');
            emptyState.classList.add('fw-text-muted', 'fw-text-sm');
            emptyState.textContent = 'No project banner uploaded yet.';
            bannerPreview.appendChild(emptyState);
            return;
        }

        const image = document.createElement('img');
        image.src = src;
        image.alt = '';
        image.classList.add('dataset-header-config-banner-image');
        bannerPreview.appendChild(image);

        if (isPending) {
            const badge = document.createElement('span');
            badge.classList.add('fw-badge');
            badge.textContent = 'Unsaved preview';
            bannerPreview.appendChild(badge);
        }
    }

    function syncProjectLogoMeta(projectLogoPath) {
        let meta = document.querySelector('meta[name="project-logo-path"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'project-logo-path');
            document.head.appendChild(meta);
        }
        meta.content = projectLogoPath || '';
    }

    function clearPendingPreview() {
        if (!pendingPreviewUrl) return;
        URL.revokeObjectURL(pendingPreviewUrl);
        pendingPreviewUrl = '';
    }
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
        console.warn('dataset_header_config_view: dataset list failed', error);
        showErrorToast(error?.message || 'Loading dataset list failed');
        return [];
    }
}

function createLangKeyEditor(labelText) {
    const wrapper = document.createElement('section');
    wrapper.classList.add('dataset-header-config-text-card', 'fw-panel', 'fw-flex', 'fw-flex-col', 'fw-gap-3');

    const title = document.createElement('h4');
    title.textContent = labelText;
    wrapper.appendChild(title);

    const keyField = createReadonlyField('Lang key');
    wrapper.appendChild(keyField.wrapper);

    const translationsGrid = document.createElement('div');
    translationsGrid.classList.add('dataset-header-config-translation-grid');

    const fiField = createTextField('Suomeksi (FI)');
    const enField = createTextField('English (EN)');
    const chField = createTextField('Chinese (CH)');
    translationsGrid.appendChild(fiField.wrapper);
    translationsGrid.appendChild(enField.wrapper);
    translationsGrid.appendChild(chField.wrapper);
    wrapper.appendChild(translationsGrid);

    const usageExplanationField = createTextareaField('AI context / usage explanation');
    usageExplanationField.input.placeholder = 'Explain the meaning and intended use of this key for AI-assisted translation.';
    wrapper.appendChild(usageExplanationField.wrapper);

    return {
        wrapper,
        keyInput: keyField.input,
        fiInput: fiField.input,
        enInput: enField.input,
        chInput: chField.input,
        usageExplanationInput: usageExplanationField.input,
    };
}

function createReadonlyField(labelText) {
    const wrapper = document.createElement('label');
    wrapper.classList.add('fw-flex', 'fw-flex-col', 'fw-gap-2');

    const label = document.createElement('span');
    label.classList.add('fw-label');
    label.textContent = labelText;

    const input = document.createElement('input');
    input.type = 'text';
    input.readOnly = true;
    input.classList.add('fw-form-control', 'dataset-header-config-readonly-key');

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    return { wrapper, input };
}

function createTextField(labelText) {
    const wrapper = document.createElement('label');
    wrapper.classList.add('fw-flex', 'fw-flex-col', 'fw-gap-2');

    const label = document.createElement('span');
    label.classList.add('fw-label');
    label.textContent = labelText;

    const input = document.createElement('input');
    input.type = 'text';
    input.classList.add('fw-form-control');

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    return { wrapper, input };
}

function createTextareaField(labelText) {
    const wrapper = document.createElement('label');
    wrapper.classList.add('fw-flex', 'fw-flex-col', 'fw-gap-2');

    const label = document.createElement('span');
    label.classList.add('fw-label');
    label.textContent = labelText;

    const input = document.createElement('textarea');
    input.classList.add('fw-form-control');
    input.rows = 3;

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    return { wrapper, input };
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
