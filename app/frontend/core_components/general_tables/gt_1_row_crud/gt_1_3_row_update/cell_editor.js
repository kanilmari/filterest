// cell_editor.js
// Handles inline editing of a single table cell, including input rendering and patch submission.
// Bridges cell selection, policy-aware option fetching, and the endpoint router into one in-place edit interaction.
// Exists to isolate cell-level update logic from row-level and table-level concerns.

import { selectCell } from '../../../table_views/table_view/table_cell_handler.js';
import { loadForeignFilterOptions } from '../../../filterbar/filter_list/filter_column_builder_helpers.js';
import { createMultiselectDropdown } from '../../../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js';
import { endpoint_router } from '../../../endpoints/endpoint_router.js';
import { showWarningToast } from '../../../../reusable_components/notifications/toast_notification_printer.js';
import { getTranslationForKey } from '../../../lang/translation_handler.js';
import { readCachedUserPermissions, canEditServiceCatalogColumn } from '../../../service_catalog/service_catalog_moderation.js';
import {
    getEditInputType,
    deriveForeignKeyColumnName,
    hasValueChanged,
    formatDateForInput,
    canInlineEditCell,
} from './cell_editor_helpers.js';
import { applyNumberInputStep } from '../number_input_step_resolver.js';
import {
    getInlineEditCacheInvalidationKeys,
    getInlineEditOptions,
    normalizeInlineEditOptionValue,
} from './cell_editor_options.js';
import {
    getTemporalValueKind,
    serializeTemporalInputValue,
} from '../../../table_views/temporal_value_formatter.js';
import { getLanguageWithBrowserFallback } from '../../../state_stores/lang_preference_reader.js';
import {
    reconstructMultilingualValue,
    resolveMultilingualValue,
} from '../../../table_views/card_view/card_field_formatter_helpers.js';
import {
    resolveDatasetDisplayValue,
    setLocalizedDatasetText,
} from '../../../table_views/dataset_value_localizer.js';
import { resolveCellEditorLayout } from './cell_editor_layout_resolver.js';
import { isServiceUnavailableError } from '../../../pipeline/api_pipeline_helpers.js';

export async function editCell(cell, columns, data, dataTypes, table_name) {
    let originalContent = cell.textContent;
    const safeDataTypes = dataTypes || {};

    // Haetaan sarakkeen nimi ja tietotyyppi
    const colIndex = parseInt(cell.dataset.colIndex, 10);
    if (!Number.isInteger(colIndex) || colIndex < 0 || colIndex >= columns.length) {
        return;
    }
    const columnName = columns[colIndex];
    const dataTypeInfo = safeDataTypes[columnName];
    const userPermissions = readCachedUserPermissions();

    if (
        !canEditServiceCatalogColumn(table_name, columnName, userPermissions)
        || !canEditServiceCatalogColumn(table_name, deriveForeignKeyColumnName(columnName, columns), userPermissions)
        || !canInlineEditCell({
            columnName,
            columns,
            dataTypes: safeDataTypes,
            tableName: table_name,
        })
    ) {
        showWarningToast(
            getTranslationForKey('access_denied_for_action', {
                fallback: 'Tätä saraketta ei voi muokata tässä näkymässä.',
            })
        );
        selectCell(cell);
        return;
    }

    // Tarkistetaan, onko sarake '_name' -sarake ja liittyykö se foreign key -sarakkeeseen
    let foreignKeyColumnName = deriveForeignKeyColumnName(columnName, columns);
    let isNameColumn = foreignKeyColumnName !== null;
    if (!isNameColumn && dataTypeInfo && dataTypeInfo.foreign_table) {
        foreignKeyColumnName = columnName;
    }

    const inlineOptions = getInlineEditOptions({
        tableName: table_name,
        columnName,
        translate: getTranslationForKey,
    });

    if (inlineOptions.length > 0) {
        await handleRegularEditing(cell, columns, data, safeDataTypes, table_name, columnName, originalContent);
        return;
    }

    // Jos sarake liittyy foreign key -sarakkeeseen
    if (foreignKeyColumnName && safeDataTypes[foreignKeyColumnName] && safeDataTypes[foreignKeyColumnName].foreign_table) {
        await handleForeignKeyEditing(cell, columns, data, safeDataTypes, table_name, columnName, foreignKeyColumnName, isNameColumn, originalContent);
    } else {
        await handleRegularEditing(cell, columns, data, safeDataTypes, table_name, columnName, originalContent);
    }
}

// Single-choice editing shares option reads and value-column resolution with
// filters, while the dropdown owns keyboard navigation and search debounce.
async function handleForeignKeyEditing(cell, columns, data, dataTypes, table_name, columnName, foreignKeyColumnName, isNameColumn, originalContent) {
    const rowIndex = parseInt(cell.dataset.rowIndex, 10);
    const rowData = data[rowIndex];
    if (!rowData) {
        selectCell(cell);
        return;
    }

    cell.textContent = '';
    cell.classList.add('editing', 'table_data_cell--inline-fk-editing');
    const dropdownContainer = document.createElement('div');
    dropdownContainer.classList.add('inline-fk-dropdown');
    dropdownContainer.dataset.testid = 'inline-fk-dropdown';
    cell.appendChild(dropdownContainer);

    const currentValue = rowData[foreignKeyColumnName];
    const hasCurrentValue = currentValue !== null && currentValue !== undefined && currentValue !== '';
    const currentLabel = resolveDatasetDisplayValue(
        rowData[foreignKeyColumnName + '_name'] || (isNameColumn ? originalContent : cell.title),
        null,
        getLanguageWithBrowserFallback()
    ) || String(currentValue ?? '');
    const currentOption = { value: currentValue, label: currentLabel };
    let availableOptions = hasCurrentValue ? [currentOption] : [];
    let searchRequest = 0;
    let ended = false;
    let foreignKeyUpdateInFlight = false;
    let pendingOption = null;
    const listeners = new AbortController();
    const noResultsLabel = getTranslationForKey('no_results');
    const loadError = document.createElement('div');
    loadError.setAttribute('role', 'alert');
    loadError.dataset.langKey = 'failed_to_load';
    loadError.hidden = true;

    const dropdown = createMultiselectDropdown({
        containerElement: dropdownContainer,
        // Keeping the fixed-position popup in the editor's ownership lets blur
        // distinguish option navigation from leaving the cell, even in a modal.
        portalElement: dropdownContainer,
        options: availableOptions,
        initialState: { includeValues: hasCurrentValue ? [currentValue] : [] },
        maxSelections: 1,
        allowExclude: false,
        placeholder: getTranslationForKey('choose_from_existing'),
        searchPlaceholder: getTranslationForKey('search_by_name_or_id'),
        noResultsLabel,
        clearLabel: getTranslationForKey('cancel'),
        onSearch: async (search) => {
            const request = ++searchRequest;
            try {
                const options = await loadForeignFilterOptions(
                    foreignKeyColumnName, dataTypes[foreignKeyColumnName], { search, limit: 100 }
                );
                if (ended || !dropdownContainer.isConnected || request !== searchRequest) return availableOptions;
                const language = getLanguageWithBrowserFallback();
                availableOptions = options.map((option) => ({
                    value: option.value,
                    label: resolveDatasetDisplayValue(option.label, null, language) || String(option.value),
                }));
                // Option reads omit unlabelled rows and are bounded. Neither may
                // erase a value already held by this row (or a retryable draft).
                for (const retained of [hasCurrentValue ? currentOption : null, pendingOption]) {
                    if (retained && !availableOptions.some((option) => String(option.value) === String(retained.value))) {
                        availableOptions.unshift(retained);
                    }
                }
                loadError.hidden = true;
                dropdown.setLabels({ noResultsLabel });
                return availableOptions;
            } catch {
                if (ended || !dropdownContainer.isConnected || request !== searchRequest) return availableOptions;
                loadError.textContent = getTranslationForKey('failed_to_load');
                loadError.hidden = false;
                dropdown.setLabels({ noResultsLabel: loadError.textContent });
                return availableOptions;
            }
        },
        onChange: ({ includeValues }) => {
            if (ended) return;
            if (foreignKeyUpdateInFlight) {
                dropdown.setValue({ includeValues: [pendingOption.value] });
                return;
            }
            // Toggling the retained draft again retries a maintenance refusal.
            // Clearing a selection cancels; this editor has never written NULL.
            const option = includeValues.length
                ? availableOptions.find((item) => String(item.value) === includeValues[0])
                : pendingOption;
            if (option) void selectOption(option);
            else finishEditing();
        },
    });
    const popup = dropdownContainer.querySelector('.msd-dropdown-list');
    popup.prepend(loadError);
    const searchInput = dropdownContainer.querySelector('.msd-dropdown-search-input');
    searchInput.dataset.testid = 'inline-fk-search-input';

    function finishEditing(displayValue = originalContent) {
        if (ended) return;
        ended = true;
        searchRequest += 1;
        listeners.abort();
        dropdown.destroy();
        cell.classList.remove('editing', 'table_data_cell--inline-fk-editing');
        delete cell.dataset.inlineSaveState;
        setCellDisplayText(cell, displayValue);
        selectCell(cell);
    }

    async function selectOption(option) {
        if (ended || foreignKeyUpdateInFlight) return;
        const { value: newValue, label: displayValue } = option;
        if (String(newValue) === String(currentValue)) {
            finishEditing();
            return;
        }
        pendingOption = option;
        dropdown.setValue({ includeValues: [newValue] });
        dropdownContainer.dataset.pendingValue = String(newValue);
        foreignKeyUpdateInFlight = true;
        cell.dataset.inlineSaveState = 'saving';
        try {
            await sendUpdateRequest(table_name, {
                id: rowData['id'], column: foreignKeyColumnName, value: newValue,
            });
            data[rowIndex][foreignKeyColumnName] = newValue;
            data[rowIndex][foreignKeyColumnName + '_name'] = displayValue;
            data[rowIndex][columnName] = isNameColumn ? displayValue : newValue;
            const rowCells = cell.parentElement?.cells;
            if (rowCells) {
                for (let i = 0; i < columns.length; i++) {
                    const siblingCell = rowCells[i + 2]; // numbering and checkbox columns
                    if (!siblingCell || siblingCell === cell) continue;
                    if (columns[i] === foreignKeyColumnName) {
                        siblingCell.textContent = newValue;
                        siblingCell.title = displayValue;
                    } else if (columns[i] === foreignKeyColumnName + '_name') {
                        siblingCell.textContent = displayValue;
                    }
                }
            }
            finishEditing(isNameColumn ? displayValue : newValue);
            if (!isNameColumn) cell.title = displayValue;
        } catch (error) {
            if (isServiceUnavailableError(error)) {
                cell.dataset.inlineSaveState = 'retry';
                dropdown.setValue({ includeValues: [newValue] });
            } else {
                finishEditing();
            }
        } finally {
            foreignKeyUpdateInFlight = false;
        }
    }

    const eventOptions = { capture: true, signal: listeners.signal };
    dropdownContainer.addEventListener('input', () => {
        // Invalidate errors as soon as text changes, before the dropdown debounce.
        searchRequest += 1;
    }, eventOptions);
    dropdownContainer.addEventListener('blur', (event) => {
        if (!foreignKeyUpdateInFlight && !dropdownContainer.contains(event.relatedTarget)) finishEditing();
    }, eventOptions);
    dropdownContainer.addEventListener('mousedown', (event) => {
        if (event.target.closest('.msd-option')) event.preventDefault();
    }, eventOptions);
    dropdownContainer.addEventListener('click', (event) => {
        if (event.target.closest('.msd-clear-btn')) {
            event.preventDefault();
            event.stopPropagation();
            if (!foreignKeyUpdateInFlight) finishEditing();
        }
    }, eventOptions);
    dropdownContainer.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (!foreignKeyUpdateInFlight) finishEditing();
        } else if (event.key === 'Enter' && cell.dataset.inlineSaveState === 'retry'
            && !event.target.closest('.msd-option')) {
            event.preventDefault();
            event.stopPropagation();
            void selectOption(pendingOption);
        }
    }, eventOptions);
    document.addEventListener('click', (event) => {
        if (!foreignKeyUpdateInFlight && !dropdownContainer.contains(event.target)) finishEditing();
    }, { signal: listeners.signal });
    dropdown.open();
}

async function handleRegularEditing(cell, columns, data, dataTypes, table_name, columnName, originalContent) {
    const dataTypeInfo = dataTypes[columnName];
    const rawDataType = dataTypeInfo && typeof dataTypeInfo === 'object'
        ? dataTypeInfo.data_type
        : dataTypeInfo;
    const dataType = String(rawDataType || 'text');
    const rowIndex = parseInt(cell.dataset.rowIndex, 10);
    const rowData = data[rowIndex];
    if (!rowData) {
        cell.classList.remove('editing');
        cell.textContent = originalContent;
        selectCell(cell);
        return;
    }
    const originalValue = rowData[columnName];
    const serializedOriginalValue = typeof originalValue === 'object' && originalValue !== null
        ? JSON.stringify(originalValue)
        : String(originalValue ?? '');
    const multilingualMetadata = dataTypeInfo && typeof dataTypeInfo === 'object'
        ? dataTypeInfo.is_multilingual
        : undefined;
    const multilingualValue = multilingualMetadata === false
        ? null
        : resolveMultilingualValue(
            serializedOriginalValue,
            multilingualMetadata,
            getLanguageWithBrowserFallback()
        );
    const inlineOptions = getInlineEditOptions({
        tableName: table_name,
        columnName,
        translate: getTranslationForKey,
    });
    const inputType = getEditInputType(dataType);
    const editorValue = multilingualValue?.displayText
        ?? (originalValue !== null && originalValue !== undefined ? originalValue : '');
    const editorLayout = resolveCellEditorLayout(cell, {
        inputType,
        value: editorValue,
    });

    cell.textContent = '';
    cell.classList.add('editing');

    if (inlineOptions.length > 0) {
        await handleOptionEditing({
            cell,
            data,
            tableName: table_name,
            columnName,
            originalContent,
            originalValue,
            options: inlineOptions,
            rowData,
            rowIndex,
            editorWidthPx: editorLayout.widthPx,
        });
        return;
    }

    const input = document.createElement(editorLayout.useTextarea ? 'textarea' : 'input');
    if (input instanceof HTMLInputElement) {
        input.type = inputType;
        applyNumberInputStep(input, dataType);
    } else {
        input.classList.add('table-editor-textarea');
        input.rows = 1;
    }
    input.classList.add('table-editor-input');
    input.dataset.testid = 'table-editor';
    if (editorLayout.widthPx > 0 && inputType !== 'checkbox') {
        input.style.width = `${Math.floor(editorLayout.widthPx)}px`;
    }
    if (editorLayout.useTextarea && editorLayout.heightPx > 0) {
        input.style.height = `${Math.floor(editorLayout.heightPx)}px`;
    }

    if (inputType === 'checkbox') {
        input.checked = originalValue === true || originalValue === 'true';
    } else if (inputType === 'date' || inputType === 'datetime-local') {
        input.value = formatDateForInput(originalValue, inputType, dataType);
    } else {
        input.value = editorValue;
    }

    cell.appendChild(input);
    const originalEditorValue = inputType === 'checkbox' ? input.checked : input.value;
    input.focus();

    let updateInFlight = false;
    input.addEventListener('blur', async () => {
        if (updateInFlight) return;
        const newValue = input.type === 'checkbox' ? input.checked : input.value;
        const temporalKind = getTemporalValueKind(dataType);
        const comparisonValue = multilingualValue
            ? originalEditorValue
            : inputType === 'checkbox' || temporalKind
            ? originalEditorValue
            : originalValue;
        const valueChanged = hasValueChanged(
            comparisonValue,
            newValue,
            editorLayout.useTextarea ? 'text' : input.type
        );

        if (!valueChanged) {
            if (multilingualValue) {
                setLocalizedTableCellDisplay(cell, originalValue, dataTypeInfo);
            } else {
                setCellDisplayText(cell, originalContent);
            }
            cell.classList.remove('editing');
            selectCell(cell);
            return;
        }

        const id = rowData['id'];

        let serializedValue = temporalKind
            ? serializeTemporalInputValue(newValue, dataType)
            : newValue;
        if (temporalKind && serializedValue === null) {
            setCellDisplayText(cell, originalContent);
            cell.classList.remove('editing');
            selectCell(cell);
            return;
        }

        if (multilingualValue && typeof newValue === 'string') {
            const reconstructedValue = reconstructMultilingualValue(
                JSON.stringify(multilingualValue.multiLangObj),
                multilingualValue.editLang,
                newValue
            );
            if (reconstructedValue === null) {
                setCellDisplayText(cell, originalContent);
                cell.classList.remove('editing');
                selectCell(cell);
                return;
            }
            serializedValue = reconstructedValue;
        }

        const updateData = {
            id: id,
            column: columnName,
            value: serializedValue
        };

        let retainDraftForRetry = false;
        updateInFlight = true;
        cell.dataset.inlineSaveState = 'saving';
        try {
            await sendUpdateRequest(table_name, updateData);
            data[rowIndex][columnName] = serializedValue;
            if (multilingualValue) {
                setLocalizedTableCellDisplay(cell, serializedValue, dataTypeInfo);
            } else {
                setCellDisplayText(cell, input.type === 'checkbox' ? String(newValue) : newValue);
            }
            cell.classList.remove('editing');
        } catch (error) {
            retainDraftForRetry = isServiceUnavailableError(error);
            if (retainDraftForRetry) {
                cell.dataset.inlineSaveState = 'retry';
            } else if (multilingualValue) {
                setLocalizedTableCellDisplay(cell, originalValue, dataTypeInfo);
            } else {
                setCellDisplayText(cell, originalContent);
            }
            if (!retainDraftForRetry) cell.classList.remove('editing');
        } finally {
            updateInFlight = false;
            if (!retainDraftForRetry) {
                delete cell.dataset.inlineSaveState;
                selectCell(cell);
            }
        }
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (!editorLayout.useTextarea || event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            input.blur();
        } else if (event.key === 'Escape') {
            if (input.type === 'checkbox') {
                input.checked = originalEditorValue;
            } else {
                input.value = originalEditorValue;
            }
            input.blur();
        }
    });
}

async function handleOptionEditing({
    cell,
    data,
    tableName,
    columnName,
    originalContent,
    originalValue,
    options,
    rowData,
    rowIndex,
    editorWidthPx,
}) {
    const select = document.createElement('select');
    select.classList.add('table-editor-select');
    select.dataset.testid = 'table-editor-select';
    if (editorWidthPx > 0) {
        select.style.width = `${Math.floor(editorWidthPx)}px`;
    }

    const normalizedOriginalValue = normalizeInlineEditOptionValue({
        tableName,
        columnName,
        value: originalValue,
    });

    options.forEach((option) => {
        const optionElement = document.createElement('option');
        optionElement.value = option.value;
        optionElement.textContent = option.label;
        select.appendChild(optionElement);
    });
    select.value = normalizedOriginalValue ?? '';

    let completed = false;
    let commitInFlight = false;

    function cleanupEditingListeners() {
        document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
    }

    function restoreOriginalSelection() {
        if (completed) return;
        completed = true;
        cleanupEditingListeners();
        cell.classList.remove('editing');
        setCellDisplayText(cell, originalContent);
        selectCell(cell);
    }

    async function commitSelection() {
        if (completed || commitInFlight) return;
        const newValue = normalizeInlineEditOptionValue({
            tableName,
            columnName,
            value: select.value,
        });
        const originalComparableValue = normalizeInlineEditOptionValue({
            tableName,
            columnName,
            value: originalValue,
        });
        if (!hasValueChanged(originalComparableValue, newValue, 'text')) {
            completed = true;
            cleanupEditingListeners();
            cell.classList.remove('editing');
            setCellDisplayText(cell, originalContent);
            selectCell(cell);
            return;
        }
        const updateData = {
            id: rowData['id'],
            column: columnName,
            value: newValue
        };
        commitInFlight = true;
        cell.dataset.inlineSaveState = 'saving';
        try {
            await sendUpdateRequest(tableName, updateData);
            completed = true;
            cleanupEditingListeners();
            data[rowIndex][columnName] = newValue;
            getInlineEditCacheInvalidationKeys({
                tableName,
                columnName,
                rowData,
            }).forEach((cacheKey) => localStorage.removeItem(cacheKey));
            cell.classList.remove('editing');
            setCellDisplayText(cell, newValue);
            delete cell.dataset.inlineSaveState;
            selectCell(cell);
        } catch (error) {
            if (isServiceUnavailableError(error)) {
                cell.dataset.inlineSaveState = 'retry';
                return;
            }
            completed = true;
            cleanupEditingListeners();
            cell.classList.remove('editing');
            setCellDisplayText(cell, originalContent);
            delete cell.dataset.inlineSaveState;
            selectCell(cell);
        } finally {
            commitInFlight = false;
        }
    }

    function handleDocumentPointerDown(event) {
        if (commitInFlight) return;
        if (!cell.contains(event.target)) {
            restoreOriginalSelection();
        }
    }

    cell.appendChild(select);
    select.focus();
    document.addEventListener('pointerdown', handleDocumentPointerDown, true);

    select.addEventListener('change', () => {
        commitSelection();
    });
    select.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            commitSelection();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            restoreOriginalSelection();
        }
    });
}

function setCellDisplayText(cell, value) {
    const text = value !== null && value !== undefined ? String(value) : '';
    if (cell.matches?.('.table_data_cell')) {
        const cellContent = document.createElement('div');
        cellContent.className = 'table_cell_content';
        if (cell.classList.contains('table_data_cell--compact')) {
            cellContent.classList.add('table_cell_content--compact');
        }
        cellContent.textContent = text;
        cell.replaceChildren(cellContent);
        return;
    }
    if (cell.matches?.('.cell')) {
        const cellContent = document.createElement('div');
        cellContent.className = 'cell-content';
        copyListCellColumnClasses(cell, cellContent);
        cellContent.textContent = text;
        cellContent.style.whiteSpace = 'pre-wrap';
        cell.replaceChildren(cellContent);
        return;
    }

    cell.textContent = text;
}

function setLocalizedTableCellDisplay(cell, rawValue, columnMetadata) {
    const cellContent = document.createElement('div');
    if (cell.matches?.('.table_data_cell')) {
        cellContent.className = 'table_cell_content';
        if (cell.classList.contains('table_data_cell--compact')) {
            cellContent.classList.add('table_cell_content--compact');
        }
    } else if (cell.matches?.('.cell')) {
        cellContent.className = 'cell-content';
        copyListCellColumnClasses(cell, cellContent);
        cellContent.style.whiteSpace = 'pre-wrap';
    } else {
        setLocalizedDatasetText(cell, rawValue, columnMetadata);
        return;
    }
    setLocalizedDatasetText(cellContent, rawValue, columnMetadata);
    cell.replaceChildren(cellContent);
}

function copyListCellColumnClasses(cell, contentElement) {
    for (const className of cell.classList) {
        if (
            className !== 'cell'
            && className !== 'editing'
            && className !== 'selected'
            && className !== 'selected_for_editing'
            && className !== 'header'
            && className !== 'sortable'
        ) {
            contentElement.classList.add(className);
        }
    }
}

async function sendUpdateRequest(table_name, updateData) {
    await endpoint_router('updateRow', {
        method: 'POST',
        url_params: `?dataset=${table_name}`,
        body_data: updateData,
    });
}
