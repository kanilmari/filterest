// table_structure_builder_helpers.js
// Pure helper functions extracted from table_structure_builder.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Format a cell value for display.
 * - null/undefined → 'Tuntematon'
 * - Array → comma-separated
 * - Object → pretty-printed JSON (keys sorted)
 * - Primitive → as-is
 *
 * @param {*} value - Raw cell value
 * @returns {string|*} Display-ready value
 */
export function formatValue(value) {
    if (value === null || value === undefined) {
        return 'Tuntematon';
    } else if (Array.isArray(value)) {
        return value.join(', ');
    } else if (typeof value === 'object') {
        const sortedValue = sortObjectKeys(value);
        return JSON.stringify(sortedValue, null, 2);
    } else {
        return value;
    }
}

/**
 * Normalize a formatted display value into plain text for DOM rendering and layout rules.
 *
 * @param {*} value - Formatted display value
 * @returns {string} String form used in table cells
 */
export function normalizeDisplayText(value) {
    return typeof value === 'string' ? value : String(value);
}

/**
 * Decide whether a cell value should stay on one line as a compact scalar.
 * Compact values include ids, booleans, short codes, and common timestamp strings.
 *
 * @param {*} value - Formatted display value
 * @returns {boolean} True when the cell should prefer a single-line compact layout
 */
export function shouldRenderCompactCellValue(value) {
    const text = normalizeDisplayText(value).trim();
    if (text === '') {
        return true;
    }

    if (text.includes('\n')) {
        return false;
    }

    if (/^\d+$/.test(text)) {
        return true;
    }

    if (/^(true|false)$/i.test(text)) {
        return true;
    }

    if (/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?::\d{2})?)?$/.test(text)) {
        return true;
    }

    if (/^[A-Za-z0-9._:/@+-]{1,28}$/.test(text)) {
        return true;
    }

    const tokens = text.split(/\s+/);
    return tokens.length <= 2 && text.length <= 18;
}

const TABLE_CONTROL_COLUMN_MIN_WIDTH_PX = 50;
const TABLE_DATA_COLUMN_MIN_WIDTH_PX = 100;
const TABLE_COLUMN_MAX_WIDTH_PX = 800;
const TABLE_CELL_MANUAL_MIN_LINES = 1;
const TABLE_CELL_DEFAULT_MAX_LINES = 15;
const TABLE_CELL_MANUAL_MAX_LINES = 60;

/**
 * Resolve the minimum resize width for a table column by index.
 * The numbering and checkbox columns stay slimmer than data columns.
 *
 * @param {number} columnIndex - Zero-based rendered table column index
 * @returns {number} Minimum allowed width in pixels
 */
export function getMinimumColumnWidthPx(columnIndex) {
    return columnIndex <= 1
        ? TABLE_CONTROL_COLUMN_MIN_WIDTH_PX
        : TABLE_DATA_COLUMN_MIN_WIDTH_PX;
}

/**
 * Clamp a user-resized column width into the supported table-view range.
 *
 * @param {number} widthPx - Proposed width in pixels
 * @param {number} columnIndex - Zero-based rendered table column index
 * @returns {number} Safe width in pixels
 */
export function clampManualColumnWidthPx(widthPx, columnIndex) {
    const minimumWidthPx = getMinimumColumnWidthPx(columnIndex);
    const numericWidthPx = Number(widthPx);
    if (!Number.isFinite(numericWidthPx)) {
        return minimumWidthPx;
    }

    return Math.min(
        TABLE_COLUMN_MAX_WIDTH_PX,
        Math.max(minimumWidthPx, numericWidthPx)
    );
}

/**
 * Convert computed CSS line-height and font-size strings into a pixel line height.
 * Falls back to 1.2 × font-size when the browser reports "normal" or an invalid value.
 *
 * @param {string} lineHeightValue - Computed line-height string
 * @param {string} fontSizeValue - Computed font-size string
 * @returns {number} Positive pixel line-height
 */
export function resolveLineHeightPx(lineHeightValue, fontSizeValue) {
    const parsedLineHeightPx = Number.parseFloat(lineHeightValue);
    if (Number.isFinite(parsedLineHeightPx) && parsedLineHeightPx > 0) {
        return parsedLineHeightPx;
    }

    const parsedFontSizePx = Number.parseFloat(fontSizeValue);
    const fallbackFontSizePx = Number.isFinite(parsedFontSizePx) && parsedFontSizePx > 0
        ? parsedFontSizePx
        : 16;

    return fallbackFontSizePx * 1.2;
}

/**
 * Return the default and manual visible cell-height bounds derived from the line height.
 *
 * @param {number} lineHeightPx - Pixel line height used by the cell content
 * @returns {{defaultMaxHeightPx: number, manualMinHeightPx: number, manualMaxHeightPx: number}}
 */
export function getCellHeightBoundsPx(lineHeightPx) {
    const safeLineHeightPx = Number.isFinite(lineHeightPx) && lineHeightPx > 0
        ? lineHeightPx
        : 19.2;

    return {
        defaultMaxHeightPx: safeLineHeightPx * TABLE_CELL_DEFAULT_MAX_LINES,
        manualMinHeightPx: safeLineHeightPx * TABLE_CELL_MANUAL_MIN_LINES,
        manualMaxHeightPx: safeLineHeightPx * TABLE_CELL_MANUAL_MAX_LINES,
    };
}

/**
 * Clamp a manual cell height into the supported 1-line to 60-line resize range.
 * When no valid height is available yet, fall back to the default 15-line baseline.
 *
 * @param {number} heightPx - Proposed visible max-height in pixels
 * @param {number} lineHeightPx - Pixel line height used by the cell content
 * @returns {number} Safe visible max-height in pixels
 */
export function clampManualCellMaxHeightPx(heightPx, lineHeightPx) {
    const { defaultMaxHeightPx, manualMinHeightPx, manualMaxHeightPx } = getCellHeightBoundsPx(lineHeightPx);
    const numericHeightPx = Number(heightPx);
    if (!Number.isFinite(numericHeightPx)) {
        return defaultMaxHeightPx;
    }

    return Math.min(
        manualMaxHeightPx,
        Math.max(manualMinHeightPx, numericHeightPx)
    );
}

/**
 * Return a shallow copy of an object with keys sorted alphabetically.
 *
 * @param {Object} obj - Input object
 * @returns {Object} New object with sorted keys
 */
export function sortObjectKeys(obj) {
    return Object.keys(obj).sort().reduce((result, key) => {
        result[key] = obj[key];
        return result;
    }, {});
}

/**
 * Compute the next sort direction when clicking a sort indicator.
 * Cycling: none→ASC, ASC→DESC, DESC→none.
 * Clicking a different column always starts at ASC.
 *
 * @param {string|null} currentColumn - Currently sorted column, or null
 * @param {string|null} currentDirection - Current direction ('ASC'|'DESC'|null)
 * @param {string} clickedColumn - The column that was clicked
 * @returns {{column: string|null, direction: string|null}}
 */
export function nextSortState(currentColumn, currentDirection, clickedColumn) {
    if (currentColumn === clickedColumn) {
        const dir = (currentDirection || '').toUpperCase();
        if (dir === 'ASC') {
            return { column: clickedColumn, direction: 'DESC' };
        } else if (dir === 'DESC') {
            return { column: null, direction: null };
        } else {
            return { column: clickedColumn, direction: 'ASC' };
        }
    } else {
        return { column: clickedColumn, direction: 'ASC' };
    }
}
