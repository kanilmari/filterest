// card_visibility_view.test.js
// Verifies the card visibility admin view uses manifest-backed candidate wrappers for load and save.
// Bridges tree selection, visibility-matrix editing, and toast feedback under test control.
// Exists to keep the second stable-candidate migration wired to explicit wrappers instead of endpoint_router.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const fetchCardVisibilityMock = vi.fn();
const saveCardVisibilityMock = vi.fn();
const showSuccessToastMock = vi.fn();
const showConfirmModalMock = vi.fn();
const getTranslationForKeyMock = vi.fn();
const getLanguageWithBrowserFallbackMock = vi.fn();
const renderTreeMock = vi.fn();
const extractFirstSelectedTableNameMock = vi.fn();

function buildColumn(overrides = {}) {
    return {
        column_uid: 9,
        column_name: 'title',
        card_element: 'details',
        card_detail_label_mode: 'label',
        card_detail_icon_svg: '',
        card_detail_icon_key: '',
        card_detail_capitalization: true,
        show_key_on_card: true,
        show_value_on_card: true,
        hide_everywhere: false,
        hide_on_small_card: false,
        hide_false_null_on_sml_crd: false,
        hide_false_null_on_big_crd: false,
        hide_on_bg_crd_if_not_own: false,
        hide_in_filter_panel: false,
        ...overrides,
    };
}

async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
}

async function loadModule() {
    vi.resetModules();
    vi.doMock('../endpoints/stable_endpoint_router.js', () => ({
        fetchCardVisibility: fetchCardVisibilityMock,
        saveCardVisibility: saveCardVisibilityMock,
    }));
    vi.doMock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
        showSuccessToast: showSuccessToastMock,
    }));
    vi.doMock('../../reusable_components/modal/confirm_modal_builder.js', () => ({
        showConfirmModal: showConfirmModalMock,
    }));
    vi.doMock('../lang/translation_handler.js', () => ({
        getTranslationForKey: getTranslationForKeyMock,
    }));
    vi.doMock('../state_stores/lang_preference_reader.js', () => ({
        getLanguageWithBrowserFallback: getLanguageWithBrowserFallbackMock,
    }));
    vi.doMock('../../reusable_components/vanilla_tree/vanilla_tree_builder.js', () => ({
        render_tree: renderTreeMock,
    }));
    vi.doMock('./tree_selection_helpers.js', () => ({
        extractFirstSelectedTableName: extractFirstSelectedTableNameMock,
    }));
    return import('./card_visibility_view.js');
}

describe('card_visibility_view', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        fetchCardVisibilityMock.mockReset();
        saveCardVisibilityMock.mockReset();
        showSuccessToastMock.mockReset();
        showConfirmModalMock.mockReset();
        getTranslationForKeyMock.mockReset();
        getLanguageWithBrowserFallbackMock.mockReset();
        renderTreeMock.mockReset();
        extractFirstSelectedTableNameMock.mockReset();
        showConfirmModalMock.mockResolvedValue(false);
        getTranslationForKeyMock.mockImplementation((key) => key);
        getLanguageWithBrowserFallbackMock.mockReturnValue('en');
        extractFirstSelectedTableNameMock.mockImplementation((selectedCategories) => (
            Array.isArray(selectedCategories) && selectedCategories.length > 0 ? 'orders' : null
        ));
        vi.restoreAllMocks();
    });

    test('renders localized fallback instructions before a dataset is selected', async () => {
        getLanguageWithBrowserFallbackMock.mockReturnValue('fi');
        const { generate_card_visibility_form } = await loadModule();
        const container = document.createElement('div');

        await generate_card_visibility_form(container);

        expect(container.textContent).toContain('Korttien näkyvyysasetukset');
        expect(container.textContent).toContain('Valitse datasetti');
        expect(container.textContent).toContain('Muuta sarakkeiden näkyvyysasetuksia editorissa.');
    });

    test('loads one table through the card visibility candidate wrapper', async () => {
        localStorage.setItem('full_tree_data', JSON.stringify({ nodes: [{ id: 'node-1' }] }));
        fetchCardVisibilityMock.mockResolvedValue({
            card_details_layout: 'single_line',
            card_style_variant: 'modern',
            columns: [buildColumn()],
        });
        const { generate_card_visibility_form } = await loadModule();
        const container = document.createElement('div');

        await generate_card_visibility_form(container);
        document.dispatchEvent(new CustomEvent('checkboxSelectionChanged', {
            detail: { selectedCategories: ['node-1'] },
        }));
        await flushAsyncWork();

        expect(renderTreeMock).toHaveBeenCalled();
        expect(renderTreeMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            render_mode: 'checkbox',
            selection_mode: 'single',
            checkbox_mode: 'leaf',
        }));
        expect(fetchCardVisibilityMock).toHaveBeenCalledWith('orders');
        expect(container.textContent).toContain('title');
        expect(container.querySelector('[data-testid="card-details-layout-select"]')?.value).toBe('single_line');
        expect(container.querySelector('[data-testid="card-style-variant-select"]')?.value).toBe('modern');
        expect(container.textContent).not.toContain('Saved');
    });

    test('keeps the newest table selection when an older request finishes last', async () => {
        localStorage.setItem('full_tree_data', JSON.stringify({ nodes: [{ id: 'node-1' }] }));
        extractFirstSelectedTableNameMock.mockImplementation((selectedCategories) => (
            Array.isArray(selectedCategories) ? selectedCategories[0] || null : null
        ));

        /** @type {(value: unknown) => void} */
        let resolveOrders;
        /** @type {(value: unknown) => void} */
        let resolveUsers;
        fetchCardVisibilityMock.mockImplementation((tableName) => new Promise((resolve) => {
            if (tableName === 'orders') {
                resolveOrders = resolve;
            } else if (tableName === 'users') {
                resolveUsers = resolve;
            }
        }));

        const { generate_card_visibility_form } = await loadModule();
        const container = document.createElement('div');
        await generate_card_visibility_form(container);

        document.dispatchEvent(new CustomEvent('checkboxSelectionChanged', {
            detail: { selectedCategories: ['orders'] },
        }));
        await flushAsyncWork();
        document.dispatchEvent(new CustomEvent('checkboxSelectionChanged', {
            detail: { selectedCategories: ['users'] },
        }));
        await flushAsyncWork();

        resolveUsers({ columns: [buildColumn({ column_name: 'users_title' })] });
        await flushAsyncWork();
        expect(container.textContent).toContain('users_title');

        resolveOrders({ columns: [buildColumn({ column_name: 'orders_title' })] });
        await flushAsyncWork();
        expect(container.textContent).toContain('users_title');
        expect(container.textContent).not.toContain('orders_title');
    });

    test('saves edits through the card visibility candidate wrapper', async () => {
        fetchCardVisibilityMock.mockResolvedValue({
            card_details_layout: 'conditional_multiline',
            card_style_variant: 'standard',
            columns: [buildColumn()],
        });
        saveCardVisibilityMock.mockResolvedValue({ status: 'ok', message: 'Saved via wrapper' });
        const { generate_card_visibility_form } = await loadModule();
        const container = document.createElement('div');
        localStorage.setItem('full_tree_data', JSON.stringify({ nodes: [{ id: 'node-1' }] }));
        localStorage.setItem('orders_dataTypes', JSON.stringify({ title: 'text' }));
        localStorage.setItem('orders_tableMeta', JSON.stringify({ card_details_layout: 'single_line' }));

        await generate_card_visibility_form(container);
        document.dispatchEvent(new CustomEvent('checkboxSelectionChanged', {
            detail: { selectedCategories: ['node-1'] },
        }));
        await flushAsyncWork();

        const editButton = /** @type {HTMLButtonElement | null} */ (
            container.querySelector('[data-testid="card-visibility-edit-button"]')
        );
        const saveButton = /** @type {HTMLButtonElement | null} */ (
            container.querySelector('[data-testid="card-visibility-save-button"]')
        );
        const cancelButton = /** @type {HTMLButtonElement | null} */ (
            container.querySelector('[data-testid="card-visibility-cancel-button"]')
        );
        expect(editButton).not.toBeNull();
        expect(saveButton).not.toBeNull();
        expect(cancelButton).not.toBeNull();

        editButton.click();
        await flushAsyncWork();

        expect(cancelButton.disabled).toBe(false);

        const checkbox = /** @type {HTMLInputElement | null} */ (
            container.querySelector('tbody tr td:nth-child(4) input[type="checkbox"]')
        );
        expect(checkbox).not.toBeNull();
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        await flushAsyncWork();

        const selectInputs = Array.from(container.querySelectorAll('tbody tr select'));
        const labelModeSelect = /** @type {HTMLSelectElement | undefined} */ (selectInputs[1]);
        expect(labelModeSelect).toBeDefined();
        labelModeSelect.value = 'both';
        labelModeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await flushAsyncWork();

        const iconKeySelect = /** @type {HTMLSelectElement | undefined} */ (selectInputs[2]);
        expect(iconKeySelect).toBeDefined();
        iconKeySelect.value = 'calendar';
        iconKeySelect.dispatchEvent(new Event('change', { bubbles: true }));
        await flushAsyncWork();

        const iconSvgInput = /** @type {HTMLInputElement | null} */ (
            container.querySelector('tbody tr input[type="text"]')
        );
        expect(iconSvgInput).not.toBeNull();
        iconSvgInput.value = '<svg viewBox="0 0 16 16"><path d="M1 1h14v14H1z" /></svg>';
        iconSvgInput.dispatchEvent(new Event('input', { bubbles: true }));
        await flushAsyncWork();

        expect(localStorage.getItem('card_visibility_draft_orders')).toContain('"show_key_on_card":false');
        expect(localStorage.getItem('card_visibility_draft_orders')).toContain('"card_detail_capitalization":true');
        expect(localStorage.getItem('card_visibility_draft_orders')).toContain('"card_detail_label_mode":"both"');
        expect(localStorage.getItem('card_visibility_draft_orders')).toContain('"card_detail_icon_key":"calendar"');
        expect(localStorage.getItem('card_visibility_draft_orders')).toContain('"card_detail_icon_svg":"<svg viewBox=\\"0 0 16 16\\"><path d=\\"M1 1h14v14H1z\\" /></svg>"');

        saveButton.click();
        await flushAsyncWork();

        expect(saveCardVisibilityMock).toHaveBeenCalledWith({
            table_name: 'orders',
            card_details_layout: 'conditional_multiline',
            card_style_variant: 'standard',
            columns: [expect.objectContaining({
                column_uid: 9,
                card_detail_label_mode: 'both',
                card_detail_icon_key: 'calendar',
                card_detail_icon_svg: '<svg viewBox="0 0 16 16"><path d="M1 1h14v14H1z" /></svg>',
                show_key_on_card: false,
            })],
        });
        expect(localStorage.getItem('orders_dataTypes')).toBe(null);
        expect(localStorage.getItem('orders_tableMeta')).toBe(null);
        expect(localStorage.getItem('card_visibility_draft_orders')).toBe(null);
        expect(showSuccessToastMock).toHaveBeenCalledWith('Saved via wrapper');
    });

    test('saves the table-level card detail layout without requiring column edits', async () => {
        fetchCardVisibilityMock.mockResolvedValue({
            card_details_layout: 'conditional_multiline',
            card_style_variant: 'standard',
            columns: [buildColumn()],
        });
        saveCardVisibilityMock.mockResolvedValue({ status: 'ok', message: 'Layout saved' });
        const { generate_card_visibility_form } = await loadModule();
        const container = document.createElement('div');
        localStorage.setItem('full_tree_data', JSON.stringify({ nodes: [{ id: 'node-1' }] }));

        await generate_card_visibility_form(container);
        document.dispatchEvent(new CustomEvent('checkboxSelectionChanged', {
            detail: { selectedCategories: ['node-1'] },
        }));
        await flushAsyncWork();

        const layoutSelect = /** @type {HTMLSelectElement | null} */ (
            container.querySelector('[data-testid="card-details-layout-select"]')
        );
        const layoutSaveButton = /** @type {HTMLButtonElement | null} */ (
            container.querySelector('[data-testid="card-details-layout-save-button"]')
        );
        expect(layoutSelect).not.toBeNull();
        expect(layoutSaveButton).not.toBeNull();
        expect(layoutSaveButton.disabled).toBe(true);

        layoutSelect.value = 'stacked';
        layoutSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await flushAsyncWork();

        expect(layoutSaveButton.disabled).toBe(false);
        layoutSaveButton.click();
        await flushAsyncWork();

        expect(saveCardVisibilityMock).toHaveBeenCalledWith({
            table_name: 'orders',
            card_details_layout: 'stacked',
            card_style_variant: 'standard',
            columns: [expect.objectContaining({ column_uid: 9 })],
        });
        expect(showSuccessToastMock).toHaveBeenCalledWith('Layout saved');
    });

    test('saves the table-level card style variant without requiring column edits', async () => {
        fetchCardVisibilityMock.mockResolvedValue({
            card_details_layout: 'conditional_multiline',
            card_style_variant: 'standard',
            columns: [buildColumn()],
        });
        saveCardVisibilityMock.mockResolvedValue({ status: 'ok', message: 'Style saved' });
        const { generate_card_visibility_form } = await loadModule();
        const container = document.createElement('div');
        localStorage.setItem('full_tree_data', JSON.stringify({ nodes: [{ id: 'node-1' }] }));

        await generate_card_visibility_form(container);
        document.dispatchEvent(new CustomEvent('checkboxSelectionChanged', {
            detail: { selectedCategories: ['node-1'] },
        }));
        await flushAsyncWork();

        const styleSelect = /** @type {HTMLSelectElement | null} */ (
            container.querySelector('[data-testid="card-style-variant-select"]')
        );
        const layoutSaveButton = /** @type {HTMLButtonElement | null} */ (
            container.querySelector('[data-testid="card-details-layout-save-button"]')
        );
        expect(styleSelect).not.toBeNull();
        expect(layoutSaveButton).not.toBeNull();

        styleSelect.value = 'modern';
        styleSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await flushAsyncWork();

        expect(layoutSaveButton.disabled).toBe(false);
        layoutSaveButton.click();
        await flushAsyncWork();

        expect(saveCardVisibilityMock).toHaveBeenCalledWith({
            table_name: 'orders',
            card_details_layout: 'conditional_multiline',
            card_style_variant: 'modern',
            columns: [expect.objectContaining({ column_uid: 9 })],
        });
        expect(showSuccessToastMock).toHaveBeenCalledWith('Style saved');
    });
});
