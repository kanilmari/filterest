// edit_session_checker.js
// Decides how an active grid edit session should react to clicks.
// Bridges normalized cell coordinates and future table/list inline editor wiring.
// Exists to keep editor focus, cancel, and switch behavior deterministic and renderer-agnostic.

import { areCellCoordinatesEqual, createCellCoordinate } from './cell_coordinate_reader.js';

export const EDIT_SESSION_CLICK_ACTIONS = Object.freeze({
    IGNORE: 'ignore',
    KEEP_EDITING: 'keep_editing',
    CANCEL_EDITING: 'cancel_editing',
    SWITCH_CELL: 'switch_cell',
});

/**
 * Creates a normalized edit-session state snapshot.
 * Operates between renderer-specific editor state and pure click decisions.
 * Exists so table and list views can pass the same active-cell structure.
 *
 * @param {Object} [rawSession]
 * @param {Object|null} [rawSession.activeCoordinate]
 * @param {boolean} [rawSession.isEditing]
 * @returns {{ activeCoordinate: Object|null, isEditing: boolean }}
 */
export function createEditSessionState(rawSession = {}) {
    const activeCoordinate = createCellCoordinate(rawSession.activeCoordinate);
    const isEditing = rawSession.isEditing ?? Boolean(activeCoordinate);

    return {
        activeCoordinate,
        isEditing: Boolean(isEditing && activeCoordinate),
    };
}

/**
 * Decides the edit-session action for a click.
 * Operates between the active cell, the clicked cell, and editor-containment metadata.
 * Exists to centralize the keep/cancel/switch rules shared by table and list views.
 *
 * @param {Object} options
 * @param {Object|null} options.session
 * @param {Object|null} options.clickedCoordinate
 * @param {boolean} [options.isClickInsideActiveEditor=false]
 * @param {boolean} [options.switchOnDifferentCell=true]
 * @param {boolean} [options.cancelOnMissingClickedCoordinate=false]
 * @returns {{ action: string, activeCoordinate: Object|null, clickedCoordinate: Object|null }}
 */
export function decideEditSessionClickAction(options = {}) {
    const session = createEditSessionState(options.session);
    const clickedCoordinate = createCellCoordinate(options.clickedCoordinate);

    if (!session.isEditing || !session.activeCoordinate) {
        return buildDecision(EDIT_SESSION_CLICK_ACTIONS.IGNORE, session.activeCoordinate, clickedCoordinate);
    }

    if (options.isClickInsideActiveEditor === true) {
        return buildDecision(EDIT_SESSION_CLICK_ACTIONS.KEEP_EDITING, session.activeCoordinate, clickedCoordinate);
    }

    if (!clickedCoordinate) {
        const action = options.cancelOnMissingClickedCoordinate === true
            ? EDIT_SESSION_CLICK_ACTIONS.CANCEL_EDITING
            : EDIT_SESSION_CLICK_ACTIONS.IGNORE;
        return buildDecision(action, session.activeCoordinate, null);
    }

    if (areCellCoordinatesEqual(session.activeCoordinate, clickedCoordinate)) {
        return buildDecision(EDIT_SESSION_CLICK_ACTIONS.KEEP_EDITING, session.activeCoordinate, clickedCoordinate);
    }

    const action = options.switchOnDifferentCell === false
        ? EDIT_SESSION_CLICK_ACTIONS.CANCEL_EDITING
        : EDIT_SESSION_CLICK_ACTIONS.SWITCH_CELL;

    return buildDecision(action, session.activeCoordinate, clickedCoordinate);
}

/**
 * Builds a consistent decision payload.
 * Operates between action constants and calling editor orchestration.
 * Exists to make future event handlers easy to assert in focused tests.
 *
 * @param {string} action
 * @param {Object|null} activeCoordinate
 * @param {Object|null} clickedCoordinate
 * @returns {{ action: string, activeCoordinate: Object|null, clickedCoordinate: Object|null }}
 */
function buildDecision(action, activeCoordinate, clickedCoordinate) {
    return {
        action,
        activeCoordinate,
        clickedCoordinate,
    };
}
