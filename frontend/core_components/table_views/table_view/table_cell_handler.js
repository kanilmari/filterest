// table_cell_handler.js
// Manages selected-cell state inside the table view.
// Bridges table DOM cells and the editing selection CSS state.
// Exists to ensure only one table cell is marked for editing at a time.

export function selectCell(cell) {
    // Poistetaan 'selected_for_editing' -luokka kaikista soluista
    const selectionRoot = cell.closest('table') || cell.closest('.table-component-root');
    if (!selectionRoot) {
        console.warn('selectCell: selection root not found for cell', cell);
        return;
    }
    const selectedCells = selectionRoot.querySelectorAll('.selected_for_editing');
    selectedCells.forEach(selectedCell => {
        selectedCell.classList.remove('selected_for_editing');
    });

    // Lisätään 'selected_for_editing' -luokka valittuun soluun
    cell.classList.add('selected_for_editing');
    cell.focus();
}
