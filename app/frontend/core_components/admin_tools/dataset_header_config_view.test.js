// dataset_header_config_view.test.js
// Verifies the dataset header admin view uses manifest-backed candidate wrappers for load and save.
// Bridges the rendered form, multipart payload submission, and toast feedback under test control.
// Exists to keep the first stable-candidate migration wired to explicit wrappers instead of endpoint_router.

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DATASET_HEADER_CONFIG_TRANSLATION_FALLBACKS as COPY } from './dataset_header_config_translation_fallbacks.js';

const endpointRouterMock = vi.fn();
const fetchDatasetHeaderConfigMock = vi.fn();
const saveDatasetHeaderConfigMock = vi.fn();
const createVanillaDropdownMock = vi.fn();
const showErrorToastMock = vi.fn();
const showInfoToastMock = vi.fn();
const showSuccessToastMock = vi.fn();
const showWarningToastMock = vi.fn();
const translatePageMock = vi.fn();
const getLanguageWithBrowserFallbackMock = vi.fn();
const datasetDropdownSetValueMock = vi.fn();

function buildConfig(overrides = {}) {
    return {
        dataset_name: 'orders',
        title: {
            lang_key: 'orders_front_page',
            fi: 'Tilaukset',
            en: 'Orders',
            ch: '',
            usage_explanation: 'Dataset hero title',
        },
        slogan: {
            lang_key: 'search_slogan_orders',
            fi: 'Selaa tilauksia',
            en: 'Browse orders',
            ch: '',
            usage_explanation: 'Dataset hero slogan',
        },
        search_placeholder: {
            lang_key: 'search_for_orders',
            fi: 'Hae tilauksia',
            en: 'Search orders',
            ch: '',
            usage_explanation: 'Dataset hero search prompt',
        },
		cover_image_path: '/storage/104/dataset_media/cover/original/cover.webp',
		background_image_path: '/storage/104/dataset_media/background/original/background.webp',
        ...overrides,
    };
}

function getTitleFiInput(container) {
    return /** @type {HTMLInputElement | null} */ (
        container.querySelector('.dataset-header-config-text-card input[type="text"]:not([readonly])')
    );
}

// Stands in for a person picking a file: browsers let code clear a file input
// by setting its value to '' but never set it, so the test models both sides.
function pickFile(input, file) {
    let files = [file];
    Object.defineProperty(input, 'files', { configurable: true, get: () => files });
    Object.defineProperty(input, 'value', {
        configurable: true,
        get: () => (files.length ? `C:\\fakepath\\${files[0].name}` : ''),
        set: (value) => {
            if (value === '') files = [];
        },
    });
    input.dispatchEvent(new Event('change'));
}

function submitForm(container) {
    container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
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
        fetchDatasetHeaderConfig: fetchDatasetHeaderConfigMock,
        saveDatasetHeaderConfig: saveDatasetHeaderConfigMock,
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
    // The screen's own English copy stands in for the site's translations.
    vi.doMock('../lang/translation_handler.js', () => ({
        translatePage: translatePageMock,
        getTranslationForKey: (key) => COPY[key]?.en ?? key,
    }));
    vi.doMock('../state_stores/lang_preference_reader.js', () => ({
        getLanguageWithBrowserFallback: getLanguageWithBrowserFallbackMock,
    }));
    return import('./dataset_header_config_view.js');
}

describe('dataset_header_config_view', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        document.head.innerHTML = '';
        endpointRouterMock.mockReset();
        fetchDatasetHeaderConfigMock.mockReset();
        saveDatasetHeaderConfigMock.mockReset();
        createVanillaDropdownMock.mockReset();
        showErrorToastMock.mockReset();
        showInfoToastMock.mockReset();
        showSuccessToastMock.mockReset();
        showWarningToastMock.mockReset();
        translatePageMock.mockReset();
        getLanguageWithBrowserFallbackMock.mockReset();
        datasetDropdownSetValueMock.mockReset();
        getLanguageWithBrowserFallbackMock.mockReturnValue('fi');
        localStorage.clear();
        createVanillaDropdownMock.mockImplementation(() => ({
            setValue: datasetDropdownSetValueMock,
        }));
        vi.restoreAllMocks();
    });

    test('loads dataset config through the candidate wrapper while keeping datasetNames on endpoint_router', async () => {
        endpointRouterMock.mockResolvedValue(['orders']);
        fetchDatasetHeaderConfigMock.mockResolvedValue(buildConfig());
        const { generate_dataset_header_config_view } = await loadModule();
        const container = document.createElement('div');

        await generate_dataset_header_config_view(container);

        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
        expect(endpointRouterMock).toHaveBeenCalledWith('datasetNames');
        expect(fetchDatasetHeaderConfigMock).toHaveBeenCalledWith('orders');
        expect(container.textContent).toContain('Dataset header configuration');
        expect(container.textContent).not.toContain('Project Banner');
        expect(container.querySelector('input[name="project_banner_image"]')).toBeNull();
        expect(getTitleFiInput(container)?.value).toBe('Tilaukset');
		expect(container.querySelectorAll('.dataset-header-config-media-card')).toHaveLength(2);
		const previewSources = Array.from(container.querySelectorAll('.dataset-header-config-media-card img'))
			.map((image) => image.getAttribute('src'));
		expect(previewSources).toEqual([
			'/storage/104/dataset_media/cover/original/cover.webp',
			'/storage/104/dataset_media/background/original/background.webp',
		]);
    });

    test('selects the requested active dataset when opened from its hero', async () => {
        endpointRouterMock.mockResolvedValue(['orders', 'invoices']);
        fetchDatasetHeaderConfigMock.mockResolvedValue(buildConfig({
            dataset_name: 'invoices',
        }));
        const { generate_dataset_header_config_view } = await loadModule();
        const container = document.createElement('div');

        await generate_dataset_header_config_view(container, {
            initialDatasetName: 'invoices',
        });

        expect(datasetDropdownSetValueMock).toHaveBeenCalledWith('invoices');
        expect(fetchDatasetHeaderConfigMock).toHaveBeenCalledTimes(1);
        expect(fetchDatasetHeaderConfigMock).toHaveBeenCalledWith('invoices');
    });

    test('submits multipart saves through the candidate wrapper', async () => {
        endpointRouterMock.mockResolvedValue(['orders']);
        fetchDatasetHeaderConfigMock.mockResolvedValue(buildConfig());
        saveDatasetHeaderConfigMock.mockResolvedValue({
            status: 'ok',
            message: 'Saved from wrapper',
            config: buildConfig({
                cover_image_path: '/storage/104/dataset_media/cover/original/new-cover.webp',
                background_image_path: '/storage/104/dataset_media/background/original/new-background.webp',
                title: {
                    lang_key: 'orders_front_page',
                    fi: 'Tilaukset nyt',
                    en: 'Orders now',
                    ch: '',
                    usage_explanation: 'Updated title',
                },
            }),
        });
        const { generate_dataset_header_config_view } = await loadModule();
        const container = document.createElement('div');

        localStorage.setItem('table_specs', JSON.stringify({
            orders: { table_uid: 104, card_style_variant: 'standard' },
            invoices: { table_uid: 105 },
        }));
        const hero = document.createElement('div');
        hero.className = 'filterbar-inline-hero';
        hero.dataset.filterbarInlineHeroFor = 'orders';
        const tabParts = document.createElement('div');
        tabParts.className = 'tab_parts_container';
        const contentArea = document.createElement('div');
        contentArea.className = 'tab-content-area';
        contentArea.dataset.tableName = 'orders';
        tabParts.appendChild(contentArea);
        const tabButton = document.createElement('button');
        tabButton.className = 'navtablinks';
        tabButton.dataset.id = 'orders';
        tabButton.dataset.hasPresentationMedia = 'false';
        document.body.append(hero, tabParts, tabButton);

        await generate_dataset_header_config_view(container);

        const titleFiInput = getTitleFiInput(container);
        expect(titleFiInput).not.toBeNull();
        titleFiInput.value = 'Tilaukset nyt';

        const form = /** @type {HTMLFormElement | null} */ (container.querySelector('form'));
        expect(form).not.toBeNull();
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await flushAsyncWork();

        expect(saveDatasetHeaderConfigMock).toHaveBeenCalledTimes(1);
        const payload = saveDatasetHeaderConfigMock.mock.calls[0][0];
        expect(payload).toBeInstanceOf(FormData);
        expect(payload.get('dataset_name')).toBe('orders');
        expect(payload.has('remove_project_banner')).toBe(false);
		expect(payload.get('remove_cover_image')).toBe('false');
		expect(payload.get('remove_background_image')).toBe('false');
        expect(payload.get('title_fi')).toBe('Tilaukset nyt');
        expect(showSuccessToastMock).toHaveBeenCalledWith('Saved');
        expect(translatePageMock).toHaveBeenCalledWith('fi');

        const tableSpecs = JSON.parse(localStorage.getItem('table_specs'));
        expect(tableSpecs.orders).toEqual(expect.objectContaining({
            table_uid: 104,
            card_style_variant: 'standard',
            dataset_cover_image_path: '/storage/104/dataset_media/cover/original/new-cover.webp',
            dataset_background_image_path: '/storage/104/dataset_media/background/original/new-background.webp',
        }));
        expect(tableSpecs.invoices).toEqual({ table_uid: 105 });
        expect(hero.classList.contains('filterbar-inline-hero--has-cover')).toBe(true);
        expect(hero.style.getPropertyValue('--dataset-cover-image')).toContain('/cover/1000/new-cover.webp');
        expect(contentArea.classList.contains('tab-content-area--has-dataset-background')).toBe(true);
        expect(contentArea.style.getPropertyValue('--dataset-background-image')).toContain('/background/2160/new-background.webp');
        expect(tabButton.dataset.hasPresentationMedia).toBe('true');
        expect(document.querySelector('meta[name="project-logo-path"]')).toBeNull();
    });

    test('forgets picked images and removal ticks when the next dataset fails to load', async () => {
        const originalCreateObjectURL = URL.createObjectURL;
        const originalRevokeObjectURL = URL.revokeObjectURL;
        URL.createObjectURL = vi.fn(() => 'blob:picked-cover');
        URL.revokeObjectURL = vi.fn();
        try {
            endpointRouterMock.mockResolvedValue(['invoices', 'orders']);
            fetchDatasetHeaderConfigMock
                .mockResolvedValueOnce(buildConfig())
                .mockRejectedValueOnce(new Error('Loading invoices failed'))
                .mockResolvedValueOnce(buildConfig({ dataset_name: 'invoices' }));
            saveDatasetHeaderConfigMock.mockResolvedValue({
                status: 'ok',
                config: buildConfig({ dataset_name: 'invoices' }),
            });
            const { generate_dataset_header_config_view } = await loadModule();
            const container = document.createElement('div');
            await generate_dataset_header_config_view(container, { initialDatasetName: 'orders' });

            pickFile(
                container.querySelector('input[name="cover_image"]'),
                new File(['png'], 'cover.png', { type: 'image/png' })
            );
            const removeBackground = /** @type {HTMLInputElement} */ (
                container.querySelector('input[name="remove_background_image"]')
            );
            removeBackground.checked = true;
            removeBackground.dispatchEvent(new Event('change'));
            expect(container.textContent).toContain('Unsaved changes');

            const { onChange } = createVanillaDropdownMock.mock.calls[0][0];
            await onChange('invoices');
            // The request pipeline reports the failure itself; the view adds no second toast.
            expect(showErrorToastMock).not.toHaveBeenCalled();
            expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:picked-cover');
            expect(container.textContent).not.toContain('Unsaved changes');
            expect(removeBackground.checked).toBe(false);

            // Choosing the dataset again loads it, and only then can it be saved.
            await onChange('invoices');
            submitForm(container);
            await flushAsyncWork();

            const payload = saveDatasetHeaderConfigMock.mock.calls[0][0];
            expect(payload.get('dataset_name')).toBe('invoices');
            expect(payload.get('cover_image')).toBeNull();
            expect(payload.get('remove_cover_image')).toBe('false');
            expect(payload.get('remove_background_image')).toBe('false');
        } finally {
            URL.createObjectURL = originalCreateObjectURL;
            URL.revokeObjectURL = originalRevokeObjectURL;
        }
    });

    test('refuses to save a dataset whose settings did not load, and says why', async () => {
        endpointRouterMock.mockResolvedValue(['invoices', 'orders']);
        fetchDatasetHeaderConfigMock
            .mockResolvedValueOnce(buildConfig())
            .mockRejectedValueOnce(new Error('Loading invoices failed'));
        const { generate_dataset_header_config_view } = await loadModule();
        const container = document.createElement('div');
        await generate_dataset_header_config_view(container, { initialDatasetName: 'orders' });
        const saveButton = /** @type {HTMLButtonElement} */ (container.querySelector('button[type="submit"]'));
        const status = /** @type {HTMLElement} */ (container.querySelector('.dataset-header-config-save-status'));
        expect(saveButton.disabled).toBe(false);
        expect(status.hidden).toBe(true);

        const { onChange } = createVanillaDropdownMock.mock.calls[0][0];
        await onChange('invoices');

        // The form still shows the orders texts; saving them to invoices is refused.
        expect(getTitleFiInput(container)?.value).toBe('Tilaukset');
        expect(saveButton.disabled).toBe(true);
        expect(status.hidden).toBe(false);
        expect(status.textContent).toBe(COPY.dataset_header_config_not_loaded.en);
        expect(status.getAttribute('role')).toBe('status');
        submitForm(container);
        await flushAsyncWork();
        expect(saveDatasetHeaderConfigMock).not.toHaveBeenCalled();
        expect(showInfoToastMock).toHaveBeenCalledWith(COPY.dataset_header_config_not_loaded.en);
    });

    test('ignores a slower load for a dataset the admin already left', async () => {
        endpointRouterMock.mockResolvedValue(['invoices', 'orders']);
        let finishOrdersReload;
        fetchDatasetHeaderConfigMock
            .mockResolvedValueOnce(buildConfig({ dataset_name: 'invoices', title: { lang_key: 'invoices_front_page', fi: 'Laskut' } }))
            .mockImplementationOnce(() => new Promise((resolve) => { finishOrdersReload = resolve; }))
            .mockResolvedValueOnce(buildConfig({ dataset_name: 'invoices', title: { lang_key: 'invoices_front_page', fi: 'Laskut' } }));
        const { generate_dataset_header_config_view } = await loadModule();
        const container = document.createElement('div');
        await generate_dataset_header_config_view(container, { initialDatasetName: 'invoices' });
        const { onChange } = createVanillaDropdownMock.mock.calls[0][0];

        const ordersLoad = onChange('orders');
        await onChange('invoices');
        finishOrdersReload(buildConfig());
        await ordersLoad;

        expect(getTitleFiInput(container)?.value).toBe('Laskut');
        expect(container.querySelector('button[type="submit"]').disabled).toBe(false);
    });

    test('leaves failed requests to the pipeline\'s own notice and words only its own failures', async () => {
        endpointRouterMock.mockRejectedValueOnce(new Error('Virhe pyynnössä (datasetNames): boom'));
        const { generate_dataset_header_config_view } = await loadModule();
        await generate_dataset_header_config_view(document.createElement('div'));
        expect(showErrorToastMock).not.toHaveBeenCalled();
        expect(showWarningToastMock).not.toHaveBeenCalled();

        endpointRouterMock.mockResolvedValue(['orders']);
        fetchDatasetHeaderConfigMock.mockResolvedValue(buildConfig());
        saveDatasetHeaderConfigMock
            .mockRejectedValueOnce(Object.assign(new Error('Virhe pyynnössä (saveDatasetHeaderConfig): {}'), { status: 500 }))
            .mockResolvedValueOnce({ status: 'ok' });
        const container = document.createElement('div');
        await generate_dataset_header_config_view(container);
        submitForm(container);
        await flushAsyncWork();
        expect(showErrorToastMock).not.toHaveBeenCalled();
        expect(container.querySelector('button[type="submit"]').disabled).toBe(false);

        submitForm(container);
        await flushAsyncWork();
        expect(showErrorToastMock).toHaveBeenCalledWith(COPY.save_failed.en);
        expect(showSuccessToastMock).not.toHaveBeenCalled();
    });

    test('every text on the screen has Finnish, English, Chinese and Cantonese copy', async () => {
        endpointRouterMock.mockResolvedValue(['orders']);
        fetchDatasetHeaderConfigMock.mockResolvedValue(buildConfig({ cover_image_path: '' }));
        const { generate_dataset_header_config_view } = await loadModule();
        const container = document.createElement('div');
        await generate_dataset_header_config_view(container, { onDismiss: () => {} });

        const keys = new Set(
            Array.from(container.querySelectorAll('[data-lang-key], [data-title-lang-key], [data-aria-label-lang-key]'))
                .flatMap((element) => [element.dataset.langKey, element.dataset.titleLangKey, element.dataset.ariaLabelLangKey])
                .filter(Boolean)
        );
        for (const key of ['dataset_select_target', 'search', 'dataset_header_config_usage_placeholder',
            'dataset_header_config_not_loaded', 'dataset_header_config_no_datasets', 'saved', 'save_failed',
            'unsaved_changes']) {
            keys.add(key);
        }
        expect(keys.size).toBeGreaterThan(20);
        for (const key of keys) {
            for (const language of ['fi', 'en', 'ch', 'yue']) {
                expect(COPY[key]?.[language], `${key} ${language}`).toMatch(/\S/);
            }
        }
        expect(Object.keys(COPY).filter((key) => !keys.has(key))).toEqual([]);
    });
});
