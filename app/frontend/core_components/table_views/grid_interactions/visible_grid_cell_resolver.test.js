// @vitest-environment jsdom
// visible_grid_cell_resolver.test.js
// Proves visibility filtering and empty-cell preservation through list/comparison copying.
// Bridges rendered DOM fields, shared payload construction and clipboard actions.
// Keeps headers aligned, empty cells in place and stale menus from exposing hidden fields.

import { beforeEach, describe, expect, test, vi } from 'vitest';
vi.mock('../../dev_tools/function_counter.js', () => ({ count_this_function: vi.fn() }));
vi.mock('../../function_access_checker.js', () => ({ logAndCheckAccess: vi.fn() }));
vi.mock('../../lang/translation_handler.js', () => ({ getTranslationForKey: key => key }));
vi.mock('../../general_tables/gt_1_row_crud/gt_1_3_row_update/cell_editor.js', () => ({ editCell: vi.fn() }));
vi.mock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showErrorToast: vi.fn(), showSuccessToast: vi.fn(),
}));
import { TableComponent } from '../table_component_builder.js';
import { createVisibleGridCellResolver } from './visible_grid_cell_resolver.js';

describe('visible grid copy consumers', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        localStorage.clear();
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) },
        });
    });

    const emptyCellCases = [
        { position: 'leading', values: ['', 'filled'], rowsText: '\nfilled', columnsText: ',filled' },
        { position: 'trailing', values: ['filled', ''], rowsText: 'filled\n', columnsText: 'filled,' },
        { position: 'middle', values: ['first', '', 'last'], rowsText: 'first\n\nlast', columnsText: 'first,,last' },
        { position: 'only', values: ['', ''], rowsText: '\n', columnsText: ',' },
        { position: 'single', values: [''], rowsText: '', columnsText: '' },
    ];
    const blankFormats = [
        { kind: 'empty', blank: '', language: 'en' },
        { kind: 'plain whitespace', blank: '   ', language: 'en' },
        { kind: 'multilingual whitespace', blank: { en: '   ', fi: '   ' }, language: 'en' },
        { kind: 'multilingual whitespace', blank: { en: '   ', fi: '   ' }, language: 'fi' },
    ];
    const cellCases = emptyCellCases.flatMap(emptyCase => blankFormats.map(format => ({
        ...emptyCase, ...format, inputValues: emptyCase.values.map(value => value === '' ? format.blank : value),
    })));
    // Plain values are already trimmed by rendering; localized nonblank values retain
    // their edge/inner whitespace. Keep both contracts independently of blank cleanup.
    for (const language of ['en', 'fi']) {
        const localizedText = language === 'en' ? ' \tleft  middle\nright \t ' : ' \tvasen  keski\noikea \t ';
        cellCases.push({
            position: 'formatted', kind: 'nonblank', language,
            inputValues: [' \tfirst  second\nthird \t ', {
                en: ' \tleft  middle\nright \t ', fi: ' \tvasen  keski\noikea \t ',
            }],
            values: ['first  second\nthird', localizedText],
            rowsText: `first  second\nthird\n${localizedText}`,
            columnsText: `first  second\nthird,${localizedText}`,
        });
    }
    const copyCases = ['normal', 'transposed'].flatMap(view =>
        ['direct', 'menu'].flatMap(copyPath =>
            ['rows', 'columns'].flatMap(axis =>
                [false, true].flatMap(withHeaders =>
                    cellCases.map(cellCase => ({ ...cellCase, view, copyPath, axis, withHeaders }))))));

    test.each(copyCases)(
        '$view $copyPath copy preserves $position $kind cells across $axis (headers: $withHeaders, language: $language)',
        ({ inputValues, values, rowsText, columnsText, language, view, copyPath, axis, withHeaders }) => {
            localStorage.setItem('chosen_language', language);
            const matrix = axis === 'rows' ? inputValues.map(value => [value]) : [inputValues];
            const fieldCount = view === 'normal' ? matrix[0].length : matrix.length;
            const recordCount = view === 'normal' ? matrix.length : matrix[0].length;
            const headers = Array.from({ length: fieldCount }, (_, index) => ({
                key: `field_${index}`, label: `Field ${index + 1}`,
            }));
            const data = Array.from({ length: recordCount }, (_, recordIndex) => Object.fromEntries(
                headers.map(({ key }, fieldIndex) => [key, view === 'normal'
                    ? matrix[recordIndex][fieldIndex] : matrix[fieldIndex][recordIndex]])
            ));
            const component = new TableComponent({ table_name: 'people', initialView: view, headers, data });
            document.body.appendChild(component.getElement());
            try {
                const first = view === 'normal' ? getCell(1, 0) : getCell(0, 1);
                const last = view === 'normal'
                    ? getCell(matrix.length, matrix[0].length - 1)
                    : getCell(matrix.length - 1, matrix[0].length);
                first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
                last.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1 }));
                component.getElement().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

                let expected = axis === 'rows' ? rowsText : columnsText;
                if (withHeaders) {
                    expected = view === 'normal'
                        ? `${headers.map(header => header.label).join(',')}\n${expected}`
                        : axis === 'rows'
                            ? values.map((value, index) => `Field ${index + 1},${value}`).join('\n')
                            : `Field 1,${expected}`;
                }
                if (copyPath === 'menu') {
                    last.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
                    document.querySelector(`[data-action="${withHeaders ? 'copy-headers' : 'copy-no-headers'}"]`).click();
                } else {
                    // Exercise direct copying without a prepared context-menu payload.
                    expect(component.selectionMenuPayload).toBeNull();
                    component.copySelected(withHeaders);
                }
                // Check the clipboard boundary, including every leading/trailing separator.
                expect(navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(expected);
            } finally {
                component.destroy();
            }
        }
    );

    test.each(['normal', 'transposed'])('%s menu rechecks hidden fields when an action is clicked', (view) => {
        const component = new TableComponent({
            table_name: 'people', initialView: view,
            headers: [{ key: 'left', label: 'Left' }, { key: 'hidden', label: 'HIDDEN-HEADER' }],
            data: [{ left: 'left', hidden: 'HIDDEN-VALUE' }],
        });
        document.body.appendChild(component.getElement());
        try {
            const first = view === 'normal' ? getCell(1, 0) : getCell(0, 1);
            const last = getCell(1, 1);
            first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
            last.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1 }));
            component.getElement().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            for (const withHeaders of [false, true]) {
                last.hidden = false;
                last.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
                last.hidden = true;
                document.querySelector(`[data-action="${withHeaders ? 'copy-headers' : 'copy-no-headers'}"]`).click();
                expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
                    withHeaders ? view === 'normal' ? 'Left\nleft' : 'Left,left' : 'left'
                );
            }
        } finally {
            component.destroy();
        }
    });

    test.each(['normal', 'transposed'])('%s copy omits hidden fields with matching labels in menus and direct copy', (view) => {
        const component = new TableComponent({
            table_name: 'people', initialView: view,
            headers: [
                { key: 'left', label: 'Left' }, { key: 'hidden', label: 'HIDDEN-HEADER' },
                { key: 'right', label: 'Right' },
            ],
            data: [{ left: 'left', hidden: 'HIDDEN-VALUE', right: 'right' }],
        });
        document.body.appendChild(component.getElement());
        try {
            const first = view === 'normal' ? getCell(1, 0) : getCell(0, 1);
            const last = view === 'normal' ? getCell(1, 2) : getCell(2, 1);
            getCell(1, 1).style.display = 'none';
            if (view === 'transposed') getCell(1, 0).style.display = 'none';
            first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
            last.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1 }));
            component.getElement().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            for (const withHeaders of [false, true]) {
                const expected = view === 'normal'
                    ? `${withHeaders ? 'Left,Right\n' : ''}left,right`
                    : withHeaders ? 'Left,left\nRight,right' : 'left\nright';
                // Covers the fallback path used without a prepared context-menu payload.
                component.copySelected(withHeaders);
                expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(expected);
                last.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
                const payload = component.selectionMenuPayload.copyActions[withHeaders ? 0 : 1].payload;
                expect(payload.text).toBe(expected);
                document.querySelector(`[data-action="${withHeaders ? 'copy-headers' : 'copy-no-headers'}"]`).click();
                expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(expected);
            }
        } finally {
            component.destroy();
        }
    });

});

describe('visible grid cell whitespace formatting', () => {
    const textCases = [
        { text: '', blank: true },
        { text: '   ', blank: true },
        { text: ' \t\n\u00a0 ', blank: true },
        { text: ' \tfirst  second\nthird \t ', blank: false },
    ];
    test.each([false, true].flatMap(trim => textCases.map(textCase => ({ ...textCase, trim }))))(
        'normalizes blank: $blank while respecting cell trim: $trim for "$text"',
        ({ text, blank, trim }) => {
            const cell = document.createElement('div');
            cell.textContent = text;
            document.body.appendChild(cell);
            try {
                const resolver = createVisibleGridCellResolver(() => cell, { trim });
                const expected = blank ? '' : trim ? 'first  second\nthird' : text;
                expect(resolver({ rowIndex: 0, columnIndex: 0 })).toBe(expected);
            } finally {
                cell.remove();
            }
        }
    );
});

function getCell(rowIndex, columnIndex) {
    return document.querySelector(`.cell[data-row="${rowIndex}"][data-col="${columnIndex}"]`);
}
