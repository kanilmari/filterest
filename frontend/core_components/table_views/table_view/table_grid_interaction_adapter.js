// table_grid_interaction_adapter.js
// Wires shared range-selection and copy-menu behavior into the HTML table view.
// Bridges table <td> cells, grid_interactions helpers, and clipboard/toast feedback.
// Exists so table view receives the same multi-cell copy affordance as the list adapter.

import { showErrorToast, showSuccessToast } from '../../../reusable_components/notifications/toast_notification_printer.js';
import { getTranslationForKey } from '../../lang/translation_handler.js';
import { getCellCoordinateFromElement } from '../grid_interactions/cell_coordinate_reader.js';
import { GRID_COPY_ACTION_IDS, deriveGridContextMenuPayload } from '../grid_interactions/context_menu_payload_builder.js';
import {
    enumerateSelectedCells,
    normalizeRangeBounds,
    normalizeRangeSelection,
} from '../grid_interactions/range_selection_builder.js';

const TABLE_DATA_CELL_SELECTOR = 'tbody td.table_data_cell';

/**
 * Adds shared grid interactions to a rendered table-view table.
 * Operates between the table DOM, row data, and shared copy/range helpers.
 * Exists to keep table and list adapters aligned without changing row rendering.
 *
 * @param {HTMLTableElement} table
 * @param {Array<string>} columns
 * @param {Array<Object>} data
 * @returns {void}
 */
export function addTableGridInteractionAdapter(table, columns, data) {
    if (!(table instanceof HTMLTableElement)) {
        return;
    }

    const state = {
        isSelecting: false,
        selectionStartCoordinate: null,
    };

    table.addEventListener('mousedown', (event) => {
        handleTableMouseDown({ event, table, state });
    });
    table.addEventListener('mousemove', (event) => {
        handleTableMouseMove({ event, table, state });
    });
    table.addEventListener('mouseup', () => {
        state.isSelecting = false;
        state.selectionStartCoordinate = null;
    });
    table.addEventListener('contextmenu', (event) => {
        handleTableContextMenu({ event, table, columns, data });
    });
}

/**
 * Starts a table range selection from a data cell.
 * Operates between mouse events and shared zero-based cell coordinates.
 * Exists to make table selection match the list adapter's drag-select behavior.
 *
 * @param {Object} params
 * @param {MouseEvent} params.event
 * @param {HTMLTableElement} params.table
 * @param {Object} params.state
 * @returns {void}
 */
function handleTableMouseDown({ event, table, state }) {
    if (event.button !== 0 || event.target?.closest?.('.resize-handle, .table_row_height_handle')) {
        return;
    }

    const cell = resolveTableDataCell(event.target);
    const menu = getExistingSelectionMenu(table);

    if (!cell) {
        if (!menu?.contains(event.target)) {
            clearTableGridSelection(table);
            hideSelectionMenu(menu);
        }
        return;
    }

    if (cell.classList.contains('editing')) {
        return;
    }

    const startCoordinate = getCellCoordinateFromElement(cell);
    if (!startCoordinate) {
        return;
    }

    state.isSelecting = true;
    state.selectionStartCoordinate = startCoordinate;
    clearTableGridSelection(table);
    hideSelectionMenu(menu);
    highlightTableRange(table, normalizeRangeSelection(startCoordinate, startCoordinate));
}

/**
 * Extends the active table range selection while the pointer moves.
 * Operates between the current hovered cell and shared range helpers.
 * Exists to keep rectangular selection math outside the table renderer.
 *
 * @param {Object} params
 * @param {MouseEvent} params.event
 * @param {HTMLTableElement} params.table
 * @param {Object} params.state
 * @returns {void}
 */
function handleTableMouseMove({ event, table, state }) {
    if (!state.isSelecting || !state.selectionStartCoordinate) {
        return;
    }

    const cell = resolveTableDataCell(event.target);
    const currentCoordinate = getCellCoordinateFromElement(cell);
    if (!currentCoordinate) {
        return;
    }

    clearTableGridSelection(table);
    highlightTableRange(table, normalizeRangeSelection(
        state.selectionStartCoordinate,
        currentCoordinate
    ));
}

/**
 * Opens the shared copy menu for a selected table range.
 * Operates between right-click events and grid_interactions context-menu payloads.
 * Exists so table view can copy selected cells with or without headers.
 *
 * @param {Object} params
 * @param {MouseEvent} params.event
 * @param {HTMLTableElement} params.table
 * @param {Array<string>} params.columns
 * @param {Array<Object>} params.data
 * @returns {void}
 */
function handleTableContextMenu({ event, table, columns, data }) {
    if (event.altKey) {
        return;
    }

    const cell = resolveTableDataCell(event.target);
    if (!cell || !cell.classList.contains('selected')) {
        return;
    }

    const menuPayload = deriveGridContextMenuPayload({
        range: getSelectedTableRange(table),
        triggerCoordinate: getCellCoordinateFromElement(cell),
        menuPosition: event,
        rows: data,
        columns,
        copyOptions: {
            valueResolver: ({ rowIndex, columnIndex }) => getTableCellText(table, rowIndex, columnIndex),
        },
    });

    if (!menuPayload.shouldOpen) {
        return;
    }

    event.preventDefault();
    showSelectionMenu(table, menuPayload);
}

/**
 * Highlights every table cell in a normalized range.
 * Operates between shared range math and table DOM cells.
 * Exists to reuse the same selected-cell class as the list adapter.
 *
 * @param {HTMLTableElement} table
 * @param {Object|null} rawRange
 * @returns {void}
 */
function highlightTableRange(table, rawRange) {
    const range = normalizeRangeBounds(rawRange);
    if (!range) {
        return;
    }

    enumerateSelectedCells(range).forEach(({ rowIndex, columnIndex }) => {
        const cell = getTableCellByCoordinate(table, rowIndex, columnIndex);
        if (cell) {
            cell.classList.add('selected');
        }
    });
}

/**
 * Removes table range-selection highlighting.
 * Operates between table DOM state and the shared selected class.
 * Exists to keep selection cleanup local to the active table.
 *
 * @param {HTMLTableElement} table
 * @returns {void}
 */
function clearTableGridSelection(table) {
    table.querySelectorAll(`${TABLE_DATA_CELL_SELECTOR}.selected`).forEach((cell) => {
        cell.classList.remove('selected');
    });
}

/**
 * Resolves the selected table cells into normalized range bounds.
 * Operates between selected DOM cells and grid_interactions range helpers.
 * Exists so copy payloads do not inspect DOM positions directly.
 *
 * @param {HTMLTableElement} table
 * @returns {Object|null}
 */
function getSelectedTableRange(table) {
    const selectedCoordinates = Array.from(
        table.querySelectorAll(`${TABLE_DATA_CELL_SELECTOR}.selected`)
    )
        .map((cell) => getCellCoordinateFromElement(cell))
        .filter(Boolean);

    if (!selectedCoordinates.length) {
        return null;
    }

    const rowIndexes = selectedCoordinates.map((coordinate) => coordinate.rowIndex);
    const columnIndexes = selectedCoordinates.map((coordinate) => coordinate.columnIndex);

    return normalizeRangeBounds({
        minRowIndex: Math.min(...rowIndexes),
        maxRowIndex: Math.max(...rowIndexes),
        minColumnIndex: Math.min(...columnIndexes),
        maxColumnIndex: Math.max(...columnIndexes),
    });
}

/**
 * Shows or creates the table copy menu.
 * Operates between context-menu payloads and the reusable menu DOM.
 * Exists to keep menu rendering identical across table refreshes.
 *
 * @param {HTMLTableElement} table
 * @param {Object} menuPayload
 * @returns {void}
 */
function showSelectionMenu(table, menuPayload) {
    const menu = getOrCreateSelectionMenu(table);
    menu.gridSelectionPayload = menuPayload;
    menu.style.left = `${menuPayload.menuPosition?.x ?? 0}px`;
    menu.style.top = `${menuPayload.menuPosition?.y ?? 0}px`;
    menu.style.display = 'block';
}

/**
 * Hides the table copy menu when present.
 * Operates between selection state and menu DOM visibility.
 * Exists so normal table clicks can dismiss stale menus.
 *
 * @param {HTMLElement|null} menu
 * @returns {void}
 */
function hideSelectionMenu(menu) {
    if (!menu) {
        return;
    }

    menu.gridSelectionPayload = null;
    menu.style.display = 'none';
}

/**
 * Builds or returns the existing copy menu for one table.
 * Operates between a table element and its closest rendered container.
 * Exists to avoid embedding a <div> menu inside invalid table markup.
 *
 * @param {HTMLTableElement} table
 * @returns {HTMLElement}
 */
function getOrCreateSelectionMenu(table) {
    if (table.gridSelectionMenu instanceof HTMLElement) {
        return table.gridSelectionMenu;
    }

    const menu = document.createElement('div');
    menu.className = 'selection-menu grid-selection-menu';
    menu.style.position = 'absolute';
    menu.style.display = 'none';

    const copyHeadersBtn = document.createElement('button');
    copyHeadersBtn.dataset.action = 'copy-headers';
    copyHeadersBtn.textContent = getTranslationForKey('copy_headers_and_cells') || 'Copy headers and cells';

    const copyNoHeadersBtn = document.createElement('button');
    copyNoHeadersBtn.dataset.action = 'copy-no-headers';
    copyNoHeadersBtn.textContent = getTranslationForKey('copy_cells_only') || 'Copy cells only';

    menu.append(copyHeadersBtn, copyNoHeadersBtn);
    menu.addEventListener('click', (event) => {
        handleSelectionMenuClick({ event, table, menu });
    });

    const menuHost = table.parentElement || document.body;
    menuHost.appendChild(menu);
    table.gridSelectionMenu = menu;
    return menu;
}

/**
 * Returns the existing menu without creating a new one.
 * Operates between table click handling and optional menu cleanup.
 * Exists so ordinary clicks do not allocate menu elements.
 *
 * @param {HTMLTableElement} table
 * @returns {HTMLElement|null}
 */
function getExistingSelectionMenu(table) {
    return table.gridSelectionMenu instanceof HTMLElement
        ? table.gridSelectionMenu
        : null;
}

/**
 * Executes one table copy-menu action.
 * Operates between menu button clicks and clipboard payload generation.
 * Exists to keep copy behavior testable without browser context-menu UI.
 *
 * @param {Object} params
 * @param {MouseEvent} params.event
 * @param {HTMLTableElement} params.table
 * @param {HTMLElement} params.menu
 * @returns {void}
 */
function handleSelectionMenuClick({ event, table: _table, menu }) {
    const action = event.target?.dataset?.action;
    if (action !== 'copy-headers' && action !== 'copy-no-headers') {
        return;
    }

    const payload = menu.gridSelectionPayload;
    const actionId = action === 'copy-headers'
        ? GRID_COPY_ACTION_IDS.COPY_WITH_HEADERS
        : GRID_COPY_ACTION_IDS.COPY_WITHOUT_HEADERS;
    const copyPayload = payload?.copyActions?.find((copyAction) => copyAction.id === actionId)?.payload;

    if (!copyPayload || copyPayload.isEmpty) {
        hideSelectionMenu(menu);
        return;
    }

    navigator.clipboard.writeText(copyPayload.text)
        .then(() => {
            showSuccessToast(getTranslationForKey('copied_to_clipboard') || 'Copied to clipboard');
        })
        .catch((error) => {
            console.warn('copy failed:', error);
            showErrorToast(getTranslationForKey('copy_failed') || 'Copy failed.');
        });

    hideSelectionMenu(menu);
}

/**
 * Reads visible text from one table cell.
 * Operates between shared copy coordinates and table DOM text content.
 * Exists so copied data matches what the user selected on screen.
 *
 * @param {HTMLTableElement} table
 * @param {number} rowIndex
 * @param {number} columnIndex
 * @returns {string}
 */
function getTableCellText(table, rowIndex, columnIndex) {
    const cell = getTableCellByCoordinate(table, rowIndex, columnIndex);
    return cell ? cell.textContent.trim() : '';
}

/**
 * Finds one table data cell by shared zero-based coordinates.
 * Operates between grid_interactions coordinates and table-view data attributes.
 * Exists so selection, keyboard, and copy code use the same addressing scheme.
 *
 * @param {HTMLTableElement} table
 * @param {number} rowIndex
 * @param {number} columnIndex
 * @returns {HTMLElement|null}
 */
function getTableCellByCoordinate(table, rowIndex, columnIndex) {
    return table.querySelector(
        `${TABLE_DATA_CELL_SELECTOR}[data-row-index='${rowIndex}'][data-col-index='${columnIndex}']`
    );
}

/**
 * Finds a supported table data cell from a nested event target.
 * Operates between content divs/editor controls and the selectable td element.
 * Exists to avoid treating numbering, checkbox, or header cells as data cells.
 *
 * @param {EventTarget|null} eventTarget
 * @returns {HTMLElement|null}
 */
function resolveTableDataCell(eventTarget) {
    const cell = eventTarget?.closest?.(TABLE_DATA_CELL_SELECTOR);
    return cell instanceof HTMLElement ? cell : null;
}
