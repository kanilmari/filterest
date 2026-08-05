// edit_session_dom_checker.js
// Connects DOM click targets to pure grid edit-session decisions.
// Bridges active editor elements, rendered cell nodes, and edit_session_checker.js.
// Exists to isolate the small amount of DOM containment logic needed by shared editing.

import { getCellCoordinateFromEventTarget } from './cell_coordinate_reader.js';
import { decideEditSessionClickAction } from './edit_session_checker.js';

/**
 * Decides the edit-session action for a DOM click target.
 * Operates between browser event targets and the pure edit-session state machine.
 * Exists so table/list event handlers can stay thin when this layer is wired in.
 *
 * @param {Object} options
 * @param {Object|null} options.session
 * @param {EventTarget|null} options.eventTarget
 * @param {Element|null} [options.activeEditorElement]
 * @param {boolean} [options.switchOnDifferentCell=true]
 * @param {boolean} [options.cancelOnOutsideClick=true]
 * @returns {{ action: string, activeCoordinate: Object|null, clickedCoordinate: Object|null }}
 */
export function decideEditSessionClickFromTarget(options = {}) {
    const clickedCoordinate = getCellCoordinateFromEventTarget(options.eventTarget);
    const isClickInsideActiveEditor = isEventTargetInsideElement(
        options.eventTarget,
        options.activeEditorElement
    );

    return decideEditSessionClickAction({
        session: options.session,
        clickedCoordinate,
        isClickInsideActiveEditor,
        switchOnDifferentCell: options.switchOnDifferentCell,
        cancelOnMissingClickedCoordinate: options.cancelOnOutsideClick !== false
            && isNodeLike(options.eventTarget),
    });
}

/**
 * Checks whether an event target is inside a DOM element.
 * Operates between nested inputs/content nodes and their active editor container.
 * Exists to keep editor-internal clicks from being mistaken for outside-cell clicks.
 *
 * @param {EventTarget|null|undefined} eventTarget
 * @param {Element|null|undefined} containerElement
 * @returns {boolean}
 */
export function isEventTargetInsideElement(eventTarget, containerElement) {
    if (!isNodeLike(eventTarget) || !isElementLike(containerElement)) {
        return false;
    }

    return containerElement.contains(eventTarget);
}

/**
 * Checks whether a value behaves like a DOM Node.
 * Operates between browser/jsdom event targets and containment checks.
 * Exists to avoid global Node assumptions in non-browser contexts.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isNodeLike(value) {
    return Boolean(value && typeof value.nodeType === 'number');
}

/**
 * Checks whether a value behaves like a DOM Element.
 * Operates between optional active editor references and DOM containment.
 * Exists to avoid global Element assumptions in non-browser contexts.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isElementLike(value) {
    return Boolean(
        value
        && value.nodeType === 1
        && typeof value.contains === 'function'
    );
}
