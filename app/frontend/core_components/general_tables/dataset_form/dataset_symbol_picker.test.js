// @vitest-environment jsdom
// dataset_symbol_picker.test.js
// Verifies the symbol control the dataset forms share.
// Bridges the safe symbol registry, the chosen key and the assignment request.
// Exists so a dataset's symbol is saved — or removed — deliberately, and never guessed.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: (...args) => endpointRouterMock(...args),
}));
vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback } = {}) => fallback,
}));

const { createDatasetSymbolPicker, readDatasetSymbol, datasetSymbolCopy } = await import(
    './dataset_symbol_picker.js'
);

const snapshot = {
    symbols: [{ key: 'payments', url: '/symbol-assets/payments.svg' }, { key: 'calendar' }],
    datasets: [{ table_uid: 3470, dataset_name: 'subscriptions', icon_key: 'payments' }],
    fields: [],
};

beforeEach(() => {
    document.body.innerHTML = '';
    endpointRouterMock.mockReset();
    endpointRouterMock.mockResolvedValue(snapshot);
});

describe('dataset symbol picker', () => {
    test('offers every safe symbol plus the choice of none', async () => {
        const picker = createDatasetSymbolPicker();
        document.body.appendChild(picker.element);
        await picker.ready;

        const options = Array.from(picker.select.options).map((option) => option.value);
        expect(options).toEqual(['', 'payments', 'calendar']);
        expect(picker.select.options[0].textContent).toBe(datasetSymbolCopy().none);
    });

    test('a stored symbol is shown with its picture', async () => {
        const picker = createDatasetSymbolPicker({
            stored: Promise.resolve({ iconKey: 'payments', tableUID: 3470 }),
        });
        document.body.appendChild(picker.element);
        await picker.ready;

        expect(picker.select.value).toBe('payments');
        expect(picker.changed()).toBe(false);
        expect(picker.element.querySelector('.dataset-symbol-preview').hidden).toBe(false);
    });

    // The creation form describes a dataset that does not exist yet, and saves
    // to each new dataset it makes; every one of them starts without a symbol.
    test('in the creation form every new dataset starts without a symbol', async () => {
        const picker = createDatasetSymbolPicker();
        document.body.appendChild(picker.element);
        await picker.ready;

        expect(picker.changed()).toBe(false);
        expect(await picker.save(3470)).toBe('unchanged');

        picker.select.value = 'calendar';
        expect(picker.changed()).toBe(true);
        expect(await picker.save(3470)).toBe('saved');
        expect(endpointRouterMock).toHaveBeenCalledWith('adminSymbols', {
            method: 'POST',
            body_data: { target_type: 'dataset', target_uid: 3470, icon_key: 'calendar' },
            suppressErrorToast: true,
        });
        // The next dataset is new too, so the same choice is saved to it as well.
        expect(await picker.save(3471)).toBe('saved');
        expect(endpointRouterMock.mock.calls.filter(([, options]) => options?.method === 'POST'))
            .toHaveLength(2);
    });

    // The editing form learns the dataset's symbol after the control is built.
    // What it learns must become the baseline a Save compares against: an
    // empty baseline made "No symbol" look unchanged, so a stored symbol could
    // never be removed, and an untouched one was rewritten on every Save.
    const postedSymbols = () => endpointRouterMock.mock.calls
        .filter(([route, options]) => route === 'adminSymbols' && options?.method === 'POST')
        .map(([, options]) => options.body_data);

    test('a stored symbol is the baseline, so choosing No symbol removes it', async () => {
        const picker = createDatasetSymbolPicker({
            stored: Promise.resolve({ iconKey: 'payments', tableUID: 3470 }),
        });
        document.body.appendChild(picker.element);
        expect(picker.select.disabled).toBe(true);
        await picker.ready;

        expect(picker.select.disabled).toBe(false);
        expect(picker.select.value).toBe('payments');
        expect(picker.changed()).toBe(false);
        expect(await picker.save()).toBe('unchanged');
        expect(postedSymbols()).toEqual([]);

        picker.select.value = '';
        expect(picker.changed()).toBe(true);
        expect(await picker.save()).toBe('saved');
        expect(postedSymbols()).toEqual([{ target_type: 'dataset', target_uid: 3470, icon_key: '' }]);
        expect(await picker.save()).toBe('unchanged');
    });

    test('a stored symbol the registry does not list is kept, not silently removed', async () => {
        const picker = createDatasetSymbolPicker({
            stored: Promise.resolve({ iconKey: 'retired_symbol', tableUID: 3470 }),
        });
        await picker.ready;

        expect(picker.select.value).toBe('retired_symbol');
        expect(await picker.save()).toBe('unchanged');
        expect(postedSymbols()).toEqual([]);
    });

    test('an unreadable registry never turns an untouched Save into a removal', async () => {
        endpointRouterMock.mockRejectedValue(new Error('network'));
        const picker = createDatasetSymbolPicker({
            stored: Promise.resolve({ iconKey: 'payments', tableUID: 3470 }),
        });
        await picker.ready;

        expect(picker.select.value).toBe('payments');
        expect(await picker.save()).toBe('unchanged');
        expect(endpointRouterMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toEqual([]);
    });

    test('without a known dataset identity the control stays closed and says why', async () => {
        const picker = createDatasetSymbolPicker({
            stored: Promise.resolve({ iconKey: '', tableUID: 0 }),
        });
        await picker.ready;

        expect(picker.select.disabled).toBe(true);
        expect(picker.element.querySelector('.dataset-symbol-status').textContent)
            .toBe(datasetSymbolCopy().unavailable);
        expect(await picker.save()).toBe('unchanged');
        expect(postedSymbols()).toEqual([]);
    });

    test('a refused symbol reports a failure beside the control, and a retry can still save it', async () => {
        const picker = createDatasetSymbolPicker({
            stored: Promise.resolve({ iconKey: 'payments', tableUID: 3470 }),
        });
        await picker.ready;
        endpointRouterMock.mockImplementation(async (route, options) => {
            if (options?.method === 'POST') throw new Error('refused');
            return snapshot;
        });
        picker.select.value = '';

        expect(await picker.save()).toBe('failed');
        const status = picker.element.querySelector('.dataset-symbol-status');
        expect(status.hidden).toBe(false);
        expect(status.textContent).toBe(datasetSymbolCopy().saveFailed);
        // Nothing was removed, so the choice still counts as a change.
        expect(picker.changed()).toBe(true);

        endpointRouterMock.mockResolvedValue({ status: 'ok' });
        expect(await picker.save()).toBe('saved');
        expect(status.hidden).toBe(true);
    });

    test('an unreadable registry says so instead of offering a wrong list', async () => {
        endpointRouterMock.mockRejectedValue(new Error('network'));
        const picker = createDatasetSymbolPicker();
        document.body.appendChild(picker.element);
        await picker.ready;

        expect(picker.element.querySelector('.dataset-symbol-status').textContent)
            .toBe(datasetSymbolCopy().unavailable);
        expect(Array.from(picker.select.options).map((option) => option.value)).toEqual(['']);
    });

    test('a dataset reports the symbol it uses and its identity', async () => {
        expect(await readDatasetSymbol('subscriptions')).toEqual({ iconKey: 'payments', tableUID: 3470 });
        expect(await readDatasetSymbol('unknown_dataset')).toEqual({ iconKey: '', tableUID: 0 });
    });
});
