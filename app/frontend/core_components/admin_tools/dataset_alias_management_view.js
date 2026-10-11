// dataset_alias_management_view.js
// Renders primary aliases, route previews and preserved collision-audit notices.
// Connects the dedicated administrator API and the readable catalogue refresh.
// Keeps failed drafts intact and uses translated copy in both application themes.
import { fetchDatasetAliasManagement, saveDatasetAliasManagement } from '../endpoints/stable_endpoint_router.js';
import { createVanillaDropdown } from '../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js';
import { showErrorToast, showInfoToast, showSuccessToast, showWarningToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import { refreshDatasetCatalogue } from '../navigation/nav_engine/dataset_access_registry.js';
import { aliasCopy as copy, loadAliasTranslations } from './dataset_alias_management_copy.js';
import { bindDatasetLanguageRenderer } from '../table_views/dataset_value_localizer.js';

/** @typedef {import('../../generated/go_contract_types').AliasManagementEntry} DatasetAliasManagementEntry */

export async function generate_dataset_alias_management_view(container) {
    if (!container) return;
    await loadAliasTranslations();
    container.replaceChildren();
    const root = element('div', 'dataset-alias-management-view fw-container fw-flex fw-flex-col fw-gap-4');
    const intro = element('section', 'fw-card fw-flex fw-flex-col fw-gap-2');
    intro.append(translatedElement('h2', '', 'title'), translatedElement('p', 'fw-text-muted', 'intro'),
        translatedElement('p', 'dataset-alias-management-note fw-text-sm', 'uniqueness'));
    root.append(intro);

    const form = element('form', 'dataset-alias-management-form fw-grid fw-gap-4');
    const selection = element('section', 'fw-card fw-flex fw-flex-col fw-gap-4');
    const dropdownContainer = element('div', 'dataset-alias-management-dataset-dropdown');
    dropdownContainer.dataset.testid = 'dataset-alias-management-dataset';
    const aliasInput = document.createElement('input');
    aliasInput.id = 'dataset_alias_management_alias_slug';
    aliasInput.type = 'text';
    aliasInput.className = 'fw-form-control';
    aliasInput.dataset.testid = 'dataset-alias-management-input';
    bindDatasetLanguageRenderer(aliasInput, () => { aliasInput.placeholder = copy('slug'); });
    aliasInput.autocomplete = 'off';
    aliasInput.spellcheck = false;
    aliasInput.pattern = '[a-zA-Z0-9_-]*';
    const label = translatedElement('label', 'fw-label', 'primary');
    label.htmlFor = aliasInput.id;
    selection.append(translatedElement('label', 'fw-label', 'dataset'), dropdownContainer, label, aliasInput,
        translatedElement('p', 'fw-text-muted fw-text-sm', 'hint'));
    form.append(selection);

    const grid = element('div', 'dataset-alias-management-grid');
    const routing = element('section', 'fw-card fw-flex fw-flex-col fw-gap-3');
    const previews = element('div', 'dataset-alias-management-preview-grid');
    routing.append(translatedElement('h3', '', 'routing'), previews);
    const source = preview(previews, 'source');
    const raw = preview(previews, 'rawRoute');
    const canonical = preview(previews, 'canonical');
    const publicRoute = preview(previews, 'publicRoute');
    const candidate = preview(previews, 'candidate');
    const policy = element('section', 'fw-card fw-flex fw-flex-col fw-gap-3 dataset-alias-management-policy');
    const policyDetail = element('p', 'dataset-alias-management-note fw-text-sm');
    policy.append(translatedElement('h3', '', 'policy'), translatedElement('p', 'fw-text-muted', 'recommendation'), policyDetail);
    grid.append(routing, policy);
    form.append(grid);

    const audit = element('section', 'fw-card dataset-alias-management-audit');
    audit.dataset.testid = 'dataset-alias-management-audit';
    audit.setAttribute('role', 'status');
    audit.hidden = true;
    form.append(audit);
    const actions = element('div', 'dataset-alias-management-actions fw-flex fw-gap-2 fw-wrap');
    const save = button('save', 'primary', 'submit');
    const clear = button('clear', 'secondary');
    const useCandidate = button('useCandidate', 'ghost');
    actions.append(save, clear, useCandidate);
    form.append(actions);
    root.append(form);
    container.append(root);

    let datasets = [];
    let selectedName = '';
    let snapshot;
    try { snapshot = await fetchDatasetAliasManagement(); }
    catch (error) {
        console.warn('dataset_alias_management_view: load failed', error);
        showErrorToast(copy('loadFailed'));
        setDisabled(true);
        return;
    }
    /** @type {DatasetAliasManagementEntry[]} */
    datasets = Array.isArray(snapshot?.datasets) ? [...snapshot.datasets] : [];
    selectedName = datasets[0]?.dataset_name || '';
    const dropdown = createVanillaDropdown({
        containerElement: dropdownContainer,
        options: datasets.map(entry => ({ value: entry.dataset_name, label: entry.dataset_name })),
        placeholder: copy('select'), searchPlaceholder: copy('search'),
        onChange: name => { selectedName = name || ''; applyEntry(); },
    });
    // The search list may be portalled outside the editor. Update the existing
    // dropdown's placeholders through its instance, preserving selection/search.
    bindDatasetLanguageRenderer(dropdownContainer, () => dropdown.setPlaceholders({
        placeholder: copy('select'), searchPlaceholder: copy('search'),
    }));
    if (!datasets.length) {
        showWarningToast(copy('empty'));
        setDisabled(true);
        return;
    }
    dropdown.setValue(selectedName);
    applyEntry();

    clear.addEventListener('click', () => {
        if (selected()?.stored_primary_alias) void submitAlias('');
    });
    useCandidate.addEventListener('click', () => {
        const name = selected()?.default_public_alias_candidate;
        if (!name) return;
        aliasInput.value = name;
        candidateState();
        aliasInput.focus();
        aliasInput.select();
    });
    aliasInput.addEventListener('input', () => candidateState());
    form.addEventListener('submit', event => {
        event.preventDefault();
        const entry = selected();
        if (!entry) { showInfoToast(copy('selectFirst')); return; }
        const nextAlias = aliasInput.value.trim().toLowerCase();
        if (!nextAlias && implicit(entry)) { showInfoToast(implicitMessage(entry)); return; }
        if (entry.stored_primary_alias === nextAlias) { showInfoToast(copy('noChange')); return; }
        void submitAlias(nextAlias);
    });

    function selected() { return datasets.find(entry => entry.dataset_name === selectedName); }

    function applyEntry() {
        const entry = selected();
        if (!entry) return;
        aliasInput.value = entry.stored_primary_alias || entry.effective_public_alias || '';
        bindDatasetLanguageRenderer(source, () => { source.textContent = copy(entry.alias_source || 'raw_only'); });
        raw.textContent = entry.raw_dataset_path || '-';
        canonical.textContent = entry.canonical_dataset_path || entry.raw_dataset_path || '-';
        bindDatasetLanguageRenderer(publicRoute, () => { publicRoute.textContent = entry.public_dataset_path || copy('rawOnly'); });
        bindDatasetLanguageRenderer(candidate, () => { candidate.textContent = entry.default_public_alias_candidate
            ? copy(entry.default_alias_auto_reserved ? 'automaticCandidate' : 'optInCandidate', { name: entry.default_public_alias_candidate })
            : copy('noCandidate'); });
        bindDatasetLanguageRenderer(policyDetail, () => { policyDetail.textContent = implicit(entry) ? implicitMessage(entry)
            : copy(entry.stored_primary_alias ? 'storedPolicy' : 'recommendation'); });
        audit.replaceChildren();
        audit.hidden = !entry.disabled_aliases?.length;
        if (!audit.hidden) {
            audit.append(translatedElement('h3', '', 'disabled'));
            for (const disabled of entry.disabled_aliases) {
                const notice = element('p', 'dataset-alias-management-note');
                notice.append(element('code', '', disabled.alias_slug), document.createTextNode(': '),
                    translatedElement('span', '', disabled.reason_key));
                audit.append(notice);
            }
        }
        setDisabled(false);
    }

    async function submitAlias(nextAlias) {
        // Capture identity; the selector is disabled for the entire write.
        const datasetName = selectedName;
        setDisabled(true);
        try {
            const response = await saveDatasetAliasManagement({ dataset_name: datasetName, alias_slug: nextAlias });
            if (!response?.dataset) throw new Error('Missing saved dataset alias entry in response');
            const index = datasets.findIndex(entry => entry.dataset_name === datasetName);
            datasets.splice(index, 1, response.dataset);
            applyEntry();
            setDisabled(true);
            await refreshDatasetCatalogue({ force: true });
            showSuccessToast(copy(nextAlias ? 'dataset_alias_saved' : 'dataset_alias_cleared'));
        } catch (error) {
            console.warn('dataset_alias_management_view: save failed', error);
            // Never present pipeline/server diagnostics as interface text.
            showErrorToast(copy(error?.failureNotice?.langKey || 'saveFailed'));
        } finally { setDisabled(false); }
    }

    function setDisabled(disabled) {
        dropdownContainer.style.pointerEvents = disabled ? 'none' : '';
        aliasInput.disabled = disabled;
        save.disabled = disabled;
        clear.disabled = disabled || !selected()?.stored_primary_alias;
        candidateState(disabled);
    }

    function candidateState(disabled = false) {
        const name = selected()?.default_public_alias_candidate || '';
        useCandidate.disabled = disabled || !name || name === aliasInput.value.trim().toLowerCase();
    }
}

function element(tag, className, text = '') {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
}

// Bind only copy-bearing nodes, so language refresh never resets input drafts.
function translatedElement(tag, className, key) {
    const node = element(tag, className);
    bindDatasetLanguageRenderer(node, () => { node.textContent = copy(key); });
    return node;
}

function preview(container, key) {
    const row = element('div', 'dataset-alias-management-preview-row');
    const value = element('code', 'dataset-alias-management-preview-value', '-');
    row.append(translatedElement('span', 'dataset-alias-management-preview-label', key), value);
    container.append(row);
    return value;
}

function button(key, style, type = 'button') {
    const node = translatedElement('button', `fw-btn fw-btn--${style}`, key);
    node.type = type;
    node.dataset.testid = `dataset-alias-management-${key === 'useCandidate' ? 'use-candidate' : key}`;
    return node;
}

function implicit(entry) {
    return !entry.stored_primary_alias && ['automatic_app_policy', 'code_fallback'].includes(entry.alias_source);
}

function implicitMessage(entry) {
    return copy(entry.alias_source === 'automatic_app_policy' ? 'implicitAutomatic' : 'implicitFallback');
}
