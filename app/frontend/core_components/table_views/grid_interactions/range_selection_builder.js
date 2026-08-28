/**
 * range_selection_builder.js
 *
 * Defines pure coordinate and rectangular range helpers for shared grid interactions.
 * Operates between renderer-specific coordinate inputs and canonical row/column selection state.
 * Exists so list and table views can share drag-selection math before DOM wiring is unified.
 */

const ROW_COORDINATE_KEYS = Object.freeze(["rowIndex", "row", "sourceRowIndex", "parentRowIndex"]);
const COLUMN_COORDINATE_KEYS = Object.freeze(["columnIndex", "column", "colIndex", "col", "cellIndex"]);

const MIN_ROW_BOUND_KEYS = Object.freeze(["minRowIndex", "minRow"]);
const MAX_ROW_BOUND_KEYS = Object.freeze(["maxRowIndex", "maxRow"]);
const MIN_COLUMN_BOUND_KEYS = Object.freeze(["minColumnIndex", "minCol", "minColumn"]);
const MAX_COLUMN_BOUND_KEYS = Object.freeze(["maxColumnIndex", "maxCol", "maxColumn"]);

/**
 * Normalize a renderer-specific cell coordinate into the shared grid coordinate shape.
 *
 * @param {Object} rawCoordinate - Coordinate-like input from a renderer adapter or event target snapshot.
 * @param {Object} [options]
 * @param {number} [options.rowOffset=0] - Offset added after reading the raw row value.
 * @param {number} [options.columnOffset=0] - Offset added after reading the raw column value.
 * @param {number} [options.minimumRowIndex=0] - Lowest accepted normalized row index.
 * @param {number} [options.minimumColumnIndex=0] - Lowest accepted normalized column index.
 * @returns {{rowIndex: number, columnIndex: number}|null}
 */
export function normalizeGridCoordinate(rawCoordinate, options = {}) {
    if (!rawCoordinate || typeof rawCoordinate !== "object") {
        return null;
    }

    const rowValue = readFirstInteger(rawCoordinate, ROW_COORDINATE_KEYS, true);
    const columnValue = readFirstInteger(rawCoordinate, COLUMN_COORDINATE_KEYS, true);

    if (rowValue === null || columnValue === null) {
        return null;
    }

    const rowIndex = rowValue + readIntegerOption(options.rowOffset, 0);
    const columnIndex = columnValue + readIntegerOption(options.columnOffset, 0);
    const minimumRowIndex = readIntegerOption(options.minimumRowIndex, 0);
    const minimumColumnIndex = readIntegerOption(options.minimumColumnIndex, 0);

    if (rowIndex < minimumRowIndex || columnIndex < minimumColumnIndex) {
        return null;
    }

    return { rowIndex, columnIndex };
}

/**
 * Normalize a drag start and current coordinate into rectangular range bounds.
 *
 * @param {Object} dragStartCoordinate - Coordinate where drag selection started.
 * @param {Object} dragCurrentCoordinate - Coordinate currently under the pointer.
 * @param {Object} [coordinateOptions] - Options passed to normalizeGridCoordinate.
 * @returns {Object|null} Normalized range, or null when either coordinate is invalid.
 */
export function normalizeRangeSelection(dragStartCoordinate, dragCurrentCoordinate, coordinateOptions = {}) {
    const startCoordinate = normalizeGridCoordinate(dragStartCoordinate, coordinateOptions);
    const currentCoordinate = normalizeGridCoordinate(dragCurrentCoordinate, coordinateOptions);

    if (!startCoordinate || !currentCoordinate) {
        return null;
    }

    return buildRangeFromCoordinates(startCoordinate, currentCoordinate);
}

/**
 * Normalize an existing range-like object into the shared rectangular range shape.
 *
 * @param {Object} rawRange - Range object with min/max bounds or start/current coordinates.
 * @returns {Object|null} Normalized range, or null for malformed ranges.
 */
export function normalizeRangeBounds(rawRange) {
    if (!rawRange || typeof rawRange !== "object") {
        return null;
    }

    const startCoordinate = rawRange.startCoordinate || rawRange.start || null;
    const currentCoordinate = rawRange.currentCoordinate || rawRange.current || null;

    if (startCoordinate && currentCoordinate) {
        return normalizeRangeSelection(startCoordinate, currentCoordinate);
    }

    const minRowIndex = readFirstInteger(rawRange, MIN_ROW_BOUND_KEYS, false);
    const maxRowIndex = readFirstInteger(rawRange, MAX_ROW_BOUND_KEYS, false);
    const minColumnIndex = readFirstInteger(rawRange, MIN_COLUMN_BOUND_KEYS, false);
    const maxColumnIndex = readFirstInteger(rawRange, MAX_COLUMN_BOUND_KEYS, false);

    if ([minRowIndex, maxRowIndex, minColumnIndex, maxColumnIndex].some((value) => value === null)) {
        return null;
    }

    return buildRangeFromBounds(minRowIndex, maxRowIndex, minColumnIndex, maxColumnIndex);
}

/**
 * Enumerate every cell coordinate in a normalized range in row-major order.
 *
 * @param {Object} rawRange - Range-like input accepted by normalizeRangeBounds.
 * @returns {Array<{rowIndex: number, columnIndex: number}>}
 */
export function enumerateSelectedCells(rawRange) {
    const range = normalizeRangeBounds(rawRange);

    if (!range) {
        return [];
    }

    const selectedCells = [];
    for (let rowIndex = range.minRowIndex; rowIndex <= range.maxRowIndex; rowIndex += 1) {
        for (let columnIndex = range.minColumnIndex; columnIndex <= range.maxColumnIndex; columnIndex += 1) {
            selectedCells.push({ rowIndex, columnIndex });
        }
    }

    return selectedCells;
}

/**
 * Determine whether a range covers exactly one cell.
 *
 * @param {Object} rawRange - Range-like input accepted by normalizeRangeBounds.
 * @returns {boolean}
 */
export function isSingleCellRange(rawRange) {
    const range = normalizeRangeBounds(rawRange);
    return Boolean(range && range.rowCount === 1 && range.columnCount === 1);
}

/**
 * Determine whether a range stays on one row across one or more columns.
 *
 * @param {Object} rawRange - Range-like input accepted by normalizeRangeBounds.
 * @returns {boolean}
 */
export function isSameRowRange(rawRange) {
    const range = normalizeRangeBounds(rawRange);
    return Boolean(range && range.rowCount === 1);
}

/**
 * Determine whether a range stays in one column across one or more rows.
 *
 * @param {Object} rawRange - Range-like input accepted by normalizeRangeBounds.
 * @returns {boolean}
 */
export function isSameColumnRange(rawRange) {
    const range = normalizeRangeBounds(rawRange);
    return Boolean(range && range.columnCount === 1);
}

/**
 * Determine whether a canonical or renderer-style coordinate sits inside a range.
 *
 * @param {Object} rawRange - Range-like input accepted by normalizeRangeBounds.
 * @param {Object} rawCoordinate - Coordinate-like input accepted by normalizeGridCoordinate.
 * @param {Object} [coordinateOptions] - Options passed to normalizeGridCoordinate.
 * @returns {boolean}
 */
export function isCoordinateInsideRange(rawRange, rawCoordinate, coordinateOptions = {}) {
    const range = normalizeRangeBounds(rawRange);
    const coordinate = normalizeGridCoordinate(rawCoordinate, coordinateOptions);

    if (!range || !coordinate) {
        return false;
    }

    return coordinate.rowIndex >= range.minRowIndex
        && coordinate.rowIndex <= range.maxRowIndex
        && coordinate.columnIndex >= range.minColumnIndex
        && coordinate.columnIndex <= range.maxColumnIndex;
}

/**
 * Build a normalized range from two canonical coordinates.
 *
 * @param {{rowIndex: number, columnIndex: number}} startCoordinate
 * @param {{rowIndex: number, columnIndex: number}} currentCoordinate
 * @returns {Object}
 */
function buildRangeFromCoordinates(startCoordinate, currentCoordinate) {
    return buildRangeFromBounds(
        startCoordinate.rowIndex,
        currentCoordinate.rowIndex,
        startCoordinate.columnIndex,
        currentCoordinate.columnIndex,
        startCoordinate,
        currentCoordinate
    );
}

/**
 * Build a normalized range from unordered numeric bounds.
 *
 * @param {number} firstRowIndex
 * @param {number} secondRowIndex
 * @param {number} firstColumnIndex
 * @param {number} secondColumnIndex
 * @param {Object|null} [startCoordinate=null]
 * @param {Object|null} [currentCoordinate=null]
 * @returns {Object}
 */
function buildRangeFromBounds(
    firstRowIndex,
    secondRowIndex,
    firstColumnIndex,
    secondColumnIndex,
    startCoordinate = null,
    currentCoordinate = null
) {
    const minRowIndex = Math.min(firstRowIndex, secondRowIndex);
    const maxRowIndex = Math.max(firstRowIndex, secondRowIndex);
    const minColumnIndex = Math.min(firstColumnIndex, secondColumnIndex);
    const maxColumnIndex = Math.max(firstColumnIndex, secondColumnIndex);

    return {
        startCoordinate,
        currentCoordinate,
        minRowIndex,
        maxRowIndex,
        minColumnIndex,
        maxColumnIndex,
        rowCount: maxRowIndex - minRowIndex + 1,
        columnCount: maxColumnIndex - minColumnIndex + 1,
    };
}

/**
 * Read the first integer from known keys, optionally checking dataset-style snapshots.
 *
 * @param {Object} source - Object to inspect.
 * @param {string[]} keys - Candidate keys to inspect in order.
 * @param {boolean} includeDataset - Whether to inspect source.dataset with the same keys.
 * @returns {number|null}
 */
function readFirstInteger(source, keys, includeDataset) {
    for (const key of keys) {
        const parsedValue = parseIntegerValue(readOwnValue(source, key));
        if (parsedValue !== null) {
            return parsedValue;
        }
    }

    if (!includeDataset || !source.dataset || typeof source.dataset !== "object") {
        return null;
    }

    for (const key of keys) {
        const parsedValue = parseIntegerValue(readOwnValue(source.dataset, key));
        if (parsedValue !== null) {
            return parsedValue;
        }
    }

    return null;
}

/**
 * Read an object property without walking the prototype chain.
 *
 * @param {Object} source - Object to inspect.
 * @param {string} key - Property key to read.
 * @returns {*}
 */
function readOwnValue(source, key) {
    if (!source || typeof source !== "object") {
        return undefined;
    }

    return Object.prototype.hasOwnProperty.call(source, key)
        ? source[key]
        : undefined;
}

/**
 * Parse a strict integer from renderer-provided values.
 *
 * @param {*} value - Value to parse.
 * @returns {number|null}
 */
function parseIntegerValue(value) {
    if (typeof value === "number") {
        return Number.isInteger(value) && Number.isFinite(value) ? value : null;
    }

    if (typeof value !== "string") {
        return null;
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) {
        return null;
    }

    const parsedValue = Number(trimmedValue);
    return Number.isInteger(parsedValue) && Number.isFinite(parsedValue) ? parsedValue : null;
}

/**
 * Read an integer option with a fallback.
 *
 * @param {*} value - Option value.
 * @param {number} fallbackValue - Fallback integer.
 * @returns {number}
 */
function readIntegerOption(value, fallbackValue) {
    return parseIntegerValue(value) ?? fallbackValue;
}
