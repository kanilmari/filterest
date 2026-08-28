// cell_coordinate_reader.js
// Normalizes table-view and div-list cell DOM nodes into one logical coordinate shape.
// Bridges rendered grid cells and shared editing or selection state.
// Exists so table and list surfaces can identify the same row/column target consistently.

export const GRID_CELL_VIEW_TYPES = Object.freeze({
    TABLE: 'table',
    LIST: 'list',
});

/**
 * Creates a normalized, logical cell coordinate from raw row and column values.
 * Operates between DOM/data attributes and pure edit-session state.
 * Exists to reject malformed coordinates before shared grid interactions use them.
 *
 * @param {Object} rawCoordinate
 * @param {string} rawCoordinate.viewType
 * @param {number|string} rawCoordinate.rowIndex
 * @param {number|string} rawCoordinate.columnIndex
 * @param {string|null} [rawCoordinate.columnName]
 * @returns {{ viewType: string, rowIndex: number, columnIndex: number, columnName: string|null } | null}
 */
export function createCellCoordinate(rawCoordinate = {}) {
    if (!rawCoordinate) {
        return null;
    }

    const rowIndex = parseNonNegativeInteger(rawCoordinate.rowIndex);
    const columnIndex = parseNonNegativeInteger(rawCoordinate.columnIndex);
    const viewType = normalizeViewType(rawCoordinate.viewType);

    if (rowIndex === null || columnIndex === null || !viewType) {
        return null;
    }

    return {
        viewType,
        rowIndex,
        columnIndex,
        columnName: normalizeColumnName(rawCoordinate.columnName),
    };
}

/**
 * Resolves the logical cell coordinate from a DOM event target or cell child.
 * Operates between low-level click targets and the shared coordinate model.
 * Exists so callers do not need to know whether a cell is a table td or div.cell.
 *
 * @param {EventTarget|null|undefined} eventTarget
 * @returns {{ viewType: string, rowIndex: number, columnIndex: number, columnName: string|null } | null}
 */
export function getCellCoordinateFromEventTarget(eventTarget) {
    const cellElement = resolveCellElementFromTarget(eventTarget);
    return getCellCoordinateFromElement(cellElement);
}

/**
 * Resolves the logical cell coordinate from a concrete cell element.
 * Operates between table td/list .cell markup conventions and edit-session state.
 * Exists to isolate DOM-specific coordinate extraction in one adapter.
 *
 * @param {Element|null|undefined} cellElement
 * @returns {{ viewType: string, rowIndex: number, columnIndex: number, columnName: string|null } | null}
 */
export function getCellCoordinateFromElement(cellElement) {
    if (!isElementLike(cellElement)) {
        return null;
    }

    if (cellElement.matches('td')) {
        return getTableCellCoordinate(cellElement);
    }

    if (cellElement.matches('.cell')) {
        return getListCellCoordinate(cellElement);
    }

    return null;
}

/**
 * Compares two logical cell coordinates without requiring the same DOM surface.
 * Operates between active edit-session state and newly clicked cells.
 * Exists so table td cells and div-list cells can refer to one shared logical cell.
 *
 * @param {Object|null|undefined} leftCoordinate
 * @param {Object|null|undefined} rightCoordinate
 * @param {Object} [options]
 * @param {boolean} [options.includeViewType=false]
 * @returns {boolean}
 */
export function areCellCoordinatesEqual(leftCoordinate, rightCoordinate, options = {}) {
    const left = createCellCoordinate(leftCoordinate);
    const right = createCellCoordinate(rightCoordinate);

    if (!left || !right) {
        return false;
    }

    if (options.includeViewType === true && left.viewType !== right.viewType) {
        return false;
    }

    if (left.rowIndex !== right.rowIndex || left.columnIndex !== right.columnIndex) {
        return false;
    }

    if (left.columnName && right.columnName) {
        return left.columnName === right.columnName;
    }

    return true;
}

/**
 * Builds a stable string key for a logical cell coordinate.
 * Operates between normalized coordinates and maps/sets used by interaction state.
 * Exists to keep future edit-session registries from inventing incompatible keys.
 *
 * @param {Object|null|undefined} coordinate
 * @param {Object} [options]
 * @param {boolean} [options.includeViewType=false]
 * @returns {string|null}
 */
export function makeCellCoordinateKey(coordinate, options = {}) {
    const normalizedCoordinate = createCellCoordinate(coordinate);

    if (!normalizedCoordinate) {
        return null;
    }

    const keyParts = [
        String(normalizedCoordinate.rowIndex),
        String(normalizedCoordinate.columnIndex),
        normalizedCoordinate.columnName || '',
    ];

    if (options.includeViewType === true) {
        keyParts.unshift(normalizedCoordinate.viewType);
    }

    return keyParts.join(':');
}

/**
 * Finds the nearest supported grid cell for a raw event target.
 * Operates between nested editor/content nodes and their cell containers.
 * Exists to keep DOM traversal small and testable.
 *
 * @param {EventTarget|null|undefined} eventTarget
 * @returns {Element|null}
 */
export function resolveCellElementFromTarget(eventTarget) {
    const targetElement = getElementFromEventTarget(eventTarget);

    if (!targetElement || typeof targetElement.closest !== 'function') {
        return null;
    }

    return targetElement.closest('td, .cell');
}

/**
 * Extracts a table cell coordinate from the canonical td data attributes.
 * Operates between table_view/createDataCell markup and shared grid coordinates.
 * Exists to prefer explicit data-row-index/data-col-index before DOM inference.
 *
 * @param {Element} cellElement
 * @returns {{ viewType: string, rowIndex: number, columnIndex: number, columnName: string|null } | null}
 */
function getTableCellCoordinate(cellElement) {
    const rowIndex = readDatasetInteger(cellElement, 'rowIndex') ?? inferTableRowIndex(cellElement);
    const columnIndex = readDatasetInteger(cellElement, 'colIndex') ?? inferTableColumnIndex(cellElement);

    return createCellCoordinate({
        viewType: GRID_CELL_VIEW_TYPES.TABLE,
        rowIndex,
        columnIndex,
        columnName: cellElement.dataset?.column,
    });
}

/**
 * Extracts a normal div-list cell coordinate from data-row/data-col attributes.
 * Operates between table_component_builder normal-view cells and shared grid coordinates.
 * Exists to convert the list surface's one-based data row into zero-based rowIndex.
 *
 * @param {Element} cellElement
 * @returns {{ viewType: string, rowIndex: number, columnIndex: number, columnName: string|null } | null}
 */
function getListCellCoordinate(cellElement) {
    if (cellElement.classList.contains('header')) {
        return null;
    }

    const listRow = readDatasetInteger(cellElement, 'row');
    const columnIndex = readDatasetInteger(cellElement, 'col');

    if (listRow === null || listRow < 1) {
        return null;
    }

    return createCellCoordinate({
        viewType: GRID_CELL_VIEW_TYPES.LIST,
        rowIndex: listRow - 1,
        columnIndex,
        columnName: cellElement.dataset?.column,
    });
}

/**
 * Reads an integer data attribute from an element.
 * Operates between DOMStringMap values and numeric coordinate fields.
 * Exists to centralize validation for missing, empty, and fractional values.
 *
 * @param {Element} element
 * @param {string} datasetKey
 * @returns {number|null}
 */
function readDatasetInteger(element, datasetKey) {
    return parseNonNegativeInteger(element.dataset?.[datasetKey]);
}

/**
 * Infers a zero-based row index from a table row when explicit data is absent.
 * Operates between fallback table markup and normalized coordinates.
 * Exists only as a best-effort adapter for simple table cells.
 *
 * @param {Element} cellElement
 * @returns {number|null}
 */
function inferTableRowIndex(cellElement) {
    const rowElement = cellElement.closest('tr');
    const rowContainer = rowElement?.parentElement;

    if (!rowElement || !rowContainer) {
        return null;
    }

    const rows = Array.from(rowContainer.querySelectorAll(':scope > tr'));
    const rowIndex = rows.indexOf(rowElement);
    return rowIndex >= 0 ? rowIndex : null;
}

/**
 * Infers a zero-based column index from a table cell when explicit data is absent.
 * Operates between fallback td markup and normalized coordinates.
 * Exists only as a best-effort adapter for simple table cells.
 *
 * @param {Element} cellElement
 * @returns {number|null}
 */
function inferTableColumnIndex(cellElement) {
    if (typeof cellElement.cellIndex !== 'number' || cellElement.cellIndex < 0) {
        return null;
    }

    return cellElement.cellIndex;
}

/**
 * Converts a numeric-like value into a non-negative integer.
 * Operates between dataset strings and edit-session coordinate fields.
 * Exists to keep invalid cells from triggering edit-session changes.
 *
 * @param {number|string|null|undefined} value
 * @returns {number|null}
 */
function parseNonNegativeInteger(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsedValue = Number(value);
    if (!Number.isInteger(parsedValue) || parsedValue < 0) {
        return null;
    }

    return parsedValue;
}

/**
 * Normalizes supported view type identifiers.
 * Operates between caller-provided surface names and canonical constants.
 * Exists to keep coordinates comparable across renderers.
 *
 * @param {string|null|undefined} viewType
 * @returns {string|null}
 */
function normalizeViewType(viewType) {
    const normalizedViewType = String(viewType || '').trim().toLowerCase();
    return Object.values(GRID_CELL_VIEW_TYPES).includes(normalizedViewType)
        ? normalizedViewType
        : null;
}

/**
 * Normalizes optional column-name metadata.
 * Operates between renderer data attributes and logical coordinate identity.
 * Exists so blank column labels do not become meaningful keys.
 *
 * @param {string|null|undefined} columnName
 * @returns {string|null}
 */
function normalizeColumnName(columnName) {
    const normalizedColumnName = String(columnName || '').trim();
    return normalizedColumnName || null;
}

/**
 * Converts an event target or text node into an element when possible.
 * Operates between browser event targets and DOM traversal helpers.
 * Exists to make click handling safe for nested text/editor nodes.
 *
 * @param {EventTarget|null|undefined} eventTarget
 * @returns {Element|null}
 */
function getElementFromEventTarget(eventTarget) {
    if (isElementLike(eventTarget)) {
        return eventTarget;
    }

    if (isElementLike(eventTarget?.parentElement)) {
        return eventTarget.parentElement;
    }

    return null;
}

/**
 * Checks whether a value behaves like a DOM Element.
 * Operates between browser/jsdom objects and pure adapter guards.
 * Exists to avoid relying on global Element in non-browser test contexts.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isElementLike(value) {
    return Boolean(
        value
        && value.nodeType === 1
        && typeof value.matches === 'function'
    );
}
