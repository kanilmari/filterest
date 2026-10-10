// presentation_palette_shell.js
// Builds the shared movable, resizable administrator palette and controls.
// Connects typed state adapters to preview ownership, saves and panel lifecycle.
// Keeps dataset and Home editors identical at their common interaction boundary.

import { createMaskIconSpan } from '../../icons/icon_mask_builder.js';
import { showToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';

export const clonePaletteValue = value => JSON.parse(JSON.stringify(value));

/** Resolve source-owned copy with a complete English fallback on every key. */
export function getPaletteCopy(dictionary) {
    const language = String(document.documentElement.lang.trim() || getLanguageWithBrowserFallback() || 'en').toLowerCase();
    return { ...dictionary.en, ...(dictionary[language] || dictionary[language.split('-')[0]] || {}) };
}

const TOOLBOX_CHEVRON_PATH = '/frontend/icons/general/chevron-down-icon.svg';

export function renderControlValue(value, unit) {
    const numericValue = Number.parseFloat(value);
    const displayValue = Number.isInteger(numericValue)
        ? String(numericValue)
        : numericValue.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return `${displayValue}${unit}`;
}

function setupPanelDragging(panel, dragHandle) {
    let dragState = null;
    function handlePointerDown(event) {
        if (event.button !== 0 || event.target.closest('button, input, output')) return;
        const rect = panel.getBoundingClientRect();
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.style.right = 'auto';
        dragState = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
        panel.classList.add('dataset-cover-test-palette--dragging');
        if (Number.isInteger(event.pointerId)) dragHandle.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    }
    function handlePointerMove(event) {
        if (!dragState) return;
        const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
        panel.style.left = `${Math.min(Math.max(0, event.clientX - dragState.offsetX), maxLeft)}px`;
        panel.style.top = `${Math.min(Math.max(0, event.clientY - dragState.offsetY), maxTop)}px`;
        event.preventDefault();
    }
    function handlePointerUp(event) {
        if (Number.isInteger(event.pointerId)) dragHandle.releasePointerCapture?.(event.pointerId);
        dragState = null;
        panel.classList.remove('dataset-cover-test-palette--dragging');
    }
    function resetGeometry() {
        ['left', 'top', 'right', 'width', 'height'].forEach((property) => panel.style.removeProperty(property));
    }
    dragHandle.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);
    return {
        resetGeometry,
        destroy() {
            dragHandle.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('pointermove', handlePointerMove);
            document.removeEventListener('pointerup', handlePointerUp);
            document.removeEventListener('pointercancel', handlePointerUp);
        },
    };
}

export function createPaletteToolbox(title, {
    iconPath = '/frontend/icons/symbols/image.svg',
    open = false,
    testid = '',
    storageKey = '',
} = {}) {
    const toolbox = document.createElement('details');
    toolbox.classList.add('dataset-cover-test-palette__group');
    toolbox.open = open;
    if (storageKey) {
        try { toolbox.open = localStorage.getItem(storageKey) === 'true'; }
        catch { /* A blocked local store keeps the closed default usable. */ }
    }
    if (testid) toolbox.dataset.testid = testid;
    const summary = document.createElement('summary');
    summary.classList.add('dataset-cover-test-palette__group-title');
    const chevron = createMaskIconSpan(
        TOOLBOX_CHEVRON_PATH,
        'dataset-cover-test-palette__group-chevron'
    );
    const icon = createMaskIconSpan(
        iconPath,
        'dataset-cover-test-palette__group-icon'
    );
    const label = document.createElement('span');
    label.classList.add('dataset-cover-test-palette__group-label');
    label.textContent = title;
    summary.append(chevron, icon, label);
    const content = document.createElement('div');
    content.classList.add('dataset-cover-test-palette__group-content');
    const controls = document.createElement('div');
    controls.classList.add('dataset-cover-test-palette__controls');
    content.appendChild(controls);
    toolbox.append(summary, content);
    // Native summary activation covers pointer, touch and keyboard clicks.
    // Initialization and programmatic openings do not become remembered user choices.
    let userTogglePending = false;
    summary.addEventListener('click', (event) => {
        if (!event.defaultPrevented) userTogglePending = true;
    });
    toolbox.addEventListener('toggle', () => {
        if (!userTogglePending || !storageKey) return;
        userTogglePending = false;
        try { localStorage.setItem(storageKey, String(toolbox.open)); }
        catch { /* Persistence is optional; the user's visible toggle still works. */ }
    });
    return { toolbox, content, controls, label };
}

/** Own one editor's draft; hiding keeps preview, reset/destroy release only its owner. */
export function createPaletteDraftOwner({ state, render, syncControls, setStatus, resetGeometry,
    saveRequestFn, prepareSave = () => {}, errorStatus = () => 'saveFailed' }) {
    const previewOwner = {};
    let draft = state.savedSettings();
    let draftRevision = 0;
    // True while the draft holds edits that Reset has not discarded.
    let edited = false;
    let destroyed = false;
    let active = true;
    let saving = false;
    function previewDraft() {
        draftRevision += 1;
        edited = true;
        if (active) state.setPreview(previewOwner, draft);
        render();
    }
    function resetPreview() {
        draftRevision += 1;
        edited = false;
        state.releasePreview(previewOwner);
        draft = state.savedSettings();
        render();
        syncControls();
        setStatus('');
        resetGeometry();
    }
    async function saveSettings() {
        if (saving || destroyed) return;
        saving = true;
        setStatus('saving');
        const savingRevision = draftRevision;
        try {
            prepareSave(draft);
            const saved = await state.saveSettings(clonePaletteValue(draft), saveRequestFn);
            if (destroyed) return;
            // Edits made during the request stay as the newer draft; after a Reset during it, the page and controls
            // show what the request just stored, as a Reset after the save would.
            if (draftRevision === savingRevision || !edited) {
                state.releasePreview(previewOwner);
                draft = saved;
                edited = false;
                render();
                syncControls();
            } else {
                // New edits keep their values but follow the successfully saved revision.
                for (const key of ['version', 'shared_version', 'dataset_uid']) {
                    if (Object.hasOwn(saved, key)) draft[key] = saved[key];
                }
                if (active) state.setPreview(previewOwner, draft);
            }
            setStatus('saved');
        } catch (error) {
            if (!destroyed) setStatus(errorStatus(error));
        } finally {
            saving = false;
        }
    }
    return { get draft() { return draft; }, get saving() { return saving; }, previewDraft, resetPreview, saveSettings,
        replaceDraft(value) { draft = clonePaletteValue(value); previewDraft(); },
        activate() { active = true; if (edited) state.setPreview(previewOwner, draft); render(); },
        deactivate() { active = false; state.releasePreview(previewOwner); render(); },
        destroy() { destroyed = true; state.releasePreview(previewOwner); } };
}

/** A typed range control shared by every palette; copy updates preserve its DOM. */
export function createPaletteRangeControl(control, copy, { prefix, onChange }) {
    const element = document.createElement('label');
    element.className = 'dataset-cover-test-palette__range';
    const labelText = document.createElement('span');
    const output = document.createElement('output');
    output.dataset.testid = `${prefix}-${control.id}-value`;
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min: String(control.min), max: String(control.max), step: String(control.step) });
    input.dataset.testid = `${prefix}-${control.id}`;
    input.addEventListener('input', () => { setValue(input.value); onChange(Number(input.value)); });
    element.append(labelText, output, input);
    const hintText = control.hint ? document.createElement('small') : null;
    if (hintText) { hintText.style.gridColumn = '1 / -1'; element.append(hintText); }
    function setValue(value) { input.value = String(value); output.value = renderControlValue(input.value, control.unit); }
    function setCopy(nextCopy) {
        labelText.textContent = nextCopy[control.label];
        input.setAttribute('aria-label', nextCopy[control.label]);
        if (hintText) {
            hintText.textContent = nextCopy[control.hint];
            input.setAttribute('aria-description', nextCopy[control.hint]);
        }
    }
    setCopy(copy);
    return { ...control, element, input, output, labelText, hintText, setValue, setCopy };
}

/** Shared select construction with keyed labels, safe text and stable focus. */
export function createPaletteSelectControl({ id, label, choices }, copy, { prefix, onChange }) {
    const element = document.createElement('label');
    element.className = 'dataset-cover-test-palette__select';
    const text = document.createElement('span');
    const input = document.createElement('select');
    input.dataset.testid = `${prefix}-${id}`;
    const options = choices.map(value => {
        const option = document.createElement('option');
        option.value = value;
        input.append(option);
        return option;
    });
    input.addEventListener('change', () => onChange(input.value));
    element.append(text, input);
    function setCopy(nextCopy) {
        text.textContent = nextCopy[label];
        input.setAttribute('aria-label', nextCopy[label]);
        options.forEach(option => { option.textContent = nextCopy[option.value]; });
    }
    setCopy(copy);
    return { element, input, setCopy, setValue(value) { input.value = value; } };
}

/** Construct common panel chrome around an existing or newly created trigger. */
export function createPresentationPaletteShell({ button, prefix, getCopy, onCopy = () => {}, onReset, onSave,
    onOpen = () => {}, canSave = () => true }) {
    let statusKey = '';
    let statusToast = null;
    let statusMessage = null;
    let destroyed = false;
    const panel = document.createElement('section');
    panel.className = 'presentation-palette dataset-cover-test-palette';
    panel.dataset.testid = prefix;
    panel.hidden = true;
    const headingRow = document.createElement('div');
    headingRow.className = 'dataset-cover-test-palette__heading';
    const heading = document.createElement('strong');
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'dataset-cover-test-palette__close';
    closeButton.dataset.testid = `${prefix}-close`;
    closeButton.textContent = '×';
    headingRow.append(heading, closeButton);
    const body = document.createElement('div');
    body.className = 'dataset-cover-test-palette__body';
    const notice = document.createElement('p');
    notice.className = 'dataset-cover-test-palette__notice';
    const actions = document.createElement('div');
    actions.className = 'dataset-cover-test-palette__actions';
    const resetButton = document.createElement('button');
    const saveButton = document.createElement('button');
    for (const [action, control] of [['reset', resetButton], ['save', saveButton]]) {
        control.type = 'button';
        control.className = `dataset-cover-test-palette__${action} fw-btn`;
        control.dataset.testid = `${prefix}-${action}`;
    }
    actions.append(resetButton, saveButton);
    body.append(notice);
    panel.append(headingRow, body, actions);
    const dragging = setupPanelDragging(panel, headingRow);
    function closePanel() { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); }
    // Close and Escape return keyboard focus to the trigger; an outside click leaves focus where the user put it.
    function closePanelAndRefocus() { closePanel(); button.focus(); }
    function openPanel() { onOpen(); panel.hidden = false; button.setAttribute('aria-expanded', 'true'); }
    function togglePanel(event) {
        event.preventDefault(); event.stopPropagation();
        if (panel.hidden) openPanel(); else closePanel();
    }
    function handleDocumentPointerDown(event) {
        if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) closePanel();
    }
    function handleDocumentKeyDown(event) {
        if (event.key === 'Escape' && !panel.hidden) closePanelAndRefocus();
    }
    function setStatus(key) {
        statusKey = key;
        statusToast?.dismiss({ immediate: true });
        statusToast = statusMessage = null;
        if (!key) return;
        statusMessage = document.createElement('span');
        statusMessage.textContent = getCopy()[key];
        statusToast = showToast({ content: statusMessage,
            level: key === 'saved' ? 'success' : ['saveFailed', 'conflict', 'reload'].includes(key) ? 'error' : 'info',
            autoClose: key !== 'saving' });
    }
    function syncCopy() {
        const copy = getCopy();
        button.title = copy.button;
        button.setAttribute('aria-label', copy.button);
        heading.textContent = copy.title;
        closeButton.title = copy.close;
        closeButton.setAttribute('aria-label', copy.close);
        notice.textContent = copy.notice;
        resetButton.textContent = copy.reset;
        saveButton.textContent = copy.save;
        if (statusMessage) statusMessage.textContent = copy[statusKey];
        onCopy(copy);
    }
    async function saveSettings() {
        if (!canSave()) return;
        saveButton.disabled = true;
        try { await onSave(); }
        finally { if (!destroyed) saveButton.disabled = !canSave(); }
    }
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', togglePanel);
    closeButton.addEventListener('click', closePanelAndRefocus);
    resetButton.addEventListener('click', onReset);
    saveButton.addEventListener('click', saveSettings);
    panel.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('pointerdown', handleDocumentPointerDown);
    document.addEventListener('keydown', handleDocumentKeyDown);
    document.body.append(panel);
    const languageObserver = new MutationObserver(syncCopy);
    languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    // Initial copy is applied after the adapter has built its own controls.
    return { button, panel, body, actions, saveButton, resetButton, syncCopy, setStatus, openPanel, closePanel,
        resetGeometry: dragging.resetGeometry,
        destroy() {
            destroyed = true;
            languageObserver.disconnect();
            setStatus('');
            dragging.destroy();
            button.removeEventListener('click', togglePanel);
            document.removeEventListener('pointerdown', handleDocumentPointerDown);
            document.removeEventListener('keydown', handleDocumentKeyDown);
            panel.remove();
        } };
}
