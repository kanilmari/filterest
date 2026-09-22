// @vitest-environment jsdom
// dataset_symbol_picker.test.js
// Verifies the dataset form's symbol control in both modes, and its routes.
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

const { assignDatasetSymbol, createDatasetSymbolPicker, readDatasetSymbol } = await import('./dataset_symbol_picker.js');

const snapshot = {
    symbols: [{ key: 'payments', url: '/symbol-assets/payments.svg' }, { key: 'calendar' }],
    datasets: [{ table_uid: 3470, dataset_name: 'subscriptions', icon_key: 'payments' }],
    fields: [],
};

function mount(settings) {
    const picker = createDatasetSymbolPicker(settings);
    document.body.appendChild(picker.element);
    return picker;
}
const status = (picker) => picker.element.querySelector('.dataset-symbol-status');

beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.lang = 'en';
    endpointRouterMock.mockReset();
    endpointRouterMock.mockResolvedValue(snapshot);
});

describe('dataset symbol control', () => {
    test('offers every safe symbol plus the choice of none', async () => {
        const picker = mount();
        await picker.ready;
        expect(Array.from(picker.select.options).map((option) => option.value)).toEqual(['', 'payments', 'calendar']);
        expect(picker.select.options[0].textContent).toBe('No symbol');
    });

    test('a stored symbol is shown with its picture', async () => {
        const picker = mount({ stored: Promise.resolve({ iconKey: 'payments', tableUID: 3470 }) });
        await picker.ready;
        expect(picker.select.value).toBe('payments');
        expect(picker.changed()).toBe(false);
        expect(picker.element.querySelector('.dataset-symbol-preview').hidden).toBe(false);
    });

    // A new dataset has no symbol; every dataset the creation mode makes is new,
    // so the same choice is a change for each of them.
    test('a new dataset starts without a symbol, and a saved choice stays a change', async () => {
        const picker = mount();
        await picker.ready;
        expect(picker.changed()).toBe(false);
        picker.select.value = 'calendar';
        expect(picker.changed()).toBe(true);
        picker.accept();
        expect(picker.changed()).toBe(true);
    });

    // The edit mode learns the dataset's symbol after the control is built. What
    // it learns must become the baseline a Save compares against, or "No symbol"
    // looks unchanged and a stored symbol can never be removed.
    test('a stored symbol is the baseline, so choosing No symbol is a change', async () => {
        const picker = mount({ stored: Promise.resolve({ iconKey: 'payments', tableUID: 3470 }) });
        expect(picker.select.disabled).toBe(true);
        await picker.ready;
        expect(picker.select.disabled).toBe(false);
        picker.select.value = '';
        expect(picker.changed()).toBe(true);
        expect(picker.value()).toBe('');
        picker.accept();
        expect(picker.changed()).toBe(false);
    });

    test('a stored symbol the registry does not list is kept, not silently removed', async () => {
        const picker = mount({ stored: Promise.resolve({ iconKey: 'retired_symbol', tableUID: 3470 }) });
        await picker.ready;
        expect(picker.select.value).toBe('retired_symbol');
        expect(picker.changed()).toBe(false);
    });

    test('an unreadable registry never turns an untouched Save into a removal', async () => {
        endpointRouterMock.mockRejectedValue(new Error('network'));
        const picker = mount({ stored: Promise.resolve({ iconKey: 'payments', tableUID: 3470 }) });
        await picker.ready;
        expect(picker.select.value).toBe('payments');
        expect(picker.changed()).toBe(false);
        expect(status(picker).textContent).toBe('The symbols could not be read.');
    });

    test('without a known dataset identity the control stays closed and says why', async () => {
        const picker = mount({ stored: Promise.resolve({ iconKey: '', tableUID: 0 }) });
        await picker.ready;
        expect(picker.select.disabled).toBe(true);
        expect(picker.changed()).toBe(false);
        expect(status(picker).textContent).toBe('The symbols could not be read.');
    });

    test('a refused symbol is reported beside the control and stays a change for a retry', async () => {
        const picker = mount({ stored: Promise.resolve({ iconKey: 'payments', tableUID: 3470 }) });
        await picker.ready;
        picker.select.value = '';
        picker.reportFailure();
        expect(status(picker).hidden).toBe(false);
        expect(status(picker).textContent).toBe('The symbol could not be saved.');
        expect(picker.changed()).toBe(true);
        picker.accept();
        expect(status(picker).hidden).toBe(true);
    });
});

describe('dataset symbol routes', () => {
    test('a dataset reports the symbol it uses and its identity', async () => {
        expect(await readDatasetSymbol('subscriptions')).toEqual({ iconKey: 'payments', tableUID: 3470 });
        expect(await readDatasetSymbol('unknown_dataset')).toEqual({ iconKey: '', tableUID: 0 });
    });

    test('a symbol is assigned quietly to one dataset; an empty key removes it', async () => {
        await assignDatasetSymbol(3470, '');
        expect(endpointRouterMock).toHaveBeenLastCalledWith('adminSymbols', {
            method: 'POST',
            body_data: { target_type: 'dataset', target_uid: 3470, icon_key: '' },
            suppressErrorToast: true,
        });
    });
});
