// row_article_page_css.test.js
// Guards the opt-in Page sizing and theme boundaries without changing IFAV rules.
// Connects the page image DOM classes to the shared stylesheet import.
// Browser P1-P4 supply actual geometry and theme evidence on the native target.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { renderDatasetAppearance } from '../dataset_appearance_renderer.js';
import { DEFAULT_DATASET_APPEARANCE } from '../../../shared/dataset_appearance/validator.js';
import { buildRowArticlePageImage } from './row_article_page_image.js';
import { refreshLocalizedDatasetValues } from '../dataset_value_localizer.js';
import { expectPhoneRule, withoutPhone } from './row_article_phone_css_test_helpers.js';
import { requireNodeDependency } from '../../../../server_tools/lib/node_dependency_loader.mjs';
const { parse } = requireNodeDependency('postcss');
const directory = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(directory, 'row_article_page.css'), 'utf8');
test('Page contains a taller desktop image and keeps the original phone cap at the end', () => {
    expect(withoutPhone(css)).toContain('--page-image-height-limit: 80dvh;');
    expect(withoutPhone(css)).toContain('width: min(100%, calc(var(--page-image-height-limit) * var(--page-image-ratio)));');
    expect(withoutPhone(css)).toMatch(/\.image_first_page_view \.row_article_page_image > img:not\(\[hidden\]\)\s*\{[^}]*width: 100%;[^}]*height: auto;[^}]*max-height: var\(--page-image-height-limit\);[^}]*object-fit: contain;/s);
    expect(withoutPhone(css)).not.toContain('min(40dvh, 360px)');
    expectPhoneRule(css, '.image_first_page_view .row_article_page_image', {
        '--page-image-height-limit': 'min(40dvh, 360px)',
    });
    const phone = parse(css).last;
    expect(phone.type).toBe('atrule');
    expect(phone.params).toBe('(width <= 700px)');
    expect(css).toMatch(/@media \(width <= 480px\)/);
    expect(css).not.toMatch(/big_card_details_container|two_line_(?:field|label|value)/);
    expectPhoneRule(readFileSync(join(directory, 'cards_big.css'), 'utf8'),
        '.big_card_details_container .two_line_field', {
            'flex-direction': 'column', 'align-items': 'stretch', 'min-width': '0',
        });
    expect(css).toMatch(/color:\s*var\(--text_color\)/);
    expect(css).toMatch(/background:\s*var\(--bg_color\)/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|@keyframes|animation:/i);
    expect(readFileSync(join(directory, '../../../styles/imports.css'), 'utf8')).toContain('row_article_page.css');
});

test('Page alone replaces stacked margins with one description gap and a separate image gap', () => {
    const root = parse(css);
    root.walkRules(rule => {
        expect(rule.selector).toMatch(/^\.image_first_page_view(?: |\[)/);
    });
    expect(css).toMatch(/\.image_first_page_view \.row_article_page_image\s*\{[^}]*margin-block-end: 24px;/s);
    expect(css).toMatch(/\.image_first_page_view \.big_card_header\s*\{\s*margin-block-end: 0;/);
    expect(css).toMatch(/\.image_first_page_view \.big_card_description_container \.big_description_value > :first-child\s*\{\s*margin-block-start: 0;/);
    const shared = readFileSync(join(directory, 'cards_big.css'), 'utf8');
    expect(shared).toMatch(/\.big_card_header\s*\{[^}]*margin: 0px 10px 30px 10px;[^}]*padding-block-start: 19px;/s);
    expect(shared).toMatch(/\.big_card_description_container\s*\{\s*padding: 20px 1rem;/);
    expect(shared).toMatch(/\.big_card_image img\s*\{[^}]*max-height: 80vh;[^}]*object-fit: contain;/s);
    const gallery = readFileSync(join(directory, 'big_card_image_gallery.css'), 'utf8');
    expect(gallery).toMatch(/\.image_first_view_article_content\s*\{[^}]*width: min\(100%, 800px\);[^}]*margin-block: 40px;/s);
});

test('Page phone title fills the viewport with 16px content edges', () => {
    expectPhoneRule(css, '.image_first_page_view .big_card_header', {
        'margin-inline': '0', width: 'auto', 'max-width': 'none',
        'border-radius': '0', 'padding-inline': '16px',
    });
});

test.each([['fi', 'dark'], ['en', 'light']])('the %s/%s Page keeps its caption bound to its photo', async (language, theme) => {
    // Load the production cascade, including the shared important reset for article descendants.
    const imports = readFileSync(join(directory, '../../../styles/imports.css'), 'utf8');
    const sheets = Array.from(imports.matchAll(/\/(cards_big|big_card_image_gallery|row_article_page)\.css"\);/g),
        ([, name]) => name + '.css');
    expect(sheets).toEqual(['cards_big.css', 'big_card_image_gallery.css', 'row_article_page.css']);
    const style = document.createElement('style');
    style.textContent = sheets.map(name => readFileSync(join(directory, name), 'utf8')).join('\n');
    document.head.append(style);
    const outer = document.createElement('div');
    outer.className = 'image_first_page_view';
    outer.dataset.articleImageCaptionPosition = 'overlay';
    const page = document.createElement('div');
    page.className = 'image_first_view image_first_page_view';
    const article = document.createElement('div');
    article.className = 'big_card_content row_article_content image_first_view_article_content';
    const photographer = 'PitkäKatkeamatonValokuvaajatunnisteLongUnbrokenPhotographerName';
    const url = 'https://example.test/photos/portrait';
    const description = { fi: 'Kuvituskuva – [' + photographer + '](' + url + ')',
        en: 'Illustration – [' + photographer + '](' + url + ')' };
    const { element } = buildRowArticlePageImage({ imageRow: { filename: 'portrait.jpg', description },
        resolvePath: path => path, resolveAlt: () => 'Portrait' });
    const image = element.querySelector('img');
    Object.defineProperties(image, { naturalWidth: { value: 400 }, naturalHeight: { value: 800 } });
    image.dispatchEvent(new Event('load'));
    article.append(element);
    page.append(article);
    outer.append(page);
    document.body.append(outer);
    document.body.classList.add(theme + '-mode');
    try {
        await refreshLocalizedDatasetValues(language);
        const caption = element.querySelector('figcaption');
        const prefix = language === 'fi' ? 'Kuvituskuva: ' : 'Illustration: ';
        for (const position of ['below', 'overlay', 'below']) {
            renderDatasetAppearance(page, { ...DEFAULT_DATASET_APPEARANCE,
                shared: { ...DEFAULT_DATASET_APPEARANCE.shared, article_image_caption_position: position } });
            expect(caption.textContent).toBe(prefix + photographer);
            const computed = getComputedStyle(caption);
            expect(computed.position === 'absolute').toBe(position === 'overlay');
            expect(computed.overflowWrap).toBe('anywhere');
            if (position === 'overlay') expect(computed.maxWidth).toBe('96%');
        }
    } finally {
        document.body.classList.remove(theme + '-mode');
        outer.remove();
        style.remove();
    }
});
