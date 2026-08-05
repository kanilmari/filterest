// @vitest-environment jsdom
// cell_coordinate_reader.test.js
// Verifies shared logical coordinates for table td and div-list .cell elements.
// Bridges jsdom-rendered grid markup and the pure coordinate adapter.
// Exists to document safe extraction, comparison, and invalid-cell behavior.

import { beforeEach, describe, expect, test } from 'vitest';
import {
    GRID_CELL_VIEW_TYPES,
    areCellCoordinatesEqual,
    createCellCoordinate,
    getCellCoordinateFromElement,
    getCellCoordinateFromEventTarget,
    makeCellCoordinateKey,
} from './cell_coordinate_reader.js';

describe('cell_coordinate_reader', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    test('extracts table td coordinates from explicit data attributes', () => {
        const cell = createTableCell({
            rowIndex: '2',
            columnIndex: '1',
            columnName: 'title',
        });
        const content = document.createElement('span');
        content.textContent = 'Order title';
        cell.appendChild(content);

        expect(getCellCoordinateFromEventTarget(content)).toEqual({
            viewType: GRID_CELL_VIEW_TYPES.TABLE,
            rowIndex: 2,
            columnIndex: 1,
            columnName: 'title',
        });
    });

    test('extracts div-list coordinates from one-based data-row and zero-based data-col', () => {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = '3';
        cell.dataset.col = '2';
        cell.dataset.column = 'status';
        const content = document.createElement('div');
        content.className = 'cell-content';
        cell.appendChild(content);
        document.body.appendChild(cell);

        expect(getCellCoordinateFromEventTarget(content)).toEqual({
            viewType: GRID_CELL_VIEW_TYPES.LIST,
            rowIndex: 2,
            columnIndex: 2,
            columnName: 'status',
        });
    });

    test('treats table and list cells with the same row and column as the same logical cell', () => {
        const tableCoordinate = createCellCoordinate({
            viewType: GRID_CELL_VIEW_TYPES.TABLE,
            rowIndex: 0,
            columnIndex: 1,
            columnName: 'title',
        });
        const listCoordinate = createCellCoordinate({
            viewType: GRID_CELL_VIEW_TYPES.LIST,
            rowIndex: 0,
            columnIndex: 1,
            columnName: 'title',
        });

        expect(areCellCoordinatesEqual(tableCoordinate, listCoordinate)).toBe(true);
        expect(areCellCoordinatesEqual(tableCoordinate, listCoordinate, { includeViewType: true })).toBe(false);
        expect(makeCellCoordinateKey(tableCoordinate)).toBe('0:1:title');
        expect(makeCellCoordinateKey(tableCoordinate, { includeViewType: true })).toBe('table:0:1:title');
    });

    test('ignores header and malformed div-list cells safely', () => {
        const headerCell = document.createElement('div');
        headerCell.className = 'cell header';
        headerCell.dataset.row = '0';
        headerCell.dataset.col = '1';

        const missingColumnCell = document.createElement('div');
        missingColumnCell.className = 'cell';
        missingColumnCell.dataset.row = '1';

        const fractionalCell = document.createElement('div');
        fractionalCell.className = 'cell';
        fractionalCell.dataset.row = '1.5';
        fractionalCell.dataset.col = '2';

        expect(getCellCoordinateFromElement(headerCell)).toBeNull();
        expect(getCellCoordinateFromElement(missingColumnCell)).toBeNull();
        expect(getCellCoordinateFromElement(fractionalCell)).toBeNull();
        expect(getCellCoordinateFromEventTarget(null)).toBeNull();
        expect(createCellCoordinate({ viewType: 'table', rowIndex: -1, columnIndex: 0 })).toBeNull();
    });

    test('falls back to simple table row and cell indexes when explicit data is missing', () => {
        const table = document.createElement('table');
        const tbody = document.createElement('tbody');
        const firstRow = document.createElement('tr');
        const secondRow = document.createElement('tr');
        const firstCell = document.createElement('td');
        const secondCell = document.createElement('td');
        firstRow.appendChild(document.createElement('td'));
        secondRow.append(firstCell, secondCell);
        tbody.append(firstRow, secondRow);
        table.appendChild(tbody);
        document.body.appendChild(table);

        expect(getCellCoordinateFromElement(secondCell)).toEqual({
            viewType: GRID_CELL_VIEW_TYPES.TABLE,
            rowIndex: 1,
            columnIndex: 1,
            columnName: null,
        });
    });
});

function createTableCell({ rowIndex, columnIndex, columnName }) {
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.dataset.rowIndex = rowIndex;
    cell.dataset.colIndex = columnIndex;
    cell.dataset.column = columnName;
    row.appendChild(cell);
    tbody.appendChild(row);
    table.appendChild(tbody);
    document.body.appendChild(table);
    return cell;
}
