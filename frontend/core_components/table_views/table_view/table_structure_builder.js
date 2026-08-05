// table_structure_builder.js
// Builds the full table DOM structure (thead, tbody, rows, cells) from column and data descriptors.
// Bridges row selection, cell events, column resizing, filtering, and infinite-scroll handlers into one table build pass.
// Exists to centralise table DOM construction so all renderers and refresh paths share one consistent structure.

import { toggle_select_all, update_row_selection } from './row_selection_handler.js';
import { addEventListenersToCells } from './table_cell_event_handler.js';
import { addTableGridInteractionAdapter } from './table_grid_interaction_adapter.js';
import { initialize_column_resizing } from './column_resize_handler.js';

// Uusi unify-funktiot – polku voi olla erilainen projektissasi!
import { getUnifiedTableState, setUnifiedTableState, refreshTableUnified } from '../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js'; 
import { makeColumnClass } from '../../filterbar/filter_list/column_visibility_handler.js';
import { emitDatasetSortSelection } from '../../filterbar/top_row_buttons/sort_sync_state.js';
import { getParams, setParams, updateURL } from '../../navigation/nav_engine/query_params.js';
import {
    clampManualCellMaxHeightPx,
    formatValue,
    nextSortState,
    normalizeDisplayText,
    resolveLineHeightPx,
    shouldRenderCompactCellValue,
} from './table_structure_builder_helpers.js';
import { formatTimestampDisplayParts } from '../timestamp_display_formatter.js';
import {
    bindDatasetLanguageRenderer,
    refreshLocalizedDatasetValues,
    resolveDatasetDisplayValue,
    setLocalizedDatasetText,
} from '../dataset_value_localizer.js';

/* ===========================================================
 *  Column Width Preservation
 *  Saves header cell widths before table rebuild so the new
 *  table starts with the same column widths, preventing the
 *  jarring width jump when sorted data has different content.
 * =========================================================*/
const _savedColumnWidths = new Map();

/**
 * Call BEFORE the old table is removed from the DOM.
 * Reads current <th> widths and stores them by table name.
 */
export function saveColumnWidths(tableName) {
    const table = document.getElementById(`${tableName}_table`);
    if (!table) return;
    const ths = table.querySelectorAll('thead tr:first-child th');
    if (!ths.length) return;
    const widths = Array.from(ths).map(th => th.offsetWidth);
    _savedColumnWidths.set(tableName, widths);
}

/**
 * Pääfunktio, joka luo taulun rakenteen ja asettaa datan.
 */
export function create_table_element(columns, data, table_name, dataTypes) {
    const table = document.createElement('table');
    table.classList.add('table_from_db');
    table.id = `${table_name}_table`;
    table.dataset.testid = 'dataset-view-table';

    table.dataset.columns = JSON.stringify(columns);
    table.dataset.dataTypes = JSON.stringify(dataTypes);

    const colgroup = createColgroup(columns, table_name);
    table.appendChild(colgroup);

    const thead = createTableHead(columns, table_name);
    table.appendChild(thead);

    const tbody = createTableBody(columns, data, table_name, dataTypes);
    table.appendChild(tbody);

    addEventListenersToCells(table, columns, data, dataTypes, table_name);
    addTableGridInteractionAdapter(table, columns, data);
    initialize_column_resizing(table);

    return table;
}

function createColgroup(columns, table_name) {
    const colgroup = document.createElement('colgroup');
    const saved = _savedColumnWidths.get(table_name);
    // Expected saved length: 2 (numbering + checkbox) + columns.length
    const hasSaved = saved && saved.length === columns.length + 2;

    // Numerointisolu
    const numbering_col = document.createElement('col');
    if (hasSaved) numbering_col.style.width = saved[0] + 'px';
    colgroup.appendChild(numbering_col);

    // Valintaruutusolu
    const select_col = document.createElement('col');
    if (hasSaved) select_col.style.width = saved[1] + 'px';
    colgroup.appendChild(select_col);

    // Varsinaiset taulun sarakkeet
    columns.forEach((_, i) => {
        const col = document.createElement('col');
        if (hasSaved) col.style.width = saved[i + 2] + 'px';
        colgroup.appendChild(col);
    });

    // Clear saved widths after applying (one-time use)
    if (hasSaved) _savedColumnWidths.delete(table_name);

    return colgroup;
}

function createTableHead(columns, table_name) {
    const thead = document.createElement('thead');
    const header_row = document.createElement('tr');
    const filter_row = document.createElement('tr');

    // --- Numerointisolu (#) ---
    const numbering_th = document.createElement('th');
    numbering_th.style.width = '50px';
    numbering_th.style.textAlign = 'center';
    numbering_th.textContent = '';
    header_row.appendChild(numbering_th);

    // Tyhjä solupaikka filtteririville
    const numbering_filter_th = document.createElement('th');
    filter_row.appendChild(numbering_filter_th);

    // --- Sarake valintaruudulle ( "valitse kaikki" -checkbox ) ---
    const select_all_th = document.createElement('th');
    select_all_th.style.width = '50px';
    select_all_th.style.textAlign = 'center';
    select_all_th.style.verticalAlign = 'middle';

    const select_all_checkbox = document.createElement('input');
    select_all_checkbox.type = 'checkbox';
    select_all_checkbox.classList.add('row_checkbox');
    select_all_checkbox.dataset.testid = 'row-select-all-checkbox';
    select_all_checkbox.addEventListener('change', (e) => toggle_select_all(e, table_name));
    select_all_th.appendChild(select_all_checkbox);
    header_row.appendChild(select_all_th);

    const empty_filter_cell = document.createElement('th');
    filter_row.appendChild(empty_filter_cell);

    // --- Data-sarakkeiden otsikot & filtterit ---
    columns.forEach(column => {
        const th = createHeaderCell(column, table_name);
        header_row.appendChild(th);

        const filter_cell = createFilterCell(column, table_name);
        filter_row.appendChild(filter_cell);
    });

    thead.appendChild(header_row);
    thead.appendChild(filter_row);
    return thead;
}

/**
 * createHeaderCell:
 *  - Luo yhden <th>-solun, johon lisätään sarakkeen nimi
 *  - Perään sortIndicator (ASC/DESC/none)
 *  - Klikatessa sortIndicatoria päivitetään unified-tila ja kutsutaan refresh.
 */
function createHeaderCell(column, table_name) {
    const th = document.createElement('th');
    th.style.cursor = 'default';
    th.classList.add('table_data_header_cell');
    th.classList.add(makeColumnClass(table_name, column));   // ★
    th.dataset.testid = `column-header-${column}`;

    const columnSpan = document.createElement('span');
    columnSpan.textContent = column;

    // Sort-indikaattori
    const sortIndicator = document.createElement('span');
    sortIndicator.classList.add('float_right');
    sortIndicator.style.cursor = 'pointer';
    sortIndicator.dataset.testid = `column-sort-${column}`;

    const st = getUnifiedTableState(table_name);
    if (st.sort && st.sort.column === column) {
        sortIndicator.textContent = (st.sort.direction === 'ASC') ? '▲'
                                   : (st.sort.direction === 'DESC') ? '▼'
                                   : '⇵';
    } else {
        sortIndicator.textContent = '⇵';
    }

    sortIndicator.addEventListener('click', (e) => {
        e.stopPropagation();
        onSortIndicatorClick(table_name, column);
    });

    th.appendChild(columnSpan);
    th.appendChild(sortIndicator);
    return th;
}

/**
 * Klikattaessa sort-indikaattoria:
 *  - luetaan nykyinen state
 *  - jos sama sarake => kierretään ASC->DESC->none
 *  - jos eri sarake => asetetaan ASC
 *  - tallennetaan & refresh.
 */
function onSortIndicatorClick(table_name, column) {
    const state = getUnifiedTableState(table_name);
    if (!state.sort) {
        state.sort = { column: null, direction: null };
    }

    const next = nextSortState(state.sort.column, state.sort.direction, column);
    state.sort.column = next.column;
    state.sort.direction = next.direction;
    setUnifiedTableState(table_name, state);
    const nextSortValue =
        state.sort.column && state.sort.direction
            ? `${state.sort.column}:${state.sort.direction}`
            : '';
    emitDatasetSortSelection(table_name, nextSortValue);
    refreshTableUnified(table_name, { skipUrlParams: true });
}

/**
 * createFilterCell:
 *  - Luo <th>, jossa on <input> filtterin kirjoittamista varten
 *  - Käytetään ID-muotoa: `${table_name}_${column}_filter`
 *  - onkeyup => tallennetaan unifyed-tilaan ja refresh
 */
function createFilterCell(column, table_name) {
    const filter_cell = document.createElement('th');
    filter_cell.classList.add('table_data_header_cell');
    filter_cell.classList.add(makeColumnClass(table_name, column)); // ★

    const filter_input = document.createElement('input');
    filter_input.type  = 'text';
    filter_input.id    = `${table_name}_${column}_filter`;
    filter_input.placeholder = `Hae ${column}`;
    filter_input.dataset.testid = `table-filter-input-${column}`;

    const st = getUnifiedTableState(table_name);
    const filterKey = filter_input.id;
    if (st.filters && st.filters[filterKey]) {
        filter_input.value = st.filters[filterKey];
    }

    filter_input.addEventListener('keyup', () => {
        updateFilterAndRefresh(table_name, filterKey, filter_input.value);
    });

    filter_cell.appendChild(filter_input);
    return filter_cell;
}

/**
 * Tallentaa filterin unifyed-tilaan, nollaa offsetin, refreshTableUnified.
 */
function updateFilterAndRefresh(table_name, filterKey, value) {
    const st = getUnifiedTableState(table_name);
    if (!st.filters) {
        st.filters = {};
    }
    if (value.trim() === '') {
        delete st.filters[filterKey];
    } else {
        st.filters[filterKey] = value;
    }
    setUnifiedTableState(table_name, st);
    refreshTableUnified(table_name, { skipUrlParams: true });

    const params = getParams(table_name);
    if (value.trim() === '') {
        delete params[filterKey];
    } else {
        params[filterKey] = value;
    }
    setParams(table_name, params);
    updateURL(table_name, params);
}

function createTableBody(columns, data, table_name, dataTypes = {}) {
    const tbody = document.createElement('tbody');
    tbody.id = `${table_name}_table_body`;

    data.forEach((item, rowIndex) => {
        const row = document.createElement('tr');

        const numbering_td = createRowNumberingCell(rowIndex + 1);
        row.appendChild(numbering_td);

        // Checkbox
        const checkbox_td = createCheckboxCell(row, table_name);
        row.appendChild(checkbox_td);

        // Data-sarakkeet
        columns.forEach((column, colIndex) => {
            const td = createDataCell(item, column, columns, rowIndex, colIndex, table_name, dataTypes);
            row.appendChild(td);
        });

        attachRowHeightResizeHandle(row, numbering_td);
        tbody.appendChild(row);
    });

    return tbody;
}

export function createRowNumberingCell(rowNumber) {
    const numberingCell = document.createElement('td');
    numberingCell.style.textAlign = 'center';
    numberingCell.style.verticalAlign = 'middle';
    numberingCell.classList.add('table_row_numbering');
    numberingCell.textContent = rowNumber;
    return numberingCell;
}

export function createCheckboxCell(row, _table_name) {
    const checkbox_td = document.createElement('td');
    checkbox_td.style.textAlign = 'center';
    checkbox_td.style.verticalAlign = 'middle';

    const row_checkbox = document.createElement('input');
    row_checkbox.type = 'checkbox';
    row_checkbox.classList.add('row_checkbox');
    row_checkbox.dataset.testid = 'row-select-checkbox';
    row_checkbox.addEventListener('change', () => update_row_selection(row));
    checkbox_td.appendChild(row_checkbox);

    return checkbox_td;
}

/**
 * Refreshes already rendered table cells after the user changes the UI language.
 * Operates between raw multilingual values retained on table cells and their visible text.
 * Exists so language switching does not require a data refetch or expose JSON payloads.
 *
 * @param {string} chosenLanguage - Active UI language code.
 */
export function refreshTableLanguages(chosenLanguage) {
    return refreshLocalizedDatasetValues(chosenLanguage, document);
}

function resolveResizableCellContents(scopeElement) {
    if (!(scopeElement instanceof HTMLElement)) {
        return [];
    }

    return Array.from(
        scopeElement.querySelectorAll('.table_data_cell--height-resizable .table_cell_content')
    ).filter((contentElement) => contentElement instanceof HTMLElement);
}

function resolveRowContentElements(scopeElement) {
    if (!(scopeElement instanceof HTMLElement)) {
        return [];
    }

    return Array.from(
        scopeElement.querySelectorAll('.table_data_cell .table_cell_content')
    ).filter((contentElement) => contentElement instanceof HTMLElement);
}

function markCellAsManuallyResized(contentElement) {
    if (!(contentElement instanceof HTMLElement)) {
        return;
    }

    const cellElement = contentElement.closest('.table_data_cell');
    if (cellElement instanceof HTMLElement) {
        cellElement.classList.add('table_data_cell--manually-expanded');
    }
}

function resetManualHeightResize(contentElements, numberingCellElement = null) {
    contentElements.forEach((contentElement) => {
        if (!(contentElement instanceof HTMLElement)) {
            return;
        }

        contentElement.style.maxHeight = '';
        const cellElement = contentElement.closest('.table_data_cell');
        if (cellElement instanceof HTMLElement) {
            cellElement.classList.remove('table_data_cell--manually-expanded');
        }
    });

    if (numberingCellElement instanceof HTMLElement) {
        numberingCellElement.classList.remove('table_row_numbering--manually-resized');
    }
}

function setManualRowHeight(rowElement, nextHeightPx) {
    if (!(rowElement instanceof HTMLTableRowElement)) {
        return;
    }

    rowElement.style.height = `${nextHeightPx}px`;
    Array.from(rowElement.cells).forEach((cellElement) => {
        if (cellElement instanceof HTMLElement) {
            cellElement.style.height = `${nextHeightPx}px`;
        }
    });
}

function resetManualRowHeight(rowElement) {
    if (!(rowElement instanceof HTMLTableRowElement)) {
        return;
    }

    rowElement.style.height = '';
    Array.from(rowElement.cells).forEach((cellElement) => {
        if (cellElement instanceof HTMLElement) {
            cellElement.style.height = '';
        }
    });
}

function resolveCurrentVisibleContentHeightPx(contentElement, lineHeightPx) {
    if (!(contentElement instanceof HTMLElement)) {
        return lineHeightPx;
    }

    const inlineMaxHeightPx = Number.parseFloat(contentElement.style.maxHeight);
    if (Number.isFinite(inlineMaxHeightPx) && inlineMaxHeightPx > 0) {
        return clampManualCellMaxHeightPx(inlineMaxHeightPx, lineHeightPx);
    }

    const renderedHeightPx = contentElement.getBoundingClientRect().height;
    if (Number.isFinite(renderedHeightPx) && renderedHeightPx > 0) {
        return clampManualCellMaxHeightPx(renderedHeightPx, lineHeightPx);
    }

    const boxHeightPx = Math.max(contentElement.clientHeight, contentElement.scrollHeight);
    if (Number.isFinite(boxHeightPx) && boxHeightPx > 0) {
        return clampManualCellMaxHeightPx(boxHeightPx, lineHeightPx);
    }

    return lineHeightPx;
}

export function attachRowHeightResizeHandle(rowElement, numberingCellElement) {
    if (!(rowElement instanceof HTMLTableRowElement) || !(numberingCellElement instanceof HTMLElement)) {
        return;
    }

    if (!resolveRowContentElements(rowElement).length) {
        return;
    }

    const existingResizeHandle = numberingCellElement.querySelector('.table_row_height_handle');
    if (existingResizeHandle instanceof HTMLElement) {
        return;
    }

    function startRowResize(mousedownEvent) {
        mousedownEvent.preventDefault();
        mousedownEvent.stopPropagation();

        const resizableContentElements = resolveResizableCellContents(rowElement);
        const rowContentElements = resolveRowContentElements(rowElement);
        const referenceContentElement =
            resizableContentElements.find((contentElement) => contentElement instanceof HTMLElement)
            || rowContentElements.find((contentElement) => contentElement instanceof HTMLElement)
            || numberingCellElement;
        const referenceStyle = getComputedStyle(referenceContentElement);
        const lineHeightPx = resolveLineHeightPx(referenceStyle.lineHeight, referenceStyle.fontSize);
        const rowHeightPx = clampManualCellMaxHeightPx(
            Number.parseFloat(rowElement.style.height) || rowElement.getBoundingClientRect().height,
            lineHeightPx
        );
        const startHeightPx = rowContentElements.reduce((currentMaxHeightPx, contentElement) => {
            if (!(contentElement instanceof HTMLElement)) {
                return currentMaxHeightPx;
            }

            return Math.max(
                currentMaxHeightPx,
                resolveCurrentVisibleContentHeightPx(contentElement, lineHeightPx)
            );
        }, rowHeightPx);

        function handleMouseMove(mousemoveEvent) {
            const nextHeightPx = clampManualCellMaxHeightPx(
                startHeightPx + (mousemoveEvent.clientY - mousedownEvent.clientY),
                lineHeightPx
            );
            setManualRowHeight(rowElement, nextHeightPx);
            resizableContentElements.forEach((contentElement) => {
                if (!(contentElement instanceof HTMLElement)) {
                    return;
                }

                contentElement.style.maxHeight = `${nextHeightPx}px`;
                markCellAsManuallyResized(contentElement);
            });
            numberingCellElement.classList.add('table_row_numbering--manually-resized');
        }

        function handleMouseUp() {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        }

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }

    function resetRowResize(dblclickEvent) {
        dblclickEvent.preventDefault();
        dblclickEvent.stopPropagation();
        resetManualRowHeight(rowElement);
        resetManualHeightResize(resolveResizableCellContents(rowElement), numberingCellElement);
    }

    const bottomResizeHandle = document.createElement('div');
    bottomResizeHandle.classList.add('table_row_height_handle');
    bottomResizeHandle.title = 'Drag to resize row height. Double-click to reset.';
    bottomResizeHandle.dataset.testid = 'table-row-height-handle';
    bottomResizeHandle.addEventListener('mousedown', startRowResize);
    bottomResizeHandle.addEventListener('dblclick', resetRowResize);

    numberingCellElement.classList.add('table_row_numbering--height-resizable');
    numberingCellElement.append(bottomResizeHandle);
}

export function createDataCell(item, column, columns, rowIndex, colIndex, table_name, dataTypes = {}) {
    const td = document.createElement('td');
    td.tabIndex = 0;
    td.dataset.rowIndex = rowIndex;
    td.dataset.colIndex  = colIndex;
    td.dataset.column = column;
    td.dataset.testid = `table-cell-${column}`;
    td.classList.add('table_data_cell');
    // console.log('calling makeColumnClass with table_name:', table_name, 'and column:', column);
    td.classList.add(makeColumnClass(table_name, column)); // ★

    const value = item[column];
    const columnMetadata = dataTypes?.[column] || {};
    let displayValue = resolveDatasetDisplayValue(value, columnMetadata);

    const foreignKeyColumn = column.replace('_name', '_id');

    if (columns.includes(foreignKeyColumn)) {
        displayValue = formatValue(displayValue);
    } else if (columns.includes(`${column}_name`)) {
        const foreignDisplayColumn = `${column}_name`;
        const foreignDisplayValue = item[foreignDisplayColumn];
        const foreignDisplayMetadata = dataTypes?.[foreignDisplayColumn] || null;
        td.title = (item[foreignDisplayColumn] == null)
            ? 'Tuntematon'
            : resolveDatasetDisplayValue(foreignDisplayValue, foreignDisplayMetadata);
        if (item[foreignDisplayColumn] != null) {
            bindDatasetLanguageRenderer(td, (chosenLanguage) => {
                td.title = resolveDatasetDisplayValue(
                    foreignDisplayValue,
                    foreignDisplayMetadata,
                    chosenLanguage
                );
            });
        }
        displayValue = formatValue(displayValue);
    } else {
        displayValue = formatValue(displayValue);
    }

    const timestampParts = formatTimestampDisplayParts(value, dataTypes?.[column] || "");
    if (timestampParts) {
        displayValue = timestampParts.displayText;
        td.title = timestampParts.titleText;
    }

    const content = document.createElement('div');
    content.classList.add('table_cell_content');
    if (shouldRenderCompactCellValue(displayValue)) {
        td.classList.add('table_data_cell--compact');
        content.classList.add('table_cell_content--compact');
    } else {
        td.classList.add('table_data_cell--height-resizable');
    }
    if (timestampParts) {
        content.textContent = normalizeDisplayText(displayValue);
    } else {
        setLocalizedDatasetText(content, value, columnMetadata, {
            transform: (localizedValue) => normalizeDisplayText(formatValue(localizedValue)),
            afterRender: (renderedValue) => {
                const isCompact = shouldRenderCompactCellValue(renderedValue);
                td.classList.toggle('table_data_cell--compact', isCompact);
                td.classList.toggle('table_data_cell--height-resizable', !isCompact);
                content.classList.toggle('table_cell_content--compact', isCompact);
            },
        });
    }
    td.appendChild(content);
    return td;
}
