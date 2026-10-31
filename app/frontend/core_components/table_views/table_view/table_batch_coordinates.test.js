// table_batch_coordinates.test.js
// Proves appended table batches keep distinct selection, editing and row identities.
// Bridges real row rendering, cell events, copy payloads and checkbox deletion.
// Guards the boundary between cumulative grid coordinates and batch-owned row caches.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
vi.mock('../../filterbar/filter_list/filter_column_builder_helpers.js', () => ({
    loadForeignFilterOptions: vi.fn(async () => [{ value: 2, label: 'Uusi' }]),
}));
vi.mock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showErrorToast: vi.fn(), showSuccessToast: vi.fn(), showWarningToast: vi.fn(),
}));
vi.mock('../../../reusable_components/modal/confirm_modal_builder.js', () => ({
    showConfirmModal: vi.fn(async () => true),
}));
vi.mock('../../lang/translation_handler.js', () => ({ getTranslationForKey: (key) => key }));
vi.mock('../../service_catalog/service_catalog_moderation.js', () => ({
    readCachedUserPermissions: () => ({}), canEditServiceCatalogColumn: () => true,
}));
vi.mock('./column_resize_handler.js', () => ({ initialize_column_resizing: vi.fn() }));
vi.mock('../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', () => ({
    getUnifiedTableState: () => ({ filters: {}, sort: {} }),
    setUnifiedTableState: vi.fn(), refreshTableUnified: vi.fn(),
}));
vi.mock('../../filterbar/filter_list/column_visibility_handler.js', () => ({
    makeColumnClass: (tableName, column) => `${tableName}-${column}`,
}));
vi.mock('../../filterbar/top_row_buttons/sort_sync_state.js', () => ({ emitDatasetSortSelection: vi.fn() }));
vi.mock('../../navigation/nav_engine/query_params.js', () => ({
    getParams: () => ({}), setParams: vi.fn(), updateURL: vi.fn(),
}));
vi.mock('../grid_interactions/context_menu_payload_builder.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, deriveGridContextMenuPayload: vi.fn(actual.deriveGridContextMenuPayload) };
});

import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { editCell } from '../../general_tables/gt_1_row_crud/gt_1_3_row_update/cell_editor.js';
import { delete_selected_items } from '../../general_tables/gt_1_row_crud/gt_1_4_row_delete/row_remover.js';
import { resetDatasetRowSelectionStoreForTests } from '../dataset_row_selection_store.js';
import { deriveGridContextMenuPayload } from '../grid_interactions/context_menu_payload_builder.js';
import { appendDataToTable } from './table_row_printer.js';
import { create_table_element } from './table_structure_builder.js';

const DATASET = 'batch_coordinate_rows';
const COLUMNS = ['id', 'label'];

function renderBatches({ columns = COLUMNS, dataTypes = {}, dataset = DATASET, appendBoth = false } = {}) {
    const rows = Array.from({ length: 30 }, (_, index) => ({ id: 30 - index, label: `row-${30 - index}` }));
    const firstBatch = rows.slice(0, 20);
    const secondBatch = rows.slice(20);
    const table = create_table_element(columns, appendBoth ? [] : firstBatch, dataset, dataTypes);
    document.body.appendChild(table);
    if (appendBoth) appendDataToTable(table, firstBatch, columns, dataTypes, dataset);
    appendDataToTable(table, secondBatch, columns, dataTypes, dataset);
    const cell = (id, column = 'label') => table.querySelector(`tr[data-row-id="${id}"] td[data-column="${column}"]`);
    return { table, rows, firstBatch, secondBatch, cell };
}

describe('table coordinates across infinite-scroll batches', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        localStorage.clear();
        resetDatasetRowSelectionStoreForTests();
        vi.clearAllMocks();
        endpoint_router.mockResolvedValue({});
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true, value: { writeText: vi.fn(async () => {}) },
        });
    });

    afterEach(() => {
        document.body.replaceChildren();
        localStorage.clear();
        resetDatasetRowSelectionStoreForTests();
    });

    test('assigns unique coordinates to every cell in two appended batches', () => {
        const { table, rows } = renderBatches({ appendBoth: true });
        const cells = [...table.querySelectorAll('td.table_data_cell')];
        expect(cells).toHaveLength(60);
        expect(new Set(cells.map((cell) => `${cell.dataset.rowIndex}:${cell.dataset.colIndex}`)).size).toBe(60);
        [...table.tBodies[0].rows].forEach((row, index) => {
            expect(row._row).toBe(rows[index]);
            expect(row.dataset.rowId).toBe(String(rows[index].id));
            expect(row.cells[0].textContent).toBe(String(index + 1));
            expect(row.cells[2].dataset.rowIndex).toBe(String(index));
        });
    });

    test.each(['dblclick', 'Enter', 'F2'])('%s edits the second-batch row and updates its shared cache', async (activation) => {
        const { cell, firstBatch, secondBatch } = renderBatches();
        const target = cell(9);
        target.dispatchEvent(activation === 'dblclick'
            ? new MouseEvent('dblclick', { bubbles: true })
            : new KeyboardEvent('keydown', { bubbles: true, key: activation }));
        const editor = target.querySelector('[data-testid="table-editor"]');
        expect(editor.value).toBe('row-9');
        editor.value = 'rivi-9';
        editor.blur();
        await vi.waitFor(() => expect(target.textContent).toBe('rivi-9'));
        expect(endpoint_router).toHaveBeenCalledExactlyOnceWith('updateRow', {
            method: 'POST', url_params: `?dataset=${DATASET}`,
            body_data: { id: 9, column: 'label', value: 'rivi-9' },
        });
        expect(secondBatch[1].label).toBe('rivi-9');
        expect(target.closest('tr')._row).toBe(secondBatch[1]);
        expect(firstBatch[1].label).toBe('row-29');
    });

    test('ArrowDown crosses the batch boundary and keeps moving within batch two', () => {
        const { table, cell } = renderBatches();
        cell(11).focus();
        for (const id of [10, 9, 8]) {
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true, cancelable: true, key: 'ArrowDown',
            }));
            expect(document.activeElement).toBe(cell(id));
            expect([...table.querySelectorAll('.selected_for_editing')]).toEqual([cell(id)]);
        }
    });

    test('highlights and copies a second-batch coordinate using all rendered row objects', async () => {
        const { table, rows, cell } = renderBatches();
        const target = cell(9);
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        target.click();
        expect([...table.querySelectorAll('td.selected')]).toEqual([target]);
        expect([...table.querySelectorAll('td.selected_for_editing')]).toEqual([target]);
        target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        const menu = document.querySelector('.grid-selection-menu');
        expect(menu.style.display).toBe('block');
        const request = deriveGridContextMenuPayload.mock.lastCall[0];
        expect(request.rows).toEqual(rows);
        expect(request.rows[21]).toBe(target.closest('tr')._row);
        expect(request.copyOptions.cellResolver({ rowIndex: 21, columnIndex: 1 })).toBe('row-9');
        menu.querySelector('[data-action="copy-no-headers"]').click();
        await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('row-9'));
    });

    test('the second-batch checkbox sends its row id to delete', async () => {
        const { cell } = renderBatches();
        cell(9).closest('tr').querySelector('.row_checkbox').click();
        await delete_selected_items(DATASET);
        expect(endpoint_router).toHaveBeenCalledExactlyOnceWith('deleteRows', {
            method: 'POST', url_params: `?dataset=${DATASET}`, body_data: { ids: [9] },
        });
    });

    test('keyboard copy resolves the selected second-batch cell without opening a menu', () => {
        const { cell } = renderBatches();
        const target = cell(9);
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        target.click();
        const copy = new Event('copy', { bubbles: true, cancelable: true });
        const clipboardData = { setData: vi.fn() };
        Object.defineProperty(copy, 'clipboardData', { value: clipboardData });
        target.dispatchEvent(copy);
        expect(copy.defaultPrevented).toBe(true);
        expect(clipboardData.setData).toHaveBeenCalledExactlyOnceWith('text/plain', 'row-9');
        expect(document.querySelector('.grid-selection-menu')).toBeNull();
    });

    test('option editing writes the second-batch row and invalidates its metadata cache', async () => {
        const { cell, rows } = renderBatches({
            columns: ['id', 'card_details_layout'], dataset: 'system_db_tables',
        });
        rows.forEach((row) => { row.card_details_layout = 'single_line'; row.table_name = `target_${row.id}`; });
        localStorage.setItem('target_9_tableMeta', '{}');
        const target = cell(9, 'card_details_layout');
        target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        const editor = target.querySelector('select');
        editor.value = 'stacked';
        editor.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(rows[21].card_details_layout).toBe('stacked'));
        expect(endpoint_router.mock.lastCall[1].body_data).toEqual({ id: 9, column: 'card_details_layout', value: 'stacked' });
        expect(rows[1].card_details_layout).toBe('single_line');
        expect(localStorage.getItem('target_9_tableMeta')).toBeNull();
    });

    test.each(['category_id', 'category_id_name'])('foreign-key editing through %s updates the second-batch caches and sibling cells', async (column) => {
        const columns = ['id', 'category_id', 'category_id_name'];
        const { cell, rows } = renderBatches({ columns });
        rows.forEach((row) => { row.category_id = 1; row.category_id_name = 'Vanha'; });
        const target = cell(9, column);
        await editCell(target, columns, rows.slice(20), {
            category_id: { data_type: 'integer', foreign_table: 'categories', foreign_column: 'id' },
        }, DATASET);
        await vi.waitFor(() => expect(target.querySelector('.msd-option[data-option-value="2"]')).not.toBeNull());
        target.querySelector('.msd-option[data-option-value="2"]').click();
        await vi.waitFor(() => expect(rows[21].category_id).toBe(2));
        expect(endpoint_router.mock.lastCall[1].body_data).toEqual({ id: 9, column: 'category_id', value: 2 });
        expect(rows[21].category_id_name).toBe('Uusi');
        expect(rows[1].category_id).toBe(1);
        expect(cell(9, 'category_id').textContent).toBe('2');
        expect(cell(9, 'category_id_name').textContent).toBe('Uusi');
    });
});
