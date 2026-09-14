// dataset_card_palette_control.js
// Edits only the current dataset's nullable card presentation overrides.
// Bridges the existing card-visibility API and transient card-only palette previews.
// Keeps dataset saves separate from site defaults and never rewrites field metadata.
import { fetchCardVisibility, saveDatasetCardPresentation } from '../endpoints/stable_endpoint_router.js';
import {
    setDatasetCardPresentationPreview, releaseDatasetCardPresentationPreview,
    applySavedDatasetCardPresentation,
} from '../table_views/card_view/card_field_presentation.js';
import {
    normalizeClientCardStyleOverride, normalizeCardDetailColumnOverride,
} from '../table_views/card_view/card_detail_layout_options.js';

const clone = value => ({ ...value });
// One dataset's reads/saves finish in issue order, including response projection.
// No DOM or credentials are retained after the last queued operation settles.
const datasetOperations = new Map();
function enqueueDatasetOperation(datasetName, operation) {
    const previous = datasetOperations.get(datasetName) || Promise.resolve();
    const queued = previous.catch(() => {}).then(operation);
    datasetOperations.set(datasetName, queued);
    return queued.finally(() => {
        if (datasetOperations.get(datasetName) === queued) datasetOperations.delete(datasetName);
    });
}

function normalizedSettings(value, datasetName) {
    if (!value || value.table_name !== datasetName) throw new Error('Dataset presentation response mismatch');
    if (!('card_style_variant' in value) || !('card_detail_columns' in value)) {
        throw new Error('Dataset presentation response incomplete');
    }
    if (value.card_style_variant !== null && normalizeClientCardStyleOverride(value.card_style_variant) === null) {
        throw new Error('Invalid dataset card style');
    }
    if (value.card_detail_columns !== null && normalizeCardDetailColumnOverride(value.card_detail_columns) === null) {
        throw new Error('Invalid dataset card columns');
    }
    return { card_style_variant: value.card_style_variant, card_detail_columns: value.card_detail_columns };
}

export function buildDatasetCardPaletteControl({
    datasetName, copy, requestFn = fetchCardVisibility, saveRequestFn = saveDatasetCardPresentation,
    onStatus = () => {},
}) {
    const owner = {};
    let destroyed = false, saved = null, draft = null, revision = 0, saving = false;
    let loadError = false, previewActive = false;
    const element = document.createElement('fieldset');
    element.className = 'dataset-cover-test-palette__card-scope';
    element.dataset.testid = 'dataset-card-palette-settings';
    const legend = document.createElement('legend');
    const hint = document.createElement('small');
    const controls = document.createElement('div');
    controls.className = 'dataset-cover-test-palette__controls';
    const makeSelect = (name, values) => {
        const label = document.createElement('label'); label.className = 'dataset-cover-test-palette__select';
        const text = document.createElement('span');
        const select = document.createElement('select'); select.dataset.testid = 'dataset-card-palette-' + name;
        values.forEach(value => { const option = document.createElement('option'); option.value = value; select.append(option); });
        label.append(text, select); controls.append(label);
        return { select, text };
    };
    const style = makeSelect('style', ['inherit', 'modern', 'standard']);
    const columns = makeSelect('columns', ['inherit', '1', '2', '3', '4']);
    const actions = document.createElement('div'); actions.className = 'dataset-cover-test-palette__actions';
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'fw-btn';
    reset.dataset.testid = 'dataset-card-palette-reset';
    const save = document.createElement('button'); save.type = 'button'; save.className = 'fw-btn';
    save.dataset.testid = 'dataset-card-palette-save';
    actions.append(reset, save); element.append(legend, hint, controls, actions);

    function syncControls() {
        style.select.value = draft?.card_style_variant ?? 'inherit';
        columns.select.value = draft?.card_detail_columns === null || !draft ? 'inherit' : String(draft.card_detail_columns);
        style.select.disabled = columns.select.disabled = !saved;
        reset.disabled = !saved;
        save.disabled = !saved || saving;
    }
    function setCopy(next) {
        copy = next; legend.textContent = copy.datasetCardSettings;
        hint.textContent = loadError ? copy.datasetCardUnavailable : copy.datasetCardHint;
        style.text.textContent = copy.cardStyle; style.select.setAttribute('aria-label', copy.datasetCardStyle);
        columns.text.textContent = copy.cardDetailColumns; columns.select.setAttribute('aria-label', copy.datasetCardColumns);
        style.select.options[0].textContent = columns.select.options[0].textContent = copy.siteDefault;
        style.select.options[1].textContent = copy.cardStyleModern;
        style.select.options[2].textContent = copy.cardStyleStandard;
        for (let index = 1; index <= 4; index++) columns.select.options[index].textContent = String(index);
        reset.textContent = copy.reset; save.textContent = copy.saveDataset;
    }
    function preview() {
        revision += 1;
        previewActive = true;
        setDatasetCardPresentationPreview(owner, datasetName, draft);
    }
    function resetPreview() {
        revision += 1;
        previewActive = false;
        releaseDatasetCardPresentationPreview(owner);
        draft = saved ? clone(saved) : null;
        syncControls();
    }
    style.select.addEventListener('change', () => {
        if (!draft) return;
        draft.card_style_variant = style.select.value === 'inherit' ? null : style.select.value;
        preview();
    });
    columns.select.addEventListener('change', () => {
        if (!draft) return;
        draft.card_detail_columns = columns.select.value === 'inherit' ? null : Number(columns.select.value);
        preview();
    });
    reset.addEventListener('click', resetPreview);
    save.addEventListener('click', async () => {
        if (!draft || saving) return;
        const snapshot = clone(draft), savingRevision = revision;
        saving = true; syncControls(); onStatus('datasetSaving');
        try {
            await enqueueDatasetOperation(datasetName, async () => {
            const response = await saveRequestFn({ table_name: datasetName, ...snapshot });
            const actual = normalizedSettings(response, datasetName);
            if (actual.card_style_variant !== snapshot.card_style_variant || actual.card_detail_columns !== snapshot.card_detail_columns) {
                throw new Error('Dataset presentation save readback mismatch');
            }
            if (destroyed) return;
            saved = actual;
            applySavedDatasetCardPresentation(datasetName, saved);
            if (revision === savingRevision || !previewActive) {
                previewActive = false;
                releaseDatasetCardPresentationPreview(owner);
                draft = clone(saved);
            }
            onStatus('datasetSaved');
            });
        } catch {
            if (!destroyed) onStatus('datasetSaveFailed');
        } finally {
            saving = false;
            if (!destroyed) syncControls();
        }
    });
    setCopy(copy); syncControls();
    const ready = enqueueDatasetOperation(datasetName, async () => {
        if (destroyed) return;
        const response = await requestFn(datasetName);
        if (destroyed) return;
        // Older servers may omit only the new nullable columns field; their saved style remains authoritative.
        if (!Array.isArray(response?.columns) || response.columns.length === 0) throw new Error('No dataset fields');
        saved = normalizedSettings({ card_detail_columns: null, ...response }, datasetName);
        draft = clone(saved);
        applySavedDatasetCardPresentation(datasetName, saved);
        syncControls();
    }).catch(() => {
        if (destroyed) return;
        loadError = true; setCopy(copy); syncControls();
    });
    return {
        element, ready, setCopy, resetPreview,
        destroy() { destroyed = true; releaseDatasetCardPresentationPreview(owner); element.remove(); },
    };
}

export function buildCardStyleControl(copy, onChange) {
    const label = document.createElement('label');
    label.className = 'dataset-cover-test-palette__select';
    const text = document.createElement('span');
    const select = document.createElement('select');
    select.dataset.testid = 'dataset-cover-test-palette-card-style';
    const choices = ['modern', 'standard'].map(value => {
        const option = document.createElement('option'); option.value = value;
        select.appendChild(option); return option;
    });
    const hint = document.createElement('small');
    label.append(text, select, hint);
    select.addEventListener('change', () => onChange(select.value));
    const setCopy = next => {
        text.textContent = next.cardStyle; select.setAttribute('aria-label', next.cardStyle);
        hint.textContent = next.cardStyleHint;
        choices[0].textContent = next.cardStyleModern; choices[1].textContent = next.cardStyleStandard;
    };
    setCopy(copy);
    return { element: label, setCopy, setValue(value) { select.value = value; } };
}
