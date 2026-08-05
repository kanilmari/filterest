// child_tab_config_view.test.js
// Verifies the child tab admin view uses manifest-backed candidate wrappers for load and save.
// Bridges the rendered child-tab editor, tree selection, and toast feedback under test control.
// Exists to keep the child-tab candidate migration wired to explicit wrappers instead of endpoint_router.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
const fetchChildTabConfigMock = vi.fn();
const saveChildTabConfigMock = vi.fn();
const renderTreeMock = vi.fn();
const showSuccessToastMock = vi.fn();
const showInfoToastMock = vi.fn();
const showConfirmModalMock = vi.fn();
const getTranslationForKeyMock = vi.fn();
const formatColumnNameMock = vi.fn();
const extractFirstSelectedTableNameMock = vi.fn();

function buildTab(overrides = {}) {
    return {
        id: 1,
        parent_table: 'orders',
        tab_key: 'comments',
        tab_order: 0,
        hidden: false,
        ...overrides,
    };
}

async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
}

async function loadModule() {
    vi.resetModules();
    vi.doMock('../endpoints/endpoint_router.js', () => ({
        endpoint_router: endpointRouterMock,
    }));
    vi.doMock('../endpoints/stable_endpoint_router.js', () => ({
        fetchChildTabConfig: fetchChildTabConfigMock,
        saveChildTabConfig: saveChildTabConfigMock,
    }));
    vi.doMock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
        showSuccessToast: showSuccessToastMock,
        showInfoToast: showInfoToastMock,
    }));
    vi.doMock('../../reusable_components/modal/confirm_modal_builder.js', () => ({
        showConfirmModal: showConfirmModalMock,
    }));
    vi.doMock('../lang/translation_handler.js', () => ({
        getTranslationForKey: getTranslationForKeyMock,
    }));
    vi.doMock('../../reusable_components/vanilla_tree/vanilla_tree_builder.js', () => ({
        render_tree: renderTreeMock,
    }));
    vi.doMock('../table_views/card_view/card_field_formatter.js', () => ({
        format_column_name: formatColumnNameMock,
    }));
    vi.doMock('./tree_selection_helpers.js', () => ({
        extractFirstSelectedTableName: extractFirstSelectedTableNameMock,
    }));
    return import('./child_tab_config_view.js');
}

describe('child_tab_config_view', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        endpointRouterMock.mockReset();
        fetchChildTabConfigMock.mockReset();
        saveChildTabConfigMock.mockReset();
        renderTreeMock.mockReset();
        showSuccessToastMock.mockReset();
        showInfoToastMock.mockReset();
        showConfirmModalMock.mockReset();
        getTranslationForKeyMock.mockReset();
        formatColumnNameMock.mockReset();
        extractFirstSelectedTableNameMock.mockReset();
        showConfirmModalMock.mockResolvedValue(false);
        getTranslationForKeyMock.mockImplementation((key) => key);
        formatColumnNameMock.mockImplementation((value) => value);
        extractFirstSelectedTableNameMock.mockImplementation((selectedCategories) => (
            Array.isArray(selectedCategories) && selectedCategories.length > 0 ? 'orders' : null
        ));
        vi.restoreAllMocks();
    });

    test('loads child-tab config through the candidate wrapper while keeping media child tables out of tab candidates', async () => {
        endpointRouterMock.mockResolvedValue({
            child_tables: [
                { dataset: 'invoices' },
                { dataset: 'orders_gallery', relation_kind: 'image_asset' },
                { dataset: 'orders_assets', relation_kind: 'shared_asset' },
            ],
        });
        fetchChildTabConfigMock.mockResolvedValue([buildTab()]);
        const { generate_child_tab_config_form } = await loadModule();
        const container = document.createElement('div');
        localStorage.setItem('full_tree_data', JSON.stringify({ nodes: [{ id: 'node-1' }] }));

        await generate_child_tab_config_form(container);
        document.dispatchEvent(new CustomEvent('checkboxSelectionChanged', {
            detail: { selectedCategories: ['node-1'] },
        }));
        await flushAsyncWork();

        expect(renderTreeMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            render_mode: 'checkbox',
            selection_mode: 'single',
            checkbox_mode: 'leaf',
        }));
        expect(endpointRouterMock).toHaveBeenCalledWith('fetchDynamicChildren', {
            method: 'POST',
            url_params: '?dataset=orders',
            body_data: {
                parent_dataset: 'orders',
                metadata_only: true,
            },
        });
        expect(fetchChildTabConfigMock).toHaveBeenCalledWith('orders');
        expect(container.textContent).toContain('comments');
        expect(container.textContent).toContain('invoices');
        expect(container.textContent).not.toContain('orders_gallery');
        expect(container.textContent).not.toContain('orders_assets');
    });

    test('uses referring-tab fallback copy instead of exposing child-tab wording when translations are missing', async () => {
        endpointRouterMock.mockResolvedValue({ child_tables: [] });
        fetchChildTabConfigMock.mockResolvedValue([]);
        const { generate_child_tab_config_form } = await loadModule();
        const container = document.createElement('div');

        await generate_child_tab_config_form(container);

        expect(container.textContent).toContain('Referring tab settings');

        document.dispatchEvent(new CustomEvent('checkboxSelectionChanged', {
            detail: { selectedCategories: ['node-1'] },
        }));
        await flushAsyncWork();

        expect(container.textContent).not.toContain('child');
        expect(container.textContent).toContain('comments');
    });

    test('renders header labels as text instead of interpreting translation HTML', async () => {
        endpointRouterMock.mockResolvedValue({ child_tables: [{ dataset: 'invoices' }] });
        fetchChildTabConfigMock.mockResolvedValue([buildTab()]);
        getTranslationForKeyMock.mockImplementation((key) => {
            if (key === 'tab_name') return '<img src=x onerror=alert(1)>Tab';
            if (key === 'visible') return '<b>Visible</b>';
            return key;
        });

        const { generate_child_tab_config_form } = await loadModule();
        const container = document.createElement('div');

        await generate_child_tab_config_form(container);
        document.dispatchEvent(new CustomEvent('checkboxSelectionChanged', {
            detail: { selectedCategories: ['node-1'] },
        }));
        await flushAsyncWork();

        const header = /** @type {HTMLDivElement | null} */ (container.querySelector('.ctc-header'));
        expect(header).not.toBeNull();
        expect(header.querySelector('.ctc-col-name img')).toBeNull();
        expect(header.querySelector('.ctc-col-visible b')).toBeNull();
        expect(header.querySelector('.ctc-col-name')?.textContent).toBe('<img src=x onerror=alert(1)>Tab');
        expect(header.querySelector('.ctc-col-visible')?.textContent).toBe('<b>Visible</b>');
    });

    test('saves child-tab config through the candidate wrapper', async () => {
        endpointRouterMock.mockResolvedValue({ child_tables: [{ dataset: 'invoices' }] });
        fetchChildTabConfigMock.mockResolvedValue([buildTab()]);
        saveChildTabConfigMock.mockResolvedValue({ status: 'ok', message: 'Saved via wrapper' });
        const { generate_child_tab_config_form } = await loadModule();
        const container = document.createElement('div');
        localStorage.setItem('full_tree_data', JSON.stringify({ nodes: [{ id: 'node-1' }] }));

        await generate_child_tab_config_form(container);
        document.dispatchEvent(new CustomEvent('checkboxSelectionChanged', {
            detail: { selectedCategories: ['node-1'] },
        }));
        await flushAsyncWork();

        const editButton = /** @type {HTMLButtonElement | null} */ (
            container.querySelector('[data-lang-key="edit"]')
        );
        const saveButton = /** @type {HTMLButtonElement | null} */ (
            container.querySelector('[data-lang-key="save"]')
        );
        expect(editButton).not.toBeNull();
        expect(saveButton).not.toBeNull();

        editButton.click();
        const checkbox = /** @type {HTMLInputElement | null} */ (
            container.querySelector('.ctc-col-visible input[type="checkbox"]')
        );
        expect(checkbox).not.toBeNull();
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));

        saveButton.click();
        await flushAsyncWork();

        expect(saveChildTabConfigMock).toHaveBeenCalledWith({
            parent_table: 'orders',
            tabs: expect.arrayContaining([
                expect.objectContaining({
                    tab_key: 'invoices',
                    hidden: true,
                }),
                expect.objectContaining({
                    tab_key: '__comments',
                    hidden: false,
                }),
            ]),
        });
        expect(showSuccessToastMock).toHaveBeenCalledWith('saved');
    });
});
