// @vitest-environment node
// cards_service_catalog_logo_css.test.js
// Verifies service catalog logo CSS keeps card media in one stable square.
// Bridges card CSS source and regression tests for visual sizing constants.
// Exists to prevent catalog logo marks from shrinking below the 300px media area.

import { describe, expect, test } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

function readSiblingCss(filename) {
    return readFileSync(resolve(CURRENT_DIR, filename), 'utf8');
}

function extractRule(css, selector) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|\\n)${escapedSelector}\\s*\\{`).exec(css);
    const startIndex = match?.index ?? -1;
    expect(startIndex, `Missing CSS rule for ${selector}`).toBeGreaterThanOrEqual(0);
    const bodyStart = startIndex + (match?.[0].length ?? 0);
    const bodyEnd = css.indexOf('}', bodyStart);
    expect(bodyEnd, `Missing CSS rule end for ${selector}`).toBeGreaterThan(bodyStart);
    return css.slice(bodyStart, bodyEnd);
}

function expectTwoLineClamp(rule) {
    expect(rule).toContain('display: -webkit-box');
    expect(rule).toContain('-webkit-box-orient: vertical');
    expect(rule).toContain('-webkit-line-clamp: 2');
    expect(rule).toContain('line-clamp: 2');
    expect(rule).toContain('overflow: hidden');
    expect(rule).toContain('text-overflow: ellipsis');
}

describe('service catalog logo CSS sizing', () => {
    test('keeps the 300px logo frame lock scoped to card view only', () => {
        const cardsCss = readSiblingCss('cards.css');
        const cardsBigCss = readSiblingCss('cards_big.css');

        const cardLogoFrameRule = extractRule(
            cardsCss,
            '.card_image .wrapper.service_catalog_logo_frame'
        );
        const rowArticleWrapperRule = extractRule(cardsBigCss, '.big_card_image .wrapper');
        const rowArticleImageContainerRule = extractRule(cardsBigCss, '.big_card_image');
        const rowArticleCssLogoFrameRule = extractRule(
            cardsBigCss,
            '.big_card_image .wrapper.service_catalog_logo_frame[data-service-catalog-logo-render-mode="css"]'
        );
        const rowArticleImageRule = extractRule(cardsBigCss, '.big_card_image img');

        expect(cardLogoFrameRule).toContain('var(--card_image_large_width)');
        expect(cardLogoFrameRule).toContain('width: var(--card_image_large_width) !important');
        expect(cardLogoFrameRule).toContain('height: var(--card_image_large_width) !important');
        expect(cardLogoFrameRule).toContain('aspect-ratio: 1');
        expect(cardLogoFrameRule).not.toContain('padding');
        expect(cardLogoFrameRule).not.toContain('min(100%');
        expect(rowArticleWrapperRule).toContain('width: 100% !important');
        expect(rowArticleWrapperRule).toContain('height: auto !important');
        expect(rowArticleImageContainerRule).toContain('margin-top: 30px');
        expect(rowArticleCssLogoFrameRule).toContain('width: min(100%, 80vh) !important');
        expect(rowArticleCssLogoFrameRule).toContain('aspect-ratio: 1');
        expect(rowArticleImageRule).toContain('max-height: 80vh');
        expect(cardsBigCss).not.toMatch(
            /\.big_card_image\s+\.wrapper\.service_catalog_logo_frame\s*\{[^}]*card_image_large_width/s
        );
        expect(cardsBigCss).not.toMatch(
            /\.big_card_image\s+\.wrapper\.service_catalog_logo_frame\s*\{[^}]*height:\s*var\(--card_image_large_width\)/s
        );
    });

    test('keeps article gallery images as thumbnails instead of a persistent hero preview', () => {
        const galleryCss = readSiblingCss('big_card_image_gallery.css');
        const rowRule = extractRule(galleryCss, '.big_card_thumbnail_row');
        const stripRule = extractRule(galleryCss, '.big_card_thumbnail_strip');
        const thumbRule = extractRule(galleryCss, '.big_card_thumbnail_row img');
        const uploadRule = extractRule(galleryCss, '.image_upload_placeholder.small');

        expect(galleryCss).not.toContain('.big_card_hero_image');
        expect(rowRule).toContain('grid-template-columns: repeat(var(--big-card-thumbnail-slot-count), minmax(0, 1fr))');
        expect(stripRule).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))');
        expect(thumbRule).toContain('width: 100%');
        expect(thumbRule).toContain('height: 100%');
        expect(uploadRule).toContain('aspect-ratio: 1');
    });

    test('keeps a visible media border while padding only CSS-composed logos', () => {
        const cardsCss = readSiblingCss('cards.css');
        const sharedFrameRule = extractRule(
            cardsCss,
            [
                '.card_image .wrapper.service_catalog_logo_frame',
                '.card_image .wrapper.card_image_contrast_frame',
                '.big_card_image .wrapper.service_catalog_logo_frame',
                '.big_card_image .wrapper.card_image_contrast_frame',
            ].join(',\n')
        );
        const cssLogoRule = extractRule(cardsCss, '.service-catalog-css-logo');

        expect(sharedFrameRule).toContain('border: 1px solid');
        expect(cssLogoRule).toContain('clamp(0.9rem, 7cqi, 1.6rem)');
        expect(cssLogoRule).toContain('clamp(0.65rem, 4cqi, 1.1rem)');
    });

    test('fills ordinary full-image logo frames without changing standalone/CSS marks', () => {
        const cardsCss = readSiblingCss('cards.css');
        const fullImageRule = extractRule(
            cardsCss,
            [
                '.card_image .wrapper.service_catalog_logo_frame[data-service-catalog-logo-kind="image"] > img',
                '.big_card_image .wrapper.service_catalog_logo_frame[data-service-catalog-logo-kind="image"] > img',
            ].join(',\n')
        );

        expect(fullImageRule).toContain('object-fit: cover !important');
    });

    test('keeps row article content out of grid layout so media centers normally', () => {
        const cardsBigCss = readSiblingCss('cards_big.css');
        const rowArticleContentRule = extractRule(cardsBigCss, '.big_card_content');

        expect(rowArticleContentRule).not.toContain('display: grid');
        expect(rowArticleContentRule).not.toContain('gap: 15px');
    });

    test('keeps the modern details panel neutral instead of adding a blue left edge', () => {
        const cardsCss = readSiblingCss('cards.css');
        const infoPanelRule = extractRule(cardsCss, '.card--modern .card_modern_info_panel');

        expect(infoPanelRule).toContain('If enabled, this would accent the details panel with a blue left edge.');
        expect(infoPanelRule).not.toMatch(/^\s*border-left:/m);
    });

    test('keeps article-mode chrome out of the row content and small-card titles', () => {
        const cardsCss = readSiblingCss('cards.css');
        const cardsBigCss = readSiblingCss('cards_big.css');
        const legacyCloseRule = extractRule(
            cardsBigCss,
            '.card_view_wrapper.big-card-open .active_row_article > .big_card_close'
        );
        const smallCardIconRule = extractRule(
            cardsCss,
            [
                '.card_view_wrapper.big-card-open .card_header_dataset_icon',
                '.card_view_wrapper.big-card-open .small_card_dataset_icon',
                '.card_view_wrapper.big-card-open .card_header .dataset_table_icon',
            ].join(',\n')
        );

        expect(legacyCloseRule).toContain('display: none');
        expect(smallCardIconRule).toContain('display: none');
    });

    test('keeps mark-only logos full-size while mark-title logos reserve text room', () => {
        const cardsCss = readSiblingCss('cards.css');
        const markRule = extractRule(cardsCss, '.service-catalog-css-logo__mark');
        const markOnlyRule = extractRule(
            cardsCss,
            '.service-catalog-css-logo--mark-only .service-catalog-css-logo__mark'
        );
        const markTitleRule = extractRule(
            cardsCss,
            '.service_catalog_logo_frame .service-catalog-css-logo.service-catalog-css-logo--mark-title .service-catalog-css-logo__mark'
        );

        expect(markRule).toContain('width: 100%');
        expect(markRule).toContain('height: 100%');
        expect(markTitleRule).toContain('width: 80%');
        expect(markTitleRule).toContain('height: 80%');
        expect(markOnlyRule).toContain('width: 100%');
        expect(markOnlyRule).toContain('height: 100%');
        expect(`${markRule}\n${markOnlyRule}`).not.toMatch(
            /\b(112|150|180|190|210|260|360)px\b/
        );
        expect(cardsCss).not.toContain('service-catalog-css-logo--matrix');
        expect(cardsCss).not.toContain('service-catalog-css-logo__mark--matrix');
    });

    test('keeps article CSS-assisted mark-title logos independent from big-card image resets', () => {
        const cardsBigCss = readSiblingCss('cards_big.css');
        const articleLogoRule = extractRule(
            cardsBigCss,
            '.big_card_image .wrapper.service_catalog_logo_frame .service-catalog-css-logo.service-catalog-css-logo--mark-title'
        );
        const articleMarkRule = extractRule(
            cardsBigCss,
            '.big_card_image .wrapper.service_catalog_logo_frame .service-catalog-css-logo.service-catalog-css-logo--mark-title .service-catalog-css-logo__mark'
        );
        const articleTitleRule = extractRule(
            cardsBigCss,
            '.big_card_image .wrapper.service_catalog_logo_frame .service-catalog-css-logo.service-catalog-css-logo--mark-title .service-catalog-css-logo__title'
        );

        expect(articleLogoRule).toContain('clamp(2.25rem, 6cqi, 4.5rem)');
        expect(articleLogoRule).toContain('clamp(3rem, 7cqi, 5.5rem)');
        expect(articleMarkRule).toContain('width: 80% !important');
        expect(articleMarkRule).toContain('height: 80% !important');
        expect(articleTitleRule).toContain('--service-logo-title-min-size: 2.2rem');
        expect(articleTitleRule).toContain('--service-logo-title-max-size: min(8.8rem, 18cqi)');
        expect(articleTitleRule).toContain('--service-logo-title-offset-y: -28px');
        expect(articleTitleRule).not.toContain('vh');
    });

    test('keeps CSS-assisted logo titles on one unclipped row', () => {
        const cardsCss = readSiblingCss('cards.css');
        const cssLogoRule = extractRule(cardsCss, '.service-catalog-css-logo');
        const titleRule = extractRule(cardsCss, '.service-catalog-css-logo__title');

        expect(cssLogoRule).toContain('grid-template-rows: minmax(0, 1fr) max-content');
        expect(cssLogoRule).toContain('container-type: inline-size');
        expect(titleRule).toContain('white-space: nowrap');
        expect(titleRule).toContain('--service-logo-title-min-size: 1.2rem');
        expect(titleRule).toContain('--service-logo-title-max-size: 2.2rem');
        expect(titleRule).toContain('--service-logo-title-offset-y: -10px');
        expect(titleRule).toContain('calc((100cqi / var(--service-logo-title-length, 10)) * 1.6)');
        expect(titleRule).toContain('line-height: 1.18');
        expect(titleRule).toContain('transform: translateY(var(--service-logo-title-offset-y))');
        expect(titleRule).not.toContain('overflow: hidden');
        expect(titleRule).not.toContain('max-height');
        expect(titleRule).not.toContain('padding-bottom');
        expect(titleRule).not.toContain('text-overflow');
        expect(titleRule).not.toContain('overflow-wrap');
    });
});

describe('card detail icon CSS', () => {
    test('does not force stroke-based SVG icons to fill into blobs', () => {
        const cardsCss = readSiblingCss('cards.css');
        const iconRule = extractRule(cardsCss, '.card_detail_row_icon_svg');

        expect(iconRule).toContain('color: currentColor');
        expect(iconRule).not.toContain('fill: currentColor');
    });
});

describe('card text clamp CSS', () => {
    test('limits card descriptions to two visible text rows with ellipsis', () => {
        const cardsCss = readSiblingCss('cards.css');
        const descriptionRule = extractRule(cardsCss, '.description_value');

        expectTwoLineClamp(descriptionRule);
        expect(descriptionRule).toContain('max-height: calc(1.5em * 2)');
    });

    test('limits card detail values to two visible text rows with ellipsis', () => {
        const cardsCss = readSiblingCss('cards.css');
        const kvRule = extractRule(
            cardsCss,
            [
                '.card_details_kv:not(.card_details_single_line) .kv-value',
                '.card_details_kv:not(.card_details_single_line) .kv-conditional-value',
                '.card_details_kv:not(.card_details_single_line) .kv-conditional-value.kv-dropped',
            ].join(',\n')
        );
        const singleLineRule = extractRule(
            cardsCss,
            '.card_details_single_line .card_detail_row_value'
        );
        const modernTileRule = extractRule(
            cardsCss,
            '.card--modern .card_detail_tile_value'
        );
        const fallbackValueRule = extractRule(cardsCss, '.card_value');

        for (const rule of [kvRule, singleLineRule, modernTileRule, fallbackValueRule]) {
            expectTwoLineClamp(rule);
        }
    });
});
