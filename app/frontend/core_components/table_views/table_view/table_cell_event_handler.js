// table_cell_event_handler.js
// Attaches click and dblclick event listeners to table body cells for selection and inline editing.
// Bridges table_cell_handler.js selection with cell_editor.js inline editing.
// Exists to keep cell-event wiring out of row rendering and table refresh logic.

import { selectCell } from './table_cell_handler.js';
import { editCell } from '../../general_tables/gt_1_row_crud/gt_1_3_row_update/cell_editor.js';
import { getCellCoordinateFromElement } from '../grid_interactions/cell_coordinate_reader.js';
import { EDIT_SESSION_CLICK_ACTIONS, createEditSessionState } from '../grid_interactions/edit_session_checker.js';
import { decideEditSessionClickFromTarget } from '../grid_interactions/edit_session_dom_checker.js';
import { getAdjacentGridCoordinate, isGridNavigationKey } from '../grid_interactions/grid_keyboard_navigation.js';

export function shouldIgnoreTableCellSelectionClick(cell, eventTarget = cell) {
    if (!(cell instanceof HTMLElement) || !cell.classList.contains('editing')) {
        return false;
    }

    const decision = decideEditSessionClickFromTarget({
        session: createEditSessionState({
            activeCoordinate: getCellCoordinateFromElement(cell),
        }),
        eventTarget,
        activeEditorElement: cell,
        switchOnDifferentCell: false,
        cancelOnOutsideClick: false,
    });

    return decision.action === EDIT_SESSION_CLICK_ACTIONS.KEEP_EDITING;
}

export function addEventListenersToCells(table, columns, data, dataTypes, table_name) {
    const cells = table.querySelectorAll('tbody td:not(:first-child)');

    cells.forEach(cell => {
        cell.addEventListener('click', (e) => {
            if (shouldIgnoreTableCellSelectionClick(e.currentTarget, e.target)) {
                e.stopPropagation();
                return;
            }
            selectCell(e.currentTarget);
        });

        cell.addEventListener('dblclick', (e) => {
            editCell(e.currentTarget, columns, data, dataTypes, table_name);
        });

        cell.addEventListener('keydown', (event) => {
            handleKeyDown(event, cell, columns, data, dataTypes, table_name);
        });
    });
}

export function handleKeyDown(event, cell, columns, data, dataTypes, table_name) {
    if (cell.classList.contains('editing')) {
        return;
    }

    const tbody = cell.closest('tbody');

    if (event.key === 'F2' || event.key === 'Enter') {
        event.preventDefault();
        editCell(cell, columns, data, dataTypes, table_name);
        return;
    }

    if (!tbody || !isGridNavigationKey(event.key)) {
        return;
    }

    const nextCoordinate = getAdjacentGridCoordinate({
        coordinate: getCellCoordinateFromElement(cell),
        key: event.key,
        maxRowIndex: tbody.rows.length - 1,
        maxColumnIndex: columns.length - 1,
    });
    const newCell = nextCoordinate
        ? tbody.querySelector(
            `td.table_data_cell[data-row-index='${nextCoordinate.rowIndex}'][data-col-index='${nextCoordinate.columnIndex}']`
        )
        : null;

    if (newCell instanceof HTMLElement) {
        event.preventDefault();
        selectCell(newCell);
    }
}
