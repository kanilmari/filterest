// dataset_alias_management_view.js
// Renders the admin editor for primary dataset URL aliases and route previews.
// Bridges stable alias-management endpoints, nav-engine alias cache refresh, and admin form layout.
// Exists to give admins a dedicated alias write surface without relying on read-only dataset routes.

import {
    fetchDatasetAliasManagement,
    saveDatasetAliasManagement,
} from '../endpoints/stable_endpoint_router.js';
import { createVanillaDropdown } from '../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js';
import {
    showErrorToast,
    showInfoToast,
    showSuccessToast,
    showWarningToast,
} from '../../reusable_components/notifications/toast_notification_printer.js';
import {
    getDatasetRouteUniquenessHint,
    refreshDatasetAliasRegistry,
} from '../navigation/nav_engine/dataset_aliases.js';

/**
 * @typedef {object} DatasetAliasManagementEntry
 * @property {string} dataset_name
 * @property {number} table_uid
 * @property {string} stored_primary_alias
 * @property {string} effective_public_alias
 * @property {string} alias_source
 * @property {string} raw_dataset_path
 * @property {string} canonical_dataset_path
 * @property {string} public_dataset_path
 * @property {string} default_public_alias_candidate
 * @property {boolean} default_alias_auto_reserved
 */
/**
 * @typedef {object} DatasetAliasManagementSnapshot
 * @property {DatasetAliasManagementEntry[]} [datasets]
 * @property {string} [system_alias_policy_recommendation]
 */
/**
 * @typedef {object} SaveDatasetAliasManagementResponse
 * @property {string} [status]
 * @property {string} [message]
 * @property {DatasetAliasManagementEntry} [dataset]
 * @property {string} [system_alias_policy_recommendation]
 */

const ALIAS_SOURCE_LABELS = Object.freeze({
    automatic_app_policy: 'Automatic app_ alias',
    database_primary_active: 'Stored primary alias',
    code_fallback: 'Fallback safety-net alias',
    raw_only: 'Raw URL only',
});

export async function generate_dataset_alias_management_view(container) {
    if (!container) return;
    container.replaceChildren();

    /** @type {DatasetAliasManagementSnapshot} */
    let snapshot = {
        datasets: [],
        system_alias_policy_recommendation: '',
    };
    let selectedDatasetName = '';

    const root = document.createElement('div');
    root.classList.add('dataset-alias-management-view', 'fw-container', 'fw-flex', 'fw-flex-col', 'fw-gap-4');

    const introCard = document.createElement('section');
    introCard.classList.add('fw-card', 'fw-flex', 'fw-flex-col', 'fw-gap-2');

    const introTitle = document.createElement('h2');
    introTitle.textContent = 'Dataset URL Alias Management';
    introCard.appendChild(introTitle);

    const introText = document.createElement('p');
    introText.classList.add('fw-text-muted');
    introText.textContent = 'Manage the primary public URL slug for each dataset while keeping raw dataset routes backward compatible.';
    introCard.appendChild(introText);

    const uniquenessHint = document.createElement('p');
    uniquenessHint.classList.add('dataset-alias-management-note', 'fw-text-sm');
    uniquenessHint.textContent = getDatasetRouteUniquenessHint();
    introCard.appendChild(uniquenessHint);

    const smokeTitle = document.createElement('h3');
    smokeTitle.textContent = 'Quick Smoke Test';
    introCard.appendChild(smokeTitle);

    const smokeList = document.createElement('ol');
    smokeList.classList.add('dataset-alias-management-smoke-list', 'fw-text-sm');
    [
        'Select one app_ dataset and confirm that Raw route, Canonical route, and Public route all match the policy shown below.',
        'Save a temporary alias and confirm that the Public route preview updates immediately and a success toast appears.',
        'Clear the stored alias and confirm that app_ datasets return to the automatic stripped route, while system_ datasets return to the raw route unless an explicit alias is saved.',
    ].forEach((stepText) => {
        const item = document.createElement('li');
        item.textContent = stepText;
        smokeList.appendChild(item);
    });
    introCard.appendChild(smokeList);

    root.appendChild(introCard);

    const form = document.createElement('form');
    form.classList.add('dataset-alias-management-form', 'fw-grid', 'fw-gap-4');

    const selectionCard = document.createElement('section');
    selectionCard.classList.add('fw-card', 'fw-flex', 'fw-flex-col', 'fw-gap-4');

    const datasetSelectorLabel = document.createElement('label');
    datasetSelectorLabel.classList.add('fw-label');
    datasetSelectorLabel.textContent = 'Dataset';
    selectionCard.appendChild(datasetSelectorLabel);

    const datasetDropdownContainer = document.createElement('div');
    datasetDropdownContainer.classList.add('dataset-alias-management-dataset-dropdown');
    selectionCard.appendChild(datasetDropdownContainer);

    const aliasFieldWrapper = document.createElement('div');
    aliasFieldWrapper.classList.add('fw-flex', 'fw-flex-col', 'fw-gap-2');

    const aliasLabel = document.createElement('label');
    aliasLabel.classList.add('fw-label');
    aliasLabel.htmlFor = 'dataset_alias_management_alias_slug';
    aliasLabel.textContent = 'Primary public alias';
    aliasFieldWrapper.appendChild(aliasLabel);

    const aliasInput = document.createElement('input');
    aliasInput.id = 'dataset_alias_management_alias_slug';
    aliasInput.type = 'text';
    aliasInput.classList.add('fw-form-control');
    aliasInput.dataset.testid = 'dataset-alias-management-input';
    aliasInput.placeholder = 'public-dataset-slug';
    aliasInput.autocomplete = 'off';
    aliasInput.spellcheck = false;
    aliasInput.pattern = '[a-z0-9_-]*';
    aliasFieldWrapper.appendChild(aliasInput);

    const aliasHint = document.createElement('p');
    aliasHint.classList.add('fw-text-muted', 'fw-text-sm');
    aliasHint.textContent = 'Use lowercase letters, numbers, underscores, or hyphens. app_ datasets may keep a stripped alias automatically, while system_ datasets stay on the raw URL until an alias is saved here.';
    aliasFieldWrapper.appendChild(aliasHint);

    selectionCard.appendChild(aliasFieldWrapper);
    form.appendChild(selectionCard);

    const detailGrid = document.createElement('div');
    detailGrid.classList.add('dataset-alias-management-grid');

    const routingCard = document.createElement('section');
    routingCard.classList.add('fw-card', 'fw-flex', 'fw-flex-col', 'fw-gap-3');

    const routingTitle = document.createElement('h3');
    routingTitle.textContent = 'Current Routing';
    routingCard.appendChild(routingTitle);

    const routingPreviewGrid = document.createElement('div');
    routingPreviewGrid.classList.add('dataset-alias-management-preview-grid');
    routingCard.appendChild(routingPreviewGrid);

    const aliasSourceValue = appendPreviewRow(routingPreviewGrid, 'Alias source');
    const rawRouteValue = appendPreviewRow(routingPreviewGrid, 'Raw route');
    const canonicalRouteValue = appendPreviewRow(routingPreviewGrid, 'Canonical route');
    const publicRouteValue = appendPreviewRow(routingPreviewGrid, 'Public route');
    const defaultCandidateValue = appendPreviewRow(routingPreviewGrid, 'Default stripped candidate');

    detailGrid.appendChild(routingCard);

    const policyCard = document.createElement('section');
    policyCard.classList.add('fw-card', 'fw-flex', 'fw-flex-col', 'fw-gap-3', 'dataset-alias-management-policy');

    const policyTitle = document.createElement('h3');
    policyTitle.textContent = 'Policy Recommendation';
    policyCard.appendChild(policyTitle);

    const policyText = document.createElement('p');
    policyText.classList.add('fw-text-muted');
    policyCard.appendChild(policyText);

    const policyDetailText = document.createElement('p');
    policyDetailText.classList.add('dataset-alias-management-note', 'fw-text-sm');
    policyCard.appendChild(policyDetailText);

    detailGrid.appendChild(policyCard);
    form.appendChild(detailGrid);

    const actionRow = document.createElement('div');
    actionRow.classList.add('dataset-alias-management-actions', 'fw-flex', 'fw-gap-2', 'fw-wrap');

    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.classList.add('fw-btn', 'fw-btn--primary');
    saveButton.dataset.testid = 'dataset-alias-management-save';
    saveButton.textContent = 'Save alias';
    actionRow.appendChild(saveButton);

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.classList.add('fw-btn', 'fw-btn--secondary');
    clearButton.dataset.testid = 'dataset-alias-management-clear';
    clearButton.textContent = 'Clear stored alias';
    actionRow.appendChild(clearButton);

    const useCandidateButton = document.createElement('button');
    useCandidateButton.type = 'button';
    useCandidateButton.classList.add('fw-btn', 'fw-btn--ghost');
    useCandidateButton.dataset.testid = 'dataset-alias-management-use-candidate';
    useCandidateButton.textContent = 'Use stripped candidate';
    actionRow.appendChild(useCandidateButton);

    form.appendChild(actionRow);
    root.appendChild(form);
    container.appendChild(root);

    let datasetDropdown = null;

    try {
        snapshot = await fetchDatasetAliasManagement();
    } catch (error) {
        console.warn('dataset_alias_management_view: load failed', error);
        showErrorToast(error?.message || 'Loading dataset alias management failed');
        return;
    }

    const datasets = Array.isArray(snapshot?.datasets) ? [...snapshot.datasets] : [];
    policyText.textContent = snapshot?.system_alias_policy_recommendation || 'No additional policy recommendation is available.';

    datasetDropdown = createVanillaDropdown({
        containerElement: datasetDropdownContainer,
        options: datasets.map((entry) => ({ value: entry.dataset_name, label: entry.dataset_name })),
        placeholder: 'Select dataset...',
        searchPlaceholder: 'Search datasets...',
        onChange: (datasetName) => {
            selectedDatasetName = datasetName || '';
            applySelectedDataset();
        },
    });

    if (datasets.length === 0) {
        showWarningToast('No datasets available for alias management.');
        setFormDisabled(true);
        applyEntryToForm(null);
        return;
    }

    selectedDatasetName = datasets[0].dataset_name;
    datasetDropdown.setValue(selectedDatasetName);
    applySelectedDataset();

    clearButton.addEventListener('click', async () => {
        const selectedEntry = getSelectedEntry();
        if (!selectedEntry) {
            showInfoToast('Select a dataset before clearing an alias.');
            return;
        }
        if (isImplicitAliasSource(selectedEntry)) {
            showInfoToast(getImplicitAliasSourceMessage(selectedEntry));
            return;
        }
        if (!selectedEntry.stored_primary_alias && !selectedEntry.effective_public_alias) {
            showInfoToast('Selected dataset already uses its raw URL only.');
            return;
        }

        aliasInput.value = '';
        submitAliasChange('');
    });
    useCandidateButton.addEventListener('click', () => {
        const selectedEntry = getSelectedEntry();
        if (!selectedEntry) {
            showInfoToast('Select a dataset before using the default alias.');
            return;
        }

        const nextCandidate = String(selectedEntry.default_public_alias_candidate || '').trim().toLowerCase();
        if (!nextCandidate) {
            showInfoToast('Selected dataset has no stripped alias candidate.');
            return;
        }

        aliasInput.value = nextCandidate;
        syncCandidateButtonState(selectedEntry);
        aliasInput.focus();
        aliasInput.select();
    });
    aliasInput.addEventListener('input', () => {
        syncCandidateButtonState(getSelectedEntry());
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const selectedEntry = getSelectedEntry();
        if (!selectedEntry) {
            showInfoToast('Select a dataset before saving.');
            return;
        }

        const nextAlias = aliasInput.value.trim().toLowerCase();
        if (!nextAlias && isImplicitAliasSource(selectedEntry)) {
            showInfoToast(getImplicitAliasSourceMessage(selectedEntry));
            return;
        }
        if (isNoopAliasSubmission(selectedEntry, nextAlias)) {
            showInfoToast('No changes to save.');
            return;
        }

        submitAliasChange(nextAlias);
    });

    function getSelectedEntry() {
        return datasets.find((entry) => entry.dataset_name === selectedDatasetName) || null;
    }

    function applySelectedDataset() {
        applyEntryToForm(getSelectedEntry());
    }

    function applyEntryToForm(entry) {
        if (!entry) {
            aliasInput.value = '';
            aliasInput.placeholder = 'public-dataset-slug';
            aliasSourceValue.textContent = 'No dataset selected';
            rawRouteValue.textContent = '-';
            canonicalRouteValue.textContent = '-';
            publicRouteValue.textContent = '-';
            defaultCandidateValue.textContent = '-';
            policyDetailText.textContent = 'Select a dataset to review how its public alias policy behaves.';
            clearButton.disabled = true;
            useCandidateButton.disabled = true;
            return;
        }

        aliasInput.value = entry.stored_primary_alias || entry.effective_public_alias || '';
        aliasInput.placeholder = entry.default_public_alias_candidate || 'public-dataset-slug';
        aliasSourceValue.textContent = ALIAS_SOURCE_LABELS[entry.alias_source] || entry.alias_source || 'Unknown';
        rawRouteValue.textContent = entry.raw_dataset_path || '-';
        canonicalRouteValue.textContent = entry.canonical_dataset_path || entry.raw_dataset_path || '-';
        publicRouteValue.textContent = entry.public_dataset_path || 'Raw URL only';
        defaultCandidateValue.textContent = getDefaultCandidateLabel(entry);
        policyDetailText.textContent = getAliasPolicyDetail(entry);
        clearButton.disabled = !entry.stored_primary_alias;
        syncCandidateButtonState(entry);
    }

    async function submitAliasChange(nextAlias) {
        if (!selectedDatasetName) {
            showInfoToast('Select a dataset before saving.');
            return;
        }

        setFormDisabled(true);
        try {
            const response = /** @type {SaveDatasetAliasManagementResponse} */ (await saveDatasetAliasManagement({
                dataset_name: selectedDatasetName,
                alias_slug: nextAlias,
            }));

            if (!response?.dataset) {
                throw new Error('Missing saved dataset alias entry in response');
            }

            const nextEntry = response.dataset;
            const existingIndex = datasets.findIndex((entry) => entry.dataset_name === nextEntry.dataset_name);
            if (existingIndex >= 0) {
                datasets.splice(existingIndex, 1, nextEntry);
            } else {
                datasets.push(nextEntry);
                datasets.sort((left, right) => left.dataset_name.localeCompare(right.dataset_name));
            }

            selectedDatasetName = nextEntry.dataset_name;
            snapshot.system_alias_policy_recommendation = response.system_alias_policy_recommendation
                || snapshot.system_alias_policy_recommendation
                || '';
            policyText.textContent = snapshot.system_alias_policy_recommendation || policyText.textContent;
            applySelectedDataset();
            await refreshDatasetAliasRegistry();
            showSuccessToast(response?.message || 'Dataset alias saved');
        } catch (error) {
            console.warn('dataset_alias_management_view: save failed', error);
            showErrorToast(error?.message || 'Saving dataset alias failed');
        } finally {
            setFormDisabled(false);
        }
    }

    function setFormDisabled(disabled) {
        if (datasetDropdownContainer) {
            datasetDropdownContainer.style.pointerEvents = disabled ? 'none' : '';
            datasetDropdownContainer.style.opacity = disabled ? '0.65' : '';
        }
        aliasInput.disabled = disabled;
        saveButton.disabled = disabled;
        const selectedEntry = getSelectedEntry();
        clearButton.disabled = disabled || !selectedEntry?.stored_primary_alias;
        syncCandidateButtonState(selectedEntry, disabled);
        if (datasetDropdown && typeof datasetDropdown.setValue === 'function' && !selectedDatasetName && datasets.length > 0) {
            datasetDropdown.setValue(datasets[0].dataset_name);
        }
    }

    function syncCandidateButtonState(entry, forceDisabled = false) {
        const defaultCandidate = String(entry?.default_public_alias_candidate || '').trim().toLowerCase();
        const currentAliasValue = aliasInput.value.trim().toLowerCase();
        useCandidateButton.disabled = forceDisabled || !defaultCandidate || defaultCandidate === currentAliasValue;
    }
}

function appendPreviewRow(container, labelText) {
    const row = document.createElement('div');
    row.classList.add('dataset-alias-management-preview-row');

    const label = document.createElement('span');
    label.classList.add('dataset-alias-management-preview-label');
    label.textContent = labelText;
    row.appendChild(label);

    const value = document.createElement('code');
    value.classList.add('dataset-alias-management-preview-value');
    value.textContent = '-';
    row.appendChild(value);

    container.appendChild(row);
    return value;
}

function isImplicitAliasSource(entry) {
    return Boolean(
        entry
        && !entry.stored_primary_alias
        && (entry.alias_source === 'code_fallback' || entry.alias_source === 'automatic_app_policy')
    );
}

function getImplicitAliasSourceMessage(entry) {
    if (entry?.alias_source === 'automatic_app_policy') {
        return 'This alias currently comes from the automatic app_ alias policy. Save a different alias to override it; clearing it keeps the automatic app_ route in place.';
    }
    return 'This alias currently comes from the fallback safety net. Save a different alias to override it; clearing it requires removing the code fallback.';
}

function getDefaultCandidateLabel(entry) {
    if (!entry?.default_public_alias_candidate) {
        return 'No stripped candidate';
    }
    if (entry.default_alias_auto_reserved) {
        return `${entry.default_public_alias_candidate} (auto-applies for app_ datasets)`;
    }
    return `${entry.default_public_alias_candidate} (opt-in only; save to activate)`;
}

function getAliasPolicyDetail(entry) {
    if (!entry) {
        return 'Select a dataset to review how its public alias policy behaves.';
    }
    if (entry.alias_source === 'automatic_app_policy') {
        return 'This app_ dataset is using its stripped alias automatically. Save the same alias to persist it in the DB, or save a different alias to override it.';
    }
    if (entry.alias_source === 'code_fallback') {
        return 'This alias is currently coming from the historical fallback map. Save the same alias to persist it in the DB, or save a different alias to override it.';
    }
    if (entry.alias_source === 'database_primary_active' && entry.default_alias_auto_reserved) {
        return 'This app_ dataset currently has an explicit DB alias stored. Clearing it falls back to the automatic app_ route when the stripped alias is still available.';
    }
    if (entry.alias_source === 'database_primary_active') {
        return 'This public alias is active because it was saved explicitly. Clearing it returns the dataset to its raw URL unless another implicit alias source still applies.';
    }
    if (!entry.default_public_alias_candidate) {
        return 'This dataset has no prefix-based default alias candidate.';
    }
    if (entry.default_alias_auto_reserved) {
        return 'This app_ dataset keeps its stripped alias reserved automatically for routing stability.';
    }
    return 'This system_ dataset keeps its raw URL by default. Save an alias here only when the public route has been intentionally approved.';
}

function isNoopAliasSubmission(entry, nextAlias) {
    if (!entry) {
        return true;
    }

    const normalizedAlias = String(nextAlias || '').trim().toLowerCase();
    const storedAlias = String(entry.stored_primary_alias || '').trim().toLowerCase();

    if (!normalizedAlias && !storedAlias) {
        return true;
    }

    return normalizedAlias === storedAlias;
}
