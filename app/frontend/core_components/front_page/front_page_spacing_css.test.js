// @vitest-environment node
// front_page_spacing_css.test.js
// Resolves shipped Home spacing through PostCSS for both layouts, widths and explicit themes.
// Complements G15 geometry: layout engines, safe-area hardware and screenshots need the native runner.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { requireNodeDependency } from '../../../server_tools/lib/node_dependency_loader.mjs';

const root = requireNodeDependency('postcss').parse(readFileSync(new URL('front_page.css', import.meta.url), 'utf8'));

function declarations(selectors, width) {
    const values = {};
    root.walkRules(rule => {
        if (!rule.selectors.some(selector => selectors.includes(selector))) return;
        for (let parent = rule.parent; parent; parent = parent.parent) {
            if (parent.type === 'atrule' && parent.name === 'media'
                && (parent.params !== '(width <= 700px)' || width > 700)) return;
        }
        rule.nodes.filter(node => node.type === 'decl').forEach(({ prop, value }) => { values[prop] = value; });
    });
    return values;
}

// Only lengths and additive calc expressions are used by these spacing rules.
function pixels(value, variables, safeArea = 0) {
    const resolved = value.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g,
        (_match, name, fallback) => `${pixels(variables[name] ?? fallback, variables, safeArea)}px`)
        .replace('env(safe-area-inset-bottom)', `${safeArea}px`);
    if (!resolved.startsWith('calc(')) {
        expect(resolved).toMatch(/^-?\d+(?:\.\d+)?px$/);
        return Number.parseFloat(resolved);
    }
    const expression = resolved.slice(5, -1);
    expect(expression).toMatch(/^-?\d+(?:\.\d+)?px(?:\s+[+-]\s+\d+(?:\.\d+)?px)*$/);
    return expression.match(/[+-]?\s*\d+(?:\.\d+)?px/g)
        .reduce((sum, term) => sum + Number.parseFloat(term.replace(/\s/g, '')), 0);
}

for (const layout of ['classic', 'positioned']) for (const width of [390, 1440]) {
    test.each(['light', 'dark'])(`${layout} at ${width}px: all three spacings resolve to Home tokens and 40px in %s`, theme => {
        const variables = declarations(['.front-page', ...(theme === 'dark' ? ['body.dark-mode .front-page'] : [])], width);
        expect(variables['--home-block-gap']).toBe('40px');
        expect(variables['--home-hero-blocks-gap']).toBe('var(--home-block-gap)');
        expect(variables['--home-page-bottom-space']).toBe('var(--home-block-gap)');
        const blocks = declarations(['.front-page-blocks', ...(layout === 'positioned'
            ? ['.front-page-content--positioned > .front-page-blocks'] : [])], width);
        expect(blocks.gap).toBe('var(--home-block-gap)');
        expect(pixels(blocks.gap, variables)).toBe(40);
        if (layout === 'classic') {
            expect(blocks['margin-block-start']).toBe('var(--home-hero-blocks-gap)');
            expect(pixels(blocks['margin-block-start'], variables)).toBe(40);
        } else {
            expect(blocks.padding).toBe('0 1rem');
            expect(blocks['margin-block-start']).toBe('calc(var(--home-hero-blocks-gap) - var(--home-hero-trailing-space, 0px))');
            // Short and long text, at every vertical anchor: stageBottom - heroBottom is the measured tail.
            for (const tail of [0, 16, 40, 256, 784]) {
                const margin = pixels(blocks['margin-block-start'], { ...variables, '--home-hero-trailing-space': `${tail}px` });
                expect(tail + margin).toBe(40);
            }
        }
        const page = declarations(['.front-page-content', ...(layout === 'positioned' ? ['.front-page-content--positioned'] : [])], width);
        expect(page['padding-block-end']).toBe(width <= 700
            ? 'calc(var(--home-page-bottom-space) + env(safe-area-inset-bottom))' : 'var(--home-page-bottom-space)');
        expect(pixels(page['padding-block-end'], variables)).toBe(40);
        if (width <= 700) expect(pixels(page['padding-block-end'], variables, 24)).toBe(64);
    });
}

test('box compensation leaves viewport anchoring, alignment and phone clearance intact', () => {
    expect(declarations(['.front-page-text-stage'], 1440)['min-height']).toBe('100cqh');
    expect(declarations(['.front-page-text-stage[data-anchor]'], 390)['min-height'])
        .toBe('calc(100cqh - var(--home-phone-bar-size, 0px))');
    for (const [anchor, alignment] of [['center', 'center'], ['bottom', 'end']]) {
        expect(declarations([`.front-page-text-stage[data-anchor^="${anchor}-"]`], 1440)['align-items']).toBe(alignment);
    }
    for (const alignment of ['start', 'center', 'end', 'justify']) {
        expect(declarations([`.front-page-text-stage .front-page-hero[data-alignment="${alignment}"]`], 1440)['text-align']).toBe(alignment);
    }
});

for (const width of [390, 700, 701, 1000, 1440, 1920]) for (const side of ['left', 'center', 'right']) {
    test.each(['light', 'dark'])(`${side} boxes at ${width}px retain A's width and margin contract in %s`, theme => {
        const selectors = ['.front-page-blocks', '.front-page-content--positioned > .front-page-blocks',
            `.front-page-content--positioned > .front-page-text-stage[data-anchor$="${side}"] ~ .front-page-blocks`,
            '.front-page-content--positioned > .front-page-text-stage[data-anchor] ~ .front-page-blocks'];
        const variables = declarations(['.front-page', ...(theme === 'dark' ? ['body.dark-mode .front-page'] : [])], width);
        const blocks = declarations(selectors, width);
        const inset = declarations(['.front-page-text-stage'], width)['padding-inline'];
        expect(blocks['max-width']).toBe('800px');
        expect(blocks['grid-template-columns']).toBe('minmax(0, 1fr)');
        expect(blocks.padding).toBe('0 1rem'); // Desktop gutters; phones override only the inline sides.
        expect(blocks['padding-inline']).toBe(width <= 700 ? '0' : undefined);
        const group = declarations(['.front-page-blocks .supplemental-dataset-group'], width);
        expect(group.border).toBe('1px solid var(--border_color)');
        expect(group['border-inline-width']).toBe(width <= 700 ? '0' : undefined);
        expect(group['border-radius']).toBe(width <= 700 ? '0' : 'var(--home-block-radius, var(--fw-radius-md, 8px))');
        expect(group['padding-inline']).toBe(width <= 700 ? '16px' : undefined);
        expect(pixels(blocks.gap, variables)).toBe(40);
        if (width <= 700 || side === 'center') {
            expect(blocks.width).toBe('100%');
            expect(blocks['margin-inline']).toBe('auto');
        } else {
            expect(blocks.width).toBe('auto');
            expect(blocks['margin-inline']).toBe(side === 'left' ? `calc(${inset} - 1rem) auto` : `auto calc(${inset} - 1rem)`);
        }
    });
}
