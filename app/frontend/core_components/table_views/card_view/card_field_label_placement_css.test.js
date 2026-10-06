// card_field_label_placement_css.test.js
// Guards punctuation and the result-card preview cap in the shared CSS cascade.
// Connects renderer markup with styles that must preserve the site's wrapping choice.
// Prevents legacy width switches from placing fields independently of that choice.
// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(CURRENT_DIR, 'card_field_label_placement.css');
const IMPORTS_PATH = resolve(CURRENT_DIR, '../../../styles/imports.css');

describe('card field label placement CSS', () => {
    test('draws the colon from style, not from the translated element', () => {
        const css = readFileSync(CSS_PATH, 'utf8');

        expect(css).toContain('.key_value_wrapper[data-card-label-placement="inline"] > .kv_label::after');
        expect(css).toContain('content: ":"');
    });

    test('draws the same colon for the card detail renderers', () => {
        const css = readFileSync(CSS_PATH, 'utf8');

        expect(css).toContain(
            '.card_details_kv [data-card-label-placement="inline"] > .card_detail_tile_label::after'
        );
        expect(css).toContain(
            '.card_details_kv [data-card-label-placement="inline"] .card_detail_row_label_text::after'
        );
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
