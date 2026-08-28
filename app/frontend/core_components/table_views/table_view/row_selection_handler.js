// row_selection_handler.js
// Syncs row highlight state with its checkbox and supports contiguous range selection.
// Bridges the table body DOM, row-checkbox input state, and select-all control.
// Exists to keep mouse/keyboard row selection consistent across initial and appended rows.

const lastClickedCheckboxByTable = new WeakMap();

export function update_row_selection(row) {
    const checkbox = row.querySelector('.row_checkbox');
    if (!(checkbox instanceof HTMLInputElement)) {
        return;
    }

    if (checkbox.checked) {
        row.classList.add('selected');
    } else {
        row.classList.remove('selected');
    }

    syncSelectAllCheckbox(row.closest('table'));
}

/**
 * Applies the clicked checkbox state across the anchor-to-current row range when Shift is held.
 * Operates between native checkbox click events and the table's row-highlight state.
 * Exists so mouse and keyboard range selection works without coupling rows to render order indexes.
 *
 * @param {MouseEvent} event
 * @param {HTMLTableRowElement} row
 */
export function update_row_selection_from_click(event, row) {
    const eventCheckbox = event.currentTarget;
    const checkbox = eventCheckbox instanceof HTMLInputElement
        ? eventCheckbox
        : row?.querySelector?.('.row_checkbox');
    const table = row?.closest?.('table');
    if (!(checkbox instanceof HTMLInputElement) || !(table instanceof HTMLTableElement)) {
        return;
    }

    const anchorCheckbox = lastClickedCheckboxByTable.get(table);
    const rowCheckboxes = Array.from(
        table.querySelectorAll('tbody .row_checkbox')
    ).filter((candidate) => candidate instanceof HTMLInputElement);
    const currentIndex = rowCheckboxes.indexOf(checkbox);
    const anchorIndex = rowCheckboxes.indexOf(anchorCheckbox);

    if (event.shiftKey && currentIndex >= 0 && anchorIndex >= 0) {
        const targetCheckedState = checkbox.checked;
        const startIndex = Math.min(anchorIndex, currentIndex);
        const endIndex = Math.max(anchorIndex, currentIndex);
        rowCheckboxes.slice(startIndex, endIndex + 1).forEach((rangeCheckbox) => {
            rangeCheckbox.checked = targetCheckedState;
            update_row_selection(rangeCheckbox.closest('tr'));
        });
    } else {
        update_row_selection(row);
    }

    lastClickedCheckboxByTable.set(table, checkbox);
}

export function toggle_select_all(event, table_name) {
    const checkboxes = document.querySelectorAll(`#${table_name}_table_body .row_checkbox`);
    const shouldSelectAll = event.target.checked;
    checkboxes.forEach(checkbox => {
        checkbox.checked = shouldSelectAll;
        update_row_selection(checkbox.closest('tr'));
    });

    const table = event.target.closest('table');
    if (table instanceof HTMLTableElement) {
        lastClickedCheckboxByTable.delete(table);
        syncSelectAllCheckbox(table);
    }
}

export function update_card_selection(card) {
    const checkbox = card.querySelector('.card_checkbox');
    if (checkbox.checked) {
        card.classList.add('selected');
    } else {
        card.classList.remove('selected');
    }
}

function syncSelectAllCheckbox(table) {
    if (!(table instanceof HTMLTableElement)) {
        return;
    }

    const selectAllCheckbox = table.querySelector('[data-testid="row-select-all-checkbox"]');
    const rowCheckboxes = Array.from(table.querySelectorAll('tbody .row_checkbox'))
        .filter((checkbox) => checkbox instanceof HTMLInputElement);
    if (!(selectAllCheckbox instanceof HTMLInputElement) || rowCheckboxes.length === 0) {
        return;
    }

    const selectedCount = rowCheckboxes.filter((checkbox) => checkbox.checked).length;
    selectAllCheckbox.checked = selectedCount === rowCheckboxes.length;
    selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < rowCheckboxes.length;
}
