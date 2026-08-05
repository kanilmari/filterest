import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouter = vi.fn();
const languageFallback = vi.fn();
const buildQueryParams = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock('./endpoint_router.js', () => ({
        endpoint_router: endpointRouter,
    }));
    vi.doMock('../state_stores/lang_preference_reader.js', () => ({
        getLanguageWithBrowserFallback: languageFallback,
    }));
    vi.doMock('./endpoint_data_fetcher_helpers.js', () => ({
        buildDatasetQueryParams: buildQueryParams,
    }));
    return import('./endpoint_data_fetcher.js');
}

describe('endpoint_data_fetcher', () => {
    beforeEach(() => {
        endpointRouter.mockReset();
        languageFallback.mockReset();
        buildQueryParams.mockReset();
        vi.unstubAllGlobals();
    });

    test('fetchFilterOptions delegates through endpoint_router with encoded query params', async () => {
        endpointRouter.mockResolvedValue([{ value: 1, label: 'One' }]);

        const mod = await loadModule();
        const result = await mod.fetchFilterOptions({
            dataset_name: 'app demo',
            value_column: 'display name',
        });

        expect(result).toEqual([{ value: 1, label: 'One' }]);
        expect(endpointRouter).toHaveBeenCalledWith('getFilterOptions', {
            url_params: '?dataset=app+demo&value_column=display+name',
        });
    });

    test('fetchFilterOptions requires a dataset name', async () => {
        const mod = await loadModule();

        await expect(mod.fetchFilterOptions()).rejects.toThrow('fetchFilterOptions requires dataset_name');
    });

    test('fetchDatasetData still delegates through endpoint_router', async () => {
        endpointRouter.mockResolvedValue({ rows: [] });
        languageFallback.mockReturnValue('fi');
        buildQueryParams.mockReturnValue('?dataset=test&offset=0&lang=fi');

        const mod = await loadModule();
        const result = await mod.fetchDatasetData({ dataset_name: 'test' });

        expect(result).toEqual({ rows: [] });
        expect(endpointRouter).toHaveBeenCalledWith('getResults', { url_params: '?dataset=test&offset=0&lang=fi' });
    });

    test('fetchDatasetData forwards card support requests into query building', async () => {
        endpointRouter.mockResolvedValue({ rows: [] });
        languageFallback.mockReturnValue('fi');
        buildQueryParams.mockReturnValue('?dataset=test&offset=0&lang=fi&include_card_support=1');

        const mod = await loadModule();
        await mod.fetchDatasetData({
            dataset_name: 'test',
            include_card_support: true,
        });

        expect(buildQueryParams).toHaveBeenCalledWith(expect.objectContaining({
            dataset_name: 'test',
            include_card_support: true,
        }));
    });

    test('fetchDatasetData forwards map support requests into query building', async () => {
        endpointRouter.mockResolvedValue({ rows: [] });
        languageFallback.mockReturnValue('fi');
        buildQueryParams.mockReturnValue('?dataset=places&offset=0&lang=fi&include_map_support=1');

        const mod = await loadModule();
        await mod.fetchDatasetData({
            dataset_name: 'places',
            include_map_support: true,
        });

        expect(buildQueryParams).toHaveBeenCalledWith(expect.objectContaining({
            dataset_name: 'places',
            include_map_support: true,
        }));
    });
});
