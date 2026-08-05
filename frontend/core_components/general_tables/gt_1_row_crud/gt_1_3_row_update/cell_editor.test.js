// cell_editor.test.js
// Verifies inline cell editors render, compare, and submit values through the routed update endpoint.
// Bridges jsdom table/list cells with editor events and endpoint-router mocks.
// Exists to prevent duplicate writes and preserve type-specific edit behavior.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
const selectCellMock = vi.fn();

vi.mock('../../../table_views/table_view/table_cell_handler.js', () => ({
    selectCell: selectCellMock,
}));

vi.mock('../gt_1_1_row_create/row_api_fetcher.js', () => ({
    fetchReferencedData: vi.fn(),
}));

vi.mock('../../../endpoints/endpoint_router.js', () => ({
    endpoint_router: endpointRouterMock,
}));

vi.mock('../../../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showWarningToast: vi.fn(),
}));

vi.mock('../../../lang/translation_handler.js', () => ({
    getTranslationForKey: vi.fn((key) => (key === 'stacked' ? 'Pinottu' : '')),
}));

vi.mock('../../../service_catalog/service_catalog_moderation.js', () => ({
    readCachedUserPermissions: vi.fn(() => ({})),
    canEditServiceCatalogColumn: vi.fn(() => true),
}));

describe('cell_editor', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        localStorage.clear();
        endpointRouterMock.mockReset();
        endpointRouterMock.mockResolvedValue({});
        selectCellMock.mockReset();
    });

    test('edits card detail layout through a dropdown and invalidates target table metadata', async () => {
        const { editCell } = await import('./cell_editor.js');
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '1';
        cell.textContent = 'single_line';
        row.appendChild(cell);
        document.body.appendChild(row);
        localStorage.setItem('orders_tableMeta', JSON.stringify({ card_details_layout: 'single_line' }));
        localStorage.setItem('full_tree_data', JSON.stringify({
            column_details: [{
                table_name: 'system_db_tables',
                column_name: 'card_details_layout',
                editable_in_ui: true,
            }],
        }));

        const data = [{
            id: 7,
            table_name: 'orders',
            card_details_layout: 'single_line',
        }];

        await editCell(
            cell,
            ['id', 'card_details_layout'],
            data,
            { card_details_layout: { data_type: 'character varying' } },
            'system_db_tables'
        );

        const select = cell.querySelector('[data-testid="table-editor-select"]');
        expect(select).toBeInstanceOf(HTMLSelectElement);
        expect(select.querySelector('option[value="stacked"]')?.textContent).toBe('Pinottu');

        select.value = 'stacked';
        select.dispatchEvent(new Event('change'));
        await Promise.resolve();
        await Promise.resolve();

        expect(endpointRouterMock).toHaveBeenCalledWith('updateRow', {
            method: 'POST',
            url_params: '?dataset=system_db_tables',
            body_data: {
                id: 7,
                column: 'card_details_layout',
                value: 'stacked',
            },
        });
        expect(data[0].card_details_layout).toBe('stacked');
        expect(localStorage.getItem('orders_tableMeta')).toBeNull();
        expect(cell.textContent).toBe('stacked');
    });

    test('edits dev task status through the constrained status dropdown before foreign-key handling', async () => {
        const { editCell } = await import('./cell_editor.js');
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '1';
        cell.textContent = 'in_progress';
        row.appendChild(cell);
        document.body.appendChild(row);
        localStorage.setItem('full_tree_data', JSON.stringify({
            column_details: [{
                table_name: 'dev_agent_tasks',
                column_name: 'status',
                editable_in_ui: true,
            }],
        }));

        const data = [{
            id: 844,
            status: 'in_progress',
        }];

        await editCell(
            cell,
            ['id', 'status'],
            data,
            { status: { data_type: 'text', foreign_table: 'dev_agent_task_statuses' } },
            'dev_agent_tasks'
        );

        const select = cell.querySelector('[data-testid="table-editor-select"]');
        expect(select).toBeInstanceOf(HTMLSelectElement);

        select.value = 'aborted';
        select.dispatchEvent(new Event('change'));
        await Promise.resolve();
        await Promise.resolve();

        expect(endpointRouterMock).toHaveBeenCalledWith('updateRow', {
            method: 'POST',
            url_params: '?dataset=dev_agent_tasks',
            body_data: {
                id: 844,
                column: 'status',
                value: 'aborted',
            },
        });
        expect(data[0].status).toBe('aborted');
        expect(cell.textContent).toBe('aborted');
    });

    test('opens foreign-key name editing as an overlay instead of clipped cell content', async () => {
        const { editCell } = await import('./cell_editor.js');
        const { fetchReferencedData } = await import('../gt_1_1_row_create/row_api_fetcher.js');
        fetchReferencedData.mockResolvedValue([
            { id: 'in_progress', display: 'In Progress' },
            { id: 'done', display: 'Done' },
        ]);
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.classList.add('table_data_cell');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '2';
        cell.textContent = 'Aborted';
        row.appendChild(cell);
        document.body.appendChild(row);
        localStorage.setItem('full_tree_data', JSON.stringify({
            column_details: [{
                table_name: 'dev_agent_tasks',
                column_name: 'status_name',
                editable_in_ui: true,
            }],
        }));

        await editCell(
            cell,
            ['id', 'status', 'status_name'],
            [{ id: 844, status: 'aborted', status_name: 'Aborted' }],
            {
                status: {
                    data_type: 'text',
                    foreign_table: 'dev_agent_task_statuses',
                },
                status_name: { data_type: 'text' },
            },
            'dev_agent_tasks'
        );

        const dropdown = cell.querySelector('[data-testid="inline-fk-dropdown"]');
        expect(dropdown).not.toBeNull();
        expect(dropdown.classList.contains('inline-fk-dropdown')).toBe(true);
        expect(cell.classList.contains('table_data_cell--inline-fk-editing')).toBe(true);
        expect(dropdown.querySelectorAll('[data-testid="inline-fk-option"]')).toHaveLength(2);
    });

    test('localizes inline foreign-key labels while submitting the unchanged option id', async () => {
        localStorage.setItem('chosen_language', 'fi');
        const { editCell } = await import('./cell_editor.js');
        const { fetchReferencedData } = await import('../gt_1_1_row_create/row_api_fetcher.js');
        fetchReferencedData.mockResolvedValue([
            {
                id: 12,
                display: JSON.stringify({ en: 'Customer portal', fi: 'Asiakasportaali' }),
            },
        ]);
        const cell = document.createElement('td');
        cell.classList.add('table_data_cell');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '2';
        cell.textContent = 'Vanha palvelu';
        document.body.appendChild(cell);
        const data = [{ id: 844, service_id: 4, service_name: 'Vanha palvelu' }];

        await editCell(
            cell,
            ['id', 'service_id', 'service_name'],
            data,
            {
                service_id: { data_type: 'integer', foreign_table: 'services' },
                service_name: { data_type: 'text' },
            },
            'tickets'
        );

        const option = cell.querySelector('[data-testid="inline-fk-option"]');
        expect(option.textContent).toBe('Asiakasportaali');
        expect(option.dataset.value).toBe('12');
        option.click();

        await vi.waitFor(() => expect(endpointRouterMock).toHaveBeenCalledTimes(1));
        expect(endpointRouterMock).toHaveBeenCalledWith('updateRow', {
            method: 'POST',
            url_params: '?dataset=tickets',
            body_data: {
                id: 844,
                column: 'service_id',
                value: 12,
            },
        });
        await vi.waitFor(() => expect(data[0].service_id).toBe(12));
        expect(data[0].service_name).toBe('Asiakasportaali');
    });

    test('sizes regular text editors to the current cell content width', async () => {
        const { editCell } = await import('./cell_editor.js');
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '1';
        cell.style.paddingLeft = '8px';
        cell.style.paddingRight = '12px';
        cell.textContent = 'Original value';
        cell.getBoundingClientRect = vi.fn(() => ({
            width: 140,
            height: 30,
            top: 0,
            right: 140,
            bottom: 30,
            left: 0,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        }));
        row.appendChild(cell);
        document.body.appendChild(row);

        await editCell(
            cell,
            ['id', 'title'],
            [{ id: 7, title: 'Original value' }],
            { title: { data_type: 'text' } },
            'orders'
        );

        const input = cell.querySelector('[data-testid="table-editor"]');
        expect(input).toBeInstanceOf(HTMLInputElement);
        expect(input.style.width).toBe('120px');
    });

    test('does not POST when a DATE editor opens and closes without a change', async () => {
        const { editCell } = await import('./cell_editor.js');
        const cell = document.createElement('td');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '1';
        cell.textContent = '2026-01-15';
        document.body.appendChild(cell);
        const data = [{ id: 7, due_date: '2026-01-15' }];

        await editCell(
            cell,
            ['id', 'due_date'],
            data,
            { due_date: { data_type: 'date' } },
            'orders'
        );

        const input = cell.querySelector('[data-testid="table-editor"]');
        expect(input.value).toBe('2026-01-15');
        input.dispatchEvent(new Event('blur'));
        await Promise.resolve();

        expect(endpointRouterMock).not.toHaveBeenCalled();
        expect(data[0].due_date).toBe('2026-01-15');
    });

    test('does not POST when a string-backed boolean checkbox is unchanged or cancelled', async () => {
        const { editCell } = await import('./cell_editor.js');
        const cell = document.createElement('td');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '1';
        cell.textContent = 'true';
        document.body.appendChild(cell);
        const data = [{ id: 7, enabled: 'true' }];

        await editCell(
            cell,
            ['id', 'enabled'],
            data,
            { enabled: { data_type: 'boolean' } },
            'orders'
        );

        const input = cell.querySelector('[data-testid="table-editor"]');
        expect(input.type).toBe('checkbox');
        expect(input.checked).toBe(true);
        input.checked = false;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await Promise.resolve();

        expect(endpointRouterMock).not.toHaveBeenCalled();
        expect(data[0].enabled).toBe('true');
    });

    test('POSTs exactly once with an unchanged wall-clock TIMESTAMP payload on explicit save', async () => {
        const { editCell } = await import('./cell_editor.js');
        const cell = document.createElement('td');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '1';
        cell.textContent = '2026-06-14 09:30';
        document.body.appendChild(cell);
        const data = [{ id: 8, scheduled_at: '2026-06-14 09:30:00' }];

        await editCell(
            cell,
            ['id', 'scheduled_at'],
            data,
            { scheduled_at: { data_type: 'timestamp without time zone' } },
            'orders'
        );

        const input = cell.querySelector('[data-testid="table-editor"]');
        expect(input.value).toBe('2026-06-14T09:30');
        input.value = '2026-06-15T14:30';
        input.dispatchEvent(new Event('blur'));

        await vi.waitFor(() => {
            expect(endpointRouterMock).toHaveBeenCalledTimes(1);
        });
        expect(endpointRouterMock).toHaveBeenCalledWith('updateRow', {
            method: 'POST',
            url_params: '?dataset=orders',
            body_data: {
                id: 8,
                column: 'scheduled_at',
                value: '2026-06-15 14:30:00',
            },
        });
        await vi.waitFor(() => {
            expect(data[0].scheduled_at).toBe('2026-06-15 14:30:00');
        });
    });

    test('restores a regular edit cell when row data is unavailable', async () => {
        const { editCell } = await import('./cell_editor.js');
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.dataset.rowIndex = '4';
        cell.dataset.colIndex = '1';
        cell.textContent = 'Original value';
        row.appendChild(cell);
        document.body.appendChild(row);

        await editCell(
            cell,
            ['id', 'title'],
            [],
            { title: { data_type: 'text' } },
            'orders'
        );

        expect(cell.classList.contains('editing')).toBe(false);
        expect(cell.textContent).toBe('Original value');
        expect(cell.querySelector('[data-testid="table-editor"]')).toBeNull();
        expect(selectCellMock).toHaveBeenCalledWith(cell);
        expect(endpointRouterMock).not.toHaveBeenCalled();
    });

    test('edits only the active language while preserving the other multilingual values', async () => {
        localStorage.setItem('chosen_language', 'fi');
        const { editCell } = await import('./cell_editor.js');
        const cell = document.createElement('td');
        cell.classList.add('table_data_cell');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '1';
        cell.innerHTML = '<div class="table_cell_content">Palvelut</div>';
        document.body.appendChild(cell);

        const originalValue = JSON.stringify({ en: 'Services', fi: 'Palvelut', yue: '服務' });
        const data = [{ id: 7, title: originalValue }];

        await editCell(
            cell,
            ['id', 'title'],
            data,
            { title: { data_type: 'text', is_multilingual: true } },
            'services'
        );

        const input = cell.querySelector('[data-testid="table-editor"]');
        expect(input.value).toBe('Palvelut');
        input.value = 'Palveluluettelo';
        input.dispatchEvent(new Event('blur'));

        await vi.waitFor(() => expect(endpointRouterMock).toHaveBeenCalledTimes(1));
        const savedValue = endpointRouterMock.mock.calls[0][1].body_data.value;
        expect(JSON.parse(savedValue)).toEqual({
            en: 'Services',
            fi: 'Palveluluettelo',
            yue: '服務',
        });
        await vi.waitFor(() => expect(data[0].title).toBe(savedValue));
        expect(cell.textContent).toBe('Palveluluettelo');
        expect(cell.querySelector('.table_cell_content')).not.toBeNull();

        const { refreshLocalizedDatasetValues } = await import(
            '../../../table_views/dataset_value_localizer.js'
        );
        await refreshLocalizedDatasetValues('en');
        expect(cell.textContent).toBe('Services');
    });

    test('cancels a multilingual edit without sending or exposing the raw JSON value', async () => {
        localStorage.setItem('chosen_language', 'en');
        const { editCell } = await import('./cell_editor.js');
        const cell = document.createElement('td');
        cell.classList.add('table_data_cell');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '1';
        cell.innerHTML = '<div class="table_cell_content">Services</div>';
        document.body.appendChild(cell);

        const originalValue = JSON.stringify({ en: 'Services', fi: 'Palvelut' });
        const data = [{ id: 8, title: originalValue }];
        await editCell(
            cell,
            ['id', 'title'],
            data,
            { title: { data_type: 'text', is_multilingual: true } },
            'services'
        );

        const input = cell.querySelector('[data-testid="table-editor"]');
        expect(input.value).toBe('Services');
        input.value = 'Changed';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await Promise.resolve();

        expect(endpointRouterMock).not.toHaveBeenCalled();
        expect(data[0].title).toBe(originalValue);
        expect(cell.textContent).toBe('Services');
        expect(cell.textContent).not.toContain('{"en"');
    });

    test('restores div-list cell content wrapper after regular edit commit', async () => {
        const { editCell } = await import('./cell_editor.js');
        const cell = document.createElement('div');
        cell.classList.add('cell', 'column-title');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '1';

        const content = document.createElement('div');
        content.classList.add('cell-content', 'column-title');
        content.textContent = 'Original value';
        cell.appendChild(content);
        document.body.appendChild(cell);

        const data = [{ id: 7, title: 'Original value' }];
        await editCell(
            cell,
            ['id', 'title'],
            data,
            { title: { data_type: 'text' } },
            'orders'
        );

        const input = cell.querySelector('[data-testid="table-editor"]');
        input.value = 'Updated value';
        input.dispatchEvent(new Event('blur'));
        await Promise.resolve();
        await Promise.resolve();

        expect(endpointRouterMock).toHaveBeenCalledWith('updateRow', {
            method: 'POST',
            url_params: '?dataset=orders',
            body_data: {
                id: 7,
                column: 'title',
                value: 'Updated value',
            },
        });
        expect(cell.querySelector(':scope > .cell-content')?.textContent).toBe('Updated value');
        expect(cell.querySelector(':scope > .cell-content')?.classList.contains('column-title')).toBe(true);
        expect(data[0].title).toBe('Updated value');
    });

    test('keeps select editing open when the native select blurs', async () => {
        const { editCell } = await import('./cell_editor.js');
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '1';
        cell.textContent = 'single_line';
        row.appendChild(cell);
        document.body.appendChild(row);
        localStorage.setItem('full_tree_data', JSON.stringify({
            column_details: [{
                table_name: 'system_db_tables',
                column_name: 'card_details_layout',
                editable_in_ui: true,
            }],
        }));

        await editCell(
            cell,
            ['id', 'card_details_layout'],
            [{ id: 7, table_name: 'orders', card_details_layout: 'single_line' }],
            { card_details_layout: { data_type: 'character varying' } },
            'system_db_tables'
        );

        const select = cell.querySelector('[data-testid="table-editor-select"]');
        select.dispatchEvent(new Event('blur'));

        expect(cell.querySelector('[data-testid="table-editor-select"]')).toBe(select);
        expect(endpointRouterMock).not.toHaveBeenCalled();
    });

    test('cancels select editing on outside pointerdown', async () => {
        const { editCell } = await import('./cell_editor.js');
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        const outside = document.createElement('button');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '1';
        cell.textContent = 'single_line';
        row.appendChild(cell);
        document.body.append(row, outside);
        localStorage.setItem('full_tree_data', JSON.stringify({
            column_details: [{
                table_name: 'system_db_tables',
                column_name: 'card_details_layout',
                editable_in_ui: true,
            }],
        }));

        await editCell(
            cell,
            ['id', 'card_details_layout'],
            [{ id: 7, table_name: 'orders', card_details_layout: 'single_line' }],
            { card_details_layout: { data_type: 'character varying' } },
            'system_db_tables'
        );

        outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));

        expect(cell.querySelector('[data-testid="table-editor-select"]')).toBeNull();
        expect(cell.textContent).toBe('single_line');
        expect(endpointRouterMock).not.toHaveBeenCalled();
    });
});
