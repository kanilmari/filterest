// @vitest-environment jsdom
// dataset_foreign_keys_panel.test.js
// Verifies the foreign-key panel the dataset forms share.
// Bridges the dataset's existing links with the request that adds one.
// Exists so a half-filled link is never sent, and a link is never claimed twice.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
const fetchColumnsMock = vi.fn();

vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: (...args) => endpointRouterMock(...args),
}));
vi.mock('../../endpoints/endpoint_column_fetcher.js', () => ({
    fetch_columns_for_table: (...args) => fetchColumnsMock(...args),
}));
vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback } = {}) => fallback,
}));

const {
    createDatasetForeignKeyPanel,
    datasetForeignKeyCopy,
    selectOutgoingForeignKeys,
} = await import('./dataset_foreign_keys_panel.js');

const links = [
    {
        constraint_name: 'fk_subscriptions_owner_id',
        referencing_table: 'subscriptions',
        referencing_column: 'owner_id',
        referenced_table: 'users',
        referenced_column: 'id',
    },
    {
        constraint_name: 'fk_invoices_subscription_id',
        referencing_table: 'invoices',
        referencing_column: 'subscription_id',
        referenced_table: 'subscriptions',
        referenced_column: 'id',
    },
];

function routeAnswers(route) {
    if (route === 'fetchForeignKeys') return { columns: [], data: links };
    if (route === 'datasetNames') return ['users', 'categories'];
    return { message: 'ok' };
}

beforeEach(() => {
    document.body.innerHTML = '';
    endpointRouterMock.mockReset().mockImplementation(async (route) => routeAnswers(route));
    fetchColumnsMock.mockReset().mockResolvedValue([{ column_name: 'id' }, { column_name: 'email' }]);
});

describe('dataset foreign keys', () => {
    test('only the links that start in this dataset are its own to show', () => {
        expect(selectOutgoingForeignKeys(links, 'subscriptions')).toEqual([{
            constraintName: 'fk_subscriptions_owner_id',
            referencingColumn: 'owner_id',
            referencedTable: 'users',
            referencedColumn: 'id',
        }]);
    });

    test('the existing links are listed in plain words', async () => {
        const panel = createDatasetForeignKeyPanel({
            datasetName: 'subscriptions', columnNames: () => ['id', 'owner_id'],
        });
        document.body.appendChild(panel.element);
        await panel.ready;

        expect([...panel.element.querySelectorAll('li')].map((item) => item.textContent))
            .toEqual(['owner_id → users.id']);
        expect(Array.from(panel.selects.referencedTableSelect.options).map((option) => option.value))
            .toEqual(['', 'users', 'categories']);
    });

    test('a dataset without links says so instead of showing an empty list', async () => {
        endpointRouterMock.mockImplementation(async (route) =>
            route === 'fetchForeignKeys' ? { data: [] } : routeAnswers(route));
        const panel = createDatasetForeignKeyPanel({ datasetName: 'subscriptions' });
        document.body.appendChild(panel.element);
        await panel.ready;

        expect(panel.element.querySelector('.dataset-foreign-keys-empty').textContent)
            .toBe(datasetForeignKeyCopy().none);
    });

    test('a half-filled link is never sent', async () => {
        const panel = createDatasetForeignKeyPanel({
            datasetName: 'subscriptions', columnNames: () => ['id', 'owner_id'],
        });
        document.body.appendChild(panel.element);
        await panel.ready;

        panel.selects.referencingSelect.value = 'owner_id';
        expect(panel.changed()).toBe(false);
        expect(await panel.save()).toBe('unchanged');
        expect(endpointRouterMock.mock.calls.some(([route]) => route === 'addForeignKey')).toBe(false);
    });

    test('a complete link is added once and the list is read again', async () => {
        const panel = createDatasetForeignKeyPanel({
            datasetName: 'subscriptions', columnNames: () => ['id', 'owner_id', 'category_id'],
        });
        document.body.appendChild(panel.element);
        await panel.ready;

        panel.selects.referencingSelect.value = 'category_id';
        panel.selects.referencedTableSelect.value = 'categories';
        panel.selects.referencedTableSelect.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(panel.selects.referencedColumnSelect.options.length).toBe(3));
        panel.selects.referencedColumnSelect.value = 'id';

        expect(panel.changed()).toBe(true);
        expect(await panel.save()).toBe('saved');
        expect(endpointRouterMock).toHaveBeenCalledWith('addForeignKey', {
            method: 'POST',
            body_data: {
                referencing_dataset: 'subscriptions',
                referencing_column: 'category_id',
                referenced_dataset: 'categories',
                referenced_column: 'id',
            },
            suppressErrorToast: true,
        });
        // The draft is cleared, so a second Save cannot repeat the same link.
        expect(panel.changed()).toBe(false);
        expect(await panel.save()).toBe('unchanged');
    });

    test('a refused link reports beside the panel and keeps the draft', async () => {
        const panel = createDatasetForeignKeyPanel({
            datasetName: 'subscriptions', columnNames: () => ['category_id'],
        });
        document.body.appendChild(panel.element);
        await panel.ready;

        panel.selects.referencingSelect.value = 'category_id';
        panel.selects.referencedTableSelect.value = 'categories';
        panel.selects.referencedColumnSelect.appendChild(
            Object.assign(document.createElement('option'), { value: 'id', textContent: 'id' })
        );
        panel.selects.referencedColumnSelect.value = 'id';

        endpointRouterMock.mockImplementationOnce(async () => { throw new Error('refused'); });
        expect(await panel.save()).toBe('failed');
        expect(panel.element.querySelector('.dataset-foreign-keys-status').textContent)
            .toBe(datasetForeignKeyCopy().saveFailed);
        expect(panel.changed()).toBe(true);
    });

    test('an unreadable link list says so instead of claiming there are none', async () => {
        endpointRouterMock.mockImplementation(async () => { throw new Error('network'); });
        const panel = createDatasetForeignKeyPanel({ datasetName: 'subscriptions' });
        document.body.appendChild(panel.element);
        await panel.ready;

        expect(panel.element.querySelector('.dataset-foreign-keys-status').textContent)
            .toBe(datasetForeignKeyCopy().unavailable);
    });
});
