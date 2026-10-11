// @vitest-environment jsdom
// dataset_aliases.test.js
// Verifies compatibility helpers delegate to the readable catalogue for every viewer.
// Bridges reload/save timing regressions and the single name/uid registry.
// Keeps obsolete storage timestamps and response order from changing name ownership.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
const catalogue = (preferred = 'orders') => ({ datasets: [{
    id: 900, table_uid: 11, dataset_name: 'app_orders',
    names: ['app_orders', preferred], preferred_name: preferred, can_read_rows: true,
}] });

async function loadModule() {
    vi.resetModules();
    vi.doMock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: endpointRouterMock }));
    return import('./dataset_aliases.js');
}

const readStorage = () => Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
    const key = localStorage.key(index);
    return [key, localStorage.getItem(key)];
}));

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    endpointRouterMock.mockReset();
});

describe('catalogue-backed dataset aliases', () => {
    test.each(['login', 'logout'])('loads readable names without alias-endpoint rights, shell=%s', async shell => {
        localStorage.setItem('button_state', shell);
        endpointRouterMock.mockResolvedValue(catalogue('shop-orders'));
        const aliases = await loadModule();
        await aliases.refreshDatasetAliasRegistry();
        expect(aliases.getInternalDatasetName('shop-orders')).toBe('app_orders');
        expect(aliases.getPublicDatasetName('app_orders')).toBe('shop-orders');
        expect(aliases.buildDatasetPath('app_orders', '/admin/')).toBe('/admin/shop-orders');
        expect(endpointRouterMock).toHaveBeenCalledExactlyOnceWith('fetchContentTables', {
            suppressAuthRedirect: true, suppressErrorToast: true,
        });
    });

    test('resolution has no network or prefix/fallback side effects before bootstrap', async () => {
        localStorage.setItem('button_state', 'logout');
        const aliases = await loadModule();
        expect(aliases.getInternalDatasetName('service_catalog')).toBe('service_catalog');
        expect(aliases.getPublicDatasetName('app_orders')).toBe('app_orders');
        expect(aliases.buildDatasetPath('app_orders')).toBe('/app_orders');
        await Promise.resolve();
        expect(endpointRouterMock).not.toHaveBeenCalled();
    });

    test('reuses only a successful catalogue held by this page', async () => {
        endpointRouterMock.mockResolvedValue(catalogue());
        const aliases = await loadModule();
        await aliases.refreshDatasetAliasRegistry();
        await aliases.refreshDatasetAliasRegistry();
        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
    });

    test('loads names again on a page reloaded within a minute', async () => {
        endpointRouterMock.mockResolvedValue(catalogue());
        const stored = readStorage();
        const first = await loadModule();
        await first.refreshDatasetAliasRegistry();
        expect(first.buildDatasetPath('app_orders')).toBe('/orders');
        expect(readStorage()).toEqual(stored);
        const reloaded = await loadModule();
        expect(reloaded.getInternalDatasetName('orders')).toBe('orders');
        await reloaded.refreshDatasetAliasRegistry();
        expect(reloaded.getInternalDatasetName('orders')).toBe('app_orders');
        expect(endpointRouterMock).toHaveBeenCalledTimes(2);
    });

    test('ignores obsolete stored freshness timestamps', async () => {
        localStorage.setItem('easelect_dataset_alias_refresh_at', String(Date.now()));
        endpointRouterMock.mockResolvedValue(catalogue());
        const aliases = await loadModule();
        await aliases.refreshDatasetAliasRegistry();
        expect(aliases.getInternalDatasetName('orders')).toBe('app_orders');
        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
    });

    test.each([null, {}, { datasets: null }])('retries malformed responses %j', async payload => {
        endpointRouterMock.mockResolvedValueOnce(payload).mockResolvedValueOnce(catalogue());
        const aliases = await loadModule();
        await aliases.refreshDatasetAliasRegistry();
        await aliases.refreshDatasetAliasRegistry();
        expect(aliases.getInternalDatasetName('orders')).toBe('app_orders');
        expect(endpointRouterMock).toHaveBeenCalledTimes(2);
    });

    test('retries failure immediately, retaining the last snapshot until a successful replacement', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        endpointRouterMock.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(catalogue())
            .mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(catalogue('shop-orders'));
        try {
            const aliases = await loadModule();
            await aliases.refreshDatasetAliasRegistry();
            expect(aliases.getInternalDatasetName('orders')).toBe('orders');
            await aliases.refreshDatasetAliasRegistry();
            await aliases.refreshDatasetAliasRegistry({ force: true });
            expect(aliases.getInternalDatasetName('orders')).toBe('app_orders');
            await aliases.refreshDatasetAliasRegistry();
            expect(aliases.buildDatasetPath('app_orders')).toBe('/shop-orders');
            expect(endpointRouterMock).toHaveBeenCalledTimes(4);
        } finally { warning.mockRestore(); }
    });

    test('force refresh bypasses a fresh catalogue after an alias save', async () => {
        endpointRouterMock.mockResolvedValueOnce(catalogue()).mockResolvedValueOnce(catalogue('shop-orders'));
        const aliases = await loadModule();
        await aliases.refreshDatasetAliasRegistry();
        await aliases.refreshDatasetAliasRegistry();
        await aliases.refreshDatasetAliasRegistry({ force: true });
        expect(aliases.buildDatasetPath('app_orders')).toBe('/shop-orders');
        expect(endpointRouterMock).toHaveBeenCalledTimes(2);
    });

    test.each([true, false])('only the newest response applies; old response first=%s', async oldFirst => {
        let oldAnswer, newAnswer;
        endpointRouterMock.mockImplementationOnce(() => new Promise(resolve => { oldAnswer = resolve; }))
            .mockImplementationOnce(() => new Promise(resolve => { newAnswer = resolve; }));
        const aliases = await loadModule();
        const oldLoad = aliases.refreshDatasetAliasRegistry();
        const newLoad = aliases.refreshDatasetAliasRegistry({ force: true });
        if (oldFirst) { oldAnswer(catalogue()); await oldLoad; }
        newAnswer(catalogue('shop-orders'));
        await newLoad;
        if (!oldFirst) { oldAnswer(catalogue()); await oldLoad; }
        expect(aliases.buildDatasetPath('app_orders')).toBe('/shop-orders');
    });

    test('empty successful catalogue removes earlier aliases and stays fresh', async () => {
        endpointRouterMock.mockResolvedValueOnce(catalogue()).mockResolvedValueOnce({ datasets: [] });
        const aliases = await loadModule();
        await aliases.refreshDatasetAliasRegistry();
        await aliases.refreshDatasetAliasRegistry({ force: true });
        await aliases.refreshDatasetAliasRegistry();
        expect(aliases.getInternalDatasetName('orders')).toBe('orders');
        expect(aliases.buildDatasetPath('app_orders')).toBe('/app_orders');
        expect(endpointRouterMock).toHaveBeenCalledTimes(2);
    });

    test('describes the existing automatic/opt-in policy in the editor hint', async () => {
        const aliases = await loadModule();
        expect(aliases.getDatasetRouteUniquenessHint()).toContain('app_ datasets auto-reserve');
        expect(aliases.getDatasetRouteUniquenessHint()).toContain('system_ stripped aliases stay opt-in only');
    });
});


test('compatibility refresh returns immutable name maps on success and failure', async () => {
    endpointRouterMock.mockResolvedValueOnce(catalogue()).mockRejectedValueOnce(new Error('offline'));
    const aliases = await loadModule();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        const expected = { rawToPublic: { app_orders: 'orders' }, publicToRaw: { orders: 'app_orders' } };
        const result = await aliases.refreshDatasetAliasRegistry();
        expect(result).toEqual(expected);
        expect(Object.isFrozen(result.rawToPublic)).toBe(true);
        expect(await aliases.refreshDatasetAliasRegistry({ force: true })).toEqual(expected);
    } finally { warning.mockRestore(); }
});
