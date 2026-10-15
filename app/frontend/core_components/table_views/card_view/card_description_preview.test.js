// @vitest-environment jsdom
// card_description_preview.test.js
// Exercises preview cleanup through real cards, locale selection and the HTML sanitizer.
// Connects stored values to normal, modern, compact and article-result descriptions.
// Keeps preview-only changes from altering the row or full-field rendering.
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
vi.mock('./card_avatar_builder.js', () => ({
    createImageElement: vi.fn(() => document.createElement('img')),
    create_seeded_avatar: vi.fn(async () => document.createElement('span')),
}));
vi.mock('./row_article_opener.js', () => ({ openRowArticleView: vi.fn() }));
vi.mock('./image_first_view_activation.js', () => ({ bindImageFirstViewActivation: vi.fn() }));
vi.mock('./card_keyword_builder.js', () => ({ addKeywordsSection: vi.fn() }));
vi.mock('../table_view/row_selection_handler.js', () => ({ update_card_selection: vi.fn() }));
vi.mock('./card_selection_action_bar.js', () => ({
    resolveCardRenderContext: vi.fn(), updateMassDeleteBar: vi.fn(),
}));
vi.mock('../../../reusable_components/key_value_container/kv_container_printer.js', () => ({
    renderKeyValuePairs: vi.fn(),
}));
vi.mock('./card_detail_single_line_helpers.js', () => ({ renderSingleLineCardDetails: vi.fn() }));
vi.mock('./card_detail_tile_builder.js', () => ({ renderModernCardDetails: vi.fn() }));
vi.mock('../../dev_tools/function_counter.js', () => ({ count_this_function: vi.fn() }));
vi.mock('../../filterbar/filter_list/column_visibility_handler.js', () => ({
    makeColumnClass: vi.fn((table, column) => `${table}_${column}`),
}));
vi.mock('../../../icons/icon_loader.js', () => ({ setElementSvgContent: vi.fn() }));
vi.mock('./dataset_icon_builder.js', () => ({ createDatasetIconElement: vi.fn() }));
vi.mock('../../route_permission_checker.js', () => ({
    hasRoutePermission: vi.fn(() => true), hasDatasetPermission: vi.fn(() => false),
}));
vi.mock('../../../ui_config.js', () => ({
    always_show_empty_fields_on_cards: true, show_more_button_on_cards: false,
    predictCardImageCssWidth: vi.fn(() => 300),
    resolveCardMediaFolderForImageWidth: vi.fn(() => '1000'),
}));

import { createSingleCard } from './card_row_builder.js';
import { createKeyValueElement } from './card_field_formatter.js';
import { datasetAppearanceState } from '../dataset_appearance_state.js';
import { DEFAULT_DATASET_APPEARANCE } from '../../../shared/dataset_appearance/validator.js';
import { disposeCardResources } from './card_resource_lifecycle.js';

const prefixes = ['\n\n', '\r\n\r\n', ' \t\u00a0', '<br><br>', '<p><br></p>',
    '<p></p><p> &nbsp;\t<br></p>', '<div><span> &nbsp;<br></span></div>'];
const forms = ['plain', 'object', 'json'];
const variants = ['normal', 'modern', 'compact', 'article-result'];

async function build(value, language, variant = 'normal', lines = 2) {
    const config = structuredClone(DEFAULT_DATASET_APPEARANCE);
    config.shared.card_style_variant = variant === 'modern' ? 'modern' : 'standard';
    await datasetAppearanceState.updateSite(config);
    localStorage.setItem('chosen_language', language);
    const row = { id: 1, body: value };
    const before = JSON.stringify(row);
    const card = await createSingleCard(row, ['body'], 'preview_test', {
        body: { card_element: 'description', show_value_on_card: true,
            is_multilingual: typeof value !== 'string' || value.startsWith('{') },
    }, { hasDeleteRight: false, canManageRowAccess: false, canManageRowGroups: false,
        tableHasImageRole: false, timestampDisplayOptions: {} }, 0, language,
    variant === 'article-result' ? 'article_view' : 'card');
    if (variant === 'compact') card.classList.add('small-card');
    expect(card.classList.contains('card--modern')).toBe(variant === 'modern');
    expect(card.dataset.cardPresentationView).toBe(variant === 'article-result' ? 'article_view' : 'card');
    card.style.setProperty('--card-description-lines', String(lines));
    document.body.append(card);
    expect(JSON.stringify(row)).toBe(before);
    return card.querySelector('.description_value');
}

beforeEach(() => {
    document.querySelectorAll('.card').forEach(disposeCardResources);
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
    datasetAppearanceState.clear();
});

describe('leading empty HTML never spends the card preview lines', () => {
    test.each(variants.flatMap(variant => forms.flatMap(form => ['fi', 'en'].flatMap(language =>
        [1, 2, 6].map(lines => [variant, form, language, lines])))))('%s / %s / %s / %i lines', async (variant, form, language, lines) => {
        for (const prefix of prefixes) {
            const text = language === 'fi' ? 'Näkyvä teksti' : 'Visible text';
            const localized = `${prefix}${text}`;
            const map = { fi: language === 'fi' ? localized : 'Muu teksti',
                en: language === 'en' ? localized : 'Other text' };
            const raw = form === 'plain' ? localized : form === 'object' ? map : JSON.stringify(map);
            const value = await build(raw, language, variant, lines);
            expect(value.textContent).toBe(text);
            expect(value.firstChild.textContent).toBe(text);
            expect(value.querySelector('br, p:empty')).toBeNull();
            expect(value.dataset.rawValue).toContain(text);
        }
    });

    test.each(['<p>A</p><p>B</p>', '<ul><li>A</li><li>B</li></ul>',
        '<ol><li>A</li><li>B</li></ol>', '<div>A</div><blockquote>B</blockquote>',
        'A<br>B', '<p>A <strong>B</strong></p>'])('keeps populated boundaries: %s', async html => {
        const value = await build(`<p><br></p>${html}<p><br></p>`, 'en');
        expect(value.innerHTML).toBe(html);
        expect(value.dataset.rawValue).toBe(`<p><br></p>${html}<p><br></p>`);
    });

    test.each(['fi', 'en'].flatMap(language => ['object', 'json'].map(form => [language, form])))(
        'an intentionally empty %s in %s never borrows the other language', async (language, form) => {
        const raw = { fi: language === 'fi' ? '' : 'Muu teksti', en: language === 'en' ? '' : 'Other text' };
        const value = await build(form === 'object' ? raw : JSON.stringify(raw), language);
        // Preserve the existing empty-field presentation, without fallback text or dots.
        expect(value.textContent).toBe('—');
        expect(value.dataset.rawValue).toBe('');
    });

    test.each(['<br><p> &nbsp; </p>', '<div><span>\u00a0<br></span></div>'])(
        'an HTML-only empty preview has no overflow content: %s', async html => {
            expect((await build(html, 'en')).innerHTML).toBe('');
        });

    test('the sanitizer handles attributes, comments and entity text before cleanup', async () => {
        const value = await build('<p title="a > b"><br></p><!-- gap --><p onclick="bad()">A &amp; B</p>', 'en');
        expect(value.innerHTML).toBe('<p>A &amp; B</p>');
        expect(value.querySelector('[onclick], [title]')).toBeNull();
    });

    test('full article and editor input keep the original blocks and whitespace', async () => {
        const stored = '<p><br></p><p>A</p><p>B</p>\r\n';
        await build(stored, 'en');
        const full = createKeyValueElement('', stored, 'body', false, 'big_description_value');
        expect(full.querySelector('.big_description_value').innerHTML).toBe('<p><br></p><p>A</p><p>B</p>');
        expect(full.querySelector('[data-raw-value]').dataset.rawValue).toBe(stored);
    });
});
