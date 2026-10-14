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
    expect(css).toMatch(/@media \(width <= 700px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
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

const sharedHero = readFileSync(resolve(currentDirectory, '../filterbar/morphing_filterbar_content.css'), 'utf8');
test.each([
    ['Home before shared hero', `${css}\n${sharedHero}`],
    ['shared hero before Home', `${sharedHero}\n${css}`],
])('Home centres unequal-height controls regardless of import order: %s', (_order, styles) => {
    // Exercise the cascade, not jsdom geometry: the shared dataset header is
    // top-aligned, but Home must centre its 36px tabs beside taller pills.
    const style = document.createElement('style');
    style.textContent = styles;
    const fixture = document.createElement('div');
    fixture.innerHTML = '<div class="front-page"><div class="front-page-top-row filterbar-inline-hero__top-row">'
        + '<nav class="hero-dataset-tabs"><button>Matkatarjoukset</button></nav></div></div>'
        + '<div class="filterbar-inline-hero__top-row"></div>';
    document.head.append(style);
    document.body.append(fixture);
    const originalBodyClass = document.body.className;
    try {
        const homeRow = fixture.querySelector('.front-page-top-row');
        const datasetRow = fixture.lastElementChild;
        for (const theme of ['light', 'dark']) {
            document.body.className = `${theme}-mode`;
            expect(window.getComputedStyle(homeRow).alignItems).toBe('center');
            const articles = document.createElement('div');
            articles.className = 'front-page-article-buttons';
            articles.innerHTML = '<a class="front-page-article-button">Yhteystiedot</a>';
            homeRow.append(articles);
            expect(window.getComputedStyle(homeRow).alignItems).toBe('center');
            expect(window.getComputedStyle(datasetRow).alignItems).toBe('start');
            articles.remove();
        }
    } finally {
        document.body.className = originalBodyClass;
        fixture.remove();
        style.remove();
    }
});

test('Home reserves identity width and a fixed 10px menu gap before tabs and actions', () => {
    expect(css).toMatch(/\.front-page > \.front-page-top-row\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap;/);
    expect(css).toMatch(/\.front-page-top-row__identity\s*\{[^}]*gap: 10px;[^}]*flex: 0 0 auto;[^}]*max-width: 100%;/);
    expect(css).toMatch(/\.front-page-top-row \.dataset-shared-topbar__menu-slot--visible\s*\{[^}]*flex: 0 0 44px;[^}]*transition: none;/);
    expect(css).toMatch(/\.front-page-top-row \.front-page-site-name\s*\{[^}]*display: block;[^}]*padding: 0;/);
    expect(css).toContain('.front-page-top-row .front-page-site-name { font-size: 1.125rem; }');
    expect(css).toContain('font-size: clamp(1.125rem, 4cqw, 2.15rem)');
});

test('Home phone tabs stack inside 16px gutters and the menu cannot squeeze the identity', () => {
    const tabs = css.match(/\.front-page > \.front-page-top-row > \.hero-dataset-tabs\s*\{([^}]+)\}/)?.[1];
    expect(tabs).toContain('display: flex'); expect(tabs).toContain('flex-direction: column');
    expect(tabs).toContain('grid-row: 2'); expect(tabs).toContain('width: calc(100% - 8px)');
    expect(tabs).toContain('max-width: 480px'); expect(tabs).toContain('overflow: visible');
    expect(css).toMatch(/\.front-page-top-row \.hero-dataset-tabs__button\s*\{[^}]*width: 100%;[^}]*min-height: 44px;[^}]*white-space: normal;/);
    expect(css).toMatch(/#tabs_container:has\(\.front-page:not\(\.hidden\) > \.front-page-top-row\)\s*\{[^}]*width: 100%;[^}]*transform: translateX\(0\);/);
    expect(css).toContain('height: calc(100vh - var(--home-top-row-height, 68px))');
    expect(css).toContain('8cqw');
});

test('Home keeps the measured header offset only on tablets and narrow desktops', () => {
    const overlay = css.match(/@media screen and \(700px < width <= 1850px\)\s*\{([^@]+)/)?.[1];
    expect(overlay).toMatch(/\.body_content:has\(\.front-page:not\(\.hidden\) > \.front-page-top-row\) #navbar\s*\{[^}]*top: var\(--home-top-row-height, 68px\);[^}]*height: calc\(100vh - var\(--home-top-row-height, 68px\)\);/);
    const shell = readFileSync(resolve(currentDirectory, '../../styles/mobile_friendliness.css'), 'utf8');
    expect(shell).toMatch(/@media screen and \(width <= 1850px\)/);
});

test('phone Home anchors its scrollable drawer to the viewport, independently of header length', () => {
    const phone = css.match(/@media \(width <= 700px\)\s*\{([^@]+)/)?.[1];
    const drawer = phone?.match(/\.body_content:has\(\.front-page:not\(\.hidden\) > \.front-page-top-row\) #navbar\s*\{([^}]+)\}/)?.[1];
    expect(drawer).toContain('top: 0;');
    expect(drawer).toContain('height: 100vh;');
    expect(drawer).toContain('height: 100dvh;');
    expect(drawer).toContain('overscroll-behavior-y: contain;');
    expect(drawer).not.toContain('--home-top-row-height');
    expect(navbar).toMatch(/#navbar\s*\{[^}]*position: fixed;[^}]*overflow: hidden auto;/);
    expect(navbar).toMatch(/\.top-button-bar\s*\{[^}]*position: sticky;[^}]*top: 0;/);
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
    expect(css).toContain('.front-page-hero .home-text-paragraph { white-space: pre-line; margin-block: 0 var(--home-paragraph-gap, 1em); }');
    const phoneStage = css.match(/@media \(width <= 700px\)\s*\{\s*\.front-page-text-stage\[data-anchor\]\s*\{([^}]*)\}/);
    expect(phoneStage?.[1]).toMatch(/padding: 16px;[^}]*justify-items: stretch;/);
    // Phones keep the saved vertical anchor (K285: the default block is centred both ways); only long text starts at the top.
    expect(phoneStage?.[1]).not.toContain('align-items');
    // On phones the block fills the line between the gutters, so alignment is visible even for short text.
    expect(css).toMatch(/@media \(width <= 700px\)[^@]*\.front-page-text-stage \.front-page-hero \{ width: auto; max-width: none; \}/);
});


test('alignment leaves intrinsic sizing intact, justify starts title and last lines at the left', () => {
    expect(css).toContain('width: max-content;');
    expect(css).toContain('max-width: min(var(--home-text-max-width), 100%);');
    // Without a fixed column a long text's max-content width widens the grid and pushes right/centre anchors off the page.
    expect(css).toMatch(/\.front-page-text-stage \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toContain('text-align: justify; text-align-last: left;');
    expect(css).toContain('.front-page-hero[data-alignment="justify"] .morphing-title { text-align: left; }');
    expect(css).toContain('font-size: var(--home-slogan-size, 1.25rem)');
    expect(css).toContain('font-size: var(--home-description-size, 1rem)');
    expect(css).not.toMatch(/column-count|column-width/);
});


test('larger slogan outranks the later shared subtitle rule, and alignment masks paint in theme text colour', () => {
    expect(css).toMatch(/\.front-page-hero \.front-page-slogan\.morphing-subtitle\s*\{[^}]*font-size: var\(--home-slogan-size, 1\.25rem\);/);
    const palette = readFileSync(resolve(currentDirectory, '../admin_tools/presentation_palette.css'), 'utf8');
    expect(palette).toMatch(/\.home-palette-alignment-icon\s*\{[^}]*background-color: currentColor;/);
});
