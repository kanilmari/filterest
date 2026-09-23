// @vitest-environment jsdom
// dataset_foreign_keys_panel.test.js
// Verifies the dataset form's links panel in both modes, and its routes.
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
    addDatasetForeignKey,
    createDatasetForeignKeyPanel,
    readDatasetForeignKeys,
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

/** Mount the panel as a mode would: editing lists the stored links. */
function mount({ editing = true, columnNames = () => ['id', 'owner_id', 'category_id'], stored } = {}) {
    const panel = createDatasetForeignKeyPanel({
        stored: editing ? (stored ?? readDatasetForeignKeys('subscriptions')) : null,
        datasetNames: endpointRouterMock('datasetNames'),
        readColumns: (name) => fetchColumnsMock(name),
        columnNames,
        multipleDrafts: !editing,
    });
    document.body.appendChild(panel.element);
    return panel;
}
const status = (panel) => panel.element.querySelector('.dataset-foreign-keys-status');
/** The draft rows as the page shows them. */
const drafts = (panel) => [...panel.element.querySelectorAll('.dataset-foreign-key-draft')].map((row) => ({
    referencing: row.querySelector('[name="fk_referencing_column"]'),
    referencedTable: row.querySelector('[name="fk_referenced_dataset"]'),
    referencedColumn: row.querySelector('[name="fk_referenced_column"]'),
}));
const addButton = (panel) => panel.element.querySelector('[data-testid="dataset-foreign-key-add"]');
const explainButton = (panel) => panel.element.querySelector('[data-testid="dataset-foreign-key-explain"]');
const explanation = (panel) => panel.element.querySelector('.dataset-form-explanation');

async function fillDraft(panel, draft, { column = 'category_id', target = 'categories' } = {}) {
    draft.referencing.value = column;
    draft.referencedTable.value = target;
    draft.referencedTable.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(draft.referencedColumn.options.length).toBe(3));
    draft.referencedColumn.value = 'id';
}

beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.lang = 'en';
    endpointRouterMock.mockReset().mockImplementation(async (route) => routeAnswers(route));
    fetchColumnsMock.mockReset().mockResolvedValue([{ column_name: 'id' }, { column_name: 'email' }]);
});

describe('dataset links panel', () => {
    test('only the links that start in this dataset are its own to show', () => {
        expect(selectOutgoingForeignKeys(links, 'subscriptions')).toEqual([{
            constraintName: 'fk_subscriptions_owner_id',
            referencingColumn: 'owner_id',
            referencedTable: 'users',
            referencedColumn: 'id',
        }]);
    });

    test('editing lists the existing links in plain words and drafts one optional link', async () => {
        const panel = mount();
        await panel.ready;
        expect([...panel.element.querySelectorAll('li')].map((item) => item.textContent)).toEqual(['owner_id → users.id']);
        const [draft] = drafts(panel);
        expect(drafts(panel)).toHaveLength(1);
        expect(draft.referencing.required).toBe(false);
        expect(Array.from(draft.referencedTable.options).map((option) => option.value)).toEqual(['', 'users', 'categories']);
        expect(addButton(panel)).toBeNull();
    });

    test('a dataset without links says so instead of showing an empty list', async () => {
        const panel = mount({ stored: Promise.resolve([]) });
        await panel.ready;
        expect(panel.element.querySelector('.dataset-foreign-keys-empty').textContent).toBe('This dataset has no links yet.');
    });

    test('a half-filled link is never sent', async () => {
        const panel = mount();
        await panel.ready;
        drafts(panel)[0].referencing.value = 'owner_id';
        expect(panel.changed()).toBe(false);
        expect(panel.value()).toEqual([]);
    });

    test('a complete link is offered once, and a saved one starts the draft over', async () => {
        const panel = mount();
        await panel.ready;
        await fillDraft(panel, drafts(panel)[0]);
        expect(panel.value()).toEqual([
            { referencing_column: 'category_id', referenced_dataset: 'categories', referenced_column: 'id' },
        ]);
        panel.accept(selectOutgoingForeignKeys(links, 'subscriptions'));
        expect(panel.changed()).toBe(false);
        expect(drafts(panel)).toHaveLength(1);
    });

    test('creating drafts any number of links, each required once added', async () => {
        const panel = mount({ editing: false });
        await panel.ready;
        expect(panel.element.querySelector('.dataset-foreign-keys-list')).toBeNull();
        expect(drafts(panel)).toHaveLength(0);
        addButton(panel).click();
        addButton(panel).click();
        const [first, second] = drafts(panel);
        expect(first.referencing.required).toBe(true);
        await fillDraft(panel, first);
        await fillDraft(panel, second, { column: 'owner_id', target: 'users' });
        expect(panel.value()).toHaveLength(2);
        second.referencing.closest('.dataset-foreign-key-draft').querySelector('.dataset-foreign-key-remove').click();
        expect(panel.value()).toEqual([
            { referencing_column: 'category_id', referenced_dataset: 'categories', referenced_column: 'id' },
        ]);
        panel.accept();
        expect(drafts(panel)).toHaveLength(0);
    });

    test('a column the same save is about to add can carry a link', async () => {
        let names = ['id'];
        const panel = mount({ editing: false, columnNames: () => names });
        await panel.ready;
        addButton(panel).click();
        names = ['id', 'category_id'];
        const [draft] = drafts(panel);
        draft.referencing.dispatchEvent(new Event('focus'));
        expect(Array.from(draft.referencing.options).map((option) => option.value)).toEqual(['', 'id', 'category_id']);
    });

    test('a refused link reports beside the panel and keeps the draft', async () => {
        const panel = mount();
        await panel.ready;
        await fillDraft(panel, drafts(panel)[0]);
        panel.reportFailure();
        expect(status(panel).textContent).toBe('The link could not be added.');
        expect(panel.changed()).toBe(true);
    });

    test('an unreadable link list says so instead of claiming there are none', async () => {
        const panel = mount({ stored: Promise.reject(new Error('network')) });
        await panel.ready;
        expect(status(panel).textContent).toBe('The links could not be read.');
    });

    test('a new link is added from the named dataset through its own route', async () => {
        await addDatasetForeignKey('subscriptions', {
            referencing_column: 'category_id', referenced_dataset: 'categories', referenced_column: 'id',
        });
        expect(endpointRouterMock).toHaveBeenLastCalledWith('addForeignKey', {
            method: 'POST',
            body_data: {
                referencing_dataset: 'subscriptions',
                referencing_column: 'category_id',
                referenced_dataset: 'categories',
                referenced_column: 'id',
            },
            suppressErrorToast: true,
        });
    });
});

describe('the offer to connect two fields', () => {
    const BUTTON_TEXTS = {
        fi: 'Yhdistä kaksi kenttää',
        en: 'Connect two fields',
        'zh-CN': '连接两个字段',
        yue: '連接兩個欄位',
    };
    const EXPLANATION_TEXTS = {
        fi: 'Tämän aineiston rivi osoittaa toisen aineiston riviin, jolloin toisen rivin tiedot voidaan näyttää tässä ja arvo pysyy kelvollisena (viiteavain).',
        en: "A row of this dataset points at a row of another dataset, so the other row's information can be shown here and the value stays valid (foreign key).",
        'zh-CN': '本数据集中的一行指向另一个数据集中的一行，这样就能在这里显示另一行的信息，并且该值始终有效（外键）。',
        yue: '呢個資料集嘅一行會指向另一個資料集嘅一行，噉就可以喺呢度顯示嗰行嘅資料，個值亦會一直有效（外鍵）。',
    };

    test.each(Object.keys(BUTTON_TEXTS))('names the act and explains it in %s', async (language) => {
        document.documentElement.lang = language;
        const panel = mount({ editing: false });
        await panel.ready;

        expect(addButton(panel).textContent).toBe(BUTTON_TEXTS[language]);
        expect(explanation(panel).textContent).toBe(EXPLANATION_TEXTS[language]);
    });

    test('the explanation names the technical term the developer knows', async () => {
        const panel = mount({ editing: false });
        await panel.ready;
        expect(explanation(panel).textContent).toContain('(foreign key)');
    });

    test('an information symbol with a name of its own opens the explanation', async () => {
        const panel = mount({ editing: false });
        await panel.ready;
        const symbol = explainButton(panel);

        expect(symbol.type).toBe('button');
        expect(symbol.querySelector('.dataset-form-explain-name').textContent)
            .toBe('What does connecting two fields mean?');
        expect(symbol.querySelector('.dataset-form-explain-symbol').dataset.symbolKey).toBe('info');
        expect(symbol.hasAttribute('title')).toBe(false);
        expect(symbol.getAttribute('aria-controls')).toBe(explanation(panel).id);
        expect(explanation(panel).hidden).toBe(true);
        expect(symbol.getAttribute('aria-expanded')).toBe('false');

        symbol.click();
        expect(explanation(panel).hidden).toBe(false);
        expect(symbol.getAttribute('aria-expanded')).toBe('true');

        symbol.click();
        expect(explanation(panel).hidden).toBe(true);
        expect(symbol.getAttribute('aria-expanded')).toBe('false');
    });

    test('editing an existing dataset offers the same explanation beside the title', async () => {
        const panel = mount();
        await panel.ready;
        expect(addButton(panel)).toBeNull();
        expect(explainButton(panel).closest('.dataset-foreign-keys-title')).not.toBeNull();
        expect(explanation(panel).textContent).toBe(EXPLANATION_TEXTS.en);
    });
});
