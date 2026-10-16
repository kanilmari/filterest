// dataset_default_view_row.js
// Builds the administrator's saved-default row inside View content as.
// Connects the existing view registry/dropdown to the narrow dataset-default API.
// Keeps drafts local and displays only acknowledged server state, including explicit clears.

import { createVanillaDropdown } from '../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js';
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { hasRoutePermission } from '../route_permission_checker.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import { getMainTabLangKey } from '../navigation/main_tabs/main_tab_lang_keys.js';
import { bindDatasetLanguageRenderer } from '../table_views/dataset_value_localizer.js';
import { getAllSpecs, setAllSpecs } from '../state_stores/table_specs_reader.js';
import { getChosenDatasetView } from '../state_stores/dataset_view_choice_saver.js';
import { resolveDatasetDefaultView } from '../table_views/dataset_default_view.js';
import {
    DATASET_VIEW_SELECTOR_GROUP_DIRECT, DATASET_VIEW_SELECTOR_GROUP_MORE,
    getDatasetViewSelectorOptions, getDatasetViewLabelForLanguage,
    getDatasetViewPermissionRoute,
} from '../table_views/dataset_view_registry.js';

export const DATASET_DEFAULT_VIEW_ROUTE = '/api/admin/dataset-default-view';
const requests = new Map();

// Serialize writes across row replacements too: ignoring a stale response alone
// would still allow an older HTTP mutation to overwrite a newer clear on the server.
function requestInOrder(dataset, options) {
    const previous = requests.get(dataset) || Promise.resolve();
    const request = previous.catch(() => {}).then(() => endpoint_router('datasetDefaultView', options));
    requests.set(dataset, request);
    void request.finally(() => { if (requests.get(dataset) === request) requests.delete(dataset); }).catch(() => {});
    return request;
}

function validateResponse(response, dataset) {
    if (response?.dataset !== dataset || !Object.hasOwn(response, 'default_view_name')
        || !Object.hasOwn(response, 'default_view_id') || !Array.isArray(response.offered_views)
        || !(response.default_view_name === null || typeof response.default_view_name === 'string')
        || !(response.default_view_id === null || Number.isInteger(response.default_view_id))) {
        throw new Error('Invalid dataset default response');
    }
    return response;
}

function rememberServerDefault(dataset, response) {
    const specs = getAllSpecs();
    if (specs[dataset]) setAllSpecs({ ...specs, [dataset]: { ...specs[dataset],
        default_view_id: response.default_view_id, default_view_name: response.default_view_name } });
    try {
        const key = dataset + '_tableMeta';
        const metadata = JSON.parse(localStorage.getItem(key) || '{}');
        localStorage.setItem(key, JSON.stringify({ ...metadata, default_view_name: response.default_view_name }));
    } catch { /* A storage failure must not turn a committed server save into a failure. */ }
}

/** Fetches administrator-checked state before exposing the control. */
export async function createDatasetDefaultViewRow(dataset, currentView, columns = [], dataTypes = {}) {
    if (!hasRoutePermission(DATASET_DEFAULT_VIEW_ROUTE)) return null;
    let saved;
    try {
        saved = validateResponse(await requestInOrder(dataset, { url_params: '?dataset=' + encodeURIComponent(dataset) }), dataset);
    } catch { return null; }

    const row = document.createElement('div');
    row.className = 'dataset-default-view-row';
    row.dataset.testid = 'dataset-default-view-row';
    row.dataset.tableName = dataset;
    const prefix = document.createElement('span'); prefix.dataset.langKey = 'dataset_default_view_for';
    const name = document.createElement('span'); name.className = 'dataset-default-view-name';
    const wrapper = document.createElement('div'); wrapper.dataset.testid = 'dataset-default-view';
    const label = document.createElement('label');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
    checkbox.dataset.testid = 'dataset-default-view-checkbox';
    const checkboxText = document.createElement('span'); checkboxText.dataset.langKey = 'dataset_default_view_saved';
    const status = document.createElement('span'); status.setAttribute('role', 'status');
    label.append(checkbox, checkboxText); row.append(prefix, name, wrapper, label, status);

    const context = { datasetName: dataset, columns, dataTypes };
    const candidates = [
        ...getDatasetViewSelectorOptions(DATASET_VIEW_SELECTOR_GROUP_DIRECT, context),
        ...getDatasetViewSelectorOptions(DATASET_VIEW_SELECTOR_GROUP_MORE, context),
    ];
    let activeView = getChosenDatasetView(dataset) || currentView;
    let selected = activeView, language = 'en', pending = false, failed = false, destroyed = false, revision = 0;
    const text = key => getTranslationForKey(key);
    const available = () => candidates.filter(option => saved.offered_views.includes(option.viewKey)).filter(option => {
        const route = getDatasetViewPermissionRoute(option.viewKey);
        const effectiveDefault = resolveDatasetDefaultView(dataset, {
            tableMeta: { default_view_name: saved.default_view_name },
        });
        return !route || hasRoutePermission(route)
            || (option.viewKey === effectiveDefault && option.viewKey !== 'price_chart');
    }).map(option => ({ value: option.viewKey, langKey: option.langKey,
        label: getTranslationForKey(option.langKey, { fallback: getDatasetViewLabelForLanguage(option.viewKey, language) }) }));
    const dropdown = createVanillaDropdown({
        containerElement: wrapper, options: [], showClearButton: false, useSearch: false,
        translate: key => getTranslationForKey(key, { fallback: available().find(option => option.langKey === key)?.label || '' }),
        onChange: value => { selected = value; render(); },
    });

    function render() {
        if (destroyed) return;
        const options = available();
        if (!options.some(option => option.value === selected)) {
            selected = options.find(option => option.value === saved.default_view_name)?.value || options[0]?.value || null;
        }
        prefix.textContent = text('dataset_default_view_for');
        name.textContent = getTranslationForKey(getMainTabLangKey(dataset), {
            fallback: getAllSpecs()[dataset]?.display_name || dataset,
        }) + ':';
        checkboxText.textContent = text('dataset_default_view_saved');
        dropdown.setOptions(options); dropdown.setValue(selected);
        wrapper.querySelector('input').setAttribute('aria-label', prefix.textContent + ' ' + name.textContent);
        checkbox.checked = Boolean(selected && selected === saved.default_view_name);
        checkbox.disabled = pending || !selected;
        dropdown.setDisabled(pending || options.length === 0);
        row.setAttribute('aria-busy', String(pending));
        status.textContent = failed ? text('dataset_default_view_error') : '';
    }

    async function refresh(options) {
        if (destroyed) return;
        const requestRevision = ++revision;
        pending = true; failed = false; render();
        try {
            const response = validateResponse(await requestInOrder(dataset, options), dataset);
            if (destroyed || requestRevision !== revision) return;
            saved = response; rememberServerDefault(dataset, response);
        } catch {
            if (!destroyed && requestRevision === revision) {
                failed = true;
                // A transport failure can occur after commit. Re-read instead of
                // assuming that a failed response means the previous value survived.
                try {
                    const response = validateResponse(await requestInOrder(dataset, {
                        url_params: '?dataset=' + encodeURIComponent(dataset),
                    }), dataset);
                    if (!destroyed && requestRevision === revision) {
                        saved = response; rememberServerDefault(dataset, response);
                    }
                } catch { /* Keep the last acknowledged state and the failure notice. */ }
            }
        } finally {
            if (!destroyed && requestRevision === revision) { pending = false; render(); }
        }
    }
    checkbox.addEventListener('change', () => {
        const requested = checkbox.checked ? selected : null;
        void refresh({ method: 'POST', body_data: { dataset, view_key: requested } });
    });
    row.__syncView = view => {
        if (destroyed || !view || view === activeView) return;
        activeView = view;
        selected = view;
        void refresh({ url_params: '?dataset=' + encodeURIComponent(dataset) });
    };
    // Translation callbacks live on this DOM node, with no document language listener.
    bindDatasetLanguageRenderer(row, chosenLanguage => { language = chosenLanguage; render(); });
    let mounted = false;
    const observer = new MutationObserver(records => {
        mounted ||= records.some(record => [...record.addedNodes].some(node => node === row || node.contains(row)));
        if (row.isConnected) mounted = true;
        else if (mounted) row.__destroy();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    row.__destroy = () => { destroyed = true; revision += 1; observer.disconnect(); dropdown.destroy(); };
    return row;
}
