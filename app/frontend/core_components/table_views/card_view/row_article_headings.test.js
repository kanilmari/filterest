// @vitest-environment jsdom
// row_article_headings.test.js
// Proves the shared builder's article-only heading rules with sanitized rich text.
// Connects multilingual fields, title semantics and raw edit values to built DOM.
// Keeps these regressions separate from the nearly full legacy builder test file.
import { beforeEach, expect, test, vi } from 'vitest';
import { createRowArticleKeyValueElementMock } from './row_article_content_builder_test_setup.js';
import { buildRowArticleContent } from './row_article_content_builder.js';
import { resolveCardFieldDisplayValue } from './card_field_formatter_helpers.js';
import { renderAllowedHtml } from '../../../reusable_components/dom_container_builder.js';
import { extractLangValue } from '../../../reusable_components/lang_value_reader.js';
import { getLanguageWithBrowserFallback } from '../../state_stores/lang_preference_reader.js';
import { applyRowArticleHeadingRules } from './row_article_heading_renderer.js';

beforeEach(() => {
    localStorage.clear();
    getLanguageWithBrowserFallback.mockReturnValue('en');
    vi.mocked(resolveCardFieldDisplayValue).mockImplementation((row, column, types, language) => ({
        rawValue: row[column], displayValue: extractLangValue(row[column], language, types[column]?.is_multilingual),
        isMultilingual: types[column]?.is_multilingual,
    }));
    createRowArticleKeyValueElementMock.mockImplementation((_label, value, column, _key, className, _show, _multi, raw) => {
        const field = document.createElement('div');
        field.className = className;
        field.dataset.column = column;
        field.dataset.rawValue = String(raw);
        field.append(renderAllowedHtml(value));
        return field;
    });
});
const metadata = {
    title: { card_element: 'header', data_type: 'text', is_multilingual: true },
    content: { card_element: 'description', data_type: 'text', is_multilingual: true },
};
async function build(content, title = 'Contact', types = metadata) {
    if (types === metadata) {
        content = JSON.stringify({ en: content });
        title = JSON.stringify({ en: title });
    }
    const row = { title, content };
    const { rowArticleContentElement: article } = await buildRowArticleContent(row, 'e2e_headings', types,
        Object.keys(types), 'seed', 'C', false);
    expect(row).toEqual({ title, content });
    expect(article.querySelectorAll('h1')).toHaveLength(1);
    expect(article.querySelector('h1.big_card_header').textContent).toBe(extractLangValue(title, getLanguageWithBrowserFallback()));
    expect(article.querySelector('.big_description_value')?.dataset.rawValue).toBe(String(content));
    return article;
}

test('drops one identical first heading, keeps the second and preserves the raw edit value', async () => {
    const article = await build('<p><br></p><div>&nbsp;</div><h2><em>CONTACT</em></h2><h2>Contact</h2><p>Body</p>');
    expect(article.querySelectorAll('.big_description_value h2')).toHaveLength(1);
    expect(article.querySelector('.big_description_value h2').textContent).toBe('Contact');
    applyRowArticleHeadingRules(article);
    expect(article.querySelectorAll('.big_description_value h2')).toHaveLength(1);
});
test.each(['<h2>Contact us</h2><p>Body</p>', '<p>Intro</p><h2>Contact</h2>', 'Plain-text content'])('keeps %s', async content => {
    const article = await build(content);
    expect(article.querySelector('.big_description_value').textContent).toBe(
        new DOMParser().parseFromString(content, 'text/html').body.textContent);
});
test('demotes content h1 only, keeps h2–h6 and gives only the primary title h1 semantics', async () => {
    const article = await build('<h1>Section</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><h6>Six</h6>');
    expect(article.querySelector('h2[data-demoted-from="h1"]').textContent).toBe('Section');
    expect(article.querySelectorAll('.big_description_value h2')).toHaveLength(2);
    for (const level of [3, 4, 5, 6]) expect(article.querySelector(`h${level}`)).not.toBeNull();
    expect(article.querySelectorAll('[data-demoted-from]')).toHaveLength(1);
    const other = document.createElement('div');
    other.innerHTML = '<h1>Another view</h1>';
    applyRowArticleHeadingRules(other);
    expect(other.querySelector('h1')).not.toBeNull();
});
test('compares the displayed language variant and refuses cross-language fallback matches', async () => {
    const types = Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, { ...value, is_multilingual: true }]));
    getLanguageWithBrowserFallback.mockReturnValue('fi-FI');
    const same = await build('{"fi":"<h2>Yhteys</h2><p>Teksti</p>","en":"<h2>Different</h2>"}', '{"fi":"Yhteys","en":"Contact"}', types);
    expect(same.querySelector('.big_description_value h2')).toBeNull();
    const other = await build('{"en":"<h2>Contact</h2><p>Body</p>"}', '{"fi":"Contact","en":"Other"}', types);
    expect(other.querySelector('.big_description_value h2')).not.toBeNull();
    const nullTranslation = await build('{"fi":null,"en":"<h2>Contact</h2><p>Body</p>"}', '{"fi":"Contact","en":"Other"}', types);
    expect(nullTranslation.querySelector('.big_description_value h2')).not.toBeNull();
});
test('several configured title fields still produce one primary h1', async () => {
    const { rowArticleContentElement: article } = await buildRowArticleContent({ title: 'Main', subtitle: 'Second' },
        'e2e_headings', { title: metadata.title, subtitle: metadata.title }, ['title', 'subtitle'], 'seed', 'M', false);
    expect(article.querySelectorAll('h1')).toHaveLength(1);
    expect(article.querySelector('h1').textContent).toBe('Main');
    expect(article.querySelectorAll('.big_card_header')).toHaveLength(2);
});
test('title-only edits restore a previously omitted heading in read-only content', async () => {
    const article = await build('<h2>Contact</h2><h2>Contact</h2><p>Body</p>');
    article.querySelector('.big_card_header_value').textContent = 'Another title';
    applyRowArticleHeadingRules(article);
    expect(article.querySelectorAll('.big_description_value h2')).toHaveLength(2);
    article.querySelector('.big_card_header_value').textContent = 'Contact';
    applyRowArticleHeadingRules(article);
    expect(article.querySelectorAll('.big_description_value h2')).toHaveLength(1);
});

test('related-record English fallback cannot remove a Finnish content heading', async () => {
    getLanguageWithBrowserFallback.mockReturnValue('fi');
    const realHelpers = await vi.importActual('./card_field_formatter_helpers.js');
    vi.mocked(resolveCardFieldDisplayValue).mockImplementation(realHelpers.resolveCardFieldDisplayValue);
    const row = { category_id: 9, category_name: '{"en":"Contact"}', content: '{"fi":"<h2>Contact</h2><p>Teksti</p>"}' };
    const types = {
        category_id: { card_element: 'header', data_type: 'integer', foreign_table: 'categories',
            foreign_display_column: 'name', foreign_display_metadata: { data_type: 'text',
                is_multilingual: true, hide_everywhere: false, client_delivery_mode: 'include' } },
        content: { ...metadata.content, is_multilingual: true },
    };
    const { rowArticleContentElement: article } = await buildRowArticleContent(row, 'e2e_headings', types,
        Object.keys(types), 'seed', 'C', false);
    expect(article.querySelector('.big_card_header_value').textContent).toBe('Contact');
    expect(article.querySelector('.big_description_value h2')?.textContent).toBe('Contact');
    expect(article.querySelector('.big_card_header_value').dataset.articleHeadingLanguage).toBe('en');
});

test('unknown title or content language preserves an otherwise identical heading', () => {
    for (const [titleLanguage, contentLanguage] of [['', 'fi'], ['fi', ''], ['', '']]) {
        const article = document.createElement('div');
        article.className = 'row_article_content';
        article.innerHTML = '<h1 class="big_card_header_value">Contact</h1><div class="big_description_value"><h2>Contact</h2></div>';
        article.querySelector('h1').dataset.articleHeadingLanguage = titleLanguage;
        article.querySelector('.big_description_value').dataset.articleHeadingLanguage = contentLanguage;
        applyRowArticleHeadingRules(article);
        expect(article.querySelector('.big_description_value h2')?.textContent).toBe('Contact');
    }
});
