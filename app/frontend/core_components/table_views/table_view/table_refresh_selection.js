// table_refresh_selection.js
// Captures cell identity at the actual SSE swap and restores the click selection path.
// Connects replacement table/list DOM to selectCell without retaining positional coordinates.
// Keeps arrow navigation alive while respecting focus in other controls.

import { selectCell } from './table_cell_handler.js';

function cellIdentity(cell) {
    const row = cell.closest('tr');
    const component = cell.closest('.table-component-root')?.tableComponentInstance;
    const coordinate = component?.getListCellEditCoordinate(cell);
    const rowData = row?._row || (coordinate && component.getFilteredData()[coordinate.rowIndex]);
    const rowId = rowData?.id ?? row?.dataset.rowId;
    const column = cell.dataset.column || (coordinate && component.headers[coordinate.columnIndex]?.key);
    return rowId != null && column ? { rowId: String(rowId), column } : null;
}

/** Called immediately before the swap; its returned callback runs after the new cells mount. */
export function preserveTableRefreshSelection(root) {
    const oldCell = root?.querySelector('.cell.selected:not(.header)') || root?.querySelector('.selected_for_editing');
    const identity = oldCell && cellIdentity(oldCell);
    if (!identity) return () => {};
    const active = document.activeElement;
    const ownedFocus = active === oldCell;
    return () => {
        const cell = [...root.querySelectorAll('.table_data_cell, .cell')].find(candidate => {
            const next = cellIdentity(candidate);
            return next?.rowId === identity.rowId && next.column === identity.column;
        });
        if (!cell) return;
        const component = cell.closest('.table-component-root')?.tableComponentInstance;
        if (component) {
            component.clearSelection();
            cell.classList.add('selected');
        }
        selectCell(cell, { focus: ownedFocus && document.activeElement === document.body, preventScroll: true });
    };
}
