import { beforeEach, describe, expect, test, vi } from 'vitest';

const selectCellMock = vi.fn();
const editCellMock = vi.fn();

vi.mock('./table_cell_handler.js', () => ({
    selectCell: selectCellMock,
}));

vi.mock('../../general_tables/gt_1_row_crud/gt_1_3_row_update/cell_editor.js', () => ({
    editCell: editCellMock,
}));

describe('table_cell_event_handler', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        selectCellMock.mockReset();
        editCellMock.mockReset();
    });

    test('does not refocus an already editing cell on click', async () => {
        const { addEventListenersToCells } = await import('./table_cell_event_handler.js');
        const table = document.createElement('table');
        const tbody = document.createElement('tbody');
        const row = document.createElement('tr');
        const numberCell = document.createElement('td');
        const dataCell = document.createElement('td');
        dataCell.classList.add('editing');
        row.append(numberCell, dataCell);
        tbody.appendChild(row);
        table.appendChild(tbody);
        document.body.appendChild(table);

        addEventListenersToCells(table, ['title'], [{ id: 1, title: 'A' }], {}, 'orders');
        dataCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(selectCellMock).not.toHaveBeenCalled();
    });

    test('selects a non-editing cell on click', async () => {
        const { addEventListenersToCells } = await import('./table_cell_event_handler.js');
        const table = document.createElement('table');
        const tbody = document.createElement('tbody');
        const row = document.createElement('tr');
        const numberCell = document.createElement('td');
        const dataCell = document.createElement('td');
        row.append(numberCell, dataCell);
        tbody.appendChild(row);
        table.appendChild(tbody);
        document.body.appendChild(table);

        addEventListenersToCells(table, ['title'], [{ id: 1, title: 'A' }], {}, 'orders');
        dataCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(selectCellMock).toHaveBeenCalledWith(dataCell);
    });

    test('starts table-cell editing with Enter like list cells do', async () => {
        const { handleKeyDown } = await import('./table_cell_event_handler.js');
        const cell = document.createElement('td');

        handleKeyDown(
            new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
            cell,
            ['title'],
            [{ id: 1, title: 'A' }],
            { title: { data_type: 'text' } },
            'orders'
        );

        expect(editCellMock).toHaveBeenCalledWith(
            cell,
            ['title'],
            [{ id: 1, title: 'A' }],
            { title: { data_type: 'text' } },
            'orders'
        );
    });

    test('moves table-cell focus with shared arrow-key coordinate navigation', async () => {
        const { addEventListenersToCells } = await import('./table_cell_event_handler.js');
        const table = document.createElement('table');
        const tbody = document.createElement('tbody');
        const row = document.createElement('tr');
        const numberingCell = document.createElement('td');
        const checkboxCell = document.createElement('td');
        const firstCell = createDataCell(0, 0, 'title');
        const secondCell = createDataCell(0, 1, 'status');
        row.append(numberingCell, checkboxCell, firstCell, secondCell);
        tbody.appendChild(row);
        table.appendChild(tbody);
        document.body.appendChild(table);

        addEventListenersToCells(table, ['title', 'status'], [{ title: 'A', status: 'ready' }], {}, 'orders');
        firstCell.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'ArrowRight',
        }));

        expect(selectCellMock).toHaveBeenCalledWith(secondCell);
    });
});

function createDataCell(rowIndex, columnIndex, columnName) {
    const cell = document.createElement('td');
    cell.classList.add('table_data_cell');
    cell.dataset.rowIndex = String(rowIndex);
    cell.dataset.colIndex = String(columnIndex);
    cell.dataset.column = columnName;
    return cell;
}
