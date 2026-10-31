// visible_grid_cell_resolver.js
// Resolves clipboard text only from currently visible grid cells.
// Bridges table/list/comparison DOM coordinates and the shared copy payload builder.
// Keeps hidden fields out of every grid copy path, including their headers.

/**
 * Build a DOM-backed copy resolver. Null means absent/hidden; an empty string
 * remains a visible empty cell. Whitespace-only text is empty in every view;
 * nonblank text follows that view's trim option. Visibility is read at copy time.
 * @param {Function} resolveCell - Finds a cell by shared grid coordinates.
 * @param {Object} options - Renderer-specific text formatting.
 * @returns {Function} Shared copy builder cellResolver.
 */
export function createVisibleGridCellResolver(resolveCell, { trim = false, contentSelector = null } = {}) {
    return (coordinate) => {
        const cell = resolveCell(coordinate);
        if (!isVisibleGridCell(cell)) return null;
        const content = contentSelector ? cell.querySelector(contentSelector) || cell : cell;
        const text = isVisibleGridCell(content) ? content.textContent : '';
        const trimmedText = text.trim();
        return trim || trimmedText === '' ? trimmedText : text;
    };
}

/**
 * Resolve copy text for both div-grid orientations through the shared visibility boundary.
 * Null removes a hidden field/record; visible empty cells keep their position.
 * @param {Object} grid - Live view state and list/transposed coordinate lookups.
 * @returns {Function}
 * @private
 */
export function getCopyCellResolver(grid) {
    return createVisibleGridCellResolver(
        coordinate => grid.currentView === 'transposed'
            ? grid.getTransposedCellByCoordinate(coordinate)
            : grid.getListCellByCoordinate(coordinate),
        { contentSelector: '.cell-content' }
    );
}

// Native visibility detects missing layout boxes; computed styles also support
// DOM-only tests and browsers without checkVisibility, including hidden ancestors.
function isVisibleGridCell(cell) {
    if (!cell?.isConnected) return false;
    if (typeof cell.checkVisibility === 'function' && !cell.checkVisibility({
        checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true,
    })) return false;
    for (let element = cell; element; element = element.parentElement) {
        const style = cell.ownerDocument.defaultView.getComputedStyle(element);
        if (element.hidden || style.display === 'none' || style.visibility === 'hidden'
            || style.visibility === 'collapse' || style.contentVisibility === 'hidden' || style.opacity === '0') {
            return false;
        }
    }
    return true;
}
