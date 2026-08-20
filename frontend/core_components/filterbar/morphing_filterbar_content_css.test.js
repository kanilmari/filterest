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
        const css = readFileSync(resolve(CURRENT_DIR, 'morphing_filterbar_content.css'), 'utf8');
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

        expect(defaultsRule).toContain('--dataset-cover-mask-oval-x: 68%');
        expect(defaultsRule).toContain('--dataset-cover-mask-oval-y: 82%');
        expect(defaultsRule).toContain('--dataset-cover-mask-position-y: 48%');
        expect(defaultsRule).toContain('--dataset-cover-mask-center-opacity: 20%');
        expect(defaultsRule).toContain('--dataset-cover-mask-mid-opacity: 45%');
        expect(defaultsRule).toContain('--dataset-cover-mask-edge-opacity: 70%');
        expect(defaultsRule).toContain('--dataset-cover-mask-center-stop: 30%');
        expect(defaultsRule).toContain('--dataset-cover-mask-mid-stop: 58%');
        expect(defaultsRule).toContain('--dataset-cover-mask-edge-stop: 100%');
        expect(defaultsRule).toContain('--dataset-cover-hero-extra-height: 40px');
        expect(defaultsRule).toContain(
            'padding-bottom: calc(18px + var(--dataset-cover-hero-extra-height))'
        );
        expect(defaultsRule).toContain('--dataset-cover-overlay-opacity: 0');
        expect(coverRule).toContain('mask-image: var(--dataset-cover-mask-image, radial-gradient(');
        expect(coverRule).toContain(
            'ellipse var(--dataset-cover-mask-oval-x) var(--dataset-cover-mask-oval-y) at 50% var(--dataset-cover-mask-position-y)'
        );
        expect(coverRule).toContain('opacity: var(--dataset-cover-image-opacity)');
        expect(coverRule).toContain('filter: blur(var(--dataset-cover-image-blur))');
        expect(darkRule).toContain('--dataset-cover-mask-image: none');
        expect(darkRule).toContain('--dataset-cover-image-opacity: 0.3');
        expect(lightRule).toContain('--dataset-cover-mask-image: initial');
        expect(lightRule).toContain('--dataset-cover-image-opacity: 1');
        expect(overlayRule).toContain('background: #000');
        expect(overlayRule).toContain('opacity: var(--dataset-cover-overlay-opacity)');
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
        expect(paletteRule).toContain('max-height: min(520px, calc(100dvh - 48px), calc(100% - 24px))');
        expect(paletteRule).toContain('overflow: auto');
        expect(paletteRule).toContain('resize: both');
    });

    test('loads the palette immediately after the canonical hero styles', () => {
        const imports = readFileSync(
            resolve(CURRENT_DIR, '../../styles/imports.css'),
            'utf8'
        );
        const heroIndex = imports.indexOf('morphing_filterbar_content.css');
        const paletteIndex = imports.indexOf('dataset_cover_test_palette.css');

        expect(heroIndex).toBeGreaterThan(-1);
        expect(paletteIndex).toBeGreaterThan(heroIndex);
    });
});
