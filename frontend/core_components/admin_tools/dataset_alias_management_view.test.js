// dataset_alias_management_view.test.js
// Verifies the dataset alias admin view uses manifest-backed candidate wrappers for load and save.
// Bridges the rendered alias editor, save payload, and alias-registry refresh under test control.
// Exists to keep the dedicated alias write surface wired to explicit wrappers instead of read-only routes.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const fetchDatasetAliasManagementMock = vi.fn();
const saveDatasetAliasManagementMock = vi.fn();
const createVanillaDropdownMock = vi.fn();
const showErrorToastMock = vi.fn();
const showInfoToastMock = vi.fn();
const showSuccessToastMock = vi.fn();
const showWarningToastMock = vi.fn();
const getDatasetRouteUniquenessHintMock = vi.fn();
const refreshDatasetAliasRegistryMock = vi.fn();

function buildEntry(overrides = {}) {
    return {
        dataset_name: 'app_orders',
        table_uid: 11,
        stored_primary_alias: 'orders',
        effective_public_alias: 'orders',
        alias_source: 'database_primary_active',
        raw_dataset_path: '/app_orders',
        canonical_dataset_path: '/orders',
        public_dataset_path: '/orders',
        default_public_alias_candidate: 'orders',
        default_alias_auto_reserved: true,
        ...overrides,
    };
}

function buildSnapshot(overrides = {}) {
    return {
        datasets: [buildEntry()],
        system_alias_policy_recommendation: 'Keep stripped system_ aliases opt-in and explicitly reviewed.',
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
        fetchDatasetAliasManagement: fetchDatasetAliasManagementMock,
        saveDatasetAliasManagement: saveDatasetAliasManagementMock,
    }));
    vi.doMock('../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js', () => ({
        createVanillaDropdown: createVanillaDropdownMock,
    }));
    vi.doMock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
        showErrorToast: showErrorToastMock,
        showInfoToast: showInfoToastMock,
        showSuccessToast: showSuccessToastMock,
        showWarningToast: showWarningToastMock,
    }));
    vi.doMock('../navigation/nav_engine/dataset_aliases.js', () => ({
        getDatasetRouteUniquenessHint: getDatasetRouteUniquenessHintMock,
        refreshDatasetAliasRegistry: refreshDatasetAliasRegistryMock,
    }));
    return import('./dataset_alias_management_view.js');
}

describe('dataset_alias_management_view', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        fetchDatasetAliasManagementMock.mockReset();
        saveDatasetAliasManagementMock.mockReset();
        createVanillaDropdownMock.mockReset();
        showErrorToastMock.mockReset();
        showInfoToastMock.mockReset();
        showSuccessToastMock.mockReset();
        showWarningToastMock.mockReset();
        getDatasetRouteUniquenessHintMock.mockReset();
        refreshDatasetAliasRegistryMock.mockReset();
        getDatasetRouteUniquenessHintMock.mockReturnValue('Dataset names also reserve their URL routes.');
        refreshDatasetAliasRegistryMock.mockResolvedValue(undefined);
        createVanillaDropdownMock.mockImplementation(() => ({
            setValue: vi.fn(),
        }));
        vi.restoreAllMocks();
    });

    test('loads alias management through the candidate wrapper', async () => {
        fetchDatasetAliasManagementMock.mockResolvedValue(buildSnapshot());
        const { generate_dataset_alias_management_view } = await loadModule();
        const container = document.createElement('div');

        await generate_dataset_alias_management_view(container);

        expect(fetchDatasetAliasManagementMock).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain('Dataset URL Alias Management');
        expect(container.textContent).toContain('Dataset names also reserve their URL routes.');
        expect(container.textContent).toContain('Quick Smoke Test');
        expect(container.textContent).toContain('/app_orders');
        expect(container.textContent).toContain('/orders');
        expect(container.querySelector('[data-testid="dataset-alias-management-input"]')?.value).toBe('orders');
    });

    test('describes automatic app aliases and blocks empty saves that would only clear an implicit alias', async () => {
        fetchDatasetAliasManagementMock.mockResolvedValue(buildSnapshot({
            datasets: [
                buildEntry({
                    stored_primary_alias: '',
                    effective_public_alias: 'orders',
                    alias_source: 'automatic_app_policy',
                    canonical_dataset_path: '/orders',
                    public_dataset_path: '/orders',
                }),
            ],
        }));
        const { generate_dataset_alias_management_view } = await loadModule();
        const container = document.createElement('div');

        await generate_dataset_alias_management_view(container);

        const aliasInput = /** @type {HTMLInputElement | null} */ (
            container.querySelector('[data-testid="dataset-alias-management-input"]')
        );
        const form = /** @type {HTMLFormElement | null} */ (container.querySelector('form'));
        expect(aliasInput).not.toBeNull();
        expect(form).not.toBeNull();
        expect(container.textContent).toContain('Automatic app_ alias');
        expect(container.textContent).toContain('auto-applies for app_ datasets');

        aliasInput.value = '';
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await flushAsyncWork();

        expect(saveDatasetAliasManagementMock).not.toHaveBeenCalled();
        expect(showInfoToastMock).toHaveBeenCalledWith(
            'This alias currently comes from the automatic app_ alias policy. Save a different alias to override it; clearing it keeps the automatic app_ route in place.'
        );
    });

    test('saves alias updates through the candidate wrapper and refreshes the live registry', async () => {
        fetchDatasetAliasManagementMock.mockResolvedValue(buildSnapshot());
        saveDatasetAliasManagementMock.mockResolvedValue({
            status: 'ok',
            message: 'Alias saved',
            dataset: buildEntry({
                stored_primary_alias: 'shop-orders',
                effective_public_alias: 'shop-orders',
                canonical_dataset_path: '/shop-orders',
                public_dataset_path: '/shop-orders',
            }),
            system_alias_policy_recommendation: 'Keep stripped system_ aliases opt-in and explicitly reviewed.',
        });
        const { generate_dataset_alias_management_view } = await loadModule();
        const container = document.createElement('div');

        await generate_dataset_alias_management_view(container);

        const aliasInput = /** @type {HTMLInputElement | null} */ (
            container.querySelector('[data-testid="dataset-alias-management-input"]')
        );
        const form = /** @type {HTMLFormElement | null} */ (container.querySelector('form'));
        expect(aliasInput).not.toBeNull();
        expect(form).not.toBeNull();

        aliasInput.value = 'Shop-Orders';
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await flushAsyncWork();

        expect(saveDatasetAliasManagementMock).toHaveBeenCalledWith({
            dataset_name: 'app_orders',
            alias_slug: 'shop-orders',
        });
        expect(refreshDatasetAliasRegistryMock).toHaveBeenCalledTimes(1);
        expect(showSuccessToastMock).toHaveBeenCalledWith('Alias saved');
        expect(aliasInput.value).toBe('shop-orders');
        expect(container.textContent).toContain('/shop-orders');
    });

    test('offers the stripped candidate as a one-click input helper', async () => {
        fetchDatasetAliasManagementMock.mockResolvedValue(buildSnapshot({
            datasets: [
                buildEntry({
                    dataset_name: 'system_db_table_aliases',
                    stored_primary_alias: '',
                    effective_public_alias: '',
                    alias_source: 'raw_only',
                    raw_dataset_path: '/system_db_table_aliases',
                    canonical_dataset_path: '/system_db_table_aliases',
                    public_dataset_path: '',
                    default_public_alias_candidate: 'db_table_aliases',
                    default_alias_auto_reserved: false,
                }),
            ],
        }));
        const { generate_dataset_alias_management_view } = await loadModule();
        const container = document.createElement('div');

        await generate_dataset_alias_management_view(container);

        const aliasInput = /** @type {HTMLInputElement | null} */ (
            container.querySelector('[data-testid="dataset-alias-management-input"]')
        );
        const useCandidateButton = /** @type {HTMLButtonElement | null} */ (
            container.querySelector('[data-testid="dataset-alias-management-use-candidate"]')
        );
        expect(aliasInput).not.toBeNull();
        expect(useCandidateButton).not.toBeNull();

        useCandidateButton.click();

        expect(aliasInput.value).toBe('db_table_aliases');
    });

    test('skips a no-op save when the alias did not change', async () => {
        fetchDatasetAliasManagementMock.mockResolvedValue(buildSnapshot());
        const { generate_dataset_alias_management_view } = await loadModule();
        const container = document.createElement('div');

        await generate_dataset_alias_management_view(container);

        const form = /** @type {HTMLFormElement | null} */ (container.querySelector('form'));
        expect(form).not.toBeNull();

        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await flushAsyncWork();

        expect(saveDatasetAliasManagementMock).not.toHaveBeenCalled();
        expect(showInfoToastMock).toHaveBeenCalledWith('No changes to save.');
    });
});
