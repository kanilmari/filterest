// @vitest-environment jsdom
// edit_session_dom_checker.test.js
// Verifies DOM click targets are translated into shared edit-session decisions.
// Bridges active editor elements, table/list cells, and pure state helpers.
// Exists to keep the framework-free DOM adapter safe before renderer wiring begins.

import { beforeEach, describe, expect, test } from 'vitest';
import { GRID_CELL_VIEW_TYPES, getCellCoordinateFromElement } from './cell_coordinate_reader.js';
import { EDIT_SESSION_CLICK_ACTIONS, createEditSessionState } from './edit_session_checker.js';
import {
    decideEditSessionClickFromTarget,
    isEventTargetInsideElement,
} from './edit_session_dom_checker.js';

describe('edit_session_dom_checker', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    test('keeps editing when clicking inside the active editor element', () => {
        const activeCell = createTableCell({ rowIndex: '0', columnIndex: '1', columnName: 'title' });
        const editor = document.createElement('div');
        const input = document.createElement('input');
        editor.className = 'inline-editor';
        editor.appendChild(input);
        activeCell.appendChild(editor);

        const session = createEditSessionState({
            activeCoordinate: getCellCoordinateFromElement(activeCell),
        });

        const decision = decideEditSessionClickFromTarget({
            session,
            eventTarget: input,
            activeEditorElement: editor,
        });

        expect(isEventTargetInsideElement(input, editor)).toBe(true);
        expect(decision.action).toBe(EDIT_SESSION_CLICK_ACTIONS.KEEP_EDITING);
    });

    test('switches cells when clicking another table cell', () => {
        const activeCell = createTableCell({ rowIndex: '0', columnIndex: '1', columnName: 'title' });
        const nextCell = createTableCell({ rowIndex: '0', columnIndex: '2', columnName: 'status' });
        const session = createEditSessionState({
            activeCoordinate: getCellCoordinateFromElement(activeCell),
        });

        const decision = decideEditSessionClickFromTarget({
            session,
            eventTarget: nextCell,
        });

        expect(decision.action).toBe(EDIT_SESSION_CLICK_ACTIONS.SWITCH_CELL);
        expect(decision.clickedCoordinate).toEqual({
            viewType: GRID_CELL_VIEW_TYPES.TABLE,
            rowIndex: 0,
            columnIndex: 2,
            columnName: 'status',
        });
    });

    test('switches cells when clicking another div-list cell', () => {
        const activeCell = createTableCell({ rowIndex: '1', columnIndex: '0', columnName: 'name' });
        const listCell = document.createElement('div');
        listCell.className = 'cell';
        listCell.dataset.row = '2';
        listCell.dataset.col = '1';
        listCell.dataset.column = 'status';
        document.body.appendChild(listCell);

        const session = createEditSessionState({
            activeCoordinate: getCellCoordinateFromElement(activeCell),
        });

        const decision = decideEditSessionClickFromTarget({
            session,
            eventTarget: listCell,
        });

        expect(decision.action).toBe(EDIT_SESSION_CLICK_ACTIONS.SWITCH_CELL);
        expect(decision.clickedCoordinate).toEqual({
            viewType: GRID_CELL_VIEW_TYPES.LIST,
            rowIndex: 1,
            columnIndex: 1,
            columnName: 'status',
        });
    });

    test('cancels when clicking outside cells and ignores missing targets safely', () => {
        const activeCell = createTableCell({ rowIndex: '0', columnIndex: '1', columnName: 'title' });
        const outsideTarget = document.createElement('button');
        document.body.appendChild(outsideTarget);
        const session = createEditSessionState({
            activeCoordinate: getCellCoordinateFromElement(activeCell),
        });

        expect(decideEditSessionClickFromTarget({
            session,
            eventTarget: outsideTarget,
        }).action).toBe(EDIT_SESSION_CLICK_ACTIONS.CANCEL_EDITING);

        expect(decideEditSessionClickFromTarget({
            session,
            eventTarget: null,
        }).action).toBe(EDIT_SESSION_CLICK_ACTIONS.IGNORE);
    });
});

function createTableCell({ rowIndex, columnIndex, columnName }) {
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.dataset.rowIndex = rowIndex;
    cell.dataset.colIndex = columnIndex;
    cell.dataset.column = columnName;
    row.appendChild(cell);
    tbody.appendChild(row);
    table.appendChild(tbody);
    document.body.appendChild(table);
    return cell;
}
