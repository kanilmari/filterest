// workline_observatory_scroll.test.js
// Guards the observatory's single desktop scrollport and unchanged phone rules.
// Connects component CSS with the shared shell and translated sticky toolbar size.
// Catches overflow ancestors and viewport heights that reintroduce nested scrolling.
// @vitest-environment node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(resolve(directory, 'workline_observatory_scroll.css'), 'utf8');
const view = readFileSync(resolve(directory, 'workline_observatory_view.css'), 'utf8');
const source = layout.replace(/\/\*[\s\S]*?\*\//g, '').trim();
const rules = [...source.slice(source.indexOf('{') + 1, source.lastIndexOf('}'))
    .matchAll(/([^{}]+)\{([^{}]*)\}/g)];

function declarations(selector) {
    const result = new Map();
    for (const [, selectors, body] of rules) {
        if (!selectors.split(',').map((value) => value.trim()).includes(selector)) continue;
        for (const declaration of body.split(';').filter((value) => value.includes(':'))) {
            const [property, value] = declaration.split(':');
            result.set(property.trim(), value.trim());
        }
    }
    return Object.fromEntries(result);
}

describe('observatory desktop scroll contract', () => {
    test('loads through the registered view stylesheet and confines changes above the existing breakpoint', () => {
        expect(view).toContain('@import url("./workline_observatory_scroll.css");');
        expect(source).toMatch(/^@media \(width > 900px\)\s*\{/);
        expect(source.match(/@media/g)).toHaveLength(1);
        expect(rules.length).toBeGreaterThan(0);
        expect(rules.every(([, selectors]) => selectors.includes('workline-observatory'))).toBe(true);
        expect(layout).not.toMatch(/(?:height|top):\s*(?:calc\(|\d+vh)/);
    });

    test('lets every flex/grid link shrink inside the viewport owned by the shell', () => {
        for (const selector of [
            '.body_content:has(.content_div:not(.hidden) .workline-observatory-view)',
            '#tabs_container:has(> .content_div:not(.hidden) .workline-observatory-view)',
            '.content_div:has(.workline-observatory-view)',
            '.management_forms:has(.workline-observatory-view)',
            '.tab_parts_container:has(.workline-observatory-view)',
            '.tab-content-area:has(.workline-observatory-view)',
            '.tab-content-body:has(.workline-observatory-view)',
        ]) expect(declarations(selector)['min-height'], selector).toBe('0');
        expect(declarations('.tab-content-body:has(.workline-observatory-view)')['grid-template-rows'])
            .toBe('minmax(0, 1fr)');
        expect(declarations('.content_div:has(.workline-observatory-view)'))
            .toMatchObject({ height: 'auto', flex: '1 1 0' });
    });

    test('keeps both axes in the shared content scroller, including the legacy management host', () => {
        for (const selector of [
            '.tab-content-body > .scrollable_content:has(.workline-observatory-view)',
            '.management_forms.workline-observatory-view',
        ]) expect(declarations(selector)).toMatchObject({ overflow: 'auto', height: 'auto', 'min-height': '0' });
        for (const selector of [
            '.management_forms:has(.workline-observatory-view)',
            '.workline-observatory-view:not(.management_forms)',
            '.workline-observatory .workline-observatory__board',
        ]) expect(declarations(selector).overflow).toBe('visible');
        expect(declarations('.workline-observatory .workline-observatory__board'))
            .toMatchObject({ width: 'max(100%, 102rem)', 'max-width': 'none' });
    });

    test('sticks the phase heading beneath the measured toolbar with an opaque theme background', () => {
        expect(declarations('.workline-observatory .workline-observatory__status-toolbar').top).toBe('0');
        expect(declarations('.workline-observatory .workline-observatory__board-heading')).toMatchObject({
            position: 'sticky', top: 'var(--workline-toolbar-height, 0)', background: 'var(--bg_color_extreme)',
        });
        expect(view).toMatch(/\.workline-observatory__status-toolbar\s*\{\s*position: sticky;/);
    });

    test('retains the original narrow-screen padding, detail stacking and nested horizontal overflow', () => {
        expect(view.match(/@media \(width <= 900px\)\s*\{[\s\S]*?\n\}/)?.[0]).toBe(`@media (width <= 900px) {
    .workline-observatory {
        padding: .5rem;
    }

    .workline-observatory__detail {
        grid-template-columns: 1fr;
    }

}`);
        expect(view).toMatch(/\.workline-observatory-view\s*\{\s*overflow-x: auto;/);
        expect(view.match(/\.workline-observatory__board\s*\{([^}]+)\}/)?.[1]).toContain('overflow-x: auto;');
    });
});
