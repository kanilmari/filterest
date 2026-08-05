// @vitest-environment jsdom
// table_grid_interaction_adapter.test.js
// Verifies table-view range selection and copy menu behavior through shared grid helpers.
// Bridges rendered td cells, context-menu events, and clipboard payload generation.
// Exists so the table adapter keeps parity with the list adapter's multi-cell affordances.

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showErrorToast: vi.fn(),
    showSuccessToast: vi.fn(),
}));

vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key) => key,
}));

import { addTableGridInteractionAdapter } from './table_grid_interaction_adapter.js';

describe('table_grid_interaction_adapter', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });
    });

    test('selects a rectangular table range and copies it from the context menu', async () => {
        const table = buildTable([
            ['Ada', 'Ready'],
            ['Linus', 'Review'],
        ]);
        document.body.appendChild(table);
        addTableGridInteractionAdapter(table, ['name', 'status'], [
            { name: 'Ada', status: 'Ready' },
            { name: 'Linus', status: 'Review' },
        ]);

        getTableCell(table, 0, 0).dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            button: 0,
        }));
        getTableCell(table, 1, 1).dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true,
            buttons: 1,
        }));
        table.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
        }));

        expect(table.querySelectorAll('td.table_data_cell.selected')).toHaveLength(4);

        getTableCell(table, 1, 1).dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 24,
            clientY: 48,
        }));

        const selectionMenu = document.querySelector('.selection-menu');
        expect(selectionMenu.style.display).toBe('block');
        expect(selectionMenu.style.left).toBe('24px');
        expect(selectionMenu.style.top).toBe('48px');

        selectionMenu.querySelector('[data-action="copy-no-headers"]').click();
        await Promise.resolve();

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Ada\tReady\nLinus\tReview');
        expect(selectionMenu.style.display).toBe('none');
    });

    test('keeps the browser context menu when right-clicking outside the selected range', () => {
        const table = buildTable([
            ['Ada', 'Ready'],
            ['Linus', 'Review'],
        ]);
        document.body.appendChild(table);
        addTableGridInteractionAdapter(table, ['name', 'status'], []);

        const contextMenuEvent = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 24,
            clientY: 48,
        });
        getTableCell(table, 1, 1).dispatchEvent(contextMenuEvent);

        expect(contextMenuEvent.defaultPrevented).toBe(false);
        expect(document.querySelector('.selection-menu')).toBeNull();
    });
});

function buildTable(rows) {
    const table = document.createElement('table');
    table.classList.add('table_from_db');
    const tbody = document.createElement('tbody');

    rows.forEach((rowValues, rowIndex) => {
        const row = document.createElement('tr');
        rowValues.forEach((value, columnIndex) => {
            const cell = document.createElement('td');
            cell.classList.add('table_data_cell');
            cell.dataset.rowIndex = String(rowIndex);
            cell.dataset.colIndex = String(columnIndex);
            cell.dataset.column = columnIndex === 0 ? 'name' : 'status';
            cell.textContent = value;
            row.appendChild(cell);
        });
        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    return table;
}

function getTableCell(table, rowIndex, columnIndex) {
    return table.querySelector(
        `td.table_data_cell[data-row-index='${rowIndex}'][data-col-index='${columnIndex}']`
    );
}
