// table_view_settings_view.js
// Renders site-wide table presentation controls in Administrator → Site settings.
// Connects the existing revision-protected presentation API and shared SPA state.
// Applies successful saves immediately to mounted tables through one CSS variable.
import { getTranslationForKey } from '../lang/translation_handler.js';
import { saveAdminSitePresentationSettings } from '../endpoints/stable_endpoint_router.js';
import { getSitePresentationState } from './site_presentation_state.js';

function translated(element, key) {
    element.dataset.langKey = key;
    element.textContent = getTranslationForKey(key);
    return element;
}

export async function generate_table_view_settings_view(container) {
    container.replaceChildren();
    const state = getSitePresentationState();
    await state.loadSettings();
    const form = document.createElement('form');
    form.className = 'settings-view';
    const heading = translated(document.createElement('h2'), 'table_view_settings');
    const row = document.createElement('div');
    row.className = 'settings-row';
    const keyCell = document.createElement('div');
    keyCell.className = 'settings-key-cell';
    const label = translated(document.createElement('label'), 'table_cell_max_lines_label');
    label.htmlFor = 'table-cell-max-lines-input';
    keyCell.append(label);
    const valueCell = document.createElement('div');
    valueCell.className = 'settings-value-cell';
    const shell = document.createElement('div');
    shell.className = 'settings-field-shell';
    const input = document.createElement('input');
    Object.assign(input, { id: label.htmlFor, type: 'number', min: '1', max: '30', step: '1', required: true,
        value: String(state.savedSettings().table_cell_max_lines) });
    input.dataset.testid = 'table-cell-max-lines-input';
    const help = translated(document.createElement('p'), 'table_cell_max_lines_help');
    help.id = 'table-cell-max-lines-help';
    input.setAttribute('aria-describedby', help.id);
    shell.append(input); valueCell.append(shell); row.append(keyCell, valueCell);
    const save = translated(document.createElement('button'), 'save');
    save.type = 'submit';
    save.className = 'settings-save-button';
    save.dataset.testid = 'table-cell-max-lines-save';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    form.append(heading, row, help, save, status);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (save.disabled || !form.reportValidity()) return;
        save.disabled = true;
        translated(status, 'saving');
        try {
            const draft = state.savedSettings();
            draft.table_cell_max_lines = Number(input.value);
            const saved = await state.saveSettings(draft, saveAdminSitePresentationSettings);
            input.value = String(saved.table_cell_max_lines);
            translated(status, 'saved');
        } catch (error) {
            translated(status, error?.failureNotice?.langKey || 'save_failed');
        } finally { save.disabled = false; }
    });
    container.append(form);
}
