// cell_editor_display.js
// Restores table/list cell content after inline editing.
// Connects editor completion to the shared localized value printer.
// Keeps both cell layouts consistent without duplicating formatting.

import { selectCell } from "../../../table_views/table_view/table_cell_handler.js";
import { setLocalizedDatasetText } from "../../../table_views/dataset_value_localizer.js";

export function setCellDisplayText(cell, value) {
    const text = value !== null && value !== undefined ? String(value) : '';
    if (cell.matches?.('.table_data_cell')) {
        const cellContent = document.createElement('div');
        cellContent.className = 'table_cell_content';
        if (cell.classList.contains('table_data_cell--compact')) {
            cellContent.classList.add('table_cell_content--compact');
        }
        cellContent.textContent = text;
        cell.replaceChildren(cellContent);
        return;
    }
    if (cell.matches?.('.cell')) {
        const cellContent = document.createElement('div');
        cellContent.className = 'cell-content';
        copyListCellColumnClasses(cell, cellContent);
        cellContent.textContent = text;
        cellContent.style.whiteSpace = 'pre-wrap';
        cell.replaceChildren(cellContent);
        return;
    }

    cell.textContent = text;
}

export function setLocalizedTableCellDisplay(cell, rawValue, columnMetadata) {
    const cellContent = document.createElement('div');
    if (cell.matches?.('.table_data_cell')) {
        cellContent.className = 'table_cell_content';
        if (cell.classList.contains('table_data_cell--compact')) {
            cellContent.classList.add('table_cell_content--compact');
        }
    } else if (cell.matches?.('.cell')) {
        cellContent.className = 'cell-content';
        copyListCellColumnClasses(cell, cellContent);
        cellContent.style.whiteSpace = 'pre-wrap';
    } else {
        setLocalizedDatasetText(cell, rawValue, columnMetadata);
        return;
    }
    setLocalizedDatasetText(cellContent, rawValue, columnMetadata);
    cell.replaceChildren(cellContent);
}

function copyListCellColumnClasses(cell, contentElement) {
    for (const className of cell.classList) {
        if (
            className !== 'cell'
            && className !== 'editing'
            && className !== 'selected'
            && className !== 'selected_for_editing'
            && className !== 'header'
            && className !== 'sortable'
        ) {
            contentElement.classList.add(className);
        }
    }
}


/** Select a finished edit without taking focus from a control the person has entered. */
export function selectCellAfterEditing(cell) {
    const active = document.activeElement;
    if (active === document.body || active === cell || cell.contains(active)) selectCell(cell);
    else selectCell(cell, { focus: false });
}
