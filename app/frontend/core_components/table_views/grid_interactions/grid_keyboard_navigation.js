// grid_keyboard_navigation.js
// Calculates keyboard movement between logical grid coordinates.
// Bridges table/list keydown handlers and shared row/column coordinate state.
// Exists so table and list adapters use the same arrow-key boundary rules.

export const GRID_NAVIGATION_KEYS = Object.freeze([
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
]);

/**
 * Checks whether a keyboard key should move between grid cells.
 * Operates between browser KeyboardEvent keys and shared navigation handling.
 * Exists to keep table and list adapters from duplicating key-name checks.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isGridNavigationKey(key) {
    return GRID_NAVIGATION_KEYS.includes(key);
}

/**
 * Calculates the next in-bounds grid coordinate for an arrow-key move.
 * Operates between a current logical cell and renderer-provided grid bounds.
 * Exists so keyboard movement behaves the same in table and list adapters.
 *
 * @param {Object} params
 * @param {{rowIndex: number, columnIndex: number}|null} params.coordinate
 * @param {string} params.key
 * @param {number} params.maxRowIndex
 * @param {number} params.maxColumnIndex
 * @returns {{rowIndex: number, columnIndex: number}|null}
 */
export function getAdjacentGridCoordinate({
    coordinate,
    key,
    maxRowIndex,
    maxColumnIndex,
} = {}) {
    if (!coordinate || !isGridNavigationKey(key)) {
        return null;
    }

    const rowIndex = readNonNegativeInteger(coordinate.rowIndex);
    const columnIndex = readNonNegativeInteger(coordinate.columnIndex);
    const lastRowIndex = readNonNegativeInteger(maxRowIndex);
    const lastColumnIndex = readNonNegativeInteger(maxColumnIndex);

    if (
        rowIndex === null
        || columnIndex === null
        || lastRowIndex === null
        || lastColumnIndex === null
    ) {
        return null;
    }

    const nextCoordinate = {
        rowIndex,
        columnIndex,
    };

    if (key === 'ArrowLeft') {
        nextCoordinate.columnIndex -= 1;
    } else if (key === 'ArrowRight') {
        nextCoordinate.columnIndex += 1;
    } else if (key === 'ArrowUp') {
        nextCoordinate.rowIndex -= 1;
    } else if (key === 'ArrowDown') {
        nextCoordinate.rowIndex += 1;
    }

    if (
        nextCoordinate.rowIndex < 0
        || nextCoordinate.columnIndex < 0
        || nextCoordinate.rowIndex > lastRowIndex
        || nextCoordinate.columnIndex > lastColumnIndex
    ) {
        return null;
    }

    return nextCoordinate;
}

/**
 * Reads a non-negative integer from numeric or dataset-style input.
 * Operates between DOM metadata and pure coordinate math.
 * Exists to reject malformed keyboard navigation bounds early.
 *
 * @param {number|string|null|undefined} value
 * @returns {number|null}
 */
function readNonNegativeInteger(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsedValue = Number(value);
    return Number.isInteger(parsedValue) && parsedValue >= 0
        ? parsedValue
        : null;
}
