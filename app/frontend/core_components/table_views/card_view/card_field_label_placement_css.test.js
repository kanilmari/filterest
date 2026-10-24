// card_field_label_placement_css.test.js
// Guards unpunctuated labels and the result-card preview cap in the shared CSS cascade.
// Connects renderer markup with styles that must preserve the site's wrapping choice.
// Prevents legacy width switches from placing fields independently of that choice.
// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { requireNodeDependency } from '../../../../server_tools/lib/node_dependency_loader.mjs';

const postcss = requireNodeDependency('postcss');

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(CURRENT_DIR, 'card_field_label_placement.css');
const IMPORTS_PATH = resolve(CURRENT_DIR, '../../../styles/imports.css');

describe('card field label placement CSS', () => {
    test('list edge overrides exist only in the three stacked-layout blocks', () => {
        const mobilePath = resolve(CURRENT_DIR, '../../../styles/mobile_friendliness.css');
        const lists = /\.(?:card_modern_info_panel|card_details_kv|big_card_details_container)\s*$/;
        const found = [];
        for (const path of [CSS_PATH, mobilePath]) {
            postcss.parse(readFileSync(path, 'utf8')).walkRules(rule => {
                if (!rule.selectors.some(selector => lists.test(selector))) return;
                const declarations = Object.fromEntries(rule.nodes.filter(node => node.type === 'decl')
                    .map(decl => [decl.prop, decl.value]));
                if (!Object.keys(declarations).some(prop => prop.startsWith('border'))) return;
                expect(path).toBe(mobilePath);
                expect(rule.parent.type).toBe('atrule');
                expect(rule.parent.parent.type).toBe('root');
                found.push({ band: `${rule.parent.name} ${rule.parent.params}`, selectors: rule.selectors, declarations });
                // Use the same block as the photo-frame boundary, including the second card-list block.
                expect(rule.parent.nodes.some(node => node.type === 'rule'
                    && node.selector.includes('.wrapper:not(.service_catalog_logo_frame, .card_image_contrast_frame)::after'))).toBe(true);
            });
        }
        const edges = { 'border-radius': '0', 'border-inline': '0', 'border-block': '1px solid var(--border_color)' };
        expect(found).toEqual([
            ...['media screen and (width <= 1550px)', 'container card-list (max-width: 1060px)'].flatMap(band => [
                { band, selectors: ['.card .card_modern_info_panel', '.card .card_details_kv'], declarations: edges },
                { band, selectors: ['.card .card_modern_info_panel .card_details_kv'], declarations: { 'border-block': '0' } },
                { band, selectors: [
                    '.card--modern:not([data-card-presentation-view="card"]) .card_modern_info_panel',
                    '.card--modern:not([data-card-presentation-view="card"]) .card_details_modern_tiles',
                ], declarations: { border: '0', 'border-radius': '0', background: 'transparent' } },
            ]),
            { band: 'media (width <= 1200px)', selectors: ['.big_card_details_container'], declarations: edges },
        ]);
        const imports = readFileSync(IMPORTS_PATH, 'utf8');
        expect(imports.indexOf('mobile_friendliness.css')).toBeGreaterThan(imports.indexOf('card_field_label_placement.css'));
    });

    test('stacking preserves the existing modern and expanded-card row separators', () => {
        const cards = postcss.parse(readFileSync(resolve(CURRENT_DIR, 'cards.css'), 'utf8'));
        const big = postcss.parse(readFileSync(resolve(CURRENT_DIR, 'cards_big.css'), 'utf8'));
        for (const [css, selector, property, value] of [
            [cards, '.card--modern .card_modern_info_panel > :not(:first-child)', 'border-top', '1px solid var(--card-modern-separator-color)'],
            [big, '.big_card_details_container > div', 'border-bottom', '2px solid var(--border_color)'],
        ]) {
            const separators = [];
            css.walkRules(selector, rule => rule.walkDecls(property, decl => separators.push(decl.value)));
            expect(separators).toEqual([value]);
        }
    });

    test('Show more inherits category-button rounding at every width and theme', () => {
        const root = postcss.parse(readFileSync(CSS_PATH, 'utf8'));
        const radii = [];
        root.walkRules(rule => {
            if (!rule.selector.includes('[data-lang-key="show_more"]')) return;
            expect(rule.selectors).toEqual(['.card [data-lang-key="show_more"]', '.big_card_container [data-lang-key="show_more"]']);
            expect(rule.parent.type).toBe('root');
            rule.walkDecls('border-radius', decl => radii.push(decl.value));
        });
        expect(radii).toEqual(['var(--search_tools_radius)']);
        const imports = readFileSync(IMPORTS_PATH, 'utf8');
        expect(imports.indexOf('card_field_label_placement.css')).toBeGreaterThan(imports.indexOf('cards_big.css'));
    });

    test('adds no colon to labels in any card style or detail variant', () => {
        const stylesheets = [
            CSS_PATH,
            resolve(CURRENT_DIR, 'cards.css'),
            resolve(CURRENT_DIR, '../experimental_free_layout_card/experimental_free_layout_card.css'),
            resolve(CURRENT_DIR, '../../../reusable_components/key_value_container/kv_container.css'),
            resolve(CURRENT_DIR, '../../../reusable_components/key_value_container/label_value_layout.css'),
        ];
        for (const path of stylesheets) {
            expect(readFileSync(path, 'utf8'), path).not.toMatch(/content:\s*["']:/);
        }
    });

    test('keeps a card detail value capped at two lines in every arrangement', () => {
        const css = readFileSync(CSS_PATH, 'utf8');

        expect(css).toContain(
            ':root :is(.card, .card_details_kv) .label-value-layout[data-label-value-layout] > .label-value-layout__value'
        );
        expect(css).toContain('-webkit-line-clamp: 2');
        expect(css).not.toContain('!important');
    });

    test.each(['stacked', 'inline', 'auto'])('card values outrank shared display resets in %s mode', mode => {
        const libraryDir = resolve(CURRENT_DIR, '../../../reusable_components/key_value_container');
        const style = document.createElement('style');
        // Load the shared reset last too: the cap must win by specificity,
        // rather than depend on which imported stylesheet was inserted last.
        style.textContent = [
            readFileSync(resolve(CURRENT_DIR, 'cards.css'), 'utf8'),
            readFileSync(CSS_PATH, 'utf8'),
            readFileSync(resolve(libraryDir, 'label_value_layout.css'), 'utf8'),
            readFileSync(resolve(libraryDir, 'kv_container.css'), 'utf8').replace(/@import[^;]+;/g, ''),
        ].join('\n');
        document.head.replaceChildren(style);
        document.body.innerHTML = ['', 'card--modern'].map(cardClass => `
            <div class="card ${cardClass}">
                <div class="card_details_kv kv-display kv-conditional">
                    <div class="kv-pair-conditional kv-smart-row label-value-layout" data-label-value-layout="${mode}">
                        <span class="kv-key label-value-layout__label">Riski</span>
                        <span class="kv-value kv-conditional-value label-value-layout__value">
                            <span class="kv-link-group"><a href="/riskit/42">Pitkä riskin nimi</a></span>
                        </span>
                    </div>
                </div>
            </div>`).join('');

        for (const value of document.querySelectorAll('.label-value-layout__value')) {
            const computed = getComputedStyle(value);
            expect(computed.display).toBe('-webkit-box');
            expect(computed.getPropertyValue('-webkit-box-orient')).toBe('vertical');
            expect(computed.getPropertyValue('-webkit-line-clamp')).toBe('2');
            expect(computed.overflow).toBe('hidden');
            expect(getComputedStyle(value.querySelector('.kv-link-group')).display).toBe('inline');
        }
    });

    test('loads the preview cap after the shared adapter without placement overrides', () => {
        const imports = readFileSync(IMPORTS_PATH, 'utf8');
        const placement = imports.indexOf('card_field_label_placement.css');

        expect(placement).toBeGreaterThan(imports.indexOf('card_view/cards.css'));
        expect(readFileSync(CSS_PATH, 'utf8')).not.toMatch(/flex-flow|grid-template-columns/);
        expect(placement).toBeGreaterThan(imports.indexOf('key_value_container/kv_container.css'));
    });

    test('keeps mobile and legacy measurement rules from overriding shared pairs', () => {
        const mobile = readFileSync(resolve(CURRENT_DIR, '../../../styles/mobile_friendliness.css'), 'utf8');
        const cards = readFileSync(resolve(CURRENT_DIR, 'cards.css'), 'utf8');
        const library = readFileSync(resolve(CURRENT_DIR, '../../../reusable_components/key_value_container/kv_container.css'), 'utf8');
        expect(mobile).not.toMatch(/\.kv-pair-inline\s*\{/);
        expect(mobile).toContain('.kv-pair-inline:not(.label-value-layout)');
        expect(cards + library).not.toMatch(/card-detail-tile-label-width|kv-dropped/);
        expect(cards).not.toContain('subgrid');
        expect(library).not.toContain('max-width: 400px');
    });
});
