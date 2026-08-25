// @vitest-environment jsdom
// cell_editor_maintenance_retry.test.js
// Verifies every inline editor keeps its current draft through a typed maintenance response.
// Bridges routed 503 failures with retryable text, constrained-select, and foreign-key controls.
// Exists to prevent a planned service drain from discarding a user's in-progress cell change.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
    endpointRouterMock,
    fetchReferencedDataMock,
    selectCellMock,
} = vi.hoisted(() => ({
    endpointRouterMock: vi.fn(),
    fetchReferencedDataMock: vi.fn(),
    selectCellMock: vi.fn(),
}));

vi.mock('../../../table_views/table_view/table_cell_handler.js', () => ({
    selectCell: selectCellMock,
}));
vi.mock('../gt_1_1_row_create/row_api_fetcher.js', () => ({
    fetchReferencedData: fetchReferencedDataMock,
}));
vi.mock('../../../endpoints/endpoint_router.js', () => ({
    endpoint_router: endpointRouterMock,
}));
vi.mock('../../../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showWarningToast: vi.fn(),
}));
vi.mock('../../../lang/translation_handler.js', () => ({
    getTranslationForKey: vi.fn((key) => (key === 'stacked' ? 'Stacked' : '')),
}));
vi.mock('../../../service_catalog/service_catalog_moderation.js', () => ({
    readCachedUserPermissions: vi.fn(() => ({})),
    canEditServiceCatalogColumn: vi.fn(() => true),
}));

import { editCell } from './cell_editor.js';

function rejectOnceForMaintenanceThenSucceed() {
    endpointRouterMock
        .mockRejectedValueOnce(Object.assign(new Error('maintenance'), {
            status: 503,
            isServiceUnavailable: true,
        }))
        .mockResolvedValueOnce({ ok: true });
}

describe('cell editor maintenance retry', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        localStorage.clear();
        endpointRouterMock.mockReset();
        fetchReferencedDataMock.mockReset();
        selectCellMock.mockReset();
        rejectOnceForMaintenanceThenSucceed();
    });

    test('keeps the same text input and retries its draft on the next blur', async () => {
        const cell = document.createElement('td');
        cell.classList.add('table_data_cell');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '1';
        cell.textContent = 'Original value';
        document.body.appendChild(cell);
        const data = [{ id: 7, title: 'Original value' }];

        await editCell(cell, ['id', 'title'], data, { title: { data_type: 'text' } }, 'orders');
        const input = cell.querySelector('[data-testid="table-editor"]');
        input.value = 'Preserved draft';
        input.dispatchEvent(new Event('blur'));

        await vi.waitFor(() => expect(cell.dataset.inlineSaveState).toBe('retry'));
        expect(cell.querySelector('[data-testid="table-editor"]')).toBe(input);
        expect(input.value).toBe('Preserved draft');
        expect(data[0].title).toBe('Original value');
        expect(selectCellMock).not.toHaveBeenCalled();

        input.dispatchEvent(new Event('blur'));
        await vi.waitFor(() => expect(data[0].title).toBe('Preserved draft'));
        expect(cell.dataset.inlineSaveState).toBeUndefined();
        expect(cell.textContent).toBe('Preserved draft');
        expect(endpointRouterMock).toHaveBeenCalledTimes(2);
    });

    test('keeps a constrained select choice and retries it with Enter', async () => {
        localStorage.setItem('full_tree_data', JSON.stringify({
            column_details: [{
                table_name: 'system_db_tables',
                column_name: 'card_details_layout',
                editable_in_ui: true,
            }],
        }));
        const cell = document.createElement('td');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '1';
        cell.textContent = 'single_line';
        document.body.appendChild(cell);
        const data = [{ id: 7, table_name: 'orders', card_details_layout: 'single_line' }];

        await editCell(
            cell,
            ['id', 'card_details_layout'],
            data,
            { card_details_layout: { data_type: 'character varying' } },
            'system_db_tables'
        );
        const select = cell.querySelector('[data-testid="table-editor-select"]');
        select.value = 'stacked';
        select.dispatchEvent(new Event('change'));

        await vi.waitFor(() => expect(cell.dataset.inlineSaveState).toBe('retry'));
        expect(cell.querySelector('[data-testid="table-editor-select"]')).toBe(select);
        expect(select.value).toBe('stacked');
        expect(data[0].card_details_layout).toBe('single_line');

        select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await vi.waitFor(() => expect(data[0].card_details_layout).toBe('stacked'));
        expect(cell.querySelector('[data-testid="table-editor-select"]')).toBeNull();
        expect(endpointRouterMock).toHaveBeenCalledTimes(2);
    });

    test('keeps a foreign-key choice visible and retries it by selecting again', async () => {
        fetchReferencedDataMock.mockResolvedValue([{ id: 12, display: 'Customer portal' }]);
        const cell = document.createElement('td');
        cell.classList.add('table_data_cell');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '2';
        cell.textContent = 'Old service';
        document.body.appendChild(cell);
        const data = [{ id: 844, service_id: 4, service_name: 'Old service' }];

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
        option.click();

        await vi.waitFor(() => expect(cell.dataset.inlineSaveState).toBe('retry'));
        expect(cell.querySelector('[data-testid="inline-fk-dropdown"]')).not.toBeNull();
        expect(cell.querySelector('[data-testid="inline-fk-search-input"]').value).toBe('Customer portal');
        expect(data[0].service_id).toBe(4);

        option.click();
        await vi.waitFor(() => expect(data[0].service_id).toBe(12));
        expect(cell.querySelector('[data-testid="inline-fk-dropdown"]')).toBeNull();
        expect(endpointRouterMock).toHaveBeenCalledTimes(2);
    });

    test('does not discard a foreign-key draft when focus leaves during its save', async () => {
        let rejectPendingSave;
        endpointRouterMock.mockReset();
        endpointRouterMock.mockImplementationOnce(() => new Promise((resolve, reject) => {
            rejectPendingSave = reject;
        }));
        fetchReferencedDataMock.mockResolvedValue([{ id: 12, display: 'Customer portal' }]);
        const cell = document.createElement('td');
        cell.classList.add('table_data_cell');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '2';
        cell.textContent = 'Old service';
        document.body.appendChild(cell);
        const data = [{ id: 844, service_id: 4, service_name: 'Old service' }];

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
        const dropdown = cell.querySelector('[data-testid="inline-fk-dropdown"]');
        const searchInput = cell.querySelector('[data-testid="inline-fk-search-input"]');
        cell.querySelector('[data-testid="inline-fk-option"]').click();
        searchInput.dispatchEvent(new FocusEvent('blur', { relatedTarget: null }));

        expect(cell.querySelector('[data-testid="inline-fk-dropdown"]')).toBe(dropdown);
        expect(searchInput.value).toBe('Customer portal');
        rejectPendingSave(Object.assign(new Error('maintenance'), {
            status: 503,
            isServiceUnavailable: true,
        }));

        await vi.waitFor(() => expect(cell.dataset.inlineSaveState).toBe('retry'));
        expect(cell.querySelector('[data-testid="inline-fk-dropdown"]')).toBe(dropdown);
        expect(searchInput.value).toBe('Customer portal');
        expect(data[0].service_id).toBe(4);
    });
});
