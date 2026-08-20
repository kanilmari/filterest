// @vitest-environment jsdom
// row_selection_handler.test.js
// Verifies contiguous table-row checkbox selection and select-all synchronization.
// Bridges native checkbox clicks with row highlight classes and the table header control.
// Exists to prevent initial and infinite-scroll rows from diverging in multi-selection behavior.

import { beforeEach, describe, expect, test } from 'vitest';
import {
    toggle_select_all,
    update_row_selection_from_click,
} from './row_selection_handler.js';

describe('row_selection_handler', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    test('Shift-click applies the current checked state through a contiguous row range', () => {
        const { table, selectAll, rowCheckboxes } = buildCheckboxTable(4);
        document.body.appendChild(table);

        rowCheckboxes[0].checked = true;
        update_row_selection_from_click(
            new MouseEvent('click'),
            rowCheckboxes[0].closest('tr')
        );

        rowCheckboxes[2].checked = true;
        update_row_selection_from_click(
            new MouseEvent('click', { shiftKey: true }),
            rowCheckboxes[2].closest('tr')
        );

        expect(rowCheckboxes.map((checkbox) => checkbox.checked)).toEqual([
            true,
            true,
            true,
            false,
        ]);
        expect(Array.from(table.tBodies[0].rows).map((row) => row.classList.contains('selected')))
            .toEqual([true, true, true, false]);
        expect(selectAll.checked).toBe(false);
        expect(selectAll.indeterminate).toBe(true);
    });

    test('select-all keeps its requested state while row synchronization runs', () => {
        const { table, selectAll, rowCheckboxes } = buildCheckboxTable(3);
        table.tBodies[0].id = 'orders_table_body';
        document.body.appendChild(table);
        selectAll.checked = true;

        toggle_select_all({ target: selectAll }, 'orders');

        expect(rowCheckboxes.every((checkbox) => checkbox.checked)).toBe(true);
        expect(selectAll.checked).toBe(true);
        expect(selectAll.indeterminate).toBe(false);
    });
});

function buildCheckboxTable(rowCount) {
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    const selectAll = document.createElement('input');
    selectAll.type = 'checkbox';
    selectAll.dataset.testid = 'row-select-all-checkbox';
    const headCell = document.createElement('th');
    headCell.appendChild(selectAll);
    headRow.appendChild(headCell);
    head.appendChild(headRow);

    const body = document.createElement('tbody');
    const rowCheckboxes = Array.from({ length: rowCount }, () => {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.classList.add('row_checkbox');
        cell.appendChild(checkbox);
        row.appendChild(cell);
        body.appendChild(row);
        return checkbox;
    });
    table.append(head, body);

    return { table, selectAll, rowCheckboxes };
}
