// @vitest-environment jsdom
// table_grid_interaction_adapter.test.js
// Verifies table-view range selection and copy menu behavior through shared grid helpers.
// Bridges rendered td cells, context-menu events, and clipboard payload generation.
// Exists so the table adapter keeps parity with the list adapter's multi-cell affordances.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showErrorToast: vi.fn(),
    showSuccessToast: vi.fn(),
}));

vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key) => key,
}));

import { addTableGridInteractionAdapter } from './table_grid_interaction_adapter.js';
import { buildCssHideRules, makeColumnClass } from '../../filterbar/filter_list/column_visibility_handler_helpers.js';

describe('table_grid_interaction_adapter', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });
    });

    afterEach(() => {
        document.getSelection().removeAllRanges();
        document.head.querySelectorAll('[data-copy-test]').forEach(element => element.remove());
        document.body.style.display = '';
    });

    const emptyCellCases = [
        { position: 'leading', values: ['', 'filled'], rowsText: '\nfilled', columnsText: '\tfilled' },
        { position: 'trailing', values: ['filled', ''], rowsText: 'filled\n', columnsText: 'filled\t' },
        { position: 'middle', values: ['first', '', 'last'], rowsText: 'first\n\nlast', columnsText: 'first\t\tlast' },
        { position: 'only', values: ['', ''], rowsText: '\n', columnsText: '\t' },
    ];
    const copyCases = ['menu', 'keyboard'].flatMap(copyPath =>
        ['rows', 'columns'].flatMap(axis =>
            emptyCellCases.map(emptyCase => ({ ...emptyCase, copyPath, axis }))));

    test.each(copyCases)(
        '$copyPath copy preserves $position empty cells across $axis while trimming individual cells',
        ({ values, rowsText, columnsText, copyPath, axis }) => {
            const matrix = axis === 'rows' ? values.map(value => [value]) : [values];
            // Cell-level trimming remains supported, including whitespace-only cells.
            const table = buildTable(matrix.map(row => row.map(value => `  ${value}  `)));
            document.body.appendChild(table);
            const columns = matrix[0].map((_, index) => `Field ${index + 1}`);
            addTableGridInteractionAdapter(table, columns, []);
            const first = getTableCell(table, 0, 0);
            const last = getTableCell(table, matrix.length - 1, matrix[0].length - 1);
            first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
            last.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1 }));
            table.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            const expected = axis === 'rows' ? rowsText : columnsText;

            if (copyPath === 'keyboard') {
                const { event, setData } = dispatchCopy(last);
                expect(event.defaultPrevented).toBe(true);
                expect(setData).toHaveBeenCalledExactlyOnceWith('text/plain', expected);
                expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
                return;
            }
            for (const withHeaders of [false, true]) {
                last.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
                table.gridSelectionMenu.querySelector(
                    `[data-action="${withHeaders ? 'copy-headers' : 'copy-no-headers'}"]`
                ).click();
                expect(navigator.clipboard.writeText).toHaveBeenNthCalledWith(
                    withHeaders ? 2 : 1, `${withHeaders ? `${columns.join('\t')}\n` : ''}${expected}`
                );
            }
            expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2);
        }
    );

    test.each(['feature CSS', 'display', 'visibility', 'hidden', 'missing', 'ancestor', 'unrendered'])(
        'omits a %s middle column from both copy paths and their headers', async (mode) => {
            const table = buildTable([['left', 'HIDDEN-VALUE', 'right'], ['left-2', 'HIDDEN-2', 'right-2']]);
            document.body.appendChild(table);
            addTableGridInteractionAdapter(table, ['Left', 'HIDDEN-HEADER', 'Right'], []);
            const middleCells = [...table.querySelectorAll('[data-col-index="1"]')];
            if (mode === 'feature CSS') {
                const style = document.createElement('style');
                style.dataset.copyTest = '';
                style.textContent = buildCssHideRules({ hidden: true }, 'people');
                document.head.appendChild(style);
                middleCells.forEach(cell => cell.classList.add(makeColumnClass('people', 'hidden')));
            } else {
                middleCells.forEach(cell => {
                    if (mode === 'display') cell.style.display = 'none';
                    if (mode === 'visibility') cell.style.visibility = 'hidden';
                    if (mode === 'hidden') cell.hidden = true;
                    if (mode === 'missing') cell.remove();
                    if (mode === 'unrendered') cell.checkVisibility = () => false;
                });
                if (mode === 'ancestor') table.parentElement.style.display = 'none';
            }
            getTableCell(table, 0, 0).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
            getTableCell(table, 1, 2).dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1 }));
            table.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            for (const withHeaders of [false, true]) {
                getTableCell(table, 1, 2).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
                const menu = table.gridSelectionMenu;
                const payload = menu.gridSelectionPayload.copyActions[withHeaders ? 0 : 1].payload;
                expect(payload.text).toBe(mode === 'ancestor' ? ''
                    : `${withHeaders ? 'Left\tRight\n' : ''}left\tright\nleft-2\tright-2`);
                expect(payload.headers).toEqual(withHeaders && mode !== 'ancestor' ? ['Left', 'Right'] : []);
                menu.querySelector(`[data-action="${withHeaders ? 'copy-headers' : 'copy-no-headers'}"]`).click();
                await Promise.resolve();
                if (mode !== 'ancestor') expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(payload.text);
            }
            const { event, setData } = dispatchCopy(getTableCell(table, 1, 2));
            if (mode === 'ancestor') {
                expect(event.defaultPrevented).toBe(false);
                expect(setData).not.toHaveBeenCalled();
                expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
                document.body.style.display = '';
            } else {
                expect(event.defaultPrevented).toBe(true);
                expect(setData).toHaveBeenCalledExactlyOnceWith('text/plain', 'left\tright\nleft-2\tright-2');
            }
        }
    );

    test.each(['input', 'textarea', 'select', 'editable', 'editable child', 'plaintext editable child'])(
        'preserves native copying from %s without the editing class (target and focus independently)', (mode) => {
            const table = buildTable([['Ada', 'Ready']]);
            document.body.appendChild(table);
            addTableGridInteractionAdapter(table, ['name', 'status'], []);
            const cell = getTableCell(table, 0, 0);
            cell.classList.add('selected');
            const control = document.createElement(mode.includes('editable') ? 'div' : mode);
            if (mode.includes('editable')) control.setAttribute('contenteditable', mode.includes('plaintext') ? 'plaintext-only' : 'true');
            control.tabIndex = 0;
            control.innerHTML = mode.includes('child') ? '<span>draft</span>' : 'draft';
            cell.appendChild(control);
            expect(cell.classList.contains('editing')).toBe(false);
            // Event target alone, without focus, must be enough to preserve native copy.
            const targetCopy = dispatchCopy(control.firstElementChild || control);
            expect(targetCopy.event.defaultPrevented).toBe(false);
            expect(targetCopy.setData).not.toHaveBeenCalled();
            // Focus alone must guard an event dispatched from the selected cell too.
            document.body.appendChild(control);
            const focusTarget = control.firstElementChild || control;
            focusTarget.tabIndex = 0;
            focusTarget.focus();
            expect(document.activeElement).toBe(focusTarget);
            const focusedCopy = dispatchCopy(cell);
            expect(focusedCopy.event.defaultPrevented).toBe(false);
            expect(focusedCopy.setData).not.toHaveBeenCalled();
            expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
        }
    );

    test('leaves native copy untouched without clipboard data or when all selected cells are hidden', () => {
        const table = buildTable([['Ada']]);
        document.body.appendChild(table);
        addTableGridInteractionAdapter(table, ['name'], []);
        const cell = getTableCell(table, 0, 0);
        cell.classList.add('selected');
        const missingClipboard = new Event('copy', { bubbles: true, cancelable: true });
        cell.dispatchEvent(missingClipboard);
        expect(missingClipboard.defaultPrevented).toBe(false);
        cell.hidden = true;
        const { event, setData } = dispatchCopy(cell);
        expect(event.defaultPrevented).toBe(false);
        expect(setData).not.toHaveBeenCalled();
    });

    test.each([false, true])('rechecks column visibility when clicking an open menu (headers: %s)', (withHeaders) => {
        const table = buildTable([['left', 'HIDDEN-VALUE', 'right']]);
        document.body.appendChild(table);
        addTableGridInteractionAdapter(table, ['Left', 'HIDDEN-HEADER', 'Right'], []);
        table.querySelectorAll('td').forEach(cell => cell.classList.add('selected'));
        const last = getTableCell(table, 0, 2);
        last.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        getTableCell(table, 0, 1).hidden = true;
        table.gridSelectionMenu.querySelector(`[data-action="${withHeaders ? 'copy-headers' : 'copy-no-headers'}"]`).click();
        expect(navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(`${withHeaders ? 'Left\tRight\n' : ''}left\tright`);
    });

    test('selects a rectangular table range and copies it from the context menu', async () => {
        const table = buildTable([
            ['Ada', 'Ready'],
            ['Linus', 'Review'],
        ]);
        document.body.appendChild(table);
        addTableGridInteractionAdapter(table, ['name', 'status'], [
            { name: 'Ada', status: 'Ready' },
            { name: 'Linus', status: 'Review' },
        ]);

        getTableCell(table, 0, 0).dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            button: 0,
        }));
        selectCellText(getTableCell(table, 0, 0));
        expect(document.getSelection().toString()).toBe('Ada');

        const rangeMouseMove = new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            buttons: 1,
        });
        getTableCell(table, 1, 1).dispatchEvent(rangeMouseMove);
        table.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
        }));

        expect(table.querySelectorAll('td.table_data_cell.selected')).toHaveLength(4);
        expect(rangeMouseMove.defaultPrevented).toBe(true);
        expect(document.getSelection().toString()).toBe('');

        getTableCell(table, 1, 1).dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 24,
            clientY: 48,
        }));

        const selectionMenu = document.querySelector('.selection-menu');
        expect(selectionMenu.style.display).toBe('block');
        expect(selectionMenu.style.position).toBe('fixed');
        expect(selectionMenu.parentElement).toBe(document.body);
        expect(selectionMenu.style.left).toBe('24px');
        expect(selectionMenu.style.top).toBe('48px');

        selectionMenu.querySelector('[data-action="copy-no-headers"]').click();
        await Promise.resolve();

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Ada\tReady\nLinus\tReview');
        expect(selectionMenu.style.display).toBe('none');
    });

    test('keeps the browser context menu when right-clicking outside the selected range', () => {
        const table = buildTable([
            ['Ada', 'Ready'],
            ['Linus', 'Review'],
        ]);
        document.body.appendChild(table);
        addTableGridInteractionAdapter(table, ['name', 'status'], []);

        const contextMenuEvent = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 24,
            clientY: 48,
        });
        getTableCell(table, 1, 1).dispatchEvent(contextMenuEvent);

        expect(contextMenuEvent.defaultPrevented).toBe(false);
        expect(document.querySelector('.selection-menu')).toBeNull();
    });

    test.each(['editing', 'native text', 'unselected'])('preserves browser copying for %s', (mode) => {
        const table = buildTable([['Ada', 'Ready']]);
        document.body.appendChild(table);
        addTableGridInteractionAdapter(table, ['name', 'status'], [{ name: 'Ada', status: 'Ready' }]);
        const cell = getTableCell(table, 0, 0);
        if (mode !== 'unselected') {
            cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
            cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        }
        if (mode === 'editing') {
            cell.classList.add('editing');
            cell.innerHTML = '<input value="draft">';
        }
        if (mode === 'native text') selectCellText(cell);
        const event = new Event('copy', { bubbles: true, cancelable: true });
        const setData = vi.fn();
        Object.defineProperty(event, 'clipboardData', { value: { setData } });
        (cell.querySelector('input') || cell).dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(setData).not.toHaveBeenCalled();
        document.getSelection().removeAllRanges();
    });

    test('extends the anchor vertically with Shift while leaving same-cell text selection available', () => {
        const table = buildTable([
            ['Ada', 'Ready'],
            ['Linus', 'Review'],
            ['Grace', 'Done'],
        ]);
        document.body.appendChild(table);
        addTableGridInteractionAdapter(table, ['name', 'status'], []);

        const ordinaryMouseDown = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
        });
        getTableCell(table, 0, 1).dispatchEvent(ordinaryMouseDown);

        selectCellText(getTableCell(table, 0, 1));
        const sameCellMouseMove = new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            buttons: 1,
        });
        getTableCell(table, 0, 1).dispatchEvent(sameCellMouseMove);

        expect(sameCellMouseMove.defaultPrevented).toBe(false);
        expect(document.getSelection().toString()).toBe('Ready');
        table.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        expect(ordinaryMouseDown.defaultPrevented).toBe(false);

        const shiftMouseDown = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            shiftKey: true,
        });
        getTableCell(table, 2, 1).dispatchEvent(shiftMouseDown);
        table.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        expect(shiftMouseDown.defaultPrevented).toBe(true);
        expect(table.querySelectorAll('td.table_data_cell.selected')).toHaveLength(3);
        expect(getTableCell(table, 0, 1).classList.contains('selected')).toBe(true);
        expect(getTableCell(table, 1, 1).classList.contains('selected')).toBe(true);
        expect(getTableCell(table, 2, 1).classList.contains('selected')).toBe(true);
        expect(getTableCell(table, 1, 0).classList.contains('selected')).toBe(false);
    });
});

function buildTable(rows) {
    const table = document.createElement('table');
    table.classList.add('table_from_db');
    const tbody = document.createElement('tbody');

    rows.forEach((rowValues, rowIndex) => {
        const row = document.createElement('tr');
        rowValues.forEach((value, columnIndex) => {
            const cell = document.createElement('td');
            cell.classList.add('table_data_cell');
            cell.dataset.rowIndex = String(rowIndex);
            cell.dataset.colIndex = String(columnIndex);
            cell.dataset.column = columnIndex === 0 ? 'name' : 'status';
            cell.textContent = value;
            row.appendChild(cell);
        });
        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    return table;
}

function getTableCell(table, rowIndex, columnIndex) {
    return table.querySelector(
        `td.table_data_cell[data-row-index='${rowIndex}'][data-col-index='${columnIndex}']`
    );
}

function selectCellText(cell) {
    const range = document.createRange();
    range.selectNodeContents(cell);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
}

function dispatchCopy(target) {
    const event = new Event('copy', { bubbles: true, cancelable: true });
    const setData = vi.fn();
    Object.defineProperty(event, 'clipboardData', { value: { setData } });
    target.dispatchEvent(event);
    return { event, setData };
}
