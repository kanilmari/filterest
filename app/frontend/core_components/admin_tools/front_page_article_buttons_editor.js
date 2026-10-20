// front_page_article_buttons_editor.js
// Edits the site's ordered Home article list independently of Home boxes and palette.
// Connects the readable grouped catalogue, canonical row picker and revision-protected API.
// Keeps rejected drafts, exposes private unavailable warnings and never copies labels into settings.
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { bindDatasetLanguageRenderer } from '../table_views/dataset_value_localizer.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import { fetchCurrentUserProfile } from '../user_tools/current_user_profile_fetcher.js';
import { showConfirmModal } from '../../reusable_components/modal/confirm_modal_builder.js';
import { frontPageText } from './front_page_settings_controls.js';
import { articleButtonCopy as copy } from './front_page_article_buttons_copy.js';
import { createArticleRowPicker, resolveArticleButtonLabel } from './front_page_article_row_picker.js';

const MAX_BUTTONS = 10;
const emptyList = () => ({ schema_version: 1, placement: 'below_text', items: [] });

/** Validate the same bounded identity contract as system_config_checks/front_page_article_buttons.go. */
export function validArticleButtonConfiguration(value) {
    if (value?.schema_version !== 1 || !['below_text', 'top_row'].includes(value.placement)
        || !Array.isArray(value.items) || value.items.length > MAX_BUTTONS) return false;
    const seen = new Set();
    return value.items.every(item => {
        const identity = `${item.table_uid}:${item.row_id}`;
        const valid = Number.isSafeInteger(item.table_uid) && item.table_uid > 0
            && typeof item.row_id === 'string' && /^(0|[1-9]\d*)$/.test(item.row_id)
            && typeof item.enabled === 'boolean' && !seen.has(identity)
            && (item.view === undefined || ['article_view', 'image_first_page_view'].includes(item.view));
        seen.add(identity);
        return valid;
    });
}

/** Independent draft/revision owner; parent Home settings owns navigation and cleanup. */
export function createFrontPageArticleButtonsEditor({ onSaved, onChange = () => {} }) {
    const element = document.createElement('fieldset');
    element.className = 'front-page-settings-section';
    element.dataset.testid = 'front-page-article-editor';
    function translated(tag, key) {
        const node = document.createElement(tag);
        node.dataset.articleCopy = key;
        node.textContent = copy(key);
        return node;
    }
    function button(key, id = key) {
        const node = translated('button', key);
        node.type = 'button'; node.className = 'fw-btn fw-btn--ghost';
        node.dataset.testid = `front-page-article-${id}`;
        return node;
    }
    function field(key, input, id) {
        const label = document.createElement('label');
        label.className = `front-page-settings-field${input.type === 'checkbox' ? ' front-page-settings-checkbox' : ''}`;
        input.id = `front-page-article-${id}`; input.dataset.testid = input.id;
        label.htmlFor = input.id; label.append(translated('span', key), input);
        return label;
    }
    const placement = document.createElement('select');
    for (const key of ['below_text', 'top_row']) {
        const option = translated('option', key); option.value = key; placement.append(option);
    }
    function presentationSelect(view, changed) {
        const select = document.createElement('select');
        for (const key of ['article_view', 'image_first_page_view']) {
            const option = translated('option', key); option.value = key; select.append(option);
        }
        select.value = view || 'article_view';
        select.addEventListener('change', () => changed(select.value));
        return select;
    }
    const newPresentation = presentationSelect('article_view', view => { void picker.setView(view); });
    const datasetSelect = document.createElement('select');
    const list = document.createElement('ol');
    list.className = 'front-page-settings-block-list'; list.dataset.testid = 'front-page-article-list';
    const preview = document.createElement('p'); preview.dataset.testid = 'front-page-article-preview';
    const status = document.createElement('p');
    status.dataset.testid = 'front-page-article-status'; status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
    const save = button('save'), reload = button('reload'), add = button('add');
    const actions = document.createElement('div'); actions.className = 'front-page-settings-actions';
    actions.append(save, reload);
    let draft = emptyList(), baseline = '', version = '', datasets = [], selection = null;
    let ready = false, busy = false, conflicted = false, disposed = false, configurationError = false;
    let statusKey = '', labelsGeneration = 0, viewerID = 0;
    const lifetime = new AbortController();
    const picker = createArticleRowPicker({ onChange: value => { selection = value; update(); } });
    const rowLabel = translated('label', 'row'); rowLabel.htmlFor = 'front-page-article-row'; rowLabel.id = 'front-page-article-picker-label';
    picker.element.setAttribute('aria-labelledby', rowLabel.id);
    element.append(translated('legend', 'title'), translated('p', 'help'), field('placement', placement, 'placement'),
        list, field('presentation', newPresentation, 'new-view'), field('dataset', datasetSelect, 'dataset'), rowLabel, picker.element, preview, add, status, actions);

    function payload() {
        return { schema_version: 1, placement: placement.value,
            items: draft.items.map(({ table_uid, row_id, enabled, view }) => ({ table_uid, row_id, enabled,
                ...(view === undefined ? {} : { view }) })) };
    }
    function dirty() { return ready && (configurationError || JSON.stringify(payload()) !== baseline); }
    function report(key) { statusKey = key; status.textContent = key ? copy(key) : ''; }
    function update() {
        placement.disabled = datasetSelect.disabled = newPresentation.disabled = !ready || busy;
        picker.setDisabled(!ready || busy);
        add.disabled = !ready || busy || !selection || !selection.label || draft.items.length >= MAX_BUTTONS;
        save.disabled = !ready || busy || conflicted || !dirty();
        reload.disabled = busy;
        list.querySelectorAll('input,button,select').forEach(control => {
            control.disabled = busy || control.dataset.boundary === 'true' || control.dataset.unavailable === 'true';
        });
        preview.textContent = selection ? copy('preview', { label: selection.label }) : '';
        element.setAttribute('aria-busy', String(busy));
        onChange();
    }
    function targetName(item) {
        return item.label || copy('target', { dataset: datasets.find(entry => entry.table_uid === item.table_uid)?.dataset_name
            || item.table_uid, row: item.row_id });
    }
    function renderList(focusIdentity = '', focusAction = '') {
        list.replaceChildren(...draft.items.map((item, index) => {
            const row = document.createElement('li'); row.className = 'front-page-settings-block';
            row.dataset.identity = `${item.table_uid}:${item.row_id}`;
            const title = document.createElement('strong'); title.textContent = targetName(item);
            const enabled = Object.assign(document.createElement('input'), { type: 'checkbox', checked: item.enabled });
            enabled.dataset.unavailable = String(Boolean(item.unavailable));
            enabled.addEventListener('change', () => { item.enabled = enabled.checked; update(); });
            const warning = translated('p', 'unavailable'); warning.className = 'front-page-settings-warning';
            warning.hidden = !item.unavailable; warning.id = `front-page-article-warning-${index}`;
            if (item.unavailable) row.setAttribute('aria-describedby', warning.id);
            const rowActions = document.createElement('div'); rowActions.className = 'front-page-settings-actions';
            for (const action of ['up', 'down', 'remove']) {
                const control = button(action, `${index}-${action}`);
                control.dataset.action = action;
                control.setAttribute('aria-label', `${copy(action)}: ${targetName(item)}`);
                control.dataset.boundary = String(action === 'up' && index === 0 || action === 'down' && index === draft.items.length - 1);
                control.addEventListener('click', () => {
                    if (busy) return;
                    const offset = action === 'up' ? -1 : 1;
                    if (action === 'remove') draft.items.splice(index, 1);
                    else [draft.items[index], draft.items[index + offset]] = [draft.items[index + offset], item];
                    const focusItem = action === 'remove' ? draft.items[Math.min(index, draft.items.length - 1)] : item;
                    const targetAction = action === 'up' && index === 1 ? 'down'
                        : action === 'down' && index === draft.items.length - 2 ? 'up' : action;
                    renderList(focusItem ? `${focusItem.table_uid}:${focusItem.row_id}` : '', targetAction);
                    update(); if (!draft.items.length) datasetSelect.focus();
                });
                rowActions.append(control);
            }
            const presentation = presentationSelect(item.view, view => {
                item.view = view;
                item.targetUnavailable = false;
                void refreshLabels(); update();
            });
            row.append(title, warning, field('enabled', enabled, `${index}-enabled`),
                field('presentation', presentation, `${index}-view`), rowActions);
            return row;
        }));
        Array.from(list.children).find(row => row.dataset.identity === focusIdentity)
            ?.querySelector(`[data-action="${focusAction}"]`)?.focus();
    }
    function renderDatasets() {
        const previousValue = datasetSelect.value;
        const placeholder = translated('option', 'chooseDataset'); placeholder.value = '';
        datasetSelect.replaceChildren(placeholder);
        for (const [key, current] of [['currentProject', true], ['otherDatasets', false]]) {
            const group = document.createElement('optgroup'); group.label = copy(key);
            for (const dataset of datasets.filter(entry => Boolean(entry.is_in_current_project) === current)) {
                const option = document.createElement('option'); option.value = String(dataset.table_uid);
                option.textContent = getTranslationForKey(dataset.dataset_name, { fallback: dataset.dataset_name, countUsage: false });
                group.append(option);
            }
            if (group.hasChildNodes()) datasetSelect.append(group);
        }
        datasetSelect.value = previousValue;
    }
    async function refreshLabels() {
        const generation = ++labelsGeneration;
        const language = getLanguageWithBrowserFallback();
        await Promise.all(draft.items.map(async item => {
            const dataset = datasets.find(entry => entry.table_uid === item.table_uid);
            if (item.targetUnavailable || !dataset) { item.unavailable = true; return; }
            try {
                const response = await endpoint_router('getResults', { signal: lifetime.signal, suppressErrorToast: true,
                    suppressAuthRedirect: true, url_params: `?${new URLSearchParams({ dataset: dataset.dataset_name,
                        id: item.row_id, row_count: '0', view_key: item.view || 'article_view', lang: language })}` });
                if (disposed || generation !== labelsGeneration) return;
                const row = response.data?.find(value => String(value.id) === item.row_id);
                item.label = row ? resolveArticleButtonLabel(row, response.columns, response.types, language, viewerID) : '';
                item.unavailable = !item.label;
            } catch { if (!disposed && generation === labelsGeneration) item.unavailable = true; }
        }));
        if (!disposed && generation === labelsGeneration) { renderList(); update(); }
    }
    async function load() {
        if (busy || disposed) return;
        busy = true; update(); report('loading');
        try {
            const [data, catalogue, profile] = await Promise.all([
                endpoint_router('adminFrontPageArticleButtons', { signal: lifetime.signal, suppressErrorToast: true }),
                endpoint_router('fetchContentTables', { signal: lifetime.signal, suppressErrorToast: true }),
                fetchCurrentUserProfile(),
            ]);
            if (disposed) return;
            configurationError = Boolean(data.configuration_error);
            if (!validArticleButtonConfiguration(data.article_buttons) || typeof data.version !== 'string' || !data.version) {
                throw new Error('invalid article settings response');
            }
            datasets = (catalogue.datasets || []).filter(entry => entry.can_read_rows === true
                && Number.isSafeInteger(entry.table_uid) && entry.table_uid > 0 && typeof entry.dataset_name === 'string');
            viewerID = profile?.user_id || 0; picker.setViewerID(viewerID);
            draft = structuredClone(data.article_buttons); version = data.version; placement.value = draft.placement;
            for (const warning of data.unavailable_items || []) {
                const item = draft.items[warning.index];
                if (item && item.table_uid === warning.table_uid && item.row_id === warning.row_id) item.unavailable = item.targetUnavailable = true;
            }
            baseline = JSON.stringify(payload()); conflicted = false; ready = true;
            renderDatasets(); renderList(); await picker.setDataset(null); datasetSelect.value = '';
            newPresentation.value = 'article_view'; await picker.setView('article_view');
            await refreshLabels(); report(configurationError ? 'configurationError' : '');
        } catch { if (!disposed) report('loadFailed'); }
        finally { busy = false; if (!disposed) update(); }
    }
    placement.addEventListener('change', update);
    datasetSelect.addEventListener('change', () => {
        void picker.setDataset(datasets.find(entry => String(entry.table_uid) === datasetSelect.value) || null);
    });
    add.addEventListener('click', () => {
        const candidate = selection && { table_uid: selection.table_uid, row_id: selection.row_id, enabled: true,
            ...(selection.view === undefined ? {} : { view: selection.view }) };
        const proposed = { ...payload(), items: [...payload().items, candidate] };
        if (!candidate || !selection.label || !validArticleButtonConfiguration(proposed)) { report('invalid'); return; }
        draft.items.push({ ...candidate, label: selection.label });
        renderList(`${candidate.table_uid}:${candidate.row_id}`, 'remove'); report(''); update();
    });
    save.addEventListener('click', async () => {
        if (!ready || busy || conflicted || !dirty()) return;
        const value = payload();
        if (!validArticleButtonConfiguration(value) || draft.items.some(item => item.unavailable)) { report('invalid'); return; }
        busy = true; update(); report('saving');
        let saved = false;
        try {
            const response = await endpoint_router('adminFrontPageArticleButtons', { method: 'POST',
                body_data: { article_buttons: value, version }, signal: lifetime.signal, suppressErrorToast: true });
            if (disposed) return;
            version = response.version; baseline = JSON.stringify(value); configurationError = false; saved = true;
            await onSaved?.(); if (!disposed) report('saved');
        } catch (error) {
            if (!disposed) {
                conflicted = error?.status === 409;
                report(conflicted ? 'conflict' : saved ? 'refreshFailed' : 'saveFailed');
            }
        } finally { busy = false; if (!disposed) update(); }
    });
    reload.addEventListener('click', async () => {
        if (dirty() && !await showConfirmModal({ messageLangKey: 'front_page_discard_changes',
            messagePlainText: frontPageText('front_page_discard_changes'), confirmLangKey: 'front_page_discard',
            confirmText: frontPageText('front_page_discard'), cancelText: frontPageText('cancel') })) return;
        await load();
    });
    let language = getLanguageWithBrowserFallback();
    bindDatasetLanguageRenderer(element, async () => {
        element.querySelectorAll('[data-article-copy]').forEach(node => { node.textContent = copy(node.dataset.articleCopy); });
        renderDatasets(); report(statusKey);
        if (language !== getLanguageWithBrowserFallback()) {
            language = getLanguageWithBrowserFallback();
            await refreshLabels();
        } else renderList();
        update();
    });
    update();
    return { element, load, dirty, busy: () => busy,
        destroy() { disposed = true; labelsGeneration++; lifetime.abort(); picker.destroy(); } };
}
