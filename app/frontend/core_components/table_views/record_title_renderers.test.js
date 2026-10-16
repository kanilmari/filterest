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
