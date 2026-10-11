// temporal_editor_dst.test.js
// Proves real table and article edit flows retain autumn occurrences and show spring normalization.
// Connects shared temporal serialization to routed inline writes and collected card updates.
// Prevents a correct formatter from losing the original instant at its consumers.

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const { endpointRouterMock } = vi.hoisted(() => ({ endpointRouterMock: vi.fn() }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: endpointRouterMock }));
vi.mock('./table_view/table_cell_handler.js', () => ({ selectCell: vi.fn() }));
vi.mock('../endpoints/endpoint_data_fetcher.js', () => ({ fetchFilterOptions: vi.fn() }));
vi.mock('../../reusable_components/notifications/toast_notification_printer.js', () => ({ showWarningToast: vi.fn() }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: vi.fn(() => '') }));
vi.mock('../service_catalog/service_catalog_moderation.js', () => ({
    readCachedUserPermissions: vi.fn(() => ({})), canEditServiceCatalogColumn: vi.fn(() => true),
}));
vi.mock('../state_stores/lang_preference_reader.js', () => ({ getLanguageWithBrowserFallback: vi.fn(() => 'fi') }));

import { editCell } from '../general_tables/gt_1_row_crud/gt_1_3_row_update/cell_editor.js';
import { disableEditing, enableEditing } from './card_view/card_field_formatter.js';
import { formatTimestampDisplayParts } from './timestamp_display_formatter.js';

const dataTypes = { clock: { data_type: 'timestamp with time zone', editable_in_ui: true } };
const cases = [
    ['autumn summer occurrence', '2026-10-25T00:30:00Z', '2026-10-25T03:31', '2026-10-25T00:31:00.000Z'],
    ['autumn standard occurrence', '2026-10-25T01:30:00Z', '2026-10-25T03:31', '2026-10-25T01:31:00.000Z'],
    ['true spring gap 03:30', '2026-03-29T00:30:00Z', '2026-03-29T03:30', '2026-03-29T01:30:00.000Z'],
];

describe('temporal editor DST consumers', () => {
    const originalTimezone = process.env.TZ;
    beforeAll(() => { process.env.TZ = 'Europe/Helsinki'; });
    afterAll(() => {
        if (originalTimezone === undefined) delete process.env.TZ;
        else process.env.TZ = originalTimezone;
    });
    beforeEach(() => {
        document.body.replaceChildren();
        localStorage.clear();
        localStorage.setItem('chosen_language', 'fi');
        endpointRouterMock.mockReset().mockResolvedValue({});
    });

    test.each(cases)('inline editing saves and displays the %s', async (_label, original, edited, saved) => {
        const cell = document.createElement('td');
        cell.dataset.rowIndex = '0';
        cell.dataset.colIndex = '1';
        cell.textContent = original;
        document.body.appendChild(cell);
        const rows = [{ id: 8, clock: original }];
        await editCell(cell, ['id', 'clock'], rows, dataTypes, 'system_config');
        const input = cell.querySelector('input');
        // Opening and closing without editing must keep seconds and occurrence.
        input.dispatchEvent(new Event('blur'));
        expect(endpointRouterMock).not.toHaveBeenCalled();
        expect(rows[0].clock).toBe(original);
        await editCell(cell, ['id', 'clock'], rows, dataTypes, 'system_config');
        cell.querySelector('input').value = edited;
        cell.querySelector('input').dispatchEvent(new Event('blur'));
        await vi.waitFor(() => expect(rows[0].clock).toBe(saved));
        expect(endpointRouterMock).toHaveBeenCalledExactlyOnceWith('updateRow', {
            method: 'POST', url_params: '?dataset=system_config',
            body_data: { id: 8, column: 'clock', value: saved },
        });
        const display = formatTimestampDisplayParts(saved, dataTypes.clock);
        expect(cell.textContent).toBe(display.displayText);
        expect(cell.title).toBe(display.titleText);
    });

    test.each(cases)('article editing saves and displays the %s', (_label, original, edited, saved) => {
        const container = document.createElement('div');
        const field = document.createElement('div');
        field.dataset.column = 'clock';
        field.dataset.rawValue = original;
        field.textContent = original;
        container.appendChild(field);
        document.body.appendChild(container);
        enableEditing(container, 'system_config', dataTypes);
        expect(disableEditing(container)).toEqual({});
        expect(field.dataset.rawValue).toBe(original);
        enableEditing(container, 'system_config', dataTypes);
        field.querySelector('input').value = edited;
        expect(disableEditing(container)).toEqual({ clock: saved });
        const display = formatTimestampDisplayParts(saved, dataTypes.clock);
        expect(field.textContent).toBe(display.displayText);
        expect(field.title).toBe(display.titleText);
    });
});
