// @vitest-environment jsdom
// shared_topbar_css.test.js
// Verifies stylesheet contracts and immediate menu hiding during animated exits.
// Connects live ownership attributes with the actual shared-topbar stylesheet.
// Keeps non-owner buttons hidden even while their ancestors remain visible.

import { afterEach, describe, expect, test } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { requireNodeDependency } from '../../../server_tools/lib/node_dependency_loader.mjs';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const postcss = requireNodeDependency('postcss');
let style;

afterEach(() => {
    style?.remove();
    document.body.replaceChildren();
    document.body.className = '';
});

function readSharedTopbarCss() {
    return readFileSync(resolve(CURRENT_DIR, 'shared_topbar.css'), 'utf8');
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

// JSDOM does not evaluate range media queries. Select their branches with
// PostCSS, then let its CSS engine resolve selectors in the real import order.
function endCellStylesAtWidth(width) {
    const imports = readFileSync(resolve(CURRENT_DIR, '../../styles/imports.css'), 'utf8');
    const files = [...imports.matchAll(/@import url\("[^"\n]*\/(shared_topbar|dataset_corner_controls)\.css"\)/g)]
        .map(([, name]) => `${name}.css`);
    expect(files).toEqual(['shared_topbar.css', 'dataset_corner_controls.css']);
    return files.map(file => {
        const root = postcss.parse(readFileSync(resolve(CURRENT_DIR, file), 'utf8'));
        root.walkAtRules('media', media => {
            const maxWidth = /^\(width <= (\d+)px\)$/.exec(media.params);
            if (maxWidth && width <= Number(maxWidth[1])) media.replaceWith(...media.nodes);
            else media.remove();
        });
        return root.toString();
    }).join('\n');
}

test.each([390, 700, 701, 1200])('end cells resolve both stylesheets in shell order at %ipx', width => {
    style = document.createElement('style');
    style.textContent = endCellStylesAtWidth(width);
    document.head.append(style);
    document.body.innerHTML = `<div class="dataset-shared-topbar dataset-shared-topbar--visible">
        <div class="dataset-shared-topbar__inner">
            <div class="dataset-shared-topbar__slot dataset-shared-topbar__slot--end dataset-corner-controls-topbar-end">
                <button class="dataset-shared-topbar__search-toggle"></button>
                <button class="filterbar-fixed-toggle filterbar-fixed-toggle--hosted"></button>
            </div>
        </div></div>`;
    const bar = document.body.firstElementChild;
    const end = bar.querySelector('.dataset-shared-topbar__slot--end');
    const phone = width <= 700;
    for (const theme of ['light', 'dark']) {
        document.body.className = `${theme}-mode`;
        for (const open of [false, true]) {
            bar.dataset.topbarSearchMode = phone ? 'phone' : 'field';
            bar.dataset.topbarSearchOpen = String(open);
            expect(getComputedStyle(end).gap).toBe(phone ? '0px' : '8px');
            expect(getComputedStyle(end.lastElementChild).right).toBe(phone
                ? 'auto' : 'calc(12px - var(--dataset-shared-topbar-padding-inline, 12px))');
            if (phone) {
                expect(getComputedStyle(bar.firstElementChild).gridTemplateColumns).toBe('52px minmax(0, 1fr) 96px');
                expect(getComputedStyle(end.firstElementChild).width).toBe('44px');
                expect(getComputedStyle(end.lastElementChild).width).toBe('52px');
                expect(getComputedStyle(end.lastElementChild).flexBasis).toBe('52px');
            }
        }
    }
});

describe('shared topbar CSS', () => {
    test.each(['light', 'dark'])('%s keeps button search in the title row and restores the title', theme => {
        style = document.createElement('style');
        style.textContent = readSharedTopbarCss(); document.head.append(style);
        document.body.className = `${theme}-mode`;
        document.body.innerHTML = `<div class="dataset-shared-topbar dataset-shared-topbar--visible">
            <div class="dataset-shared-topbar__inner">
                <div class="dataset-shared-topbar__slot dataset-shared-topbar__slot--start">
                    <div class="dataset-shared-topbar__dataset-title">Matkatarjoukset</div>
                </div>
                <div class="dataset-shared-topbar__center"><div class="dataset-search-panel"></div></div>
                <div class="dataset-shared-topbar__slot dataset-shared-topbar__slot--end"></div>
            </div></div>`;
        const bar = document.body.firstElementChild;
        const inner = bar.firstElementChild;
        const title = bar.querySelector('.dataset-shared-topbar__dataset-title');
        const center = bar.querySelector('.dataset-shared-topbar__center');
        expect(getComputedStyle(inner).gridTemplateColumns).toBe('max-content minmax(0, 1fr) auto');
        bar.dataset.topbarSearchMode = 'button'; bar.dataset.topbarSearchOpen = 'true';
        expect(getComputedStyle(inner).gridTemplateColumns).toBe('minmax(0, 1fr) auto');
        expect(getComputedStyle(center).position).toBe('absolute');
        expect(getComputedStyle(center).insetBlockStart).toBe('0px');
        expect(getComputedStyle(center).maxWidth).toBe('none');
        expect(getComputedStyle(title).visibility).toBe('hidden');
        bar.dataset.topbarSearchOpen = 'false';
        expect(getComputedStyle(title).visibility).toBe('visible');
    });

    test.each(['light', 'dark'].flatMap(theme => ['visible', 'hiding', 'showing'].map(phase => ({ theme, phase }))))(
        '$theme/$phase hides a released menu immediately despite the slot remaining visible', ({ theme, phase }) => {
        style = document.createElement('style');
        style.textContent = readSharedTopbarCss();
        document.head.append(style);
        document.body.className = `${theme}-mode`;
        document.body.innerHTML = `<div class="dataset-shared-topbar dataset-shared-topbar--visible">
            <div class="dataset-shared-topbar__menu-slot dataset-shared-topbar__menu-slot--visible">
                <button class="dataset-shared-topbar__menu-button" aria-hidden="false" tabindex="0">
                    <span class="environment-badge">TEST</span>
                </button>
            </div></div>`;
        const bar = document.body.firstElementChild;
        const slot = bar.firstElementChild;
        const button = slot.firstElementChild;
        expect(getComputedStyle(button).visibility).toBe('visible');
        button.setAttribute('aria-hidden', 'true'); button.tabIndex = -1;
        slot.classList.remove('dataset-shared-topbar__menu-slot--visible');
        slot.setAttribute('aria-hidden', 'true'); slot.inert = true;
        if (phase !== 'visible') bar.classList.remove('dataset-shared-topbar--visible');
        // jsdom does not interpolate CSS transitions. Supply their retained
        // intermediate ancestor values; the button's own CSS must still hide it.
        for (const opacity of [1, 0.5, 0]) {
            bar.style.opacity = String(opacity);
            bar.style.visibility = 'visible';
            bar.style.transform = 'translateY(-4px)';
            slot.style.visibility = 'visible'; slot.style.opacity = String(opacity);
            slot.style.width = `${52 * opacity}px`;
            expect(getComputedStyle(button).visibility).toBe('hidden');
            expect(getComputedStyle(button.firstElementChild).visibility).toBe('hidden');
            expect(button.getAttribute('aria-hidden')).toBe('true');
            expect(button.tabIndex).toBe(-1);
        }
        // Reacquiring the slot restores normal inheritance rather than forcing
        // visibility through an actually hidden bar or host.
        button.setAttribute('aria-hidden', 'false'); button.tabIndex = 0;
        slot.classList.add('dataset-shared-topbar__menu-slot--visible');
        slot.setAttribute('aria-hidden', 'false'); slot.inert = false;
        bar.classList.add('dataset-shared-topbar--visible');
        expect(getComputedStyle(button).visibility).toBe('visible');
    });

    test('caps the search-only field at 600px inside the shared topbar', () => {
        const css = readSharedTopbarCss();
        const topbarRule = extractRule(css, '.dataset-shared-topbar');
        const searchRule = extractRule(css, '.dataset-shared-topbar__center > .dataset-search-panel');

        expect(topbarRule).toContain('--filterbar-search-only-max-width: 600px');
        expect(searchRule).toContain('max-width: var(--filterbar-search-only-max-width, 600px)');
    });

    test('matches the navbar top-row divider without changing collapse geometry', () => {
        const css = readSharedTopbarCss();
        const topbarRule = extractRule(css, '.dataset-shared-topbar');
        const visibleRule = extractRule(css, '.dataset-shared-topbar--visible');

        expect(topbarRule).toContain('border-bottom: 2px solid transparent');
        expect(visibleRule).toContain('border-bottom-color: var(--border_color)');
        expect(visibleRule).not.toContain('var(--filter_panel_border)');
    });

    test('moves the article close button left of the exposed filterbar toggle', () => {
        const css = readSharedTopbarCss();
        const closeOffsetRule = extractRule(
            css,
            '.tab_parts_container:has(.filterbar-fixed-toggle--exposed) .dataset-shared-topbar__article-close:not([hidden])'
        );

        expect(closeOffsetRule).toContain('margin-right: 52px');
    });

    test('reveals the menu control through synchronized width and opacity transitions', () => {
        const css = readSharedTopbarCss();
        const hiddenSlotRule = extractRule(css, '.dataset-shared-topbar__menu-slot');
        const visibleSlotRule = extractRule(css, '.dataset-shared-topbar__menu-slot--visible');

        expect(hiddenSlotRule).toContain('width: 0');
        expect(hiddenSlotRule).toContain('opacity: 0');
        expect(hiddenSlotRule).toContain('clip-path: inset(-8px 0 -8px 0)');
        expect(hiddenSlotRule).toContain('opacity 260ms cubic-bezier(0.4, 0, 0.2, 1)');
        expect(visibleSlotRule).toContain('width: 52px');
        expect(visibleSlotRule).toContain('opacity: 1');
        expect(visibleSlotRule).toContain('opacity 260ms cubic-bezier(0.4, 0, 0.2, 1)');
    });
});

test.each(['light', 'dark'])('Home paints a results box only for actual results in %s', theme => {
    style = document.createElement('style');
    style.textContent = readFileSync(resolve(CURRENT_DIR, '../front_page/front_page_search_sheet.css'), 'utf8');
    document.head.append(style); document.body.className = `${theme}-mode`;
    document.body.innerHTML = '<div class="front-page-search-layer"><p role="status">Haetaan…</p>'
        + '<div class="front-page-search-sheet__results"><div></div></div></div>';
    const results = document.querySelector('.front-page-search-sheet__results');
    expect(getComputedStyle(results).display).toBe('none');
    expect(getComputedStyle(document.querySelector('[role="status"]')).display).not.toBe('none');
    const row = document.createElement('div'); row.className = 'supplemental-dataset-result';
    results.firstElementChild.append(row);
    expect(getComputedStyle(results).display).toBe('block');
    row.remove(); expect(getComputedStyle(results).display).toBe('none');
});
