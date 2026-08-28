// edit_session_checker.test.js
// Verifies pure edit-session click decisions for shared grid editing.
// Bridges normalized cell coordinates and renderer-independent editor state.
// Exists to document keep, cancel, switch, and safe-ignore behavior.

import { describe, expect, test } from 'vitest';
import { GRID_CELL_VIEW_TYPES } from './cell_coordinate_reader.js';
import {
    EDIT_SESSION_CLICK_ACTIONS,
    createEditSessionState,
    decideEditSessionClickAction,
} from './edit_session_checker.js';

describe('edit_session_checker', () => {
    test('keeps editing when a click occurs inside the active editor', () => {
        const session = createSessionAt(0, 1, 'title');

        const decision = decideEditSessionClickAction({
            session,
            clickedCoordinate: null,
            isClickInsideActiveEditor: true,
        });

        expect(decision.action).toBe(EDIT_SESSION_CLICK_ACTIONS.KEEP_EDITING);
        expect(decision.activeCoordinate).toEqual(session.activeCoordinate);
        expect(decision.clickedCoordinate).toBeNull();
    });

    test('keeps editing when the clicked coordinate is the active cell', () => {
        const session = createSessionAt(0, 1, 'title');

        const decision = decideEditSessionClickAction({
            session,
            clickedCoordinate: {
                viewType: GRID_CELL_VIEW_TYPES.LIST,
                rowIndex: 0,
                columnIndex: 1,
                columnName: 'title',
            },
        });

        expect(decision.action).toBe(EDIT_SESSION_CLICK_ACTIONS.KEEP_EDITING);
    });

    test('switches cells when a different valid cell is clicked by default', () => {
        const session = createSessionAt(0, 1, 'title');
        const nextCoordinate = {
            viewType: GRID_CELL_VIEW_TYPES.TABLE,
            rowIndex: 0,
            columnIndex: 2,
            columnName: 'status',
        };

        const decision = decideEditSessionClickAction({
            session,
            clickedCoordinate: nextCoordinate,
        });

        expect(decision.action).toBe(EDIT_SESSION_CLICK_ACTIONS.SWITCH_CELL);
        expect(decision.clickedCoordinate).toEqual(nextCoordinate);
    });

    test('can request cancel instead of switching for another valid cell', () => {
        const session = createSessionAt(0, 1, 'title');

        const decision = decideEditSessionClickAction({
            session,
            clickedCoordinate: {
                viewType: GRID_CELL_VIEW_TYPES.TABLE,
                rowIndex: 1,
                columnIndex: 1,
                columnName: 'title',
            },
            switchOnDifferentCell: false,
        });

        expect(decision.action).toBe(EDIT_SESSION_CLICK_ACTIONS.CANCEL_EDITING);
    });

    test('ignores missing or invalid clicked coordinates safely', () => {
        const session = createSessionAt(0, 1, 'title');

        expect(decideEditSessionClickAction({
            session,
            clickedCoordinate: null,
        }).action).toBe(EDIT_SESSION_CLICK_ACTIONS.IGNORE);

        expect(decideEditSessionClickAction({
            session,
            clickedCoordinate: {
                viewType: GRID_CELL_VIEW_TYPES.TABLE,
                rowIndex: 'bad',
                columnIndex: 1,
            },
        }).action).toBe(EDIT_SESSION_CLICK_ACTIONS.IGNORE);
    });

    test('can cancel editing when a DOM caller treats a missing clicked coordinate as outside', () => {
        const session = createSessionAt(0, 1, 'title');

        const decision = decideEditSessionClickAction({
            session,
            clickedCoordinate: null,
            cancelOnMissingClickedCoordinate: true,
        });

        expect(decision.action).toBe(EDIT_SESSION_CLICK_ACTIONS.CANCEL_EDITING);
    });

    test('ignores clicks when no active edit session exists', () => {
        const session = createEditSessionState();

        const decision = decideEditSessionClickAction({
            session,
            clickedCoordinate: {
                viewType: GRID_CELL_VIEW_TYPES.TABLE,
                rowIndex: 0,
                columnIndex: 1,
            },
        });

        expect(decision.action).toBe(EDIT_SESSION_CLICK_ACTIONS.IGNORE);
    });
});

function createSessionAt(rowIndex, columnIndex, columnName) {
    return createEditSessionState({
        activeCoordinate: {
            viewType: GRID_CELL_VIEW_TYPES.TABLE,
            rowIndex,
            columnIndex,
            columnName,
        },
    });
}
