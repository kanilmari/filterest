// @vitest-environment jsdom
// table_component_builder.test.js
// Verifies TableComponent selection and copy behavior through the shared grid interaction layer.
// Bridges rendered div-list cells, context-menu events, and clipboard payloads.
// Exists to keep list-view range selection stable while table/list interaction code is unified.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const editCellMock = vi.hoisted(() => vi.fn());

vi.mock('../dev_tools/function_counter.js', () => ({
    count_this_function: vi.fn(),
}));

vi.mock('../function_access_checker.js', () => ({
    logAndCheckAccess: vi.fn(),
}));

vi.mock('../lang/translation_handler.js', () => ({
    getTranslationForKey: (key) => key,
}));

vi.mock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showErrorToast: vi.fn(),
    showSuccessToast: vi.fn(),
}));

vi.mock('../general_tables/gt_1_row_crud/gt_1_3_row_update/cell_editor.js', () => ({
    editCell: editCellMock,
}));

import { TableComponent } from './table_component_builder.js';
import { refreshLocalizedDatasetValues } from './dataset_value_localizer.js';

describe('TableComponent shared grid interactions', () => {
    beforeEach(() => {
        editCellMock.mockClear();
        document.body.replaceChildren();
        localStorage.clear();
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });
    });

    test('selects a rectangular range from nested cell content and copies via the context menu', async () => {
        const tableComponent = new TableComponent({
            table_name: 'people',
            initialView: 'normal',
            headers: [
                { key: 'name', label: 'Name' },
                { key: 'status', label: 'Status' },
            ],
            data: [
                { name: 'Ada', status: 'Ready' },
                { name: 'Linus', status: 'Review' },
            ],
        });
        document.body.appendChild(tableComponent.getElement());

        getCellContent(1, 0).dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            button: 0,
        }));
        getCellContent(2, 1).dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true,
            buttons: 1,
        }));
        tableComponent.getElement().dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
        }));

        expect(document.querySelectorAll('.cell.selected')).toHaveLength(4);

        getCellContent(2, 1).dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 40,
            clientY: 80,
        }));

        const selectionMenu = document.querySelector('.selection-menu');
        expect(selectionMenu.style.display).toBe('block');
        expect(selectionMenu.style.left).toBe('40px');
        expect(selectionMenu.style.top).toBe('80px');
        expect(editCellMock).not.toHaveBeenCalled();

        selectionMenu.querySelector('[data-action="copy-no-headers"]').click();
        await Promise.resolve();

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Ada,Ready\nLinus,Review');
    });

    test('starts inline editing for a div-list cell with normalized row and column metadata', () => {
        const dataTypes = { status: { data_type: 'text' } };
        const tableComponent = new TableComponent({
            table_name: 'people',
            initialView: 'normal',
            dataTypes,
            headers: [
                { key: 'name', label: 'Name' },
                { key: 'status', label: 'Status' },
            ],
            data: [
                { id: 1, name: 'Ada', status: 'Ready' },
            ],
        });
        document.body.appendChild(tableComponent.getElement());

        const editableCell = getCell(1, 1);
        delete editableCell.dataset.rowIndex;
        delete editableCell.dataset.colIndex;
        delete editableCell.dataset.column;

        getCellContent(1, 1).dispatchEvent(new MouseEvent('dblclick', {
            bubbles: true,
            cancelable: true,
        }));

        expect(editCellMock).toHaveBeenCalledTimes(1);
        const [cell, columns, visibleData, receivedDataTypes, tableName] = editCellMock.mock.calls[0];
        expect(cell.dataset.rowIndex).toBe('0');
        expect(cell.dataset.colIndex).toBe('1');
        expect(cell.dataset.column).toBe('status');
        expect(columns).toEqual(['name', 'status']);
        expect(visibleData).toEqual([{ id: 1, name: 'Ada', status: 'Ready' }]);
        expect(receivedDataTypes).toBe(dataTypes);
        expect(tableName).toBe('people');
    });

    test('starts inline editing for a focused div-list cell with F2', () => {
        const tableComponent = new TableComponent({
            table_name: 'people',
            initialView: 'normal',
            headers: [
                { key: 'name', label: 'Name' },
                { key: 'status', label: 'Status' },
            ],
            data: [
                { id: 1, name: 'Ada', status: 'Ready' },
            ],
        });
        document.body.appendChild(tableComponent.getElement());

        const editableCell = getCell(1, 0);
        editableCell.focus();
        editableCell.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'F2',
        }));

        expect(editCellMock).toHaveBeenCalledTimes(1);
        expect(editCellMock.mock.calls[0][0]).toBe(editableCell);
    });

    test('starts inline editing when an already selected list cell is clicked again', () => {
        const tableComponent = new TableComponent({
            table_name: 'people',
            initialView: 'normal',
            headers: [
                { key: 'name', label: 'Name' },
            ],
            data: [
                { id: 1, name: 'Ada' },
            ],
        });
        document.body.appendChild(tableComponent.getElement());

        const cellContent = getCellContent(1, 0);
        cellContent.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            button: 0,
        }));
        cellContent.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            button: 0,
        }));
        cellContent.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            button: 0,
        }));
        cellContent.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            button: 0,
        }));

        expect(editCellMock).toHaveBeenCalledTimes(1);
        expect(editCellMock.mock.calls[0][0].dataset.column).toBe('name');
    });

    test('starts inline editing for a focused list cell with Enter', () => {
        const tableComponent = new TableComponent({
            table_name: 'people',
            initialView: 'normal',
            headers: [
                { key: 'name', label: 'Name' },
            ],
            data: [
                { id: 1, name: 'Ada' },
            ],
        });
        document.body.appendChild(tableComponent.getElement());

        getCellContent(1, 0).dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'Enter',
        }));

        expect(editCellMock).toHaveBeenCalledTimes(1);
        expect(editCellMock.mock.calls[0][0].dataset.column).toBe('name');
    });

    test('moves list-cell focus with shared arrow-key coordinate navigation', () => {
        const tableComponent = new TableComponent({
            table_name: 'people',
            initialView: 'normal',
            headers: [
                { key: 'name', label: 'Name' },
                { key: 'status', label: 'Status' },
            ],
            data: [
                { id: 1, name: 'Ada', status: 'Ready' },
            ],
        });
        document.body.appendChild(tableComponent.getElement());

        getCellContent(1, 0).dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'ArrowRight',
        }));

        expect(getCell(1, 1).classList.contains('selected')).toBe(true);
        expect(document.activeElement).toBe(getCell(1, 1));
        expect(editCellMock).not.toHaveBeenCalled();
    });

    test('normal list selection uses zero-based shared coordinates while preserving visible copy text', async () => {
        const tableComponent = new TableComponent({
            table_name: 'people',
            initialView: 'normal',
            headers: [
                { key: 'name', label: 'Name' },
                { key: 'status', label: 'Status' },
            ],
            data: [
                { name: 'Ada', status: 'Ready' },
                { name: 'Linus', status: 'Review' },
            ],
        });
        document.body.appendChild(tableComponent.getElement());

        getCellContent(1, 0).dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            button: 0,
        }));
        getCellContent(2, 1).dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true,
            buttons: 1,
        }));
        tableComponent.getElement().dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
        }));

        expect(tableComponent.getSelectedRange()).toMatchObject({
            minRowIndex: 0,
            maxRowIndex: 1,
            minColumnIndex: 0,
            maxColumnIndex: 1,
        });

        getCellContent(2, 1).dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 40,
            clientY: 80,
        }));
        document.querySelector('.selection-menu [data-action="copy-no-headers"]').click();
        await Promise.resolve();

        expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('Ada,Ready\nLinus,Review');
    });

    test('comparison selection copies selected cells through the shared copy payload builder', async () => {
        const tableComponent = new TableComponent({
            table_name: 'people',
            initialView: 'transposed',
            headers: [
                { key: 'name', label: 'Name' },
                { key: 'status', label: 'Status' },
            ],
            data: [
                { name: 'Ada', status: 'Ready' },
                { name: 'Linus', status: 'Review' },
            ],
        });
        document.body.appendChild(tableComponent.getElement());

        getCellContent(0, 1).dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            button: 0,
        }));
        getCellContent(1, 2).dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true,
            buttons: 1,
        }));
        tableComponent.getElement().dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
        }));

        expect(tableComponent.getSelectedRange()).toMatchObject({
            minRowIndex: 0,
            maxRowIndex: 1,
            minColumnIndex: 1,
            maxColumnIndex: 2,
        });

        getCellContent(1, 2).dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 52,
            clientY: 84,
        }));
        expect(tableComponent.selectionMenuPayload.copyActions[1].payload.text).toBe('Ada,Linus\nReady,Review');
        document.querySelector('.selection-menu [data-action="copy-no-headers"]').click();
        await Promise.resolve();

        expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('Ada,Linus\nReady,Review');
    });

    test('comparison copy with headers preserves row labels while using shared selected-cell payloads', async () => {
        const tableComponent = new TableComponent({
            table_name: 'people',
            initialView: 'transposed',
            headers: [
                { key: 'name', label: 'Name' },
                { key: 'status', label: 'Status' },
            ],
            data: [
                { name: 'Ada', status: 'Ready' },
                { name: 'Linus', status: 'Review' },
            ],
        });
        document.body.appendChild(tableComponent.getElement());

        getCellContent(0, 1).dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            button: 0,
        }));
        getCellContent(1, 2).dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true,
            buttons: 1,
        }));
        tableComponent.getElement().dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
        }));

        getCellContent(1, 2).dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 52,
            clientY: 84,
        }));
        expect(tableComponent.selectionMenuPayload.copyActions[0].payload.text).toBe('Name,Ada,Linus\nStatus,Ready,Review');
        document.querySelector('.selection-menu [data-action="copy-headers"]').click();
        await Promise.resolve();

        expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('Name,Ada,Linus\nStatus,Ready,Review');
    });

    test('moves comparison-cell focus with shared arrow-key coordinate navigation', () => {
        const tableComponent = new TableComponent({
            table_name: 'people',
            initialView: 'transposed',
            headers: [
                { key: 'name', label: 'Name' },
                { key: 'status', label: 'Status' },
            ],
            data: [
                { name: 'Ada', status: 'Ready' },
                { name: 'Linus', status: 'Review' },
            ],
        });
        document.body.appendChild(tableComponent.getElement());

        const firstDataCell = getCell(0, 1);
        firstDataCell.focus();
        firstDataCell.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'ArrowRight',
        }));

        expect(getCell(0, 2).classList.contains('selected')).toBe(true);
        expect(document.activeElement).toBe(getCell(0, 2));

        getCell(0, 2).dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'ArrowDown',
        }));

        expect(getCell(1, 2).classList.contains('selected')).toBe(true);
        expect(document.activeElement).toBe(getCell(1, 2));
        expect(editCellMock).not.toHaveBeenCalled();
    });

    test('keeps comparison arrow navigation anchored after mouse selection', () => {
        const tableComponent = new TableComponent({
            table_name: 'people',
            initialView: 'transposed',
            headers: [
                { key: 'name', label: 'Name' },
            ],
            data: [
                { name: 'Ada' },
                { name: 'Linus' },
            ],
        });
        document.body.appendChild(tableComponent.getElement());

        getCellContent(0, 1).dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            button: 0,
        }));
        tableComponent.getElement().dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
        }));

        expect(document.activeElement).toBe(getCell(0, 1));
        expect(getCell(0, 1).classList.contains('selected')).toBe(true);

        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'ArrowRight',
        }));

        expect(getCell(0, 2).classList.contains('selected')).toBe(true);
        expect(document.activeElement).toBe(getCell(0, 2));
    });

    test('does not reopen list editing when Enter bubbles from an active editor input', () => {
        editCellMock.mockImplementationOnce((cell) => {
            cell.classList.add('editing');
            const input = document.createElement('input');
            input.classList.add('table-editor-input');
            input.dataset.testid = 'table-editor';
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    cell.classList.remove('editing');
                    cell.replaceChildren(document.createTextNode(input.value));
                }
            });
            cell.replaceChildren(input);
        });

        const tableComponent = new TableComponent({
            table_name: 'people',
            initialView: 'normal',
            headers: [
                { key: 'name', label: 'Name' },
            ],
            data: [
                { id: 1, name: 'Ada' },
            ],
        });
        document.body.appendChild(tableComponent.getElement());

        getCellContent(1, 0).dispatchEvent(new MouseEvent('dblclick', {
            bubbles: true,
            cancelable: true,
        }));

        const editorInput = document.querySelector('[data-testid="table-editor"]');
        editorInput.value = 'Grace';
        editorInput.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
        }));

        expect(editCellMock).toHaveBeenCalledTimes(1);
        expect(getCell(1, 0).classList.contains('editing')).toBe(false);
        expect(getCell(1, 0).textContent).toBe('Grace');
    });

    test('keeps an active div-list editor open when clicking inside its own editor', () => {
        editCellMock.mockImplementationOnce((cell) => {
            cell.classList.add('editing');
            const input = document.createElement('input');
            input.dataset.testid = 'inline-editor-input';
            cell.replaceChildren(input);
        });

        const tableComponent = new TableComponent({
            table_name: 'people',
            initialView: 'normal',
            headers: [
                { key: 'name', label: 'Name' },
                { key: 'status', label: 'Status' },
            ],
            data: [
                { id: 1, name: 'Ada', status: 'Ready' },
            ],
        });
        document.body.appendChild(tableComponent.getElement());

        getCellContent(1, 1).dispatchEvent(new MouseEvent('dblclick', {
            bubbles: true,
            cancelable: true,
        }));

        const editorInput = document.querySelector('[data-testid="inline-editor-input"]');
        editorInput.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            button: 0,
        }));

        expect(editorInput.isConnected).toBe(true);
        expect(getCell(1, 1).classList.contains('editing')).toBe(true);
        expect(document.querySelectorAll('.cell.selected')).toHaveLength(0);
    });

    test.each([
        ['normal', () => getCellContent(1, 0)?.textContent],
        ['transposed', () => getCellContent(0, 1)?.textContent],
        ['ticket', () => document.querySelector('.ticket span:not(.label)')?.textContent.trim()],
    ])('shows only the active language in the initial %s layout', (initialView, readVisibleValue) => {
        localStorage.setItem('chosen_language', 'fi');
        const rawMultilingualValue = JSON.stringify({
            en: 'Service people can trust',
            fi: 'Palvelu, johon ihmiset voivat luottaa',
        });
        const tableComponent = createMultilingualTableComponent(initialView, [
            { id: 1, title: rawMultilingualValue },
        ]);
        document.body.appendChild(tableComponent.getElement());

        expect(readVisibleValue()).toBe('Palvelu, johon ihmiset voivat luottaa');
        expect(tableComponent.data[0].title).toBe(rawMultilingualValue);
        expect(document.body.textContent).not.toContain('"en"');
    });

    test.each([
        ['normal', () => getCellContent(1, 0)?.textContent],
        ['transposed', () => getCellContent(0, 1)?.textContent],
        ['ticket', () => document.querySelector('.ticket')?.textContent],
    ])('localizes newly appended rows in the %s layout', async (initialView, readVisibleValue) => {
        localStorage.setItem('chosen_language', 'fi');
        const rawMultilingualValue = JSON.stringify({
            en: 'New service',
            fi: 'Uusi palvelu',
        });
        const tableComponent = createMultilingualTableComponent(initialView, []);
        document.body.appendChild(tableComponent.getElement());

        tableComponent.appendData([{ id: 2, title: rawMultilingualValue }]);

        expect(readVisibleValue()).toContain('Uusi palvelu');
        expect(readVisibleValue()).not.toContain('"en"');
        expect(tableComponent.data[0].title).toBe(rawMultilingualValue);

        await refreshLocalizedDatasetValues('en');

        expect(readVisibleValue()).toContain('New service');
        expect(tableComponent.data[0].title).toBe(rawMultilingualValue);
    });

    test.each([
        ['normal', () => getCellContent(1, 0)?.textContent],
        ['transposed', () => getCellContent(0, 1)?.textContent],
        ['ticket', () => document.querySelector('.ticket')?.textContent],
    ])('refreshes mounted %s values without refetching or mutating raw data', async (initialView, readVisibleValue) => {
        localStorage.setItem('chosen_language', 'fi');
        const rawMultilingualValue = JSON.stringify({
            en: 'English value',
            fi: 'Suomenkielinen arvo',
        });
        const row = { id: 3, title: rawMultilingualValue };
        const tableComponent = createMultilingualTableComponent(initialView, [row]);
        document.body.appendChild(tableComponent.getElement());

        await refreshLocalizedDatasetValues('en');

        expect(readVisibleValue()).toContain('English value');
        expect(readVisibleValue()).not.toContain('Suomenkielinen arvo');
        expect(row.title).toBe(rawMultilingualValue);
        expect(tableComponent.data[0]).toBe(row);
    });

    test('keeps explicitly non-multilingual JSON intact across language refreshes', async () => {
        localStorage.setItem('chosen_language', 'fi');
        const ordinaryJsonValue = { name: 'Service', type: 'internal' };
        const expectedJsonText = JSON.stringify(ordinaryJsonValue);
        const tableComponent = new TableComponent({
            table_name: 'services',
            initialView: 'normal',
            headers: [{ key: 'metadata', label: 'Metadata' }],
            data: [{ id: 4, metadata: ordinaryJsonValue }],
            dataTypes: {
                metadata: { data_type: 'jsonb', is_multilingual: false },
            },
        });
        document.body.appendChild(tableComponent.getElement());

        expect(getCellContent(1, 0)?.textContent).toBe(expectedJsonText);

        await refreshLocalizedDatasetValues('en');

        expect(getCellContent(1, 0)?.textContent).toBe(expectedJsonText);
        expect(tableComponent.data[0].metadata).toBe(ordinaryJsonValue);
    });
});

function createMultilingualTableComponent(initialView, data) {
    return new TableComponent({
        table_name: 'services',
        initialView,
        headers: [{ key: 'title', label: 'Title' }],
        data,
        dataTypes: {
            title: { data_type: 'text', is_multilingual: true },
        },
    });
}

function getCell(rowIndex, columnIndex) {
    return document.querySelector(
        `.cell[data-row='${rowIndex}'][data-col='${columnIndex}']`
    );
}

function getCellContent(rowIndex, columnIndex) {
    return document.querySelector(
        `.cell[data-row='${rowIndex}'][data-col='${columnIndex}'] .cell-content`
    );
}
