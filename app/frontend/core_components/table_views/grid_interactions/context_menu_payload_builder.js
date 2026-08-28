/**
 * context_menu_payload_builder.js
 *
 * Builds pure context-menu and clipboard payloads for shared grid selections.
 * Operates between normalized range state, column metadata, and renderer row data.
 * Exists to let table and list views share copy behavior without sharing DOM code.
 */

import {
    enumerateSelectedCells,
    isCoordinateInsideRange,
    isSameColumnRange,
    isSameRowRange,
    isSingleCellRange,
    normalizeGridCoordinate,
    normalizeRangeBounds,
} from "./range_selection_builder.js";

export const GRID_COPY_ACTION_IDS = Object.freeze({
    COPY_WITH_HEADERS: "copy-with-headers",
    COPY_WITHOUT_HEADERS: "copy-without-headers",
});

const GRID_COPY_LABEL_KEYS = Object.freeze({
    [GRID_COPY_ACTION_IDS.COPY_WITH_HEADERS]: "copy_headers_and_cells",
    [GRID_COPY_ACTION_IDS.COPY_WITHOUT_HEADERS]: "copy_cells_only",
});

/**
 * Build a clipboard-ready payload for the selected range.
 *
 * @param {Object} params
 * @param {Object} params.range - Range-like input accepted by normalizeRangeBounds.
 * @param {Array<Object|Array>} [params.rows=[]] - Source row data addressed by rowIndex - dataRowStartIndex.
 * @param {Array<Object|string>} [params.columns=[]] - Source column metadata addressed by columnIndex.
 * @param {boolean} [params.includeHeaders=false] - Whether to include selected column labels as the first row.
 * @param {number} [params.dataRowStartIndex=0] - Grid row index where rows[0] appears.
 * @param {string} [params.delimiter="\t"] - Cell delimiter used for text/plain output.
 * @param {string} [params.lineBreak="\n"] - Row delimiter used for text/plain output.
 * @param {Function} [params.valueResolver] - Optional custom cell value resolver.
 * @returns {Object}
 */
export function buildGridCopyPayload({
    range,
    rows = [],
    columns = [],
    includeHeaders = false,
    dataRowStartIndex = 0,
    delimiter = "\t",
    lineBreak = "\n",
    valueResolver = null,
} = {}) {
    const normalizedRange = normalizeRangeBounds(range);
    const normalizedDataRowStartIndex = readIntegerOption(dataRowStartIndex, 0);
    const selectedCells = enumerateSelectedCells(normalizedRange);

    if (!normalizedRange || selectedCells.length === 0) {
        return buildEmptyCopyPayload(includeHeaders, delimiter, lineBreak);
    }

    const selectedColumns = buildSelectedColumnDescriptors(columns, normalizedRange);
    const headers = includeHeaders ? selectedColumns.map((column) => column.label) : [];
    const rowMatrix = [];
    const cells = [];

    for (let rowIndex = normalizedRange.minRowIndex; rowIndex <= normalizedRange.maxRowIndex; rowIndex += 1) {
        const sourceRowIndex = rowIndex - normalizedDataRowStartIndex;
        const row = Array.isArray(rows) ? rows[sourceRowIndex] : undefined;
        const rowValues = [];

        selectedColumns.forEach((column) => {
            const value = resolveCellValue({
                row,
                rowIndex,
                sourceRowIndex,
                column,
                valueResolver,
            });

            rowValues.push(value);
            cells.push({
                rowIndex,
                sourceRowIndex,
                columnIndex: column.columnIndex,
                columnKey: column.key,
                columnLabel: column.label,
                value,
            });
        });

        rowMatrix.push(rowValues);
    }

    const textRows = includeHeaders ? [headers, ...rowMatrix] : rowMatrix;

    return {
        range: normalizedRange,
        includeHeaders,
        headers,
        rows: rowMatrix,
        cells,
        text: textRows.map((rowValues) => rowValues.join(delimiter)).join(lineBreak),
        mimeType: "text/plain",
        delimiter,
        lineBreak,
        isEmpty: cells.length === 0,
    };
}

/**
 * Build the data needed to show a copy context menu for a selected grid range.
 *
 * @param {Object} params
 * @param {Object} params.range - Range-like input accepted by normalizeRangeBounds.
 * @param {Object} params.triggerCoordinate - Coordinate where the menu was requested.
 * @param {Object} [params.menuPosition=null] - Pointer position with x/y, pageX/pageY, or clientX/clientY.
 * @param {Array<Object|Array>} [params.rows=[]] - Source row data for copy actions.
 * @param {Array<Object|string>} [params.columns=[]] - Source column metadata for copy actions.
 * @param {Object} [params.coordinateOptions={}] - Options passed to normalizeGridCoordinate.
 * @param {Object} [params.copyOptions={}] - Additional options passed to buildGridCopyPayload.
 * @returns {Object}
 */
export function deriveGridContextMenuPayload({
    range,
    triggerCoordinate,
    menuPosition = null,
    rows = [],
    columns = [],
    coordinateOptions = {},
    copyOptions = {},
} = {}) {
    const normalizedRange = normalizeRangeBounds(range);
    const normalizedTriggerCoordinate = normalizeGridCoordinate(triggerCoordinate, coordinateOptions);
    const shouldOpen = Boolean(
        normalizedRange
        && normalizedTriggerCoordinate
        && isCoordinateInsideRange(normalizedRange, normalizedTriggerCoordinate)
    );

    if (!shouldOpen) {
        return {
            shouldOpen: false,
            reason: resolveClosedMenuReason(normalizedRange, normalizedTriggerCoordinate),
            range: normalizedRange,
            triggerCoordinate: normalizedTriggerCoordinate,
            menuPosition: normalizeMenuPosition(menuPosition),
            selectionShape: normalizedRange ? deriveSelectionShape(normalizedRange) : "none",
            copyActions: [],
        };
    }

    const copyWithHeadersPayload = buildGridCopyPayload({
        range: normalizedRange,
        rows,
        columns,
        includeHeaders: true,
        ...copyOptions,
    });
    const copyWithoutHeadersPayload = buildGridCopyPayload({
        range: normalizedRange,
        rows,
        columns,
        includeHeaders: false,
        ...copyOptions,
    });

    return {
        shouldOpen: true,
        reason: null,
        range: normalizedRange,
        triggerCoordinate: normalizedTriggerCoordinate,
        menuPosition: normalizeMenuPosition(menuPosition),
        selectionShape: deriveSelectionShape(normalizedRange),
        copyActions: [
            buildCopyAction(GRID_COPY_ACTION_IDS.COPY_WITH_HEADERS, copyWithHeadersPayload),
            buildCopyAction(GRID_COPY_ACTION_IDS.COPY_WITHOUT_HEADERS, copyWithoutHeadersPayload),
        ],
    };
}

/**
 * Build column descriptors for every selected column index.
 *
 * @param {Array<Object|string>} columns - Column metadata.
 * @param {Object} range - Normalized range.
 * @returns {Array<Object>}
 */
function buildSelectedColumnDescriptors(columns, range) {
    const selectedColumns = [];

    for (
        let columnIndex = range.minColumnIndex;
        columnIndex <= range.maxColumnIndex;
        columnIndex += 1
    ) {
        selectedColumns.push(normalizeColumnDescriptor(columns[columnIndex], columnIndex));
    }

    return selectedColumns;
}

/**
 * Normalize a renderer column descriptor into key/label metadata.
 *
 * @param {Object|string} rawColumn - Column metadata from a renderer.
 * @param {number} columnIndex - Canonical selected column index.
 * @returns {{key: string, label: string, columnIndex: number, source: *}}
 */
function normalizeColumnDescriptor(rawColumn, columnIndex) {
    if (typeof rawColumn === "string" || typeof rawColumn === "number") {
        const columnValue = String(rawColumn);
        return {
            key: columnValue,
            label: columnValue,
            columnIndex,
            source: rawColumn,
        };
    }

    if (!rawColumn || typeof rawColumn !== "object") {
        return {
            key: String(columnIndex),
            label: String(columnIndex),
            columnIndex,
            source: rawColumn,
        };
    }

    const key = readFirstDisplayValue(rawColumn, [
        "key",
        "name",
        "field",
        "column",
        "columnName",
        "column_name",
        "field_name",
        "id",
    ]) ?? String(columnIndex);
    const label = readFirstDisplayValue(rawColumn, [
        "label",
        "title",
        "displayName",
        "header",
        "name",
        "columnName",
        "column_name",
        "key",
    ]) ?? key;

    return {
        key,
        label,
        columnIndex,
        source: rawColumn,
    };
}

/**
 * Resolve one selected cell value from rows, columns, or a custom resolver.
 *
 * @param {Object} params
 * @returns {string}
 */
function resolveCellValue({
    row,
    rowIndex,
    sourceRowIndex,
    column,
    valueResolver,
}) {
    if (typeof valueResolver === "function") {
        return formatCopyValue(valueResolver({
            row,
            rowIndex,
            sourceRowIndex,
            columnIndex: column.columnIndex,
            columnKey: column.key,
            column,
        }));
    }

    if (Array.isArray(row)) {
        return formatCopyValue(row[column.columnIndex]);
    }

    if (!row || typeof row !== "object") {
        return "";
    }

    if (Object.prototype.hasOwnProperty.call(row, column.key)) {
        return formatCopyValue(row[column.key]);
    }

    if (Object.prototype.hasOwnProperty.call(row, column.label)) {
        return formatCopyValue(row[column.label]);
    }

    if (Object.prototype.hasOwnProperty.call(row, column.columnIndex)) {
        return formatCopyValue(row[column.columnIndex]);
    }

    return "";
}

/**
 * Convert a cell value into stable clipboard text.
 *
 * @param {*} value - Raw cell value.
 * @returns {string}
 */
function formatCopyValue(value) {
    if (value === null || value === undefined) {
        return "";
    }

    if (typeof value === "object") {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    return String(value);
}

/**
 * Build a context-menu action descriptor around a prepared copy payload.
 *
 * @param {string} actionId - Stable action identifier.
 * @param {Object} payload - Copy payload for this action.
 * @returns {Object}
 */
function buildCopyAction(actionId, payload) {
    return {
        id: actionId,
        labelKey: GRID_COPY_LABEL_KEYS[actionId],
        includeHeaders: payload.includeHeaders,
        enabled: !payload.isEmpty,
        payload,
    };
}

/**
 * Classify a selected range by shape for renderer styling and analytics.
 *
 * @param {Object} range - Range-like input accepted by normalizeRangeBounds.
 * @returns {"none"|"cell"|"row"|"column"|"rectangle"}
 */
function deriveSelectionShape(range) {
    if (!range) {
        return "none";
    }

    if (isSingleCellRange(range)) {
        return "cell";
    }

    if (isSameRowRange(range)) {
        return "row";
    }

    if (isSameColumnRange(range)) {
        return "column";
    }

    return "rectangle";
}

/**
 * Normalize pointer coordinates for future menu placement.
 *
 * @param {Object|null} rawPosition - Coordinate-like menu position.
 * @returns {{x: number, y: number}|null}
 */
function normalizeMenuPosition(rawPosition) {
    if (!rawPosition || typeof rawPosition !== "object") {
        return null;
    }

    const x = parseIntegerValue(rawPosition.x)
        ?? parseIntegerValue(rawPosition.pageX)
        ?? parseIntegerValue(rawPosition.clientX);
    const y = parseIntegerValue(rawPosition.y)
        ?? parseIntegerValue(rawPosition.pageY)
        ?? parseIntegerValue(rawPosition.clientY);

    return x === null || y === null ? null : { x, y };
}

/**
 * Return a stable reason when a context menu should stay closed.
 *
 * @param {Object|null} range - Normalized range, if any.
 * @param {Object|null} triggerCoordinate - Normalized trigger coordinate, if any.
 * @returns {string}
 */
function resolveClosedMenuReason(range, triggerCoordinate) {
    if (!range) {
        return "missing-range";
    }

    if (!triggerCoordinate) {
        return "missing-trigger";
    }

    return "outside-selection";
}

/**
 * Build the empty payload shape used by invalid or empty selections.
 *
 * @param {boolean} includeHeaders - Whether headers were requested.
 * @param {string} delimiter - Text delimiter.
 * @param {string} lineBreak - Text line break.
 * @returns {Object}
 */
function buildEmptyCopyPayload(includeHeaders, delimiter, lineBreak) {
    return {
        range: null,
        includeHeaders,
        headers: [],
        rows: [],
        cells: [],
        text: "",
        mimeType: "text/plain",
        delimiter,
        lineBreak,
        isEmpty: true,
    };
}

/**
 * Read the first non-empty display value from an object.
 *
 * @param {Object} source - Object to inspect.
 * @param {string[]} keys - Ordered keys to inspect.
 * @returns {string|null}
 */
function readFirstDisplayValue(source, keys) {
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) {
            continue;
        }

        const value = source[key];
        if (value === null || value === undefined) {
            continue;
        }

        const stringValue = String(value).trim();
        if (stringValue) {
            return stringValue;
        }
    }

    return null;
}

/**
 * Parse an integer with null on invalid input.
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
