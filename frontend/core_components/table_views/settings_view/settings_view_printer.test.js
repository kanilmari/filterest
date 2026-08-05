// @vitest-environment jsdom
// settings_view_printer.test.js
// Verifies the settings key/value renderer exposes an intentional save action and persists dirty rows through updateRow.
// Bridges jsdom form edits, endpoint_router saves, and toast feedback for the settings dataset view.
// Exists to keep settings datasets on explicit save semantics instead of implicit or missing persistence.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
const getTranslationForKeyMock = vi.fn();
const showErrorToastMock = vi.fn();
const showInfoToastMock = vi.fn();
const showSuccessToastMock = vi.fn();

async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
}

async function loadModule() {
    vi.resetModules();
    vi.doMock('../../endpoints/endpoint_router.js', () => ({
        endpoint_router: endpointRouterMock,
    }));
    vi.doMock('../../lang/translation_handler.js', () => ({
        getTranslationForKey: getTranslationForKeyMock,
    }));
    vi.doMock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({
        showErrorToast: showErrorToastMock,
        showInfoToast: showInfoToastMock,
        showSuccessToast: showSuccessToastMock,
    }));

    return import('./settings_view_printer.js');
}

describe('settings_view_printer', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        endpointRouterMock.mockReset();
        getTranslationForKeyMock.mockReset();
        showErrorToastMock.mockReset();
        showInfoToastMock.mockReset();
        showSuccessToastMock.mockReset();
        getTranslationForKeyMock.mockImplementation((key, { fallback } = {}) => fallback || key);
    });

    test('renders dedicated key and value cells for aligned settings rows', async () => {
        const { create_settings_view } = await loadModule();
        const view = create_settings_view(
            'app_settings',
            ['id', 'setting_key', 'value_type', 'value_text', 'value_bool'],
            [
                {
                    id: 12,
                    setting_key: 'site_name',
                    value_type: 0,
                    value_text: 'Easelect',
                },
                {
                    id: 13,
                    setting_key: 'maintenance_mode',
                    value_type: 2,
                    value_bool: true,
                },
            ]
        );

        document.body.appendChild(view);

        const rows = Array.from(view.querySelectorAll('.settings-row'));
        const firstInput = /** @type {HTMLInputElement | null} */ (rows[0]?.querySelector('.settings-input'));
        const firstLabel = rows[0]?.querySelector('.settings-key-cell label');
        const checkboxShell = rows[1]?.querySelector('.settings-field-shell--checkbox');

        expect(rows).toHaveLength(2);
        expect(rows[0]?.querySelector('.settings-key-cell')).not.toBeNull();
        expect(rows[0]?.querySelector('.settings-value-cell .settings-field-shell')).not.toBeNull();
        expect(firstLabel?.htmlFor).toBe(firstInput?.id);
        expect(checkboxShell?.querySelector('input[type="checkbox"]')).not.toBeNull();
    });

    test('renders an explicit save button and persists only dirty rows', async () => {
        endpointRouterMock.mockResolvedValue({ message: 'Row updated successfully' });
        const { create_settings_view } = await loadModule();
        const view = create_settings_view(
            'app_settings',
            ['id', 'setting_key', 'value_type', 'value_text'],
            [
                {
                    id: 12,
                    setting_key: 'site_name',
                    value_type: 0,
                    value_text: 'Easelect',
                },
            ]
        );

        document.body.appendChild(view);

        const saveButton = /** @type {HTMLButtonElement | null} */ (
            view.querySelector('[data-testid="settings-save-button"]')
        );
        const statusLabel = view.querySelector('[data-testid="settings-save-status"]');
        const input = /** @type {HTMLInputElement | null} */ (view.querySelector('input[type="text"]'));

        expect(saveButton).not.toBeNull();
        expect(saveButton?.disabled).toBe(true);
        expect(statusLabel?.textContent).toBe('No unsaved changes');

        input.value = 'Easelect Pro';
        input.dispatchEvent(new Event('input', { bubbles: true }));

        expect(saveButton?.disabled).toBe(false);
        expect(statusLabel?.textContent).toBe('Unsaved changes');

        saveButton.click();
        await flushAsyncWork();

        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
        expect(endpointRouterMock).toHaveBeenCalledWith('updateRow', {
            method: 'POST',
            url_params: '?dataset=app_settings',
            body_data: {
                id: 12,
                column: 'value_text',
                value: 'Easelect Pro',
            },
        });
        expect(showSuccessToastMock).toHaveBeenCalledWith('Saved');
        expect(saveButton?.disabled).toBe(true);
        expect(statusLabel?.textContent).toBe('No unsaved changes');
    });

    test('validates JSON settings before sending update requests', async () => {
        const { create_settings_view } = await loadModule();
        const view = create_settings_view(
            'app_settings',
            ['id', 'setting_key', 'value_type', 'value_json'],
            [
                {
                    id: 44,
                    setting_key: 'feature_flags',
                    value_type: 5,
                    value_json: '{"enabled":true}',
                },
            ]
        );

        document.body.appendChild(view);

        const textarea = /** @type {HTMLTextAreaElement | null} */ (view.querySelector('textarea'));
        const saveButton = /** @type {HTMLButtonElement | null} */ (
            view.querySelector('[data-testid="settings-save-button"]')
        );

        textarea.value = '{broken json';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        saveButton.click();
        await flushAsyncWork();

        expect(endpointRouterMock).not.toHaveBeenCalled();
        expect(showErrorToastMock).toHaveBeenCalledWith('Invalid JSON for feature_flags');
        expect(saveButton?.disabled).toBe(false);
    });
});
