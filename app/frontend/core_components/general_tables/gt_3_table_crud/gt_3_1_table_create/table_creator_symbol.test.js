// @vitest-environment jsdom
// table_creator_symbol.test.js
// Verifies that the creation form saves a new dataset's symbol through the same
// step the editing form uses, and reports a refused symbol the same way.
// Exists so the two dataset forms cannot drift back into two ways of saving it.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
const showSuccessToastMock = vi.fn();
const showWarningToastMock = vi.fn();

vi.mock('../../../endpoints/endpoint_router.js', () => ({
    endpoint_router: (...args) => endpointRouterMock(...args),
}));
vi.mock('../../../endpoints/endpoint_column_fetcher.js', () => ({ fetch_columns_for_table: vi.fn().mockResolvedValue([]) }));
vi.mock('../../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback } = {}) => fallback ?? key,
}));
vi.mock('../../../vanilla_tree/van_tr_components/admin_tree_builder.js', () => ({
    initializeTreeCallAdmin: vi.fn().mockResolvedValue(),
}));
vi.mock('../../../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showToast: vi.fn(),
    showSuccessToast: (...args) => showSuccessToastMock(...args),
    showWarningToast: (...args) => showWarningToastMock(...args),
}));

const { generate_table_creation_view } = await import('./table_creator.js');

const registry = {
    symbols: [{ key: 'payments' }, { key: 'calendar' }],
    datasets: [{ dataset_name: 'new_dataset', table_uid: 5001, icon_key: '' }],
    fields: [],
};

function answer({ assign = () => ({ status: 'ok' }), datasets = registry.datasets } = {}) {
    endpointRouterMock.mockImplementation(async (route, options) => {
        if (route === 'adminSymbols') {
            return options?.method === 'POST' ? assign(options) : { ...registry, datasets };
        }
        if (route === 'datasetNames') return [];
        if (route === 'fetchTreeData') return { nodes: [] };
        return { message: 'ok' };
    });
}

const symbolWrites = () => endpointRouterMock.mock.calls
    .filter(([route, options]) => route === 'adminSymbols' && options?.method === 'POST')
    .map(([, options]) => options);

async function openFilledForm(symbol) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await generate_table_creation_view(host);
    const form = host.querySelector('form');
    const select = form.querySelector('[data-testid="dataset-symbol-select"]');
    await vi.waitFor(() => expect(select.options.length).toBe(3));
    form.querySelector('#table_name').value = 'new_dataset';
    select.value = symbol;
    return { form, select };
}

async function submit(form) {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(showSuccessToastMock).toHaveBeenCalled());
}

beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    endpointRouterMock.mockReset();
    showSuccessToastMock.mockReset();
    showWarningToastMock.mockReset();
});

describe('dataset creation saves the symbol through the shared step', () => {
    test('a chosen symbol is saved to the new dataset through the quiet shared step', async () => {
        answer();
        const { form } = await openFilledForm('payments');
        await submit(form);

        expect(symbolWrites()).toEqual([{
            method: 'POST',
            body_data: { target_type: 'dataset', target_uid: 5001, icon_key: 'payments' },
            suppressErrorToast: true,
        }]);
        expect(showWarningToastMock).not.toHaveBeenCalled();
    });

    test('no chosen symbol neither looks up the new dataset nor writes anything', async () => {
        answer();
        const { form } = await openFilledForm('');
        const readsBefore = endpointRouterMock.mock.calls.filter(([route]) => route === 'adminSymbols').length;
        await submit(form);

        expect(endpointRouterMock.mock.calls.filter(([route]) => route === 'adminSymbols')).toHaveLength(readsBefore);
        expect(showWarningToastMock).not.toHaveBeenCalled();
    });

    test('a refused symbol is shown beside the control and flagged, as in the editing form', async () => {
        answer({ assign: () => { throw new Error('refused'); } });
        const { form } = await openFilledForm('calendar');
        await submit(form);

        expect(symbolWrites()).toHaveLength(1);
        const status = form.querySelector('.dataset-symbol-status');
        expect(status.hidden).toBe(false);
        expect(status.textContent).toBe('The symbol could not be saved.');
        expect(showWarningToastMock).toHaveBeenCalledWith(
            'The columns were saved. One dataset setting still needs attention — see the message in the form.'
        );
    });

    test('an unknown identity for the new dataset is a failed save, not a silent skip', async () => {
        answer({ datasets: [] });
        const { form } = await openFilledForm('calendar');
        await submit(form);

        expect(symbolWrites()).toEqual([]);
        expect(form.querySelector('.dataset-symbol-status').textContent).toBe('The symbol could not be saved.');
        expect(showWarningToastMock).toHaveBeenCalledTimes(1);
    });

    test('the next dataset starts without a symbol, so choosing the same one again still saves it', async () => {
        answer();
        const { form, select } = await openFilledForm('payments');
        await submit(form);
        expect(select.value).toBe('');

        showSuccessToastMock.mockReset();
        form.querySelector('#table_name').value = 'new_dataset';
        select.value = 'payments';
        await submit(form);

        expect(symbolWrites().map(({ body_data }) => body_data.icon_key)).toEqual(['payments', 'payments']);
    });
});
