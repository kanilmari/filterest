// column_resize_handler.test.js
// Verifies persisted table column widths are re-applied through the shared DOM synchronizer.
// Bridges colgroup width state and rendered header/body cells in a jsdom-safe harness.
// Exists to keep the shared 800px column ceiling enforced at the DOM application layer.
// @vitest-environment jsdom

import { describe, expect, test } from 'vitest';

import { synchronize_column_widths } from './column_resize_handler.js';

function createTableHarness() {
    const table = document.createElement('table');
    table.innerHTML = `
        <colgroup>
            <col style="width: 12px;">
            <col style="width: 40px;">
            <col style="width: 1200px;">
        </colgroup>
        <thead>
            <tr>
                <th>#</th>
                <th>Select</th>
                <th>Name</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td>1</td>
                <td><input type="checkbox"></td>
                <td><div class="table_cell_content">Long dataset value</div></td>
            </tr>
        </tbody>
    `;
    document.body.appendChild(table);
    return table;
}

describe('synchronize_column_widths', () => {
    test('clamps persisted widths across colgroup, header cells, and data cells', () => {
        document.body.innerHTML = '';
        const table = createTableHarness();

        synchronize_column_widths(table);

        const columns = table.querySelectorAll('colgroup col');
        const headerCells = table.querySelectorAll('thead th');
        const dataCells = table.querySelectorAll('tbody td');
        const content = table.querySelector('.table_cell_content');

        expect(columns[0].style.width).toBe('50px');
        expect(columns[2].style.width).toBe('800px');
        expect(headerCells[0].style.width).toBe('50px');
        expect(headerCells[2].style.width).toBe('800px');
        expect(dataCells[0].style.width).toBe('50px');
        expect(dataCells[2].style.width).toBe('800px');
        expect(content.style.maxWidth).toBe('800px');
    });
});
