// selected_items_reader.js
// Reads the currently selected row IDs and data objects from the active table or card view.
// Bridges localStorage view state with DOM-based selection markers.
// Exists to provide a unified selection API for delete, bulk, and detail actions.
import { computeIdCellIndex, parseIdFromText, parseRowObject } from './selected_items_reader_helpers.js';

export function get_selected_items(table_name) {
    const datasetName = table_name;
    const current_view = localStorage.getItem(`${datasetName}_view`) || 'table';
    const ids = [];
    const rows = [];

    if (current_view === 'table') {
        const selected_rows = document.querySelectorAll(`#${table_name}_table_body tr.selected`);

        if (selected_rows.length === 0) {
            return { ids: [], rows: [] };
        }

        const table = document.querySelector(`#${table_name}_container table`);
        if (!table) {
            return { ids: [], rows: [] };
        }
        const columns = JSON.parse(table.dataset.columns);

        const id_cell_index = computeIdCellIndex(columns);

        selected_rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            const cellTexts = Array.from(cells).map(c => c.textContent.trim());
            rows.push(parseRowObject(columns, cellTexts));

            if (id_cell_index !== -1 && cells.length > id_cell_index) {
                const id_cell = cells[id_cell_index];
                const id_parsed = parseIdFromText(id_cell.textContent);
                if (id_parsed !== null) {
                    ids.push(id_parsed);
                }
            }
        });
    } else if (current_view === 'card') {
        const selected_cards = document.querySelectorAll(`#${table_name}_container .card.selected`);
    
        if (selected_cards.length === 0) {
            return { ids: [], rows: [] };
        }
    
        selected_cards.forEach(card => {
            if (card._row) {
                rows.push(card._row);
            }

            const id_from_card = card.getAttribute('data-id');
            if (id_from_card) {
                ids.push(parseInt(id_from_card, 10));
            } else {
                console.warn("Kortilla ei ole data-id-attribuuttia:", card);
            }
        });
    }

    return { ids, rows };
}
