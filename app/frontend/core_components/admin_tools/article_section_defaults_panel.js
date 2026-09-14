// article_section_defaults_panel.js
// Edits each dataset's initial article disclosure states through a dedicated atomic API.
// Connects the existing field-settings page to independent classic and IFAV defaults.
// Preserves per-context drafts and verifies saves without changing field/group assignments.
import { getArticleSectionDefaults, saveArticleSectionDefaults } from '../endpoints/stable_endpoint_router.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { showSuccessToast, showWarningToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import { getArticleSectionDefaultsCopy } from './article_section_defaults_copy.js';

const SECTIONS = {
    classic: ['details', 'images', 'attachments', 'related_rows', 'task_progress'],
    image_first: ['details'],
};
function validateResponse(value, dataset, presentation) {
    if (!value || value.dataset !== dataset || value.presentation_key !== presentation
        || JSON.stringify(value.supported_sections) !== JSON.stringify(SECTIONS[presentation])
        || typeof value.can_edit !== 'boolean' || !value.overrides || !value.initial_open) {
        throw new Error('Article section response target mismatch');
    }
    for (const key of Object.keys(value.overrides)) {
        if (!SECTIONS[presentation].includes(key) || typeof value.overrides[key] !== 'boolean') throw new Error('Invalid article override');
    }
    for (const key of SECTIONS[presentation]) {
        if (typeof value.initial_open[key] !== 'boolean'
            || value.initial_open[key] !== (value.overrides[key] ?? true)) throw new Error('Invalid article effective state');
    }
    return value;
}
export function createArticleSectionDefaultsPanel({
    host, requestFn = getArticleSectionDefaults, saveFn = saveArticleSectionDefaults,
}) {
    const contexts = new Map();
    let active = null, dataset = '', view = '', destroyed = false;
    let copy = getArticleSectionDefaultsCopy(getLanguageWithBrowserFallback());
    const panel = document.createElement('fieldset');
    panel.className = 'view-field-assignments__controls';
    panel.dataset.testid = 'article-section-defaults';
    panel.style.minWidth = '0';
    const title = document.createElement('legend');
    const info = document.createElement('p');
    const label = document.createElement('label'); label.className = 'view-field-assignments__label';
    const labelText = document.createElement('span');
    const select = document.createElement('select'); select.className = 'view-field-assignments__select';
    select.dataset.testid = 'article-section-defaults-presentation';
    for (const key of Object.keys(SECTIONS)) { const option = document.createElement('option'); option.value = key; select.append(option); }
    label.append(labelText, select);
    const fields = document.createElement('div');
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    status.dataset.testid = 'article-section-defaults-status';
    const actions = document.createElement('div'); actions.className = 'view-field-assignments__actions';
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'fw-btn';
    reset.dataset.testid = 'article-section-defaults-reset';
    const save = document.createElement('button'); save.type = 'button'; save.className = 'fw-btn fw-btn--primary';
    save.dataset.testid = 'article-section-defaults-save';
    actions.append(reset, save); panel.append(title, info, label, fields, status, actions); host.append(panel);
    function changed(entry) {
        return Object.fromEntries(Object.entries(entry?.draft || {}).filter(([key, value]) => value !== entry.response?.initial_open[key]));
    }
    function render() {
        panel.hidden = !dataset || view !== 'article_view';
        panel.style.display = panel.hidden ? 'none' : 'grid';
        title.textContent = copy.title; info.textContent = copy.info; labelText.textContent = copy.presentation;
        for (const option of select.options) option.textContent = copy[option.value];
        reset.textContent = copy.reset; save.textContent = copy.save;
        fields.replaceChildren();
        const editable = active?.response?.can_edit && !active.loading && !active.saving;
        for (const key of SECTIONS[select.value]) {
            const row = document.createElement('label'); row.className = 'view-field-assignments__visibility';
            row.style.display = 'flex';
            const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
            checkbox.dataset.testid = 'article-section-default-' + key;
            checkbox.checked = active?.draft?.[key] ?? true; checkbox.disabled = !editable;
            checkbox.setAttribute('aria-label', copy[key] + ': ' + copy.open);
            const text = document.createElement('span'); text.textContent = copy[key] + ' — ' + copy.open;
            checkbox.addEventListener('change', () => { active.draft[key] = checkbox.checked; syncStatus(); });
            row.append(checkbox, text); fields.append(row);
        }
        syncStatus();
    }
    function syncStatus() {
        const dirty = Object.keys(changed(active)).length > 0;
        save.disabled = !active?.response?.can_edit || active.loading || active.saving || !dirty;
        reset.disabled = !active?.response?.can_edit || active.loading || active.saving;
        status.textContent = active?.error ? copy.error : active?.loading ? copy.loading
            : active?.response?.can_edit === false ? copy.readOnly : dirty ? copy.dirty : '';
    }
    async function loadCurrent() {
        if (destroyed) return;
        if (!dataset || view !== 'article_view') { active = null; render(); return; }
        const presentation = select.value, key = dataset + ':' + presentation;
        if (contexts.has(key)) { active = contexts.get(key); render(); return; }
        const entry = { dataset, presentation, loading: true, saving: false, response: null, draft: null, error: false };
        contexts.set(key, entry); active = entry; render();
        try {
            entry.response = validateResponse(await requestFn(entry.dataset, presentation), entry.dataset, presentation);
            entry.draft = { ...entry.response.initial_open };
        } catch { entry.error = true; contexts.delete(key); }
        finally { entry.loading = false; if (!destroyed && active === entry) render(); }
    }
    async function persist(isReset) {
        const entry = active;
        if (!entry?.response?.can_edit || entry.saving || entry.loading) return;
        const patch = changed(entry);
        if (!isReset && Object.keys(patch).length === 0) return;
        entry.saving = true; entry.error = false; render();
        const payload = { dataset: entry.dataset, presentation_key: entry.presentation,
            ...(isReset ? { reset_to_defaults: true } : { initial_open: patch }) };
        try {
            validateResponse(await saveFn(payload), entry.dataset, entry.presentation);
            const actual = validateResponse(await requestFn(entry.dataset, entry.presentation), entry.dataset, entry.presentation);
            if (isReset ? Object.keys(actual.overrides).length !== 0
                : Object.entries(patch).some(([key, value]) => actual.overrides[key] !== value)) throw new Error('Article section readback mismatch');
            entry.response = actual; entry.draft = { ...actual.initial_open };
            if (!destroyed && active === entry) showSuccessToast(isReset ? copy.restored : copy.saved);
        } catch {
            entry.error = true;
            if (!destroyed && active === entry) showWarningToast(copy.error);
        } finally { entry.saving = false; if (!destroyed && active === entry) render(); }
    }
    select.addEventListener('change', () => { void loadCurrent(); });
    save.addEventListener('click', () => { void persist(false); });
    reset.addEventListener('click', () => { void persist(true); });
    const languageObserver = new MutationObserver(() => {
        copy = getArticleSectionDefaultsCopy(getLanguageWithBrowserFallback()); render();
    });
    languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    render();
    return {
        element: panel,
        setContext(nextDataset, nextView) { dataset = nextDataset || ''; view = nextView || ''; return loadCurrent(); },
        destroy() { destroyed = true; active = null; contexts.clear(); languageObserver.disconnect(); panel.remove(); },
    };
}
