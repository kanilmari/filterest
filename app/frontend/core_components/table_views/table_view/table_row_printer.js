// table_row_printer.js
// Appends data rows to a table tbody, building each cell from column/type metadata.
// Bridges raw server row data with table_structure_builder cell factories and cell event handlers.
// Exists to isolate row-append rendering from table construction and cell interaction logic.

import { selectCell } from './table_cell_handler.js';
import { editCell } from '../../general_tables/gt_1_row_crud/gt_1_3_row_update/cell_editor.js';
import { handleKeyDown, shouldIgnoreTableCellSelectionClick } from './table_cell_event_handler.js';
import {
    attachRowHeightResizeHandle,
    createCheckboxCell,
    createDataCell,
    createRowNumberingCell,
} from './table_structure_builder.js';

export function appendDataToTable(table, newData, columns, dataTypes, tableName) {
    let tbody = table.querySelector('tbody');
    if (!tbody) {
        tbody = document.createElement('tbody');
        table.appendChild(tbody);
    }
    const existingRows = tbody.rows.length;

    newData.forEach((item, index) => {
        const row = document.createElement('tr');

        const numbering_td = createRowNumberingCell(existingRows + index + 1);
        row.appendChild(numbering_td);

        // Luodaan checkbox-solu
        const checkbox_td = createCheckboxCell(row, tableName);
        row.appendChild(checkbox_td);

        // Luodaan data-solut
        // Use batch-relative index (index) for createDataCell rowIndex so that
        // editCell's data[rowIndex] lookup matches the newData batch.
        columns.forEach((column, colIndex) => {
            const td = createDataCell(item, column, columns, index, colIndex, tableName, dataTypes);
            row.appendChild(td);
        });

        attachRowHeightResizeHandle(row, numbering_td);
        tbody.appendChild(row);

        // Attach event listeners only to this row's cells (avoids duplicate listeners)
        const cells = row.querySelectorAll('td:not(:first-child)');
        cells.forEach(cell => {
            cell.addEventListener('click', (e) => {
                if (shouldIgnoreTableCellSelectionClick(e.currentTarget, e.target)) {
                    e.stopPropagation();
                    return;
                }
                selectCell(e.currentTarget);
            });
            cell.addEventListener('dblclick', (e) => {
                editCell(e.currentTarget, columns, newData, dataTypes, tableName);
            });
            cell.addEventListener('keydown', (event) => {
                handleKeyDown(event, cell, columns, newData, dataTypes, tableName);
            });
        });
    });
}
