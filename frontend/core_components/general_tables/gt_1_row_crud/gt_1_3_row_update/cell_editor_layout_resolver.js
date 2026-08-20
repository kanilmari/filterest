// cell_editor_layout_resolver.js
// Chooses and sizes the inline editor used for one rendered dataset cell.
// Bridges existing cell geometry and text content with input/textarea creation.
// Exists so wrapped and explicitly multiline text stays multiline while typed controls remain unchanged.

const MULTILINE_TEXT_LENGTH_THRESHOLD = 80;
const MULTILINE_HEIGHT_TOLERANCE = 1.5;

/**
 * Resolves whether a text value needs a textarea and captures the cell's usable size.
 * Operates between the still-rendered cell and cell_editor.js before it replaces the content.
 * Exists to preserve the user's visual editing context without changing data-type semantics.
 *
 * @param {HTMLElement} cell
 * @param {Object} options
 * @param {string} options.inputType
 * @param {*} options.value
 * @returns {{useTextarea: boolean, widthPx: number, heightPx: number}}
 */
export function resolveCellEditorLayout(cell, { inputType, value } = {}) {
    if (!(cell instanceof HTMLElement)) {
        return { useTextarea: false, widthPx: 0, heightPx: 0 };
    }

    const cellRect = cell.getBoundingClientRect();
    const cellStyle = getComputedStyle(cell);
    const horizontalPadding = readCssPixels(cellStyle.paddingLeft)
        + readCssPixels(cellStyle.paddingRight);
    const verticalPadding = readCssPixels(cellStyle.paddingTop)
        + readCssPixels(cellStyle.paddingBottom);
    const widthPx = positiveDifference(cellRect.width, horizontalPadding);
    const heightPx = positiveDifference(cellRect.height, verticalPadding);

    const contentElement = cell.querySelector(':scope > .table_cell_content, :scope > .cell-content');
    const textStyle = getComputedStyle(contentElement instanceof HTMLElement ? contentElement : cell);
    const lineHeightPx = resolveLineHeightPx(textStyle.lineHeight, textStyle.fontSize);
    const renderedHeightPx = resolveRenderedHeightPx(contentElement, heightPx);
    const textValue = String(value ?? '');
    const useTextarea = inputType === 'text' && (
        textValue.includes('\n')
        || textValue.length > MULTILINE_TEXT_LENGTH_THRESHOLD
        || (lineHeightPx > 0 && renderedHeightPx > lineHeightPx * MULTILINE_HEIGHT_TOLERANCE)
    );

    return { useTextarea, widthPx, heightPx };
}

function resolveRenderedHeightPx(contentElement, fallbackHeightPx) {
    if (!(contentElement instanceof HTMLElement)) {
        return fallbackHeightPx;
    }

    const contentRectHeight = contentElement.getBoundingClientRect().height;
    return Math.max(
        Number.isFinite(contentRectHeight) ? contentRectHeight : 0,
        contentElement.clientHeight || 0,
        contentElement.scrollHeight || 0
    );
}

function resolveLineHeightPx(lineHeightValue, fontSizeValue) {
    const lineHeightPx = readCssPixels(lineHeightValue);
    if (lineHeightPx > 0) {
        return lineHeightPx;
    }

    const fontSizePx = readCssPixels(fontSizeValue);
    return fontSizePx > 0 ? fontSizePx * 1.2 : 0;
}

function positiveDifference(totalPx, removedPx) {
    const differencePx = totalPx - removedPx;
    return Number.isFinite(differencePx) && differencePx > 0 ? differencePx : 0;
}

function readCssPixels(value) {
    const parsedValue = Number.parseFloat(value);
    return Number.isFinite(parsedValue) ? parsedValue : 0;
}
