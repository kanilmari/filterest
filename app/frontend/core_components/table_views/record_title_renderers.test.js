// record_title_renderers.test.js
// Exercises the real card, compact summary, product and article title builders.
// Connects the shared naming rule to visible headings and avatar initials.
// Protects translated titles and existing multi-heading layouts across renderers.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn(async () => ({})) }));
vi.mock('./card_view/card_view_printer.js', () => ({ refreshCardLanguages: vi.fn() }));
vi.mock('../dev_tools/function_counter.js', () => ({ count_this_function: vi.fn() }));
vi.mock('./card_view/row_article_opener.js', () => ({ openRowArticleView: vi.fn() }));
vi.mock('./card_view/row_article_presentation_settings.js', () => ({
    resolveRowArticleTimestampDisplayOptions: vi.fn(async () => ({ locale: 'en' })),
}));
vi.mock('../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback, language } = {}) =>
        ({ fi: { sample_key: 'Otsikko' }, en: { sample_key: 'Title' } })[language]?.[key] ?? fallback ?? key,
}));
vi.mock('./card_view/card_avatar_builder.js', () => ({
    create_seeded_avatar: vi.fn(async (_seed, initial) => {
        const avatar = document.createElement('div'); avatar.dataset.initial = initial; return avatar;
    }),
    createImageElement: vi.fn(async () => document.createElement('img')),
}));
import { createSingleCard } from './card_view/card_row_builder.js';
import { cancelEditing, disableEditing, enableEditing } from './card_view/card_field_formatter.js';
import { buildRowArticleContent } from './card_view/row_article_content_builder.js';
import { create_product_card_view } from './product_card_view/product_card_view_printer.js';
import { buildExperimentalCardModel } from './experimental_free_layout_card/experimental_free_layout_card_helpers.js';
import { disposeCardResources } from './card_view/card_resource_lifecycle.js';
import { ROW_ARTICLE_PERMISSION_ROUTES } from './card_view/row_article_permission_checker.js';

beforeEach(() => {
    document.body.replaceChildren(); localStorage.clear(); sessionStorage.clear();
    sessionStorage.setItem('user_permissions', JSON.stringify(Object.values(ROW_ARTICLE_PERMISSION_ROUTES)));
});
afterEach(() => document.querySelectorAll('.card').forEach(disposeCardResources));
const field = extra => ({ data_type: 'text', show_value_on_card: true, ...extra });
const context = { hasDeleteRight: false, canManageRowAccess: false, canManageRowGroups: false,
    tableHasImageRole: false, timestampDisplayOptions: { locale: 'en' } };

test.each(['fi', 'en'])('all visible titles and initials agree in %s, including +lang_key', async language => {
    localStorage.setItem('chosen_language', language);
    const row = { id: 7, key: 'sample_key', content: 'A description' };
    const types = { id: { data_type: 'integer' }, key: field({ card_element: 'header+lang_key' }),
        content: field({ card_element: 'description' }) };
    const columns = Object.keys(types);
    const expected = language === 'fi' ? 'Otsikko' : 'Title';
    const card = await createSingleCard(row, columns, 'notes', types, context, 0, language);
    document.body.append(card);
    await card._ensureSmallSummaryMedia();
    const product = create_product_card_view('notes', columns, [row], types);
    document.body.append(product);
    const { rowArticleContentElement } = await buildRowArticleContent(row, 'notes', types, columns, '7', '?', false);
    const experiment = buildExperimentalCardModel({ rowItem: row, columns, tableName: 'notes',
        dataTypes: types, preferredLang: language, tableHasImageRole: false });
    expect(card.querySelector('.header_value').textContent).toBe(expected);
    expect(card.querySelector('.small_card_name_text').textContent).toBe(expected);
    expect(product.querySelector('.product-card-view-title').textContent).toBe(expected);
    expect(rowArticleContentElement.querySelector('.big_card_header_value').textContent).toBe(expected);
    expect(experiment.summary.headerText).toBe(expected);
    expect(experiment.summary.headerFirstLetter).toBe(expected[0]);
    expect([...card.querySelectorAll('[data-initial]')].map(element => element.dataset.initial))
        .toEqual([expected[0], expected[0]]);
    expect(product.querySelector('.product-card-view-image-placeholder').textContent).toBe(expected[0]);
});

test('empty/hidden headings fall through consistently and multiple usable headings stay several', async () => {
    const row = { id: 2, empty: '', name: 'Resolved', second: 'Second', private: 'Private' };
    const types = { id: { data_type: 'integer' }, empty: field({ card_element: 'header' }),
        name: field({ card_element: 'header' }), second: field({ card_element: 'header' }),
        private: field({ card_element: 'header', hide_everywhere: true }) };
    const columns = Object.keys(types);
    const card = await createSingleCard(row, columns, 'notes', types, context);
    document.body.append(card);
    const product = create_product_card_view('notes', columns, [row], types);
    const article = await buildRowArticleContent(row, 'notes', types, columns, '2', '?', false);
    const experiment = buildExperimentalCardModel({ rowItem: row, columns, tableName: 'notes', dataTypes: types, preferredLang: 'en' });
    for (const [root, selector] of [[card, '.header_value'], [product, '.product-card-view-title'],
        [article.rowArticleContentElement, '.big_card_header_value']]) {
        expect([...root.querySelectorAll(selector)].map(element => element.textContent)).toEqual(['Resolved', 'Second']);
    }
    expect(card.querySelector('.small_card_name_text').textContent).toBe('Resolved');
    expect(experiment.blocks.filter(block => block.type === 'header').map(block => block.displayValue)).toEqual(['Resolved', 'Second']);
});

test('unconfigured system-setting keys and ID-only rows gain the same title everywhere', async () => {
    for (const [row, types, expected] of [
        [{ id: 1, key: 'registration_enabled' }, { id: { data_type: 'integer' }, key: field() }, 'registration_enabled'],
        [{ id: 3 }, { id: { data_type: 'integer' } }, 'Record 3'],
        [{ id: 5, title: '🙂 Example' }, { id: { data_type: 'integer' }, title: field() }, '🙂 Example'],
    ]) {
        const columns = Object.keys(types);
        const card = await createSingleCard(row, columns, 'settings', types, context);
        document.body.append(card);
        const product = create_product_card_view('settings', columns, [row], types);
        const article = await buildRowArticleContent(row, 'settings', types, columns, 'id', '?', false);
        expect(card.querySelector('.header_value').textContent).toBe(expected);
        expect(card.querySelector('.small_card_name_text').textContent).toBe(expected);
        expect(product.querySelector('.product-card-view-title').textContent).toBe(expected);
        expect(product.querySelector('.product-card-view-image-placeholder').textContent).toBe([...expected][0].toUpperCase());
        expect(card.querySelector('[data-initial]').dataset.initial).toBe([...expected][0].toUpperCase());
        expect(article.rowArticleContentElement.querySelector('.big_card_header_value').textContent).toBe(expected);
    }
});

test('numeric and long configured headers retain every layout member across renderers', async () => {
    const long = `A long heading ${'x'.repeat(170)}\nsecond line`;
    const row = { id: 2, code: 42, long, last: 'Last', name: 'Inferred name', api_token: 'Private', hidden: 'Hidden' };
    const types = { id: { data_type: 'integer' }, code: field({ data_type: 'integer', card_element: 'header', co_number: 5 }),
        long: field({ card_element: 'header', co_number: 1 }), last: field({ card_element: 'header' }), name: field(),
        api_token: field({ card_element: 'header' }), hidden: field({ card_element: 'header', hide_everywhere: true }) };
    const columns = Object.keys(types);
    const card = await createSingleCard(row, columns, 'notes', types, context);
    document.body.append(card);
    await card._ensureSmallSummaryMedia();
    const product = create_product_card_view('notes', columns, [row], types);
    const article = await buildRowArticleContent(row, 'notes', types, columns, '2', '?', false);
    const experiment = buildExperimentalCardModel({ rowItem: row, columns, tableName: 'notes', dataTypes: types, preferredLang: 'en' });
    for (const [root, selector] of [[card, '.header_value'], [article.rowArticleContentElement, '.big_card_header_value']]) {
        expect([...root.querySelectorAll(selector)].map(element => element.textContent)).toEqual(['42', long, 'Last']);
    }
    const tileHeadings = [...product.querySelectorAll('.product-card-view-title')];
    expect(tileHeadings.map(element => element.title)).toEqual(['42', long, 'Last']);
    expect(tileHeadings.map(element => element.textContent)).toEqual(['42', `${long.slice(0, 117)}...`, 'Last']);
    expect(card.querySelector('.small_card_name_text').textContent).toBe('42');
    expect(card.querySelector('[data-initial]').dataset.initial).toBe('4');
    expect(product.querySelector('.product-card-view-image-placeholder').textContent).toBe('4');
    expect(experiment.blocks.filter(block => block.type === 'header').map(block => block.displayValue)).toEqual(['42', long, 'Last']);
});

test.each([
    ['hidden', { data_type: 'text', hide_everywhere: true }, 'Customer', 'Safe'],
    ['not delivered', { data_type: 'text', client_delivery_mode: 'server_only' }, 'Customer', 'Safe'],
    ['unproven', null, 'Customer', 'Safe'],
    ['ordinary JSON', { data_type: 'jsonb' }, { en: 'Customer', fi: 'Asiakas' }, 'Safe'],
    ['text', { data_type: 'text' }, 'Customer', 'Customer'],
    ['multilingual', { data_type: 'jsonb', is_multilingual: true }, { en: 'Customer', fi: 'Asiakas' }, 'Asiakas'],
])('%s relation targets obey the same title boundary in every renderer', async (_label, target, alias, expected) => {
    localStorage.setItem('chosen_language', 'fi');
    const row = { id: 2, customer_id: 1, 'customer_name (ln)': alias, safe: 'Safe' };
    const types = { id: { data_type: 'integer' }, customer_id: field({ data_type: 'integer', card_element: 'header',
        foreign_table: 'customers', foreign_display_column: 'name', foreign_display_metadata: target && {
            hide_everywhere: false, client_delivery_mode: 'include', is_multilingual: false, ...target,
        } }), safe: field() };
    const columns = Object.keys(types);
    const card = await createSingleCard(row, columns, 'notes', types, context, 0, 'fi');
    document.body.append(card);
    const product = create_product_card_view('notes', columns, [row], types);
    const article = await buildRowArticleContent(row, 'notes', types, columns, '2', '?', false);
    const experiment = buildExperimentalCardModel({ rowItem: row, columns, tableName: 'notes', dataTypes: types, preferredLang: 'fi' });
    expect(card.querySelector('.header_value').textContent).toBe(expected);
    expect(card.querySelector('.small_card_name_text').textContent).toBe(expected);
    expect(product.querySelector('.product-card-view-title').textContent).toBe(expected);
    expect(article.rowArticleContentElement.querySelector('.big_card_header_value').textContent).toBe(expected);
    expect(experiment.summary.headerText).toBe(expected);
});

test.each([
    ['<h1>Hotel</h1>', 'Hotel'],
    ['<h1><em>Hotel</em> <a href="https://example.test/news">news</a></h1>', 'Hotel news'],
    ['<h1><strong>Hotel</strong></h1>', 'Hotel', true],
])('renders an inferred record title without block markup and keeps its edit source: %s', async (source, expected, multilingual = false) => {
    const stored = multilingual ? { en: source, fi: 'Hotelli' } : source;
    const row = { id: 42, heading: '<h2> </h2>', title: stored };
    const types = { id: { data_type: 'integer' }, heading: field({ card_element: 'header' }),
        title: field({ editable_in_ui: true, is_multilingual: multilingual }) };
    const columns = Object.keys(types);
    const card = await createSingleCard(row, columns, 'notes', types, context);
    document.body.append(card);
    const { rowArticleContentElement, rowArticleHeaderText } =
        await buildRowArticleContent(row, 'notes', types, columns, '42', '?', false);
    expect(card.querySelector('.card_header').title).toBe(expected);
    expect(card.querySelector('.small_card_name_text').textContent).toBe(expected);
    expect(rowArticleHeaderText).toBe(expected);
    for (const element of [card.querySelector('.header_value'), rowArticleContentElement.querySelector('.big_card_header_value')]) {
        const wrapper = element.parentElement;
        const checkDisplay = () => {
            expect(element.textContent).toBe(expected);
            expect(element.querySelector('h1,h2,h3,h4,h5,h6')).toBeNull();
            expect(element.dataset.rawValue).toBe(multilingual ? JSON.stringify(stored) : source);
            if (source.includes('<em>')) {
                expect(element.querySelector('em')?.textContent).toBe('Hotel');
                expect(element.querySelector('a')?.href).toBe('https://example.test/news');
            }
        };
        checkDisplay();
        enableEditing(wrapper, 'notes', types);
        const input = element.querySelector('input,textarea');
        expect(input.value).toBe(source);
        input.value = 'Discard this change';
        cancelEditing(wrapper);
        checkDisplay();
        if (multilingual) {
            enableEditing(wrapper, 'notes', types);
            element.querySelector('input,textarea').value = '<h1>New title</h1>';
            const updates = disableEditing(wrapper);
            expect(JSON.parse(updates.title)).toEqual({ en: '<h1>New title</h1>', fi: 'Hotelli' });
        }
    }
});

test.each(['standard', 'modern'])('uses only the inferred value as the %s card and article heading', async style => {
    const table = 'dokumentaatio';
    localStorage.setItem('chosen_language', 'en');
    localStorage.setItem(table + '_tableMeta', JSON.stringify({ fk_display_column: 'kohdetiimi', card_style_variant: style }));
    const types = {
        id: { data_type: 'integer' },
        otsikko: field({ card_element: 'header', is_multilingual: true }),
        kohdetiimi: field({ card_element: 'details10', show_key_on_card: true, is_multilingual: true, icon_key: 'user' }),
    };
    const columns = Object.keys(types);
    const row = { id: 1, otsikko: { en: '<h2> </h2>' }, kohdetiimi: { en: '<h1><em>Hotel</em></h1>' } };
    const card = await createSingleCard(row, columns, table, types, context);
    document.body.append(card);
    expect(card.dataset.cardStyleVariant).toBe(style);
    const { rowArticleContentElement: article } = await buildRowArticleContent(row, table, types, columns, '1', 'H', false);
    for (const [view, selector] of [[card, '.card_header'], [article, 'h1.big_card_header']]) {
        const headings = view.querySelectorAll(selector);
        expect(headings).toHaveLength(1);
        expect(headings[0].querySelector('.kv_label, .two_line_label')).toBeNull();
        expect(headings[0].textContent).toBe('Hotel');
        expect(headings[0].querySelector('em')?.textContent).toBe('Hotel');
        expect(headings[0].querySelector('h1,h2,h3,h4,h5,h6')).toBeNull();
    }
    expect(card.querySelector('.small_card_name_text').textContent).toBe('Hotel');
    const details = article.querySelector('.big_card_details_container');
    expect(details.querySelector('[data-lang-key="kohdetiimi"]')).not.toBeNull();
    expect(details.querySelector('[data-column="kohdetiimi"] em')?.textContent).toBe('Hotel');

    types.otsikko.show_key_on_card = true;
    const next = { ...row, id: 2, otsikko: { en: 'First dataset' } };
    const nextCard = await createSingleCard(next, columns, table, types, context);
    document.body.append(nextCard);
    const nextArticle = await buildRowArticleContent(next, table, types, columns, '2', 'F', false);
    for (const [view, selector] of [[nextCard, '.card_header'], [nextArticle.rowArticleContentElement, 'h1.big_card_header']]) {
        expect(view.querySelector(selector + ' [data-lang-key="otsikko"]')).not.toBeNull();
        expect(view.querySelector(selector + ' [data-column="otsikko"]').textContent).toBe('First dataset');
    }
});

test('keeps the article caption and author together when their unconfigured companion fields have no value', async () => {
    const caption = 'Design the services people can rely on';
    const types = { id: { data_type: 'integer', card_element: 'hidden' }, otsikko: field({ card_element: 'header' }),
        cached_username: field({ card_element: 'username' }), comment: field({ show_key_on_card: true }),
        contact: field({ editable_in_ui: true }) };
    const row = { id: 1, otsikko: 'Hotel', 'palvelu_name (ln)': caption, created_by_name: null,
        'owner_name (ln)': '', cached_username: 'teppo_tekija', comment: '', contact: '' };
    const render = async rowItem => (await buildRowArticleContent(rowItem, 'dokumentaatio', types,
        Object.keys(rowItem), '1', 'H', false)).rowArticleContentElement;
    const article = await render(row);
    const generic = root => [...root.querySelectorAll('.big_card_generic_field')]
        .map(value => [value.dataset.column, value.textContent]);
    expect(generic(article)).toEqual([['palvelu_name (ln)', caption], ['comment', '—'], ['contact', '—']]);
    expect(article.querySelector('.card_username_text').textContent).toBe('teppo_tekija');
    expect(article.querySelector('[data-column="comment"]').parentElement.querySelector('.two_line_label')).not.toBeNull();
    const populated = await render({ ...row, created_by_name: 'Ada', 'owner_name (ln)': '—' });
    expect(generic(populated)).toEqual([['palvelu_name (ln)', caption], ['created_by_name', 'Ada'],
        ['owner_name (ln)', '—'], ['comment', '—'], ['contact', '—']]);
});
