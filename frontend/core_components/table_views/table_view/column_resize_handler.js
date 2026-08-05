// column_resize_handler.js
// Attaches drag-to-resize handles to each <th> in a given table element.
// Bridges table_column_resizer.js orchestration with the table-header DOM.
// Exists to isolate resize-handle attachment logic from column-width state management.

import { clampManualColumnWidthPx } from './table_structure_builder_helpers.js';

function parseColumnWidthPx(column_element) {
    if (!(column_element instanceof HTMLElement)) {
        return null;
    }

    const widthPx = Number.parseFloat(column_element.style.width);
    return Number.isFinite(widthPx) ? widthPx : null;
}

function applyColumnWidth(table_element, column_index, width_px) {
    const safeWidthPx = clampManualColumnWidthPx(width_px, column_index);
    const colgroupColumns = table_element.querySelectorAll('colgroup col');
    const columnElement = colgroupColumns[column_index];
    if (columnElement instanceof HTMLElement) {
        const cssWidth = `${safeWidthPx}px`;
        columnElement.style.width = cssWidth;
        columnElement.style.minWidth = cssWidth;
        columnElement.style.maxWidth = cssWidth;
    }

    table_element.querySelectorAll('tr').forEach((row_element) => {
        const cell = row_element.children[column_index];
        if (!(cell instanceof HTMLElement)) {
            return;
        }

        const cssWidth = `${safeWidthPx}px`;
        cell.style.width = cssWidth;
        cell.style.minWidth = cssWidth;
        cell.style.maxWidth = cssWidth;

        const content = cell.querySelector('.table_cell_content');
        if (content instanceof HTMLElement) {
            content.style.maxWidth = cssWidth;
        }
    });

    return safeWidthPx;
}

export function synchronize_column_widths(table_element) {
    const colgroupColumns = table_element.querySelectorAll('colgroup col');
    colgroupColumns.forEach((column_element, column_index) => {
        const widthPx = parseColumnWidthPx(column_element);
        if (widthPx !== null) {
            applyColumnWidth(table_element, column_index, widthPx);
        }
    });
}

export function initialize_column_resizing(table_element) {
    const table_headers = table_element.querySelectorAll('thead tr:first-child th');
    synchronize_column_widths(table_element);

    table_headers.forEach(function(th_element) {
        let existing_resize_handle = th_element.querySelector('.resize-handle');
        if (!existing_resize_handle) {
            const resize_handle_element = document.createElement('div');
            resize_handle_element.classList.add('resize-handle');
            th_element.appendChild(resize_handle_element);
        }
    });

    const resize_handles = table_element.querySelectorAll('thead tr:first-child .resize-handle');
    resize_handles.forEach(function(resize_handle_element) {
        if (resize_handle_element.dataset.resizeListenerAttached) return;
        resize_handle_element.dataset.resizeListenerAttached = 'true';
        resize_handle_element.addEventListener('mousedown', function(mousedown_event) {
            mousedown_event.preventDefault();

            let table_header_element = resize_handle_element.parentElement;
            if (!(table_header_element instanceof HTMLTableCellElement)) {
                return;
            }

            const columnIndex = table_header_element.cellIndex;
            const colgroupColumns = table_element.querySelectorAll('colgroup col');
            const savedWidthPx = parseColumnWidthPx(colgroupColumns[columnIndex]);
            let start_mouse_x_position = mousedown_event.pageX;
            let start_header_width = savedWidthPx ?? table_header_element.offsetWidth;

            const handle_rect = resize_handle_element.getBoundingClientRect();
            const handle_grab_offset = mousedown_event.clientX - handle_rect.left;

            function handle_mousemove(mousemove_event) {
                let diff_x = (mousemove_event.clientX - handle_grab_offset) - start_mouse_x_position;
                let new_width = start_header_width + diff_x;
                applyColumnWidth(table_element, columnIndex, new_width);
            }

            function handle_mouseup() {
                document.removeEventListener('mousemove', handle_mousemove);
                document.removeEventListener('mouseup', handle_mouseup);
            }

            document.addEventListener('mousemove', handle_mousemove);
            document.addEventListener('mouseup', handle_mouseup);
        });
    });
}
