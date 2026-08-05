// table_row_printer.test.js
// Verifies appended table rows keep the same timestamp display policy as initial table rows.
// Bridges infinite-scroll/text-search append rendering and table_structure_builder cell factories.
// Exists so later appended table data does not regress to visible seconds.
// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest';
import { DATE_TIME_DISPLAY_SEPARATOR } from '../timestamp_display_formatter.js';

function displayDateTime(dateText, timeText) {
    return `${dateText}${DATE_TIME_DISPLAY_SEPARATOR}${timeText}`;
}

vi.mock('./table_cell_handler.js', () => ({
    selectCell: vi.fn(),
}));

vi.mock('../../general_tables/gt_1_row_crud/gt_1_3_row_update/cell_editor.js', () => ({
    editCell: vi.fn(),
}));

vi.mock('./table_cell_event_handler.js', () => ({
    addEventListenersToCells: vi.fn(),
    handleKeyDown: vi.fn(),
    shouldIgnoreTableCellSelectionClick: vi.fn(() => false),
}));

vi.mock('./row_selection_handler.js', () => ({
    toggle_select_all: vi.fn(),
    update_row_selection: vi.fn(),
}));

vi.mock('./column_resize_handler.js', () => ({
    initialize_column_resizing: vi.fn(),
}));

vi.mock('./table_grid_interaction_adapter.js', () => ({
    addTableGridInteractionAdapter: vi.fn(),
}));

vi.mock('../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', () => ({
    getUnifiedTableState: vi.fn(() => ({ filters: {}, sort: {} })),
    setUnifiedTableState: vi.fn(),
    refreshTableUnified: vi.fn(),
}));

vi.mock('../../filterbar/filter_list/column_visibility_handler.js', () => ({
    makeColumnClass: vi.fn((tableName, columnName) => `${tableName}-${columnName}`),
}));

vi.mock('../../filterbar/top_row_buttons/sort_sync_state.js', () => ({
    emitDatasetSortSelection: vi.fn(),
}));

vi.mock('../../navigation/nav_engine/query_params.js', () => ({
    getParams: vi.fn(() => ({})),
    setParams: vi.fn(),
    updateURL: vi.fn(),
}));

import { appendDataToTable } from './table_row_printer.js';

describe('appendDataToTable', () => {
    test('passes data type metadata to appended timestamp cells', () => {
        const table = document.createElement('table');

        appendDataToTable(
            table,
            [{ created: '2026-06-15T21:36:10' }],
            ['created'],
            { created: { data_type: 'timestamp with time zone' } },
            'orders',
        );

        const cell = table.querySelector('[data-column="created"]');

        expect(cell?.textContent).toBe(displayDateTime('2026-06-15', '21:36'));
        expect(cell?.title).toBe('2026-06-15 21:36:10');
    });
});
