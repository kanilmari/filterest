// settings_view_printer.js
// Renders a form-like settings view for key/value config tables with type-specific inputs.
// Bridges dataset column metadata and row data with bool, json, text, and int DOM input elements.
// Exists to display config tables as editable forms rather than raw data rows.

import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { getTranslationForKey } from '../../lang/translation_handler.js';
import {
    showErrorToast,
    showInfoToast,
    showSuccessToast,
} from '../../../reusable_components/notifications/toast_notification_printer.js';

const DIRTY_ROW_CLASS = 'settings-row-dirty';

function normalizeDateTimeLocalValue(rawValue) {
    if (rawValue == null) {
        return '';
    }

    const stringValue = String(rawValue).trim();
    if (!stringValue) {
        return '';
    }

    const normalizedTimestamp = stringValue.replace(' ', 'T');
    const isoLikeMatch = normalizedTimestamp.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
    if (isoLikeMatch) {
        return isoLikeMatch[1];
    }

    const parsedDate = new Date(normalizedTimestamp);
    if (Number.isNaN(parsedDate.getTime())) {
        return '';
    }

    const year = parsedDate.getFullYear();
    const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
    const day = String(parsedDate.getDate()).padStart(2, '0');
    const hours = String(parsedDate.getHours()).padStart(2, '0');
    const minutes = String(parsedDate.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function sanitizeSettingInputIdPart(rawValue) {
    return String(rawValue || 'setting').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function readSettingInputValue(inputElement, valueType) {
    if (!(inputElement instanceof HTMLInputElement || inputElement instanceof HTMLTextAreaElement)) {
        return '';
    }

    if (valueType === 2 && inputElement instanceof HTMLInputElement && inputElement.type === 'checkbox') {
        return inputElement.checked;
    }

    if (valueType === 4 && inputElement instanceof HTMLInputElement) {
        return inputElement.value.trim();
    }

    return inputElement.value;
}

function serializeSettingValue(valueType, value) {
    return JSON.stringify({ valueType, value: value ?? null });
}

function getDirtyInputs(container) {
    return Array.from(container.querySelectorAll('.settings-input')).filter((inputElement) => {
        const valueType = Number(inputElement.dataset.valueType || 0);
        const nextValue = readSettingInputValue(inputElement, valueType);
        return serializeSettingValue(valueType, nextValue) !== inputElement.dataset.initialValue;
    });
}

function updateSaveUi(container, { isSaving = false } = {}) {
    const saveButton = container.querySelector('.settings-save-button');
    const statusLabel = container.querySelector('.settings-save-status');
    if (!(saveButton instanceof HTMLButtonElement) || !(statusLabel instanceof HTMLElement)) {
        return;
    }

    const hasDirtyRows = getDirtyInputs(container).length > 0;
    saveButton.disabled = isSaving || !hasDirtyRows;

    if (isSaving) {
        saveButton.textContent = getTranslationForKey('saving', { fallback: 'Saving...' });
        statusLabel.textContent = getTranslationForKey('saving', { fallback: 'Saving...' });
        return;
    }

    saveButton.textContent = getTranslationForKey('save', { fallback: 'Save' });
    statusLabel.textContent = hasDirtyRows
        ? getTranslationForKey('unsaved_changes', { fallback: 'Unsaved changes' })
        : 'No unsaved changes';
}

function updateInputDirtyState(container, inputElement) {
    const rowElement = inputElement.closest('.settings-row');
    const valueType = Number(inputElement.dataset.valueType || 0);
    const nextValue = readSettingInputValue(inputElement, valueType);
    const isDirty = serializeSettingValue(valueType, nextValue) !== inputElement.dataset.initialValue;

    rowElement?.classList.toggle(DIRTY_ROW_CLASS, isDirty);
    updateSaveUi(container);
}

export function create_settings_view(datasetName, columns, data, _dataTypes) {
    const container = document.createElement('div');
    container.classList.add('settings-view');
    container.dataset.datasetName = datasetName;

    const toolbar = document.createElement('div');
    toolbar.classList.add('settings-toolbar');

    const statusLabel = document.createElement('span');
    statusLabel.classList.add('settings-save-status');
    statusLabel.dataset.testid = 'settings-save-status';
    toolbar.appendChild(statusLabel);

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.classList.add('settings-save-button');
    saveButton.dataset.testid = 'settings-save-button';
    toolbar.appendChild(saveButton);

    container.appendChild(toolbar);

    const keyColumn = columns.find(c => c.toLowerCase().includes('key'));
    const valueTypeColumn = columns.find(c => c.toLowerCase().includes('value_type'));
    const boolColumn = columns.find(c => c.toLowerCase().includes('bool'));
    const jsonColumn = columns.find(c => c.toLowerCase().includes('json'));
    const textColumn = columns.find(c => c.toLowerCase().includes('text'));
    const intColumn  = columns.find(c => c.toLowerCase().includes('int'));

    if (!keyColumn || !valueTypeColumn) {
        container.textContent = 'No key/value columns found';
        return container;
    }

    data.forEach(row => {
        const rowDiv = document.createElement('div');
        rowDiv.classList.add('settings-row');
        rowDiv.dataset.settingKey = String(row[keyColumn] || '');

        const keyCell = document.createElement('div');
        keyCell.classList.add('settings-key-cell');

        const valueCell = document.createElement('div');
        valueCell.classList.add('settings-value-cell');

        const label = document.createElement('label');
        label.textContent = row[keyColumn];
        keyCell.appendChild(label);

        const valueType = row[valueTypeColumn];
        let input;
        let valueColumn;
        const inputId = `settings_${sanitizeSettingInputIdPart(datasetName)}_${sanitizeSettingInputIdPart(row.id || row[keyColumn])}`;

        switch (valueType) {
        case 2: // boolean
            valueColumn = boolColumn;
            input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = Boolean(row[valueColumn]);
            break;
        case 5: // json
            valueColumn = jsonColumn;
            input = document.createElement('textarea');
            input.rows = 4;
            input.value = typeof row[valueColumn] === 'string'
                ? row[valueColumn]
                : JSON.stringify(row[valueColumn] ?? '', null, 2);
            break;
        case 1: // integer
        case 3: // float
            valueColumn = intColumn;
            input = document.createElement('input');
            input.type = 'number';
            if (valueType === 3) input.step = 'any';
            if (row[valueColumn] != null) input.value = row[valueColumn];
            break;
        case 4: // timestampz
            valueColumn = textColumn;
            input = document.createElement('input');
            input.type = 'datetime-local';
            input.value = normalizeDateTimeLocalValue(row[valueColumn]);
            break;
        default:
            valueColumn = textColumn || intColumn || jsonColumn || boolColumn;
            input = document.createElement('input');
            input.type = 'text';
            if (row[valueColumn] != null) input.value = row[valueColumn];
        }

        label.htmlFor = inputId;
        input.id = inputId;
        input.classList.add('settings-input');
        input.dataset.testid = 'settings-input';
        if (valueColumn) input.dataset.column = valueColumn;
        input.dataset.rowId = String(row.id || '');
        input.dataset.valueType = valueType;
        input.dataset.initialValue = serializeSettingValue(valueType, readSettingInputValue(input, valueType));

        const updateDirtyState = () => updateInputDirtyState(container, input);
        input.addEventListener('input', updateDirtyState);
        input.addEventListener('change', updateDirtyState);

        const fieldShell = document.createElement('div');
        fieldShell.classList.add('settings-field-shell');
        if (input instanceof HTMLTextAreaElement) {
            fieldShell.classList.add('settings-field-shell--multiline');
        }
        if (input instanceof HTMLInputElement && input.type === 'checkbox') {
            fieldShell.classList.add('settings-field-shell--checkbox');
        }

        fieldShell.appendChild(input);
        valueCell.appendChild(fieldShell);

        rowDiv.appendChild(keyCell);
        rowDiv.appendChild(valueCell);

        container.appendChild(rowDiv);
    });

    saveButton.addEventListener('click', async () => {
        const dirtyInputs = getDirtyInputs(container);
        if (dirtyInputs.length === 0) {
            showInfoToast('No changes to save');
            updateSaveUi(container);
            return;
        }

        updateSaveUi(container, { isSaving: true });

        let savedCount = 0;
        try {
            for (const inputElement of dirtyInputs) {
                const rowId = Number.parseInt(inputElement.dataset.rowId || '', 10);
                const columnName = inputElement.dataset.column || '';
                const valueType = Number(inputElement.dataset.valueType || 0);
                const settingKey = inputElement.closest('.settings-row')?.dataset.settingKey || 'setting';
                const nextValue = readSettingInputValue(inputElement, valueType);

                if (!Number.isFinite(rowId) || !columnName) {
                    continue;
                }

                if (valueType === 5 && typeof nextValue === 'string' && nextValue.trim() !== '') {
                    try {
                        JSON.parse(nextValue);
                    } catch {
                        throw new Error(`Invalid JSON for ${settingKey}`);
                    }
                }

                await endpoint_router('updateRow', {
                    method: 'POST',
                    url_params: `?dataset=${encodeURIComponent(datasetName)}`,
                    body_data: {
                        id: rowId,
                        column: columnName,
                        value: nextValue,
                    },
                });

                inputElement.dataset.initialValue = serializeSettingValue(valueType, nextValue);
                inputElement.closest('.settings-row')?.classList.remove(DIRTY_ROW_CLASS);
                savedCount += 1;
            }

            if (savedCount === 0) {
                showInfoToast('No changes to save');
            } else {
                showSuccessToast(
                    savedCount === 1
                        ? getTranslationForKey('saved', { fallback: 'Saved' })
                        : `${savedCount} settings saved`
                );
            }
        } catch (error) {
            console.warn('settings_view_printer: save failed', error);
            showErrorToast(error?.message || getTranslationForKey('save_failed', { fallback: 'Saving settings failed' }));
        } finally {
            updateSaveUi(container);
        }
    });

    updateSaveUi(container);
    return container;
}
