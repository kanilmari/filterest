// @vitest-environment node
// morphing_filterbar_content_css.test.js
// Locks the dataset-cover fade that keeps hero copy readable over photography.

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

describe('morphing filterbar content CSS', () => {
    test('keeps the light oval defaults and gives dark mode an unmasked 30 percent cover', () => {
        const css = readFileSync(resolve(CURRENT_DIR, 'dataset_cover_theme.css'), 'utf8');
        const defaultsRule = css.match(
            /\.filterbar-inline-hero--has-cover\s*\{([\s\S]*?)\n\}/,
        )?.[1] || '';
        const coverRule = css.match(
            /\.filterbar-inline-hero--has-cover::before\s*\{([\s\S]*?)\n\}/,
        )?.[1] || '';
        const darkRule = css.match(
            /body\.dark-mode \.filterbar-inline-hero--has-cover\s*\{([\s\S]*?)\n\}/,
        )?.[1] || '';
        const lightRule = css.match(
            /body:not\(\.dark-mode\) \.filterbar-inline-hero--has-cover\s*\{([\s\S]*?)\n\}/,
        )?.[1] || '';
        const overlayRule = Array.from(css.matchAll(
            /\.filterbar-inline-hero--has-cover::after\s*\{([\s\S]*?)\n\}/g,
        )).at(-1)?.[1] || '';

        expect(defaultsRule).toContain('--dataset-cover-light-mask-oval-x: 32%');
        expect(defaultsRule).toContain('--dataset-cover-light-mask-oval-y: 67%');
        expect(defaultsRule).toContain('--dataset-cover-light-mask-position-y: 56%');
        expect(defaultsRule).toContain('--dataset-cover-light-mask-center-opacity: 0.4');
        expect(defaultsRule).toContain('--dataset-cover-light-mask-mid-opacity: 0.7');
        expect(defaultsRule).toContain('--dataset-cover-light-mask-edge-opacity: 1');
        expect(defaultsRule).toContain('--dataset-cover-light-mask-center-stop: 39%');
        expect(defaultsRule).toContain('--dataset-cover-light-mask-mid-stop: 55%');
        expect(defaultsRule).toContain('--dataset-cover-light-mask-edge-stop: 80%');
        expect(defaultsRule).toContain('--dataset-cover-hero-extra-height: 40px');
        expect(defaultsRule).toContain('--dataset-cover-hero-bottom-fade: 48px');
        expect(defaultsRule).toContain('--dataset-cover-image-blur: 1px');
        expect(defaultsRule).toContain(
            'padding-bottom: calc(18px + var(--dataset-cover-hero-extra-height))'
        );
        expect(defaultsRule).toContain('--dataset-cover-light-overlay-opacity: 0');
        expect(coverRule).toContain('mask-image: var(--dataset-cover-mask-image, radial-gradient(');
        expect(coverRule).toContain(
            'ellipse var(--dataset-cover-mask-oval-x) var(--dataset-cover-mask-oval-y) at 50% var(--dataset-cover-mask-position-y)'
        );
        expect(coverRule).toContain('opacity: var(--dataset-cover-image-opacity)');
        expect(coverRule).toContain('filter: blur(var(--dataset-cover-image-blur))');
        expect(darkRule).toContain('--dataset-cover-mask-image: var(--dataset-cover-dark-mask-image)');
        expect(darkRule).toContain('--dataset-cover-image-opacity: var(--dataset-cover-dark-image-opacity)');
        expect(lightRule).toContain('--dataset-cover-mask-image: var(--dataset-cover-light-mask-image)');
        expect(lightRule).toContain('--dataset-cover-image-opacity: var(--dataset-cover-light-image-opacity)');
        expect(overlayRule).toContain('rgb(0 0 0 / var(--dataset-cover-overlay-opacity))');
        expect(overlayRule).toContain('calc(100% - var(--dataset-cover-hero-bottom-fade))');
        expect(overlayRule).toContain('var(--bg_color) 100%');
    });

    test('uses the title colour for wide slogans and outlines the inline sort row', () => {
        const css = readFileSync(resolve(CURRENT_DIR, 'morphing_filterbar_content.css'), 'utf8');
        const subtitleRule = css.match(
            /\.filterbar-panel--wide \.morphing-subtitle,[\s\S]*?\.filterbar-inline-hero \.morphing-subtitle\s*\{([\s\S]*?)\n\}/,
        )?.[1] || '';
        const sortRule = css.match(
            /\.filterbar-inline-hero-sort-row\s*\{([\s\S]*?)\n\}/,
        )?.[1] || '';

        expect(subtitleRule).toContain('color: var(--text_color)');
        expect(sortRule).toContain('border: 1px solid var(--border_color)');
    });

    test('keeps the compact palette inside the visible area and scrollable', () => {
        const css = readFileSync(
            resolve(CURRENT_DIR, '../admin_tools/dataset_cover_test_palette.css'),
            'utf8'
        );
        const paletteRule = css.match(
            /\.dataset-cover-test-palette\s*\{([\s\S]*?)\n\}/,
        )?.[1] || '';

        expect(paletteRule).toContain('position: fixed');
        expect(paletteRule).toContain('width: min(420px, calc(100% - 88px))');
        expect(paletteRule).toContain('height: min(820px, 97dvh)');
        expect(paletteRule).toContain('max-height: 97dvh');
        expect(paletteRule).toContain('overflow: hidden');
        expect(paletteRule).toContain('resize: both');

        const bodyRule = css.match(
            /\.dataset-cover-test-palette__body\s*\{([\s\S]*?)\n\}/,
        )?.[1] || '';
        const headingRule = css.match(
            /\.dataset-cover-test-palette__heading\s*\{([\s\S]*?)\n\}/,
        )?.[1] || '';
        expect(bodyRule).toContain('overflow: auto');
        expect(headingRule).toContain('position: sticky');
    });

    test('loads the palette immediately after the canonical hero styles', () => {
        const imports = readFileSync(
            resolve(CURRENT_DIR, '../../styles/imports.css'),
            'utf8'
        );
        const heroIndex = imports.indexOf('morphing_filterbar_content.css');
        const themeIndex = imports.indexOf('dataset_cover_theme.css');
        const paletteIndex = imports.indexOf('dataset_cover_test_palette.css');

        expect(heroIndex).toBeGreaterThan(-1);
        expect(themeIndex).toBeGreaterThan(heroIndex);
        expect(paletteIndex).toBeGreaterThan(themeIndex);
    });

    test('applies the configured wide-card image width without overriding stacked cards', () => {
        const css = readFileSync(
            resolve(CURRENT_DIR, '../table_views/card_view/cards.css'),
            'utf8'
        );
        const wideImageRule = css.match(
            /\.card_content_large \.card_image_content\s*\{([\s\S]*?)\n\}/,
        )?.[1] || '';
        const responsiveRule = css.match(
            /@container card-list \(max-width: 1060px\)\s*\{([\s\S]*?)\n\}/,
        )?.[1] || '';

        expect(wideImageRule).toContain('width: var(--card_image_large_width)');
        expect(responsiveRule).toContain('width: 100%');
    });

});
