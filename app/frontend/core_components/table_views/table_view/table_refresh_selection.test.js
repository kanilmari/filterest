// @vitest-environment jsdom
// table_refresh_selection.test.js
// Proves SSE selection follows row identity at commit and preserves control focus.
// Connects the real click/arrow path to replacement cells, including reordered rows.
// Keeps delayed requests from rewinding the reader's selection or taking another input's focus.

import { afterEach, expect, test, vi } from 'vitest';
vi.mock('../../general_tables/gt_1_row_crud/gt_1_3_row_update/cell_editor.js', () => ({ editCell: vi.fn() }));
import { selectCell } from './table_cell_handler.js';
import { handleKeyDown } from './table_cell_event_handler.js';
import { preserveTableRefreshSelection } from './table_refresh_selection.js';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function buildRows(root, ids) {
    const table = document.createElement('table');
    const tbody = table.createTBody();
    ids.forEach((id, index) => {
        const row = tbody.insertRow(); row._row = { id };
        ['quantity', 'label'].forEach((column, colIndex) => {
            const cell = row.insertCell(); cell.className = 'table_data_cell'; cell.tabIndex = 0;
            Object.assign(cell.dataset, { column, rowIndex: String(index), colIndex: String(colIndex) });
            cell.addEventListener('keydown', event => handleKeyDown(event, cell, ['quantity', 'label'], [], {}, 'orders'));
        });
    });
    root.replaceChildren(table);
    return [...table.querySelectorAll('td')];
}

function mount() {
    const root = document.createElement('div'); document.body.append(root);
    return root;
}

test('reads selection at swap, restores by row and column, and real arrows work after a reorder', () => {
    const root = mount(); const old = buildRows(root, [7, 8]);
    selectCell(old[0]); // The request could have started here.
    selectCell(old[3]); // Reader moves while the answer is in flight.
    const restore = preserveTableRefreshSelection(root);
    const next = buildRows(root, [8, 7]);
    const focus = vi.spyOn(next[1], 'focus'); restore();
    expect(root.querySelector('.selected_for_editing')).toBe(next[1]);
    expect(document.activeElement).toBe(next[1]);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    next[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(root.querySelector('.selected_for_editing')).toBe(next[0]);
    expect(document.activeElement).toBe(next[0]);
});

test.each(['search', 'filter', 'dialog', 'editor'])('keeps focus held by a %s control', kind => {
    const root = mount(); const old = buildRows(root, [7]); selectCell(old[0]);
    const control = document.createElement('input'); control.dataset.testid = kind;
    document.body.append(control); control.focus();
    const restore = preserveTableRefreshSelection(root); const next = buildRows(root, [7]); restore();
    expect(next[0].classList.contains('selected_for_editing')).toBe(true);
    expect(document.activeElement).toBe(control);
});

test('a control focused after capture also keeps focus', () => {
    const root = mount(); const old = buildRows(root, [7]); selectCell(old[0]);
    const restore = preserveTableRefreshSelection(root); buildRows(root, [7]);
    const control = document.createElement('input'); document.body.append(control); control.focus(); restore();
    expect(document.activeElement).toBe(control);
});

test('a row outside the new first page leaves no selection and does not move focus', () => {
    const root = mount(); const old = buildRows(root, [107]); selectCell(old[0]);
    const restore = preserveTableRefreshSelection(root); buildRows(root, [7]); restore();
    expect(root.querySelector('.selected_for_editing')).toBeNull();
    expect(document.activeElement).toBe(document.body);
});

test('BODY already had focus before the swap, so restoration leaves it there', () => {
    const root = mount(); const old = buildRows(root, [7]); selectCell(old[0]); old[0].blur();
    const restore = preserveTableRefreshSelection(root); buildRows(root, [7]); restore();
    expect(document.activeElement).toBe(document.body);
    expect(root.querySelector('.selected_for_editing')).not.toBeNull();
});

test('normal list identity uses shared header-adjusted coordinates and arrows moved during the fetch', async () => {
    vi.doMock('../../dev_tools/function_counter.js', () => ({ count_this_function: vi.fn() }));
    vi.doMock('../../function_access_checker.js', () => ({ logAndCheckAccess: vi.fn() }));
    const { TableComponent } = await import('../table_component_builder.js');
    const root = mount();
    const create = data => new TableComponent({ table_name: 'orders', headers: [
        { key: 'quantity', label: 'Quantity' }, { key: 'label', label: 'Label' },
    ], data, initialView: 'normal' });
    const old = create([{ id: 7 }, { id: 8 }]); root.append(old.getElement());
    selectCell(old.getListCellByCoordinate({ rowIndex: 1, columnIndex: 0 }));
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const restore = preserveTableRefreshSelection(root);
    old.destroy(); const next = create([{ id: 8 }, { id: 7 }]); root.append(next.getElement()); restore();
    const selected = next.getListCellByCoordinate({ rowIndex: 0, columnIndex: 1 });
    expect(document.activeElement).toBe(selected); expect(selected.classList.contains('selected')).toBe(true);
    selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.activeElement).toBe(next.getListCellByCoordinate({ rowIndex: 0, columnIndex: 0 }));
    next.destroy();
});
