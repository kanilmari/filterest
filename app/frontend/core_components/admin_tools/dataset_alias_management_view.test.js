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
let language = 'en';
const refreshDatasetCatalogueMock = vi.fn();

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

async function loadModule({ realDropdown = false } = {}) {
    vi.resetModules();
    vi.doMock('../endpoints/stable_endpoint_router.js', () => ({
        fetchDatasetAliasManagement: fetchDatasetAliasManagementMock,
        saveDatasetAliasManagement: saveDatasetAliasManagementMock,
    }));
    if (realDropdown) vi.doUnmock('../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js');
    else vi.doMock('../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js', () => ({
        createVanillaDropdown: createVanillaDropdownMock,
    }));
    vi.doMock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
        showErrorToast: showErrorToastMock,
        showInfoToast: showInfoToastMock,
        showSuccessToast: showSuccessToastMock,
        showWarningToast: showWarningToastMock,
    }));
    vi.doMock('../state_stores/lang_preference_reader.js', () => ({ getLanguageWithBrowserFallback: () => language }));
    vi.doMock('../lang/component_language_dictionary.js', () => ({
        getTranslationForKey: (_key, { fallback }) => fallback,
        loadTranslationsForLanguage: vi.fn().mockResolvedValue({}),
    }));
    vi.doMock('../navigation/nav_engine/dataset_access_registry.js', () => ({
        refreshDatasetCatalogue: refreshDatasetCatalogueMock,
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
        language = 'en';
        refreshDatasetCatalogueMock.mockReset();
        refreshDatasetCatalogueMock.mockResolvedValue(undefined);
        createVanillaDropdownMock.mockImplementation(() => ({
            setValue: vi.fn(),
            setPlaceholders: vi.fn(),
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
        // Forced: a registry loaded moments ago would otherwise keep the old alias.
        expect(refreshDatasetCatalogueMock).toHaveBeenCalledExactlyOnceWith({ force: true });
        expect(showSuccessToastMock).toHaveBeenCalledWith('Dataset alias saved');
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
    test.each([
        ['en', 'This name already belongs to another dataset or a reserved route. Choose another name.', 'dataset_namespace_conflict'],
        ['fi', 'Nimi kuuluu jo toiselle aineistolle tai varatulle osoitteelle. Valitse toinen nimi.', 'dataset_namespace_conflict'],
        ['ch', '此名称已属于其他数据集或保留网址。请选择其他名称。', 'dataset_namespace_conflict'],
        ['yue', '呢個名稱已屬於另一個資料集或保留網址。請揀另一個名稱。', 'dataset_namespace_conflict'],
        ['en', 'Dataset names changed during this operation. Please retry.', 'dataset_namespace_retry'],
        ['fi', 'Aineistojen nimet muuttuivat toiminnon aikana. Yritä uudelleen.', 'dataset_namespace_retry'],
        ['ch', '操作期间数据集名称发生了变化。请重试。', 'dataset_namespace_retry'],
        ['yue', '操作期間資料集名稱有變。請再試。', 'dataset_namespace_retry'],
    ])('translates a namespace refusal in %s and preserves the draft and accepted preview', async (locale, notice, langKey) => {
        language = locale;
        fetchDatasetAliasManagementMock.mockResolvedValue(buildSnapshot());
        saveDatasetAliasManagementMock.mockRejectedValue(Object.assign(new Error('Technical server detail'), {
            status: 409, failureNotice: { langKey },
        }));
        const { generate_dataset_alias_management_view } = await loadModule();
        const container = document.createElement('div');
        await generate_dataset_alias_management_view(container);
        const input = container.querySelector('[data-testid="dataset-alias-management-input"]');
        input.value = 'Reports';
        container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await flushAsyncWork();
        expect(showErrorToastMock).toHaveBeenCalledExactlyOnceWith(notice);
        expect(showSuccessToastMock).not.toHaveBeenCalled();
        expect(refreshDatasetCatalogueMock).not.toHaveBeenCalled();
        expect(input.value).toBe('Reports');
        expect(input.disabled).toBe(false);
        expect(container.textContent).toContain('/orders');
        expect(container.textContent).not.toContain('/reports');
    });

    test('renders the preserved audit reason in Finnish after a successful clear', async () => {
        language = 'fi';
        const disabled = [{ alias_slug: 'reports', reason_key: 'dataset_namespace_real_name_conflict' }];
        fetchDatasetAliasManagementMock.mockResolvedValue(buildSnapshot({ datasets: [buildEntry({ disabled_aliases: disabled })] }));
        saveDatasetAliasManagementMock.mockResolvedValue({ dataset: buildEntry({
            stored_primary_alias: '', effective_public_alias: 'orders', alias_source: 'automatic_app_policy', disabled_aliases: disabled,
        }) });
        const { generate_dataset_alias_management_view } = await loadModule();
        const container = document.createElement('div');
        await generate_dataset_alias_management_view(container);
        const audit = container.querySelector('[data-testid="dataset-alias-management-audit"]');
        expect(audit.hidden).toBe(false);
        expect(audit.textContent).toContain('Alias on poistettu käytöstä, koska nimi kuuluu varsinaiselle aineistolle. Aliastiedot on säilytetty.');
        container.querySelector('[data-testid="dataset-alias-management-clear"]').click();
        await flushAsyncWork();
        expect(saveDatasetAliasManagementMock).toHaveBeenCalledWith({ dataset_name: 'app_orders', alias_slug: '' });
        expect(showSuccessToastMock).toHaveBeenCalledWith('Aineiston alias poistettu.');
        expect(audit.textContent).toContain('reports');
        expect(audit.hidden).toBe(false);
    });

    test('hides audit notices when the dataset has no disabled aliases', async () => {
        fetchDatasetAliasManagementMock.mockResolvedValue(buildSnapshot());
        const { generate_dataset_alias_management_view } = await loadModule();
        const container = document.createElement('div');
        await generate_dataset_alias_management_view(container);
        expect(container.querySelector('[data-testid="dataset-alias-management-audit"]').hidden).toBe(true);
    });

    test.each([['raw_only', false], ['raw_only', true], ['automatic_app_policy', false], ['code_fallback', false], ['database_primary_active', false]])(
        'refreshes every open-editor text and audit notice in %s / no candidate %s while preserving drafts', async (aliasSource, noCandidate) => {
            const disabled = [
                'dataset_namespace_real_name_conflict', 'dataset_namespace_automatic_conflict',
                'dataset_namespace_alias_conflict', 'dataset_namespace_conflict', 'dataset_namespace_invalid',
            ].map((reason_key, index) => ({ alias_slug: `disabled-${index}`, reason_key }));
            fetchDatasetAliasManagementMock.mockResolvedValue(buildSnapshot({ datasets: [buildEntry({
                alias_source: aliasSource, stored_primary_alias: aliasSource === 'database_primary_active' ? 'orders' : '',
                public_dataset_path: '', disabled_aliases: disabled,
                default_alias_auto_reserved: aliasSource === 'automatic_app_policy',
                default_public_alias_candidate: noCandidate ? '' : 'orders',
            })] }));
            const { generate_dataset_alias_management_view } = await loadModule({ realDropdown: true });
            const { refreshLocalizedDatasetValues } = await import('../table_views/dataset_value_localizer.js');
            const container = document.createElement('div');
            document.body.append(container);
            await generate_dataset_alias_management_view(container);
            const input = container.querySelector('[data-testid="dataset-alias-management-input"]');
            input.value = 'My-Draft';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const dropdownContainer = container.querySelector('[data-testid="dataset-alias-management-dataset"]');
            dropdownContainer.__dropdown.open();
            const search = document.querySelector('[data-testid="dataset-alias-management-dataset-search-input"]');
            search.value = 'orders';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
            input.setSelectionRange(1, 4);
            const translated = [...container.querySelectorAll('h2,h3,label,p:not(.dataset-alias-management-audit p),.dataset-alias-management-preview-label,.dataset-alias-management-audit span,.dataset-alias-management-actions button')];
            const dynamic = [...container.querySelectorAll('.dataset-alias-management-preview-value')]
                .filter(node => !node.textContent.startsWith('/'));
            const nodes = [...translated, ...dynamic];
            const english = nodes.map(node => node.textContent);
            const placeholders = [input, container.querySelector('.vdw-dropdown-input'), search];
            const englishPlaceholders = placeholders.map(node => node.placeholder);
            language = 'fi';
            await refreshLocalizedDatasetValues('fi', container);
            nodes.forEach((node, index) => {
                expect(node.isConnected).toBe(true);
                expect(node.textContent, `unchanged text: ${english[index]}`).not.toBe(english[index]);
            });
            placeholders.forEach((node, index) => expect(node.placeholder).not.toBe(englishPlaceholders[index]));
            expect(container.querySelector('h2').textContent).toBe('Aineistojen URL-aliakset');
            expect(container.querySelector('.dataset-alias-management-audit').textContent).toContain('Aliastiedot on säilytetty.');
            expect(input.value).toBe('My-Draft');
            expect(document.activeElement).toBe(input);
            expect([input.selectionStart, input.selectionEnd]).toEqual([1, 4]);
            expect(search.value).toBe('orders');
            expect(dropdownContainer.__dropdown.getValue()).toBe('app_orders');
            expect(container.textContent).toContain('/orders');
            expect(fetchDatasetAliasManagementMock).toHaveBeenCalledTimes(1);
            dropdownContainer.__dropdown.destroy();
        }
    );

});
