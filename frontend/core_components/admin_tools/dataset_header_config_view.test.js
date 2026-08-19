// dataset_header_config_view.test.js
// Verifies the dataset header admin view uses manifest-backed candidate wrappers for load and save.
// Bridges the rendered form, multipart payload submission, and toast feedback under test control.
// Exists to keep the first stable-candidate migration wired to explicit wrappers instead of endpoint_router.

import { beforeEach, describe, expect, test, vi } from 'vitest';

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
        project_logo_path: '/media/project-logo.png',
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
    vi.doMock('../lang/translation_handler.js', () => ({
        translatePage: translatePageMock,
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
        getLanguageWithBrowserFallbackMock.mockReturnValue('fi');
        localStorage.clear();
        createVanillaDropdownMock.mockImplementation(() => ({
            setValue: vi.fn(),
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
        expect(container.textContent).toContain('Dataset Header Configuration');
        expect(getTitleFiInput(container)?.value).toBe('Tilaukset');
		expect(container.querySelectorAll('.dataset-header-config-media-card')).toHaveLength(2);
		const previewSources = Array.from(container.querySelectorAll('.dataset-header-config-media-card img'))
			.map((image) => image.getAttribute('src'));
		expect(previewSources).toEqual([
			'/storage/104/dataset_media/cover/original/cover.webp',
			'/storage/104/dataset_media/background/original/background.webp',
		]);
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
        tabParts.dataset.tableName = 'orders';
        const resultsSurface = document.createElement('div');
        resultsSurface.className = 'dataset-results-surface';
        tabParts.appendChild(resultsSurface);
        document.body.append(hero, tabParts);

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
        expect(payload.get('remove_project_banner')).toBe('false');
		expect(payload.get('remove_cover_image')).toBe('false');
		expect(payload.get('remove_background_image')).toBe('false');
        expect(payload.get('title_fi')).toBe('Tilaukset nyt');
        expect(showSuccessToastMock).toHaveBeenCalledWith('Saved from wrapper');
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
        expect(hero.style.getPropertyValue('--dataset-cover-image')).toContain('new-cover.webp');
        expect(resultsSurface.classList.contains('dataset-results-surface--has-background')).toBe(true);
        expect(resultsSurface.style.getPropertyValue('--dataset-background-image')).toContain('new-background.webp');
    });
});
