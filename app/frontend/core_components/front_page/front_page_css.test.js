// front_page_css.test.js
// Guards Home's responsive surfaces, sized backgrounds and long accessible labels.
// Reads the shipped styles because jsdom cannot lay out a phone viewport or ellipsis.
// Complements DOM tests; native light/dark browser proofs remain the integration check.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { requireNodeDependency } from '../../../server_tools/lib/node_dependency_loader.mjs';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(currentDirectory, 'front_page.css'), 'utf8');
const navbar = readFileSync(resolve(currentDirectory, '../navigation/navbar/navbar_layout.css'), 'utf8');
const postcss = requireNodeDependency('postcss');

test('Home boxes keep one 800px column with auto margins as the default', () => {
    const root = postcss.parse(css);
    const columns = [];
    root.walkRules(rule => {
        if (!rule.selector.includes('.front-page-blocks')) return;
        rule.walkDecls('grid-template-columns', declaration => columns.push(declaration.value));
        rule.walkDecls('max-width', declaration => {
            if (rule.selector.endsWith('.front-page-blocks')) expect(declaration.value).toBe('800px');
        });
    });
    expect(columns).toEqual(['minmax(0, 1fr)']);
    expect(css).toMatch(/\.front-page-blocks\s*\{[^}]*box-sizing: border-box;[^}]*width: 100%;[^}]*max-width: 800px;[^}]*margin-inline: auto;/);
});

test('only side-anchored boxes above 700px follow the unchanged text inset less their 1rem gutter', () => {
    const root = postcss.parse(css);
    const stage = root.nodes.find(node => node.selector === '.front-page-text-stage');
    const inset = stage.nodes.find(node => node.prop === 'padding-inline').value;
    expect(inset).toBe('min(var(--home-text-horizontal-margin), 8cqw, max(0px, calc((100cqw - var(--home-text-min-width)) / 2)))');
    const margins = [];
    root.walkRules(rule => {
        if (!rule.selector.endsWith('.front-page-blocks')) return;
        rule.walkDecls('margin-inline', declaration => {
            margins.push(rule.selector);
            if (rule.selector === '.front-page-blocks') {
                expect(declaration.value).toBe('auto');
                expect(rule.parent.type).toBe('root');
                return;
            }
            if (rule.selector === '.front-page-content--positioned > .front-page-text-stage[data-anchor] ~ .front-page-blocks') {
                expect(rule.parent.name).toBe('media');
                expect(rule.parent.params).toBe('(width <= 700px)');
                expect(declaration.value).toBe('auto');
                expect(rule.nodes.find(node => node.prop === 'width').value).toBe('100%');
                return;
            }
            expect(rule.parent.type).toBe('root');
            const side = rule.selector.includes('[data-anchor$="left"]') ? 'left' : 'right';
            expect(rule.selector).toBe(`.front-page-content--positioned > .front-page-text-stage[data-anchor$="${side}"] ~ .front-page-blocks`);
            expect(declaration.value).toBe(side === 'left' ? `calc(${inset} - 1rem) auto` : `auto calc(${inset} - 1rem)`);
            // Auto width reserves the fixed margin at 701px instead of overflowing a 100% wrapper.
            expect(rule.nodes.find(node => node.prop === 'width').value).toBe('auto');
        });
    });
    expect(margins).toHaveLength(4);
});

test('only Show all gets the 44px link target; the existing title stretches over the row', () => {
    const root = postcss.parse(css);
    root.walkRules(rule => {
        if (!rule.selector.includes('.front-page-blocks')) return;
        expect(rule.selectors).not.toContain('.front-page-blocks a');
        rule.walkDecls('min-height', declaration => {
            expect(rule.selectors).toContain('.front-page-blocks .supplemental-dataset-show-all');
            expect(declaration.value).toBe('44px');
        });
    });
    expect(css).toMatch(/\.front-page-blocks \.supplemental-dataset-show-all,[^{]*\{[^}]*display: flex;[^}]*min-height: 44px;/);
    expect(css).toMatch(/\.front-page-blocks \.supplemental-dataset-result\s*\{\s*position: relative;/);
    expect(css).toMatch(/\.front-page-blocks \.supplemental-dataset-result-text > a::after\s*\{[^}]*content: "";[^}]*position: absolute;[^}]*inset: 0;/);
    expect(css).toMatch(/\.front-page-blocks \.supplemental-dataset-result-text > a:focus-visible::after\s*\{[^}]*outline: 2px solid var\(--primary_color\);/);
    // The production import order exposed the broad anchor rule overriding the title clamp.
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve(currentDirectory, '../filterbar/text_search/supplemental_dataset_results.css'), 'utf8') + css;
    const fixture = document.createElement('div');
    fixture.className = 'front-page-blocks';
    fixture.innerHTML = '<section class="supplemental-dataset-group"><li class="supplemental-dataset-result">'
        + '<div class="supplemental-dataset-result-text"><a href="/news/1">Pitkä otsikko</a><p>Kuvaus</p></div>'
        + '</li><a class="supplemental-dataset-show-all" href="/news">Näytä kaikki</a></section>';
    document.head.append(style); document.body.append(fixture);
    try {
        const title = getComputedStyle(fixture.querySelector('li a'));
        expect(title.display).toBe('-webkit-box');
        expect(title.getPropertyValue('-webkit-line-clamp')).toBe('1');
        expect(title.minHeight).not.toBe('44px');
        expect(getComputedStyle(fixture.querySelector('p')).getPropertyValue('-webkit-line-clamp')).toBe('2');
        expect(getComputedStyle(fixture.querySelector('.supplemental-dataset-show-all')).minHeight).toBe('44px');
    } finally { fixture.remove(); style.remove(); }
});

test('sticky Home bar, drawer lock and measured offsets are confined to the phone breakpoint', () => {
    const root = requireNodeDependency('postcss').parse(css);
    const phone = {};
    root.walkRules(rule => {
        if (/front-page-phone-topbar|front-page-scroller--drawer-open/.test(rule.selector)
            || rule.nodes.some(node => /--home-phone-bar-size|100dvh/.test(node.value || ''))) {
            let ancestor = rule.parent;
            while (ancestor && !(ancestor.type === 'atrule' && ancestor.name === 'media')) ancestor = ancestor.parent;
            expect(ancestor?.params).toBe('(width <= 700px)');
            phone[rule.selector] ||= {};
            rule.walkDecls(decl => { phone[rule.selector][decl.prop] = decl.value; });
        }
    });
    expect(phone['.front-page-phone-topbar']).toMatchObject({ position: 'sticky', top: '0', 'z-index': '1',
        display: 'grid', 'grid-template-columns': '44px minmax(0, 1fr) 44px',
        padding: '12px', 'padding-top': 'calc(12px + env(safe-area-inset-top))',
        'border-bottom': '1px solid var(--border_color)' });
    expect(css).toContain('background: color-mix(in srgb, var(--bg_color) 92%, transparent)');
    expect(css).toContain('@supports not (backdrop-filter: blur(1px))');
    expect(phone['.front-page-phone-topbar'].background).toBe('var(--bg_color)');
    expect(phone['.front-page-phone-topbar > .dataset-shared-topbar__menu-slot']['grid-column']).toBe('1');
    expect(phone['.front-page-phone-topbar > .front-page-top-row__identity']['grid-column']).toBe('2');
    expect(phone['.front-page-phone-topbar__end']).toMatchObject({ 'grid-column': '3', width: '44px' });
    expect(phone['.front-page-phone-topbar #showMenuButton']).toMatchObject({ position: 'relative', inset: 'auto' });
    expect(phone['.front-page-phone-topbar .front-page-site-name']).toMatchObject({ display: 'block', padding: '0',
        'font-size': '1.125rem', 'font-weight': 'bold', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' });
    expect(phone['.front-page .front-page-scroller--drawer-open']['overflow-y']).toBe('hidden');
    // The scrolled content clears the bar with its own margin; the scroller has no scroll padding, which would make
    // focusing the sticky menu button scroll Home to the top (b513 G11:437).
    const clearing = Object.entries(phone).find(([selector, decls]) =>
        selector.includes('.front-page-scroller > :not(.front-page-phone-topbar)') && decls['scroll-margin-top']);
    expect(clearing?.[1]['scroll-margin-top']).toBe('calc(var(--home-phone-bar-size, 0px) + 8px)');
    let scrollPadding = 0;
    root.walkDecls(/^scroll-padding/, () => { scrollPadding += 1; });
    expect(scrollPadding).toBe(0);
    expect(Object.keys(phone).filter(selector => /front-page-phone-topbar/.test(selector)
        && !/:not\(\.front-page-phone-topbar\)/.test(selector)
        && phone[selector]['scroll-margin-top'])).toEqual([]);
    expect(phone['.front-page-text-stage[data-anchor]']['min-height']).toBe('calc(100cqh - var(--home-phone-bar-size, 0px))');
    expect(phone['.front-page'].height).toBe('100dvh');
});

test('phone navigation, Contact and actions occupy separate rows regardless of shared stylesheet import order', () => {
    const postcss = requireNodeDependency('postcss');
    const articles = readFileSync(resolve(currentDirectory, 'front_page_article_buttons.css'), 'utf8');
    const hero = readFileSync(resolve(currentDirectory, '../filterbar/morphing_filterbar_content.css'), 'utf8');
    function activeRules(source, width) {
        return postcss.parse(source).nodes.flatMap(node => {
            if (node.type === 'rule') return node.toString();
            if (width <= 700 && node.type === 'atrule' && node.name === 'media' && node.params === '(width <= 700px)') {
                return node.nodes.filter(child => child.type === 'rule').map(child => child.toString());
            }
            return [];
        }).join('\n');
    }
    // jsdom does not evaluate viewport media queries; apply the shipped phone block
    // explicitly at 390/700px, and exclude it at 701px and desktop widths.
    const alignmentCases = [
        ['start', 'inherit', 'start', '0 auto'], ['center', 'inherit', 'center', 'auto'],
        ['end', 'inherit', 'end', 'auto 0'], ['justify', 'inherit', 'start', '0 auto'],
        ['end', 'start', 'start', '0 auto'], ['end', 'center', 'center', 'auto'],
    ];
    const style = document.createElement('style');
    const fixture = document.createElement('div');
    fixture.innerHTML = '<div class="front-page"><div class="front-page-scroller"><div class="front-page-top-row filterbar-inline-hero__top-row">'
        + '<nav class="hero-dataset-tabs"></nav><div class="front-page-article-buttons"><a class="front-page-article-button">Ota yhteyttä</a></div>'
        + '<div class="filterbar-inline-hero__actions"><button>Settings</button></div></div>'
        + '<header class="front-page-hero"><div class="front-page-article-buttons"><a class="front-page-article-button">Ota yhteyttä</a></div></header></div></div>';
    document.head.append(style); document.body.append(fixture);
    try {
        for (const order of [[css, articles, hero], [hero, articles, css], [articles, css, hero]]) {
            for (const width of [390, 700, 701, 1440]) {
                const phone = width <= 700;
                style.textContent = order.map(source => activeRules(source, width)).join('\n');
                for (const [alignment, phoneAlignment, effective, marginInline] of alignmentCases) {
                    for (const list of fixture.querySelectorAll('.front-page-article-buttons')) {
                        delete list.dataset.alignment; delete list.dataset.phoneAlignment;
                        const desktop = getComputedStyle(list);
                        const desktopAlignment = { justifyContent: desktop.justifyContent,
                            marginInline: desktop.getPropertyValue('margin-inline'), marginInlineStart: desktop.marginInlineStart };
                        list.dataset.alignment = alignment; list.dataset.phoneAlignment = phoneAlignment;
                        const group = getComputedStyle(list), link = getComputedStyle(list.firstElementChild);
                        if (phone) {
                            expect(group.getPropertyValue('margin-inline')).toBe(marginInline);
                            expect(group.justifyContent).toBe(effective);
                            expect(group.width).toBe('fit-content'); expect(group.maxWidth).toBe('100%');
                            expect(link.width).toBe('fit-content'); expect(link.minWidth).toBe('44px');
                            expect(link.minHeight).toBe('54px'); expect(link.paddingInline).toBe('27px'); expect(link.paddingBlock).toBe('0px');
                            expect(link.whiteSpace).toBe('normal'); expect(link.overflowWrap).toBe('anywhere');
                        } else {
                            expect(link.minHeight).toBe('44px');
                            expect(link.padding).toBe(list.closest('header') ? '10px 16px' : '10px 28px');
                            expect(group.width).not.toBe('fit-content');
                            expect({ justifyContent: group.justifyContent, marginInline: group.getPropertyValue('margin-inline'),
                                marginInlineStart: group.marginInlineStart }).toEqual(desktopAlignment);
                        }
                    }
                }
                if (phone) {
                    expect(getComputedStyle(fixture.querySelector('nav')).gridRow).toBe('1');
                    expect(getComputedStyle(fixture.querySelector('.front-page-article-buttons')).gridRow).toBe('2');
                    expect(getComputedStyle(fixture.querySelector('.filterbar-inline-hero__actions')).gridRow).toBe('3');
                }
            }
        }
    } finally { style.remove(); fixture.remove(); }
});

test('article-button sizing and logical alignment overrides belong only to the 700px phone block', () => {
    const articles = postcss.parse(readFileSync(resolve(currentDirectory, 'front_page_article_buttons.css'), 'utf8'));
    articles.walkRules(rule => {
        if (!rule.selector.includes('[data-phone-alignment]') && !rule.selector.includes('[data-phone-alignment="')
            && !rule.nodes.some(node => node.prop === 'width' && node.value === 'fit-content')) return;
        expect(rule.parent.type).toBe('atrule'); expect(rule.parent.params).toBe('(width <= 700px)');
        rule.walkDecls(decl => expect(decl.prop).not.toMatch(/^(?:margin|padding)-(?:left|right)$/));
    });
});

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


test('only Home content scrolls, with a fixed sibling background and no structural top-row border', () => {
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

test('Home alone paints its 2px inset edge in both themes without changing row layout', () => {
    const root = postcss.parse(css);
    const edge = root.nodes.find(rule => rule.selector === '.front-page > .front-page-top-row');
    const declarations = Object.fromEntries(edge.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
    expect(declarations['box-shadow']).toBe('inset 0 -2px 0 var(--border_color)');
    for (const property of ['border-bottom', 'height', 'box-sizing', 'min-height']) expect(declarations).not.toHaveProperty(property);
    const style = document.createElement('style');
    style.textContent = css;
    const fixture = document.createElement('div');
    fixture.innerHTML = '<div class="front-page"><div class="front-page-top-row"></div></div>'
        + '<div class="filterbar-inline-hero__top-row"></div>';
    document.head.append(style); document.body.append(fixture);
    const original = document.body.className;
    try {
        for (const theme of ['light', 'dark']) {
            document.body.className = `${theme}-mode`;
            const row = getComputedStyle(fixture.querySelector('.front-page-top-row'));
            expect(row.boxShadow).toBe('inset 0 -2px 0 var(--border_color)');
            expect(row.padding).toBe('12px');
            expect(row.borderBottomWidth).toBe('0px');
            expect(getComputedStyle(fixture.lastElementChild).boxShadow).not.toContain('inset');
        }
    } finally { document.body.className = original; fixture.remove(); style.remove(); }
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
    expect(css).toMatch(/\.front-page-phone-topbar \.front-page-site-name\s*\{[^}]*font-size: 1.125rem;/);
    expect(css).toContain('font-size: clamp(1.125rem, 4cqw, 2.15rem)');
});

test('Home phone tabs stack inside 16px gutters and the menu cannot squeeze the identity', () => {
    const tabs = css.match(/\.front-page \.front-page-scroller > \.front-page-top-row > \.hero-dataset-tabs\s*\{([^}]+)\}/)?.[1];
    expect(tabs).toContain('display: flex'); expect(tabs).toContain('flex-direction: column');
    expect(tabs).toContain('grid-row: 1'); expect(tabs).toContain('width: calc(100% - 8px)');
    expect(tabs).toContain('max-width: 480px'); expect(tabs).toContain('overflow: visible');
    expect(css).toMatch(/\.front-page-top-row \.hero-dataset-tabs__button\s*\{[^}]*width: 100%;[^}]*min-height: 44px;[^}]*white-space: normal;/);
    expect(css).toMatch(/#tabs_container:has\(\.front-page:not\(\.hidden\) > \.front-page-scroller > \.front-page-phone-topbar\)\s*\{[^}]*width: 100%;[^}]*transform: translateX\(0\);/);
    expect(css).toContain('8cqw');
});

test('Home inherits the full-height dataset drawer at every width and keeps narrow content overlaid', () => {
    expect(css).not.toContain('--home-top-row-height');
    expect(css).not.toMatch(/#navbar\s*\{[^}]*\b(?:top|height):/);
    expect(navbar).toMatch(/#navbar\s*\{[^}]*height: 100vh;/);
    const shell = readFileSync(resolve(currentDirectory, '../../styles/mobile_friendliness.css'), 'utf8');
    expect(shell).toMatch(/@media screen and \(width <= 1850px\)[\s\S]*#tabs_container\s*\{[^}]*transform: unset !important;[^}]*width: unset !important;/);
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


test('alignment leaves intrinsic sizing intact, justify starts title and last lines at the logical start', () => {
    expect(css).toContain('width: max-content;');
    expect(css).toContain('max-width: min(var(--home-text-max-width), 100%);');
    // Without a fixed column a long text's max-content width widens the grid and pushes right/centre anchors off the page.
    expect(css).toMatch(/\.front-page-text-stage \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toMatch(/text-align: justify;\s*text-align-last: start;/);
    expect(css).toContain('.front-page-hero[data-alignment="justify"] .morphing-title { text-align: start; }');
    expect(css).toContain('font-size: var(--home-slogan-size, 1.25rem)');
    expect(css).toContain('font-size: var(--home-description-size, 1rem)');
    expect(css).not.toMatch(/column-count|column-width/);
});

test('logical hero alignment and phone overrides leave anchors and navigation with their existing owners', () => {
    for (const alignment of ['start', 'center', 'end', 'justify']) {
        expect(css).toMatch(new RegExp(`\\[data-alignment="${alignment}"\\] \\{\\s*text-align: ${alignment};`));
    }
    const override = css.split('/* Overrides affect hero copy only;')[1].split('.front-page-content--positioned >')[0];
    expect(override).toContain('@media (width <= 700px)');
    for (const alignment of ['start', 'center']) {
        expect(override).toMatch(new RegExp(`\\[data-phone-alignment="${alignment}"\\] \\.morphing-title \\{\\s*text-align: ${alignment};\\s*text-align-last: auto;`));
    }
    expect(css).not.toContain('[data-phone-alignment="inherit"]');
    expect(override).not.toMatch(/justify-items|top-row|topbar|nav/);
});


test('larger slogan outranks the later shared subtitle rule, and alignment masks paint in theme text colour', () => {
    expect(css).toMatch(/\.front-page-hero \.front-page-slogan\.morphing-subtitle\s*\{[^}]*font-size: var\(--home-slogan-size, 1\.25rem\);/);
    const palette = readFileSync(resolve(currentDirectory, '../admin_tools/presentation_palette.css'), 'utf8');
    expect(palette).toMatch(/\.home-palette-alignment-icon\s*\{[^}]*background-color: currentColor;/);
});
