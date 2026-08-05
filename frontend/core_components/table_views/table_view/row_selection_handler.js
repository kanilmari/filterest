// row_selection_handler.js
// Syncs row highlight state with its checkbox and toggles all-row selection.
// Bridges the table body DOM with row-checkbox input state.
// Exists to keep selection logic separate from row rendering and action handlers.

export function update_row_selection(row) {
    const checkbox = row.querySelector('.row_checkbox');
    if (checkbox.checked) {
        row.classList.add('selected');
    } else {
        row.classList.remove('selected');
    }
}

export function toggle_select_all(event, table_name) {
    const checkboxes = document.querySelectorAll(`#${table_name}_table_body .row_checkbox`);
    checkboxes.forEach(checkbox => {
        checkbox.checked = event.target.checked;
        update_row_selection(checkbox.closest('tr'));
    });
}

export function update_card_selection(card) {
    const checkbox = card.querySelector('.card_checkbox');
    if (checkbox.checked) {
        card.classList.add('selected');
    } else {
        card.classList.remove('selected');
    }
}
