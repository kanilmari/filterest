// row_article_page_css.test.js
// Guards the opt-in Page sizing and theme boundaries without changing IFAV rules.
// Connects the page image DOM classes to the shared stylesheet import.
// Browser P1-P4 supply actual geometry and theme evidence on the native target.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { expectPhoneRule, withoutPhone } from './row_article_phone_css_test_helpers.js';
import { requireNodeDependency } from '../../../../server_tools/lib/node_dependency_loader.mjs';
const { parse } = requireNodeDependency('postcss');
const directory = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(directory, 'row_article_page.css'), 'utf8');
test('Page contains a taller desktop image and keeps the original phone cap at the end', () => {
    expect(withoutPhone(css)).toMatch(/\.image_first_page_view \.row_article_page_image > img:not\(\[hidden\]\)\s*\{[^}]*width: 100%;[^}]*height: auto;[^}]*max-height: 80dvh;[^}]*object-fit: contain;/s);
    expect(withoutPhone(css)).not.toContain('min(40dvh, 360px)');
    expectPhoneRule(css, '.image_first_page_view .row_article_page_image > img:not([hidden])', {
        'max-height': 'min(40dvh, 360px)',
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
        expect(rule.selector.startsWith('.image_first_page_view ')).toBe(true);
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
