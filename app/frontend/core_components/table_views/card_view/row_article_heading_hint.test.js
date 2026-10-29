// @vitest-environment jsdom
// row_article_heading_hint.test.js
// Proves the existing inline article editor warns politely without changing save behavior.
// Connects real formatter controls, locale changes and the shared heading matcher.
// Covers both translations, title/content drafts and restoration of article semantics.
import { beforeEach, expect, test, vi } from 'vitest';
vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn(async () => ({})) }));
vi.mock('../../state_stores/lang_preference_reader.js', () => ({ getLanguageWithBrowserFallback: vi.fn(() => 'en') }));
vi.mock('../../lang/translation_handler.js', () => ({ getTranslationForKey: (_key, { fallback }) => fallback }));
vi.mock('../../service_catalog/service_catalog_moderation.js', () => ({
    readCachedUserPermissions: () => [], canEditServiceCatalogColumn: () => true,
}));
import { enableEditing, collectCardUpdates, disableEditing, cancelEditing, sendCardUpdates } from './card_field_formatter.js';
import { getLanguageWithBrowserFallback } from '../../state_stores/lang_preference_reader.js';
import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { applyRowArticleHeadingRules } from './row_article_heading_renderer.js';
import { resolveHeadingLanguage } from './row_article_heading_match.js';

const types = { title: { data_type: 'text', editable_in_ui: true, card_element: 'header' },
    content: { data_type: 'text', editable_in_ui: true, card_element: 'description' } };
function setup(multilingual = false) {
    const container = document.createElement('div');
    container.className = 'row_article_content';
    container.innerHTML = '<h1 class="big_card_header"><div class="big_card_header_value" data-column="title"></div></h1>'
        + '<div class="big_description_value" data-column="content"></div>';
    const language = getLanguageWithBrowserFallback();
    const title = multilingual ? '{"en":"Contact","fi":"Yhteys"}' : JSON.stringify({ [language]: 'Contact' });
    const content = multilingual ? '{"en":"<h2>Contact</h2><p>Body</p>","fi":"<h2>Yhteys</h2><p>Teksti</p>"}'
        : JSON.stringify({ [language]: '<h2>Contact</h2><h2>Contact</h2><h1>Section</h1><p>Body</p>' });
    for (const [name, raw] of Object.entries({ title, content })) {
        const field = container.querySelector(`[data-column="${name}"]`);
        field.dataset.rawValue = raw;
        field.dataset.articleHeadingLanguage = resolveHeadingLanguage(raw, true, language);
    }
    document.body.append(container);
    enableEditing(container, 'e2e_headings', Object.fromEntries(Object.entries(types)
        .map(([name, metadata]) => [name, { ...metadata, is_multilingual: true }])));
    return container;
}
function change(input, value) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
beforeEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); getLanguageWithBrowserFallback.mockReturnValue('en'); });

test.each(['en', 'fi'])('%s hint follows both fields and never blocks collection or saving', async language => {
    getLanguageWithBrowserFallback.mockReturnValue(language);
    const container = setup();
    const hint = container.querySelector('.row-article-heading-hint');
    const title = container.querySelector('[data-column="title"] input');
    const content = container.querySelector('[data-column="content"] input, [data-column="content"] textarea');
    expect(hint.getAttribute('aria-live')).toBe('polite');
    expect(hint.textContent).toBe(language === 'fi' ? 'Sisältö alkaa samalla otsikolla kuin rivi; otsikko näytetään jo.'
        : 'The content starts with the row title, which is already shown.');
    expect(collectCardUpdates(container)).toEqual({});
    change(title, 'Contact us'); expect(hint.textContent).toBe('');
    change(content, '<h2>Contact us</h2><p>New body</p>'); expect(hint.textContent).not.toBe('');
    expect(content.validationMessage).toBe('');
    const updates = collectCardUpdates(container);
    expect(JSON.parse(updates.title)).toEqual({ [language]: 'Contact us' });
    expect(JSON.parse(updates.content)).toEqual({ [language]: '<h2>Contact us</h2><p>New body</p>' });
    await sendCardUpdates('e2e_headings', 7, updates);
    expect(endpoint_router).toHaveBeenCalledTimes(2);
    expect(content.value).toBe(JSON.parse(updates.content)[language]);
    disableEditing(container);
    expect(container.querySelector('.row-article-heading-hint')).toBeNull();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('.big_description_value').textContent).toBe('New body');
});
test('changing content to a later or near-match heading clears the hint', () => {
    const container = setup();
    const content = container.querySelector('[data-column="content"] input, [data-column="content"] textarea');
    const hint = container.querySelector('.row-article-heading-hint');
    change(content, '<h2>Contact us</h2>'); expect(hint.textContent).toBe('');
    change(content, '<p>Intro</p><h2>Contact</h2>'); expect(hint.textContent).toBe('');
    change(content, '<h2>Contact</h2>'); expect(hint.textContent).not.toBe('');
    cancelEditing(container);
    expect(container.querySelectorAll('.big_description_value h2')).toHaveLength(2);
    expect(container.querySelector('h2[data-demoted-from="h1"]').textContent).toBe('Section');
    applyRowArticleHeadingRules(container);
    expect(container.querySelectorAll('.big_description_value h2')).toHaveLength(2);
});
test('switching editor language compares that language without flattening stored translations', async () => {
    const container = setup(true);
    await Promise.resolve();
    container.querySelector('.multilang-selector input[value="fi"]').click();
    expect(container.querySelector('[data-column="content"] input, [data-column="content"] textarea').value).toContain('Yhteys');
    expect(container.querySelector('.row-article-heading-hint').textContent).not.toBe('');
    change(container.querySelector('[data-column="title"] input'), 'Muu');
    expect(container.querySelector('.row-article-heading-hint').textContent).toBe('');
    const updates = collectCardUpdates(container);
    expect(JSON.parse(updates.title)).toEqual({ en: 'Contact', fi: 'Muu' });
    expect(updates.content).toBeUndefined();
});
test('ordinary card editors gain neither hint nor heading demotion', () => {
    const container = setup();
    cancelEditing(container);
    container.classList.remove('row_article_content');
    enableEditing(container, 'e2e_headings', types);
    expect(container.querySelector('.row-article-heading-hint')).toBeNull();
});

test.each(['fi', 'fi-FI'])('saving a newly added Finnish translation refreshes its fallback comparison language (%s)', async language => {
    getLanguageWithBrowserFallback.mockReturnValue(language);
    const container = document.createElement('div');
    container.className = 'row_article_content';
    container.innerHTML = '<h1 class="big_card_header"><div class="big_card_header_value" data-column="title">Contact</div></h1>'
        + '<div class="big_description_value" data-column="content"><h2>English</h2><p>Body</p></div>';
    const title = container.querySelector('[data-column="title"]');
    const content = container.querySelector('[data-column="content"]');
    title.dataset.rawValue = '{"fi":"Contact"}';
    title.dataset.articleHeadingLanguage = 'fi';
    content.dataset.rawValue = '{"en":"<h2>English</h2><p>Body</p>"}';
    content.dataset.articleHeadingLanguage = 'en';
    applyRowArticleHeadingRules(container);
    document.body.append(container);
    enableEditing(container, 'e2e_headings', Object.fromEntries(Object.entries(types)
        .map(([name, meta]) => [name, { ...meta, is_multilingual: true }])));
    container.querySelector('.multilang-selector input[value="fi"]').click();
    change(content.querySelector('input, textarea'), '<h2>Contact</h2><p>Teksti</p>');
    expect(container.querySelector('.row-article-heading-hint').textContent).not.toBe('');
    const updates = collectCardUpdates(container);
    await sendCardUpdates('e2e_headings', 7, updates);
    disableEditing(container);
    expect(content.querySelector('h2')).toBeNull();
    expect(content.dataset.articleHeadingLanguage).toBe('fi');
    expect(JSON.parse(content.dataset.rawValue)).toEqual({ en: '<h2>English</h2><p>Body</p>', fi: '<h2>Contact</h2><p>Teksti</p>' });
});
