// @vitest-environment jsdom
// dataset_symbol_picker.test.js
// Verifies the symbol control the dataset forms share.
// Bridges the safe symbol registry, the chosen key and the assignment request.
// Exists so a dataset's symbol is saved deliberately, and never guessed.
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

    test('a preselected symbol is shown with its picture', async () => {
        const picker = createDatasetSymbolPicker({ selectedKey: 'payments' });
        document.body.appendChild(picker.element);
        await picker.ready;

        expect(picker.value()).toBe('payments');
        expect(picker.changed()).toBe(false);
        expect(picker.element.querySelector('.dataset-symbol-preview').hidden).toBe(false);
    });

    test('saving assigns the chosen symbol only when the choice changed', async () => {
        const picker = createDatasetSymbolPicker({ selectedKey: 'payments' });
        document.body.appendChild(picker.element);
        await picker.ready;

        expect(await picker.save(3470)).toBe(false);

        picker.select.value = 'calendar';
        expect(picker.changed()).toBe(true);
        expect(await picker.save(3470)).toBe(true);
        expect(endpointRouterMock).toHaveBeenCalledWith('adminSymbols', {
            method: 'POST',
            body_data: { target_type: 'dataset', target_uid: 3470, icon_key: 'calendar' },
        });
        // Saving twice must not repeat the same assignment.
        expect(await picker.save(3470)).toBe(false);
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
