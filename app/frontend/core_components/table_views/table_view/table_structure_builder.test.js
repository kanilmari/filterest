// table_structure_builder.test.js
// Verifies table-view cell and row resize affordances under jsdom.
// Bridges table_structure_builder.js DOM factories with mocked table-state dependencies and drag events.
// Exists to keep the manual 1..60 line resize range and row-edge grip stable during table rendering changes.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DATE_TIME_DISPLAY_SEPARATOR } from '../timestamp_display_formatter.js';
import { buildSortOptions } from '../../filterbar/top_row_buttons/sort_dropdown_builder_helpers.js';

function displayDateTime(dateText, timeText) {
    return `${dateText}${DATE_TIME_DISPLAY_SEPARATOR}${timeText}`;
}

const toggleSelectAllMock = vi.fn();
const updateRowSelectionMock = vi.fn();
const updateRowSelectionFromClickMock = vi.fn();
const addEventListenersToCellsMock = vi.fn();
const initializeColumnResizingMock = vi.fn();
const getUnifiedTableStateMock = vi.fn();
const setUnifiedTableStateMock = vi.fn();
const refreshTableUnifiedMock = vi.fn();
const makeColumnClassMock = vi.fn();
const emitDatasetSortSelectionMock = vi.fn();
const getParamsMock = vi.fn();
const setParamsMock = vi.fn();
const updateURLMock = vi.fn();
const endpointRouterMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: endpointRouterMock }));
    vi.doMock('./row_selection_handler.js', () => ({
        toggle_select_all: toggleSelectAllMock,
        update_row_selection: updateRowSelectionMock,
        update_row_selection_from_click: updateRowSelectionFromClickMock,
    }));
    vi.doMock('./table_cell_event_handler.js', () => ({
        addEventListenersToCells: addEventListenersToCellsMock,
    }));
    vi.doMock('./column_resize_handler.js', () => ({
        initialize_column_resizing: initializeColumnResizingMock,
    }));
    vi.doMock('../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', () => ({
        getUnifiedTableState: getUnifiedTableStateMock,
        setUnifiedTableState: setUnifiedTableStateMock,
        refreshTableUnified: refreshTableUnifiedMock,
    }));
    vi.doMock('../../filterbar/filter_list/column_visibility_handler.js', () => ({
        makeColumnClass: makeColumnClassMock,
    }));
    vi.doMock('../../filterbar/top_row_buttons/sort_sync_state.js', () => ({
        emitDatasetSortSelection: emitDatasetSortSelectionMock,
    }));
    vi.doMock('../../navigation/nav_engine/query_params.js', () => ({
        getParams: getParamsMock,
        setParams: setParamsMock,
        updateURL: updateURLMock,
    }));
    return import('./table_structure_builder.js');
}

describe('table_structure_builder resize affordances', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        toggleSelectAllMock.mockReset();
        updateRowSelectionMock.mockReset();
        updateRowSelectionFromClickMock.mockReset();
        addEventListenersToCellsMock.mockReset();
        initializeColumnResizingMock.mockReset();
        getUnifiedTableStateMock.mockReset();
        setUnifiedTableStateMock.mockReset();
        refreshTableUnifiedMock.mockReset();
        makeColumnClassMock.mockReset();
        emitDatasetSortSelectionMock.mockReset();
        getParamsMock.mockReset();
        setParamsMock.mockReset();
        updateURLMock.mockReset();
        endpointRouterMock.mockReset();
        delete window.translationPromises;

        getUnifiedTableStateMock.mockReturnValue({
            filters: {},
            sort: { column: null, direction: null },
        });
        getParamsMock.mockReturnValue({});
        makeColumnClassMock.mockImplementation((tableName, columnName) => `${tableName}-${columnName}`);
    });

    test('column sorting keeps URL, shared state, dropdown event, and refresh aligned', async () => {
        const state = { filters: {}, sort: { column: null, direction: null } };
        getUnifiedTableStateMock.mockReturnValue(state);
        getParamsMock.mockReturnValue({ search: 'release' });
        const { create_table_element } = await loadModule();
        const table = create_table_element(['created'], [], 'system_db_version', {
            created: { data_type: 'timestamp' },
        });

        table.querySelector('[data-testid="column-sort-created"]').click();

        expect(state.sort).toEqual({ column: 'created', direction: 'ASC' });
        expect(setParamsMock).toHaveBeenCalledWith('system_db_version', {
            search: 'release',
            sort_column: 'created',
            sort_order: 'ASC',
        });
        expect(updateURLMock).toHaveBeenCalledWith(
            'system_db_version',
            expect.objectContaining({ sort_column: 'created', sort_order: 'ASC' }),
            undefined,
            { replace: true },
        );
        expect(emitDatasetSortSelectionMock).toHaveBeenCalledWith(
            'system_db_version',
            'created:ASC',
        );
        expect(refreshTableUnifiedMock).toHaveBeenCalledWith(
            'system_db_version',
            { skipUrlParams: true },
        );
    });

    test.each([
        ['created', ['created', 'created_at', 'applied_at', 'id', 'name']],
        ['created_at', ['created_at', 'applied_at', 'id', 'name']],
        ['applied_at', ['applied_at', 'id', 'name']],
        ['id', ['id', 'name']],
    ])('Newest marks only the server-reported %s column', async (column, columns) => {
        getUnifiedTableStateMock.mockReturnValue({ sort: { column: '__newest', direction: 'DESC' } });
        const { create_table_element } = await loadModule();
        const table = create_table_element(columns, [], 'orders', {}, { column, direction: 'DESC' });
        const indicators = [...table.querySelectorAll('[data-testid^="column-sort-"]')];
        expect(indicators.filter(element => element.textContent === '▼')).toHaveLength(1);
        expect(table.querySelector(`[data-testid="column-sort-${column}"]`).textContent).toBe('▼');
        expect(table.querySelectorAll('[aria-sort="descending"]')).toHaveLength(1);
        expect(indicators.filter(element => element.textContent === '⇵')).toHaveLength(columns.length - 1);
    });

    test.each([null, undefined])('Newest never guesses a column without resolution (%s)', async effectiveSort => {
        getUnifiedTableStateMock.mockReturnValue({ sort: { column: '__newest', direction: 'DESC' } });
        const { create_table_element } = await loadModule();
        // Even an id-looking field must not substitute for absent server metadata.
        for (const columns of [['name', 'updated'], ['id', 'created']]) {
            const table = create_table_element(columns, [], 'orders', {}, effectiveSort);
            expect([...table.querySelectorAll('[data-testid^="column-sort-"]')]
                .every(element => element.textContent === '⇵')).toBe(true);
            expect(table.querySelector('[aria-sort]')).toBeNull();
        }
    });

    test.each([
        ['fi', 'Uusimmat: created', 'Newest: created'],
        ['en', 'Newest: created', 'Uusimmat: created'],
    ])('Newest has translated aria and title labels in %s', async (language, label, switchedLabel) => {
        localStorage.setItem('chosen_language', language);
        getUnifiedTableStateMock.mockReturnValue({ sort: { column: '__newest', direction: 'DESC' } });
        const { create_table_element, refreshTableLanguages } = await loadModule();
        // Use the real dictionary lookup with the existing dropdown key in both languages.
        endpointRouterMock.mockImplementation((_endpoint, { url_params }) => Promise.resolve({
            sort_newest: url_params === '?lang=fi' ? 'Uusimmat' : 'Newest',
        }));
        const { loadTranslationsForLanguage } = await import('../../lang/translation_handler.js');
        await Promise.all(['fi', 'en'].map(loadTranslationsForLanguage));
        const table = create_table_element(['id', 'created'], [], 'orders', {}, {
            column: 'created', direction: 'DESC',
        });
        document.body.append(table);
        const indicator = table.querySelector('[data-testid="column-sort-created"]');
        expect(indicator.title).toBe(label);
        expect(indicator.closest('th').getAttribute('aria-label')).toBe(label);
        expect(indicator.dataset.titleLangKey).toBe('sort_newest');
        expect(indicator.closest('th').dataset.ariaLabelLangKey).toBe('sort_newest');
        expect(indicator.closest('th').getAttribute('aria-sort')).toBe('descending');
        await refreshTableLanguages(language === 'fi' ? 'en' : 'fi');
        expect(indicator.title).toBe(switchedLabel);
        expect(indicator.closest('th').getAttribute('aria-label')).toBe(switchedLabel);
        expect(indicator.textContent).toBe('▼');
        expect(table.querySelector('[data-testid="column-sort-id"]').hasAttribute('aria-label')).toBe(false);
    });

    test('Newest falls back to the dropdown label when translations are unavailable', async () => {
        getUnifiedTableStateMock.mockReturnValue({ sort: { column: '__newest', direction: 'DESC' } });
        const { create_table_element } = await loadModule();
        const table = create_table_element(['created', 'id'], [], 'orders', {}, {
            column: 'created', direction: 'DESC',
        });
        const dropdownLabel = buildSortOptions([]).find(option => option.langKey === 'sort_newest').label;
        const indicator = table.querySelector('[data-testid="column-sort-created"]');
        expect(indicator.title).toBe(`${dropdownLabel}: created`);
        expect(indicator.closest('th').getAttribute('aria-label')).toBe(`${dropdownLabel}: created`);
    });

    test.each(['ASC', 'DESC'])('explicit %s sorting ignores Newest metadata', async direction => {
        getUnifiedTableStateMock.mockReturnValue({ sort: { column: 'name', direction } });
        const { create_table_element } = await loadModule();
        const table = create_table_element(['created', 'name'], [], 'orders', {}, {
            column: 'created', direction: 'DESC',
        });
        expect(table.querySelector('[data-testid="column-sort-name"]').textContent)
            .toBe(direction === 'ASC' ? '▲' : '▼');
        expect(table.querySelector('[data-testid="column-sort-created"]').textContent).toBe('⇵');
        expect(table.querySelector('[data-aria-label-lang-key]')).toBeNull();
    });

    test('clicking the Newest implementation starts the column own ASC/DESC/none cycle', async () => {
        const state = { sort: { column: '__newest', direction: 'DESC' } };
        getUnifiedTableStateMock.mockReturnValue(state);
        const { create_table_element } = await loadModule();
        const table = create_table_element(['created', 'id'], [], 'orders', {}, {
            column: 'created', direction: 'DESC',
        });
        const indicator = table.querySelector('[data-testid="column-sort-created"]');
        for (const sort of [
            { column: 'created', direction: 'ASC' },
            { column: 'created', direction: 'DESC' },
            { column: null, direction: null },
        ]) {
            indicator.click();
            expect(state.sort).toEqual(sort);
        }
        expect(emitDatasetSortSelectionMock.mock.calls.map(call => call[1]))
            .toEqual(['created:ASC', 'created:DESC', '']);
    });

    test('non-compact cells no longer render a per-cell height handle', async () => {
        const { createDataCell } = await loadModule();
        const cell = createDataCell(
            {
                notes: 'Another long text value that should remain row-resizable only.',
            },
            'notes',
            ['notes'],
            0,
            0,
            'orders'
        );

        expect(cell.classList.contains('table_data_cell--height-resizable')).toBe(true);
        expect(cell.querySelector('.table_cell_height_handle')).toBeNull();
    });

    test('timestamp cells hide seconds in the visible value and keep them in hover text', async () => {
        const { createDataCell } = await loadModule();
        const cell = createDataCell(
            {
                created: '2026-06-15T21:36:10',
            },
            'created',
            ['created'],
            0,
            0,
            'orders',
            { created: { data_type: 'timestamp with time zone' } }
        );

        expect(cell.textContent).toBe(displayDateTime('2026-06-15', '21:36'));
        expect(cell.title).toBe('2026-06-15 21:36:10');
    });

    test('multilingual cells show only the active language instead of raw JSON', async () => {
        localStorage.setItem('chosen_language', 'fi');
        const { createDataCell } = await loadModule();
        const cell = createDataCell(
            {
                title: JSON.stringify({
                    en: 'Design services people can trust',
                    fi: 'Muotoile palvelut, joihin ihmiset voivat luottaa',
                    yue: '設計大家可以信賴嘅服務',
                }),
            },
            'title',
            ['title'],
            0,
            0,
            'services',
            { title: { data_type: 'text', is_multilingual: true } }
        );

        expect(cell.textContent).toBe('Muotoile palvelut, joihin ihmiset voivat luottaa');
        expect(cell.textContent).not.toContain('{"en"');
    });

    test('multilingual cells use English as the controlled fallback when active language is absent', async () => {
        localStorage.setItem('chosen_language', 'sv');
        const { createDataCell } = await loadModule();
        const cell = createDataCell(
            { title: JSON.stringify({ fi: 'Palvelut', en: 'Services' }) },
            'title',
            ['title'],
            0,
            0,
            'services',
            { title: { data_type: 'text', is_multilingual: true } }
        );

        expect(cell.textContent).toBe('Services');
    });

    test('refreshes an existing multilingual table cell when the active language changes', async () => {
        localStorage.setItem('chosen_language', 'en');
        const { create_table_element, refreshTableLanguages } = await loadModule();
        const table = create_table_element(
            ['title'],
            [{ title: JSON.stringify({ en: 'Services', fi: 'Palvelut' }) }],
            'services',
            { title: { data_type: 'text', is_multilingual: true } }
        );
        document.body.appendChild(table);

        expect(table.querySelector('[data-column="title"]')?.textContent).toBe('Services');

        refreshTableLanguages('fi');

        expect(table.querySelector('[data-column="title"]')?.textContent).toBe('Palvelut');
    });

    test('keeps explicitly non-multilingual JSON intact', async () => {
        localStorage.setItem('chosen_language', 'fi');
        const { createDataCell } = await loadModule();
        const rawValue = JSON.stringify({ name: 'Primary', value: 'secondary' });
        const cell = createDataCell(
            { settings: rawValue },
            'settings',
            ['settings'],
            0,
            0,
            'services',
            { settings: { data_type: 'jsonb', is_multilingual: false } }
        );

        expect(cell.textContent).toBe(rawValue);
        expect(cell.dataset.localizedRawValue).toBeUndefined();
    });

    test('row-edge handle resizes every expandable cell in the row from the tallest current height', async () => {
        const { create_table_element } = await loadModule();
        const table = create_table_element(
            ['notes', 'description'],
            [{
                notes: 'Long notes value that should stay row-resizable even after being collapsed to one line.',
                description: 'Another long description value that participates in row-height resizing.',
            }],
            'orders',
            { notes: 'text', description: 'text' }
        );
        document.body.appendChild(table);

        const row = table.querySelector('tbody tr');
        const numberingCell = row.querySelector('.table_row_numbering');
        const handle = row.querySelector('.table_row_height_handle');
        const contents = Array.from(row.querySelectorAll('.table_data_cell--height-resizable .table_cell_content'));

        expect(handle).toBeTruthy();
        expect(numberingCell.classList.contains('table_row_numbering--height-resizable')).toBe(true);
        expect(contents).toHaveLength(2);

        contents[0].style.lineHeight = '20px';
        contents[0].style.fontSize = '20px';
        contents[0].style.maxHeight = '300px';
        contents[1].style.lineHeight = '20px';
        contents[1].style.fontSize = '20px';
        contents[1].style.maxHeight = '500px';

        handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 500 }));
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 380 }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientY: 380 }));

        expect(contents[0].style.maxHeight).toBe('380px');
        expect(contents[1].style.maxHeight).toBe('380px');
        expect(numberingCell.classList.contains('table_row_numbering--manually-resized')).toBe(true);
    });

    test('row resize starts from the currently visible low row height instead of the default multiline cap', async () => {
        const { create_table_element } = await loadModule();
        const table = create_table_element(
            ['notes'],
            [{
                notes: 'This row uses the multiline renderer but is still visually short.',
            }],
            'orders',
            { notes: 'text' }
        );
        document.body.appendChild(table);

        const row = /** @type {HTMLTableRowElement | null} */ (table.querySelector('tbody tr'));
        const handle = /** @type {HTMLElement | null} */ (row?.querySelector('.table_row_height_handle'));
        const content = /** @type {HTMLElement | null} */ (row?.querySelector('.table_cell_content'));

        expect(handle).not.toBeNull();
        expect(content).not.toBeNull();

        content.style.lineHeight = '20px';
        content.style.fontSize = '20px';
        vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ height: 24 });
        vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({ height: 24 });

        handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 100 }));
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 130 }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientY: 130 }));

        expect(row?.style.height).toBe('54px');
        expect(content.style.maxHeight).toBe('54px');
    });

    test('bottom row handle remains available on later rows and double-clicking it restores default heights', async () => {
        const { create_table_element } = await loadModule();
        const table = create_table_element(
            ['notes', 'description'],
            [{
                notes: 'Long notes value that should stay row-resizable.',
                description: 'Another long description value that participates in row-height resizing.',
            }, {
                notes: 'Second row long notes value that should also stay row-resizable.',
                description: 'Second row description value that should respond to the same bottom handle affordance.',
            }],
            'orders',
            { notes: 'text', description: 'text' }
        );
        document.body.appendChild(table);

        const row = /** @type {HTMLTableRowElement | null} */ (table.querySelectorAll('tbody tr')[1]);
        const numberingCell = /** @type {HTMLElement | null} */ (row?.querySelector('.table_row_numbering'));
        const bottomHandle = /** @type {HTMLElement | null} */ (row?.querySelector('.table_row_height_handle'));
        const contents = Array.from(row?.querySelectorAll('.table_data_cell--height-resizable .table_cell_content') || []);

        expect(bottomHandle).toBeTruthy();
        expect(row?.querySelector('.table_row_height_gutter_handle')).toBeNull();
        expect(contents).toHaveLength(2);

        row.style.height = '220px';
        Array.from(row?.cells || []).forEach((cell) => {
            cell.style.height = '220px';
        });
        contents.forEach((content) => {
            content.style.lineHeight = '20px';
            content.style.fontSize = '20px';
            content.style.maxHeight = '220px';
        });

        bottomHandle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 220 }));
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 320 }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientY: 320 }));

        expect(row?.style.height).toBe('320px');
        expect(Array.from(row?.cells || []).every((cell) => cell.style.height === '320px')).toBe(true);
        expect(contents[0].style.maxHeight).toBe('320px');
        expect(numberingCell.classList.contains('table_row_numbering--manually-resized')).toBe(true);

        bottomHandle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

        expect(row?.style.height).toBe('');
        expect(Array.from(row?.cells || []).every((cell) => cell.style.height === '')).toBe(true);
        expect(contents[0].style.maxHeight).toBe('');
        expect(contents[1].style.maxHeight).toBe('');
        expect(numberingCell.classList.contains('table_row_numbering--manually-resized')).toBe(false);
    });
});
