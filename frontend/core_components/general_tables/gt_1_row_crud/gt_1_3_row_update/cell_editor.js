// cell_editor.js
// Handles inline editing of a single table cell, including input rendering and patch submission.
// Bridges cell selection, referenced-data fetching, and the endpoint router into one in-place edit interaction.
// Exists to isolate cell-level update logic from row-level and table-level concerns.

import { selectCell } from '../../../table_views/table_view/table_cell_handler.js';
import { fetchReferencedData } from '../gt_1_1_row_create/row_api_fetcher.js';
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
    const fullTreeDataRaw = localStorage.getItem('full_tree_data');
    const userPermissions = readCachedUserPermissions();

    if (
        !canEditServiceCatalogColumn(table_name, columnName, userPermissions)
        || !canEditServiceCatalogColumn(table_name, deriveForeignKeyColumnName(columnName, columns), userPermissions)
        || !canInlineEditCell({
            columnName,
            columns,
            dataTypes: safeDataTypes,
            tableName: table_name,
            fullTreeDataRaw,
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

async function handleForeignKeyEditing(cell, columns, data, dataTypes, table_name, columnName, foreignKeyColumnName, isNameColumn, originalContent) {
    cell.textContent = '';
    cell.classList.add('editing', 'table_data_cell--inline-fk-editing');

    const rowIndex = parseInt(cell.dataset.rowIndex, 10);
    const rowData = data[rowIndex];
    if (!rowData) {
        cell.classList.remove('editing', 'table_data_cell--inline-fk-editing');
        cell.textContent = originalContent;
        selectCell(cell);
        return;
    }

    const dropdownContainer = document.createElement('div');
    dropdownContainer.classList.add('custom-dropdown-container', 'inline-fk-dropdown');
    dropdownContainer.dataset.testid = 'inline-fk-dropdown';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Hae...';
    searchInput.classList.add('dropdown-search-input');
    searchInput.dataset.testid = 'inline-fk-search-input';

    const optionsList = document.createElement('ul');
    optionsList.classList.add('dropdown-options-list');

    const foreignTableName = dataTypes[foreignKeyColumnName].foreign_table;
    const options = await fetchReferencedData(foreignTableName);

    function renderOptions(filterText = '') {
        optionsList.replaceChildren();
        const chosenLanguage = getLanguageWithBrowserFallback();
        const localizedOptions = options.map((option) => ({
            option,
            displayValue: resolveDatasetDisplayValue(
                option['display'],
                null,
                chosenLanguage
            ),
        }));

        const filteredOptions = localizedOptions.filter(({ displayValue }) => {
            return displayValue.toLowerCase().includes(filterText.toLowerCase());
        });

        filteredOptions.forEach(({ option, displayValue }) => {
            const optionItem = document.createElement('li');
            optionItem.classList.add('dropdown-option-item');
            optionItem.dataset.testid = 'inline-fk-option';

            const idValue = option['id'];

            optionItem.dataset.value = idValue;
            optionItem.dataset.display = displayValue;

            if (isNameColumn) {
                optionItem.textContent = displayValue;
            } else {
                optionItem.textContent = `${idValue} (${displayValue})`;
            }

            const foreignKeyValue = rowData[foreignKeyColumnName];

            if (idValue == foreignKeyValue) {
                optionItem.classList.add('selected');
            }

            optionItem.addEventListener('click', () => {
                selectOption(idValue, displayValue);
            });

            optionsList.appendChild(optionItem);
        });
    }

    // Funktio valinnan käsittelyyn
    async function selectOption(newValue, displayValue) {
        document.removeEventListener('click', handleDocumentClick);
        if (isNameColumn) {
            setCellDisplayText(cell, displayValue);
        } else {
            setCellDisplayText(cell, newValue);
            cell.title = displayValue;
        }
        cell.classList.remove('editing', 'table_data_cell--inline-fk-editing');

        const foreignKeyValue = rowData[foreignKeyColumnName];

        if (newValue == foreignKeyValue) {
            selectCell(cell);
            return;
        }

        const id = rowData['id'];

        const updateData = {
            id: id,
            column: foreignKeyColumnName,
            value: newValue
        };

        try {
            await sendUpdateRequest(table_name, updateData);

            data[rowIndex][foreignKeyColumnName] = newValue;
            data[rowIndex][foreignKeyColumnName + '_name'] = displayValue;
            data[rowIndex][columnName] = isNameColumn ? displayValue : newValue;

            const rowCells = cell.parentElement?.cells;
            if (rowCells) {
                for (let i = 0; i < columns.length; i++) {
                    const col = columns[i];
                    if (col === foreignKeyColumnName) {
                        const fkCell = rowCells[i + 2]; // offset for numbering and checkbox columns
                        fkCell.textContent = data[rowIndex][foreignKeyColumnName];
                        fkCell.title = data[rowIndex][foreignKeyColumnName + '_name'];
                    } else if (col === foreignKeyColumnName + '_name') {
                        const nameCell = rowCells[i + 2]; // offset for numbering and checkbox columns
                        nameCell.textContent = data[rowIndex][foreignKeyColumnName + '_name'];
                    }
                }
            }

        } catch (error) {
            console.warn('Error updating cell:', error);
            setCellDisplayText(cell, originalContent);
        } finally {
            selectCell(cell);
        }
    }

    // Hakukentän tapahtuma
    searchInput.addEventListener('input', () => {
        const filterText = searchInput.value;
        renderOptions(filterText);
    });

    // Blur-tapahtuma
    function handleBlur(event) {
        if (!dropdownContainer.contains(event.relatedTarget)) {
            document.removeEventListener('click', handleDocumentClick);
            cell.classList.remove('editing', 'table_data_cell--inline-fk-editing');
            setCellDisplayText(cell, originalContent);
            selectCell(cell);
        }
    }

    // Käsitellään klikkaukset dropdownin ulkopuolella
    function handleDocumentClick(event) {
        if (!dropdownContainer.contains(event.target)) {
            handleBlur({ relatedTarget: null });
        }
    }

    // Lisätään elementit kontaineriin
    dropdownContainer.appendChild(searchInput);
    dropdownContainer.appendChild(optionsList);

    // Lisätään kontaineri soluun
    cell.appendChild(dropdownContainer);
    searchInput.focus();

    // Alustetaan valinnat
    renderOptions();

    // Lisätään tapahtumankuuntelijat
    searchInput.addEventListener('blur', handleBlur);
    optionsList.addEventListener('blur', handleBlur);
    document.addEventListener('click', handleDocumentClick);

    // Estetään solun fokuksen menetys
    dropdownContainer.addEventListener('mousedown', (event) => {
        event.preventDefault();
    });

    // Näppäimistönavigaatio
    searchInput.addEventListener('keydown', (event) => {
        const items = optionsList.querySelectorAll('.dropdown-option-item');
        const selectedItem = optionsList.querySelector('.dropdown-option-item.highlighted');
        let currentIndex = Array.from(items).indexOf(selectedItem);

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (currentIndex < items.length - 1) {
                currentIndex++;
            } else {
                currentIndex = 0;
            }
            highlightItem(items, currentIndex);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (currentIndex > 0) {
                currentIndex--;
            } else {
                currentIndex = items.length - 1;
            }
            highlightItem(items, currentIndex);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (selectedItem) {
                selectedItem.click();
            }
        } else if (event.key === 'Escape') {
            handleBlur({ relatedTarget: null });
        }
    });

    function highlightItem(items, index) {
        items.forEach(item => item.classList.remove('highlighted'));
        const item = items[index];
        if (item) {
            item.classList.add('highlighted');
            item.scrollIntoView({ block: 'nearest' });
        }
    }
}

async function handleRegularEditing(cell, columns, data, dataTypes, table_name, columnName, originalContent) {
    const editorWidthPx = resolveCellEditorWidthPx(cell);
    cell.textContent = '';
    cell.classList.add('editing');

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
            editorWidthPx,
        });
        return;
    }

    const inputType = getEditInputType(dataType);

    const input = document.createElement('input');
    input.type = inputType;
    input.classList.add('table-editor-input');
    input.dataset.testid = 'table-editor';
    if (editorWidthPx > 0 && inputType !== 'checkbox') {
        input.style.width = `${Math.floor(editorWidthPx)}px`;
    }

    if (inputType === 'checkbox') {
        input.checked = originalValue === true || originalValue === 'true';
    } else if (inputType === 'date' || inputType === 'datetime-local') {
        input.value = formatDateForInput(originalValue, inputType, dataType);
    } else {
        input.value = multilingualValue?.displayText
            ?? (originalValue !== null && originalValue !== undefined ? originalValue : '');
    }

    cell.appendChild(input);
    const originalEditorValue = inputType === 'checkbox' ? input.checked : input.value;
    input.focus();

    input.addEventListener('blur', async () => {
        let newValue;
        if (input.type === 'checkbox') {
            newValue = input.checked;
            setCellDisplayText(cell, newValue ? 'true' : 'false');
        } else {
            newValue = input.value;
            setCellDisplayText(cell, newValue);
        }
        cell.classList.remove('editing');

        const temporalKind = getTemporalValueKind(dataType);
        const comparisonValue = multilingualValue
            ? originalEditorValue
            : inputType === 'checkbox' || temporalKind
            ? originalEditorValue
            : originalValue;
        const valueChanged = hasValueChanged(comparisonValue, newValue, input.type);

        // Debug-tulostus

        if (!valueChanged) {
            if (multilingualValue) {
                setLocalizedTableCellDisplay(cell, originalValue, dataTypeInfo);
            }
            selectCell(cell);
            return;
        }

        const id = rowData['id'];

        let serializedValue = temporalKind
            ? serializeTemporalInputValue(newValue, dataType)
            : newValue;
        if (temporalKind && serializedValue === null) {
            setCellDisplayText(cell, originalContent);
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

        try {
            await sendUpdateRequest(table_name, updateData);

            data[rowIndex][columnName] = serializedValue;
            if (multilingualValue) {
                setLocalizedTableCellDisplay(cell, serializedValue, dataTypeInfo);
            }

        } catch (error) {
            console.warn('Error updating cell:', error);
            if (multilingualValue) {
                setLocalizedTableCellDisplay(cell, originalValue, dataTypeInfo);
            } else {
                setCellDisplayText(cell, originalContent);
            }
        } finally {
            selectCell(cell);
        }
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
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

function resolveCellEditorWidthPx(cell) {
    if (!(cell instanceof HTMLElement)) {
        return 0;
    }

    const cellRect = cell.getBoundingClientRect();
    const style = getComputedStyle(cell);
    const horizontalPadding =
        (Number.parseFloat(style.paddingLeft) || 0)
        + (Number.parseFloat(style.paddingRight) || 0);
    const contentWidthPx = cellRect.width - horizontalPadding;
    return Number.isFinite(contentWidthPx) && contentWidthPx > 0 ? contentWidthPx : 0;
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
    select.value = normalizedOriginalValue;

    let completed = false;

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
        if (completed) return;
        completed = true;
        cleanupEditingListeners();

        const newValue = normalizeInlineEditOptionValue({
            tableName,
            columnName,
            value: select.value,
        });

        cell.classList.remove('editing');
        setCellDisplayText(cell, newValue);

        const originalComparableValue = normalizeInlineEditOptionValue({
            tableName,
            columnName,
            value: originalValue,
        });

        if (!hasValueChanged(originalComparableValue, newValue, 'text')) {
            selectCell(cell);
            return;
        }

        const updateData = {
            id: rowData['id'],
            column: columnName,
            value: newValue
        };

        try {
            await sendUpdateRequest(tableName, updateData);

            data[rowIndex][columnName] = newValue;
            getInlineEditCacheInvalidationKeys({
                tableName,
                columnName,
                rowData,
            }).forEach((cacheKey) => localStorage.removeItem(cacheKey));
        } catch (error) {
            console.warn('Error updating cell:', error);
            setCellDisplayText(cell, originalContent);
        } finally {
            selectCell(cell);
        }
    }

    function handleDocumentPointerDown(event) {
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
