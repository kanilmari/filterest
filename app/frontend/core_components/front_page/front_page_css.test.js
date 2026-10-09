// front_page_css.test.js
// Guards Home's responsive surfaces, sized backgrounds and long accessible labels.
// Reads the shipped styles because jsdom cannot lay out a phone viewport or ellipsis.
// Complements DOM tests; native light/dark browser proofs remain the integration check.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(currentDirectory, 'front_page.css'), 'utf8');
const navbar = readFileSync(resolve(currentDirectory, '../navigation/navbar/navbar_layout.css'), 'utf8');

test('Home uses the reserved grid area and a phone-sized single column', () => {
    expect(navbar).toMatch(/#navbar > #navbarFrontPage\s*\{\s*grid-area: front-page;/);
    expect(css).toMatch(/@media \(width <= 600px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(css).toContain('min-height: 44px;');
    // The shared paragraph rule sets display, which otherwise overrides HTML hidden.
    expect(css).toMatch(/\.front-page-blocks \.supplemental-dataset-group p\[hidden\]\s*\{\s*display: none;/);
});

test('visual truncation preserves full DOM text and keyboard focus styling', () => {
    expect(css).toMatch(/\.navbar-front-page-label\s*\{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
    expect(css).toMatch(/\.navbar-front-page-link:focus-visible\s*\{[^}]*2px solid var\(--primary_color\)/);
});

test('text has theme surfaces and background sizing follows width, never OS theme', () => {
    expect(css).toContain('background: var(--bg_color_2);');
    expect(css).toContain('filter: blur(var(--dataset-background-image-blur, 0));');
    expect(css).toContain('opacity: var(--home-media-opacity);');
    expect(css).toContain('body.dark-mode .front-page');
    expect(css).toContain('--home-wash-colour: var(--bg_color);');
    expect(css).toContain('background-image: var(--front-page-background-2160);');
    expect(css).toMatch(/@media \(width < 1000px\)[\s\S]*--front-page-background-1000/);
    expect(css).not.toMatch(/prefers-color-scheme|background-attachment:\s*fixed/);
});


test('only Home content scrolls, with a fixed sibling background and no structural top-row line', () => {
    const scroller = css.match(/\.front-page-scroller\s*\{([^}]+)\}/)?.[1];
    const row = css.match(/\.front-page-top-row\s*\{([^}]+)\}/)?.[1];
    expect(scroller).toContain('overflow: hidden auto');
    expect(scroller).toContain('display: block');
    expect(scroller).toContain('padding: 0');
    expect(scroller).toContain('min-height: 0');
    expect(row).toContain('flex: 0 0 auto');
    expect(row).toContain('border-bottom: 0');
    expect(row).toContain('box-shadow: none');
    expect(css).toMatch(/\.front-page-background\s*\{[^}]*position: absolute;[^}]*inset:/);
    expect(css).toMatch(/\.front-page-background video\s*\{[^}]*object-fit: cover;/);
    expect(css).toContain('image-rendering: auto');
    expect(css).not.toContain('padding-top: calc(12px + 44px');
});

test('Home keeps the 12px corner inset that the shared hero row class would cancel', () => {
    expect(css).toMatch(/\.front-page > \.front-page-top-row\s*\{[^}]*margin-inline: 0;/);
    expect(css.match(/\.front-page-top-row\s*\{([^}]+)\}/)?.[1]).toContain('padding: 12px');
});

test('the slogan shows the line breaks typed in its multi-line settings fields', () => {
    expect(css).toMatch(/\.front-page-hero \.home-text-paragraph\s*\{\s*white-space: pre-line;/);
});

// The palette button takes the shared hero action shape, so it matches the gear as on dataset pages.
test('Home gives its palette button no shape of its own', () => {
    expect(css).not.toContain('home-palette-button');
});

test('positioned Home uses expanding flow, safe insets, theme copy and phone gutters', () => {
    expect(css).toContain('container-type: size');
    expect(css).toContain('min-height: 100cqh');
    expect(css).toContain('padding-inline: min(var(--home-text-horizontal-margin)');
    expect(css).toContain('.front-page-hero .home-text-paragraph { white-space: pre-line; margin-block: 0 1em; }');
    const phoneStage = css.match(/@media \(width <= 600px\)\s*\{\s*\.front-page-text-stage\[data-anchor\]\s*\{([^}]*)\}/);
    expect(phoneStage?.[1]).toMatch(/padding: 16px;[^}]*justify-items: stretch;/);
    // Phones keep the saved vertical anchor (K285: the default block is centred both ways); only long text starts at the top.
    expect(phoneStage?.[1]).not.toContain('align-items');
    // On phones the block fills the line between the gutters, so alignment is visible even for short text.
    expect(css).toMatch(/@media \(width <= 600px\)[^@]*\.front-page-text-stage \.front-page-hero \{ width: auto; max-width: none; \}/);
});


test('alignment leaves intrinsic sizing intact, justify starts title and last lines at the left', () => {
    expect(css).toContain('width: max-content;');
    expect(css).toContain('max-width: min(var(--home-text-max-width), 100%);');
    // Without a fixed column a long text's max-content width widens the grid and pushes right/centre anchors off the page.
    expect(css).toMatch(/\.front-page-text-stage \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toContain('text-align: justify; text-align-last: left;');
    expect(css).toContain('.front-page-hero[data-alignment="justify"] .morphing-title { text-align: left; }');
    expect(css).toContain('font-size: 1.25rem'); expect(css).toContain('font-size: 1rem');
    expect(css).not.toMatch(/column-count|column-width/);
});


test('larger slogan outranks the later shared subtitle rule, and alignment masks paint in theme text colour', () => {
    expect(css).toMatch(/\.front-page-hero \.front-page-slogan\.morphing-subtitle\s*\{[^}]*font-size: 1.25rem;/);
    const palette = readFileSync(resolve(currentDirectory, '../admin_tools/presentation_palette.css'), 'utf8');
    expect(palette).toMatch(/\.home-palette-alignment-icon\s*\{[^}]*background-color: currentColor;/);
});
