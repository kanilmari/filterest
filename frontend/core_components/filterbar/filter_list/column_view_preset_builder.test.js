// @vitest-environment jsdom
// column_view_preset_builder.test.js
// Verifies the column-view preset builder uses manifest-backed candidate wrappers for list, save, and delete.
// Bridges preset rendering, wrapper calls, and confirmation/toast behavior under test control.
// Exists to keep the candidate preset migration wired to explicit wrappers instead of endpoint_router.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const listColumnViewPresetsMock = vi.fn();
const saveColumnViewPresetMock = vi.fn();
const deleteColumnViewPresetMock = vi.fn();
const getHiddenColumnsMock = vi.fn();
const applyColumnVisibilityMock = vi.fn();
const hasRoutePermissionMock = vi.fn();
const showSuccessToastMock = vi.fn();
const showConfirmModalMock = vi.fn();
const showInputModalMock = vi.fn();
const getTranslationForKeyMock = vi.fn();

async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
}

async function triggerPresetLoad(row) {
    const select = /** @type {HTMLSelectElement | null} */ (row.querySelector('select'));
    expect(select).not.toBeNull();
    select.dispatchEvent(new Event('focus', { bubbles: true }));
    await flushAsyncWork();
    return select;
}

async function loadModule() {
    vi.resetModules();
    vi.doMock('../../endpoints/stable_endpoint_router.js', () => ({
        listColumnViewPresets: listColumnViewPresetsMock,
        saveColumnViewPreset: saveColumnViewPresetMock,
        deleteColumnViewPreset: deleteColumnViewPresetMock,
    }));
    vi.doMock('./column_visibility_handler.js', () => ({
        getHiddenColumns: getHiddenColumnsMock,
        applyColumnVisibility: applyColumnVisibilityMock,
    }));
    vi.doMock('../../lang/translation_handler.js', () => ({
        getTranslationForKey: getTranslationForKeyMock,
    }));
    vi.doMock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({
        showSuccessToast: showSuccessToastMock,
    }));
    vi.doMock('../../../reusable_components/modal/confirm_modal_builder.js', () => ({
        showConfirmModal: showConfirmModalMock,
        showInputModal: showInputModalMock,
    }));
    vi.doMock('../../route_permission_checker.js', () => ({
        hasRoutePermission: hasRoutePermissionMock,
    }));
    return import('./column_view_preset_builder.js');
}

describe('column_view_preset_builder', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        listColumnViewPresetsMock.mockReset();
        saveColumnViewPresetMock.mockReset();
        deleteColumnViewPresetMock.mockReset();
        getHiddenColumnsMock.mockReset();
        applyColumnVisibilityMock.mockReset();
        hasRoutePermissionMock.mockReset();
        showSuccessToastMock.mockReset();
        showConfirmModalMock.mockReset();
        showInputModalMock.mockReset();
        getTranslationForKeyMock.mockReset();
        hasRoutePermissionMock.mockReturnValue(true);
        getHiddenColumnsMock.mockReturnValue({ title: true });
        showConfirmModalMock.mockResolvedValue(true);
        showInputModalMock.mockResolvedValue('Compact');
        getTranslationForKeyMock.mockImplementation((key) => key);
        vi.restoreAllMocks();
    });

    test('loads presets through the candidate list wrapper', async () => {
        listColumnViewPresetsMock.mockResolvedValue([
            { id: 7, preset_name: 'Compact', hidden_columns: { title: true } },
        ]);
        const { buildColumnViewPresetSelector } = await loadModule();

        const row = buildColumnViewPresetSelector('orders');
        await triggerPresetLoad(row);

        expect(listColumnViewPresetsMock).toHaveBeenCalledWith('orders');
        expect(row.querySelector('option[value="7"]')?.textContent).toBe('Compact');
    });

    test('updates the selected preset through the candidate save wrapper', async () => {
        listColumnViewPresetsMock.mockResolvedValue([
            { id: 7, preset_name: 'Compact', hidden_columns: { title: true } },
        ]);
        saveColumnViewPresetMock.mockResolvedValue({ status: 'ok', message: 'Saved preset' });
        const { buildColumnViewPresetSelector } = await loadModule();

        const row = buildColumnViewPresetSelector('orders');
        const select = await triggerPresetLoad(row);
        select.value = '7';
        select.dispatchEvent(new Event('change', { bubbles: true }));

        const updateButton = /** @type {HTMLButtonElement | null} */ (
            row.querySelector('[data-lang-key="update_field_set"]')
        );
        expect(updateButton).not.toBeNull();
        updateButton.click();
        await flushAsyncWork();

        expect(saveColumnViewPresetMock).toHaveBeenCalledWith({
            table_name: 'orders',
            preset_name: 'Compact',
            hidden_columns: { title: true },
        });
        expect(showSuccessToastMock).toHaveBeenCalledWith(
            'field_set_updated: Compact'
        );
    });

    test('deletes the selected preset through the candidate delete wrapper', async () => {
        listColumnViewPresetsMock.mockResolvedValue([
            { id: 7, preset_name: 'Compact', hidden_columns: { title: true } },
        ]);
        deleteColumnViewPresetMock.mockResolvedValue({ status: 'ok', message: 'Deleted preset' });
        const { buildColumnViewPresetSelector } = await loadModule();

        const row = buildColumnViewPresetSelector('orders');
        const select = await triggerPresetLoad(row);
        select.value = '7';
        select.dispatchEvent(new Event('change', { bubbles: true }));

        const moreButton = /** @type {HTMLButtonElement | null} */ (
            row.querySelector('[data-lang-key="more_actions"]')
        );
        const deleteButton = /** @type {HTMLButtonElement | null} */ (
            row.querySelector('[data-lang-key="delete_field_set"]')
        );
        expect(moreButton).not.toBeNull();
        expect(deleteButton).not.toBeNull();

        moreButton.click();
        deleteButton.click();
        await flushAsyncWork();

        expect(deleteColumnViewPresetMock).toHaveBeenCalledWith({ id: 7 });
        expect(showConfirmModalMock).toHaveBeenCalled();
        expect(showSuccessToastMock).toHaveBeenCalledWith('field_set_deleted');
        expect(row.querySelector('option[value="7"]')).toBeNull();
        expect(listColumnViewPresetsMock).toHaveBeenCalledTimes(1);
    });

    test('destroy detaches the outside-click menu closer', async () => {
        listColumnViewPresetsMock.mockResolvedValue([]);
        const { buildColumnViewPresetSelector } = await loadModule();

        const row = buildColumnViewPresetSelector('orders');
        await triggerPresetLoad(row);

        const moreButton = /** @type {HTMLButtonElement | null} */ (
            row.querySelector('[data-lang-key="more_actions"]')
        );
        const moreMenu = moreButton?.nextElementSibling;
        expect(moreButton).not.toBeNull();
        expect(moreMenu).not.toBeNull();

        moreButton.click();
        expect(moreMenu.hidden).toBe(false);

        row.destroy();
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(moreMenu.hidden).toBe(false);
    });

    test('does not load presets until the user interacts with the control', async () => {
        listColumnViewPresetsMock.mockResolvedValue([]);
        const { buildColumnViewPresetSelector } = await loadModule();

        const row = buildColumnViewPresetSelector('orders');
        await flushAsyncWork();

        expect(listColumnViewPresetsMock).not.toHaveBeenCalled();
        expect(row.querySelector('select')?.textContent).toContain('select_field_set');
        expect(row.querySelector('button.filterbar-section-heading')?.getAttribute('aria-expanded'))
            .toBe('false');
        expect(row.querySelector('.animated-disclosure-content-shell')?.hidden).toBe(true);
        expect(row.querySelector('.column-preset-heading-icon')?.style.maskImage)
            .toContain('/frontend/icons/general/visible-fields-icon.svg');
    });

    test('keeps field-set controls visible after the lazy preset load', async () => {
        listColumnViewPresetsMock.mockResolvedValue([]);
        const { buildColumnViewPresetSelector } = await loadModule();

        const row = buildColumnViewPresetSelector('orders');
        const controls = [
            '[data-lang-key="save_field_set"]',
            '[data-lang-key="update_field_set"]',
            '[data-lang-key="clear_selections"]',
            '[data-lang-key="more_actions"]',
        ];

        for (const selector of controls) {
            const control = /** @type {HTMLElement | null} */ (row.querySelector(selector));
            expect(control).not.toBeNull();
            expect(control?.style.display).not.toBe('none');
        }

        await triggerPresetLoad(row);

        for (const selector of controls) {
            const control = /** @type {HTMLElement | null} */ (row.querySelector(selector));
            expect(control?.style.display).not.toBe('none');
        }
    });

    test('field picker writes hidden-column state without legacy visibility toggles', async () => {
        getHiddenColumnsMock.mockImplementation(() => {
            try {
                return JSON.parse(localStorage.getItem('orders_hide_columns') || '{}');
            } catch {
                return {};
            }
        });
        const { buildColumnViewPresetSelector } = await loadModule();

        const row = buildColumnViewPresetSelector('orders', ['title', 'description']);
        document.body.appendChild(row);
        const dropdown = row.querySelector('.column-preset-field-picker')?.__dropdown;
        expect(dropdown).toBeTruthy();

        dropdown.open();
        const checkboxes = Array.from(document.body.querySelectorAll('.msd-option-checkbox'));
        expect(checkboxes).toHaveLength(2);
        checkboxes[1].click();

        expect(JSON.parse(localStorage.getItem('orders_hide_columns'))).toEqual({
            description: true,
        });
        expect(applyColumnVisibilityMock).toHaveBeenCalledWith('orders');
        row.destroy();
    });

    test('applying a preset syncs the field picker selections', async () => {
        getHiddenColumnsMock.mockImplementation(() => {
            try {
                return JSON.parse(localStorage.getItem('orders_hide_columns') || '{}');
            } catch {
                return {};
            }
        });
        listColumnViewPresetsMock.mockResolvedValue([
            { id: 7, preset_name: 'Compact', hidden_columns: { description: true } },
        ]);
        const { buildColumnViewPresetSelector } = await loadModule();

        const row = buildColumnViewPresetSelector('orders', ['title', 'description']);
        const select = await triggerPresetLoad(row);
        select.value = '7';
        select.dispatchEvent(new Event('change', { bubbles: true }));

        const dropdown = row.querySelector('.column-preset-field-picker')?.__dropdown;
        expect(dropdown.getState()).toEqual({
            includeValues: ['title'],
            excludeValues: [],
        });
        row.destroy();
    });
});
