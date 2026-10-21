// @vitest-environment node
// search_tools_radius_css.test.js
// Holds the hero search tools to one soft radius without restyling shared controls.
// Connects global radius tokens, the search surface and scoped filter-section rules.
// Protects popup decorations and component defaults used outside the tools box.

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const readCss = path => readFileSync(resolve(currentDir, path), 'utf8');
const tools = readCss('morphing_filterbar_content.css');
const variables = readCss('../../styles/variables.css');
const framework = readCss('../../styles/framework.css');
const search = readCss('text_search/text_search.css');
const facets = readCss('filter_list/row_group_facets.css');
const dropdown = readCss('../../reusable_components/vanilla_dropdown/vanilla_dropdown.css');

function rulesFor(css, selector) {
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, selectors]) => selectors.replace(/\/\*[\s\S]*?\*\//g, '')
            .split(',').some(value => value.trim() === selector))
        .map(([, , body]) => body);
}

function radii(css, selector) {
    const rules = rulesFor(css, selector);
    expect(rules.length, `Missing rule: ${selector}`).toBeGreaterThan(0);
    return rules.flatMap(body => [...body.matchAll(/\bborder(?:-[\w]+)?-radius\s*:\s*([^;]+);/g)]
        .map(([declaration]) => declaration.trim()));
}

describe('search tools shared soft radius', () => {
    test('defines the token once beside the global 10px box radius', () => {
        const definitions = [variables, framework, tools, search, facets, dropdown]
            .join('\n').match(/--search_tools_radius\s*:/g);
        expect(definitions).toHaveLength(1);
        expect(variables).toMatch(/--border_radius: 10px;\s*--search_tools_radius: 10px;/);
        const root = rulesFor(variables, ':root').join('\n');
        expect(root).toContain('--search_tools_radius: 10px;');
    });

    test.each([
        ['box', '.dataset-filter-section'],
        ['sort select', '.dataset-filter-section .sort-dropdown-wrapper .vdw-dropdown-input'],
        ['Filter results', '.dataset-filter-section .filterbar-filters-toggle-button'],
        ['Reset search', '.dataset-filter-section .reset-search-button'],
        ['category heading', '.dataset-filter-section .row-group-facet-heading'],
    ])('%s has exactly one shared radius declaration', (_label, selector) => {
        expect(radii(tools, selector)).toEqual(['border-radius: var(--search_tools_radius);']);
    });

    test('the search field and its joined input/submit corners use the same token in their own stylesheet', () => {
        expect(radii(search, '.dataset-search-input-row')).toEqual(['border-radius: var(--search_tools_radius);']);
        expect(radii(search, '.dataset-search-input'))
            .toEqual(['border-radius: var(--search_tools_radius) 0 0 var(--search_tools_radius) !important;']);
        expect(radii(search, '.dataset-search-submit-button'))
            .toEqual(['border-radius: 0 calc(var(--search_tools_radius) - 1px) calc(var(--search_tools_radius) - 1px) 0 !important;']);
        // No hero-only override is needed; the box file adds no !important radius.
        expect(tools).not.toMatch(/--search_tools_radius[^;]*!important/);
    });

    test('keeps scoped radius rules unconditional across themes and viewport widths', () => {
        // Every token consumer sits at stylesheet root, outside media/theme overrides.
        let depth = 0;
        for (const line of tools.split('\n')) {
            if (line.includes('var(--search_tools_radius)')) expect(depth).toBe(1);
            depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        }
        for (const body of rulesFor(tools, '.dataset-filter-section .row-group-facet-heading')) {
            expect(body.trim()).toBe('border-radius: var(--search_tools_radius);');
        }
    });

    test.each([
        ['heading badge', facets, '.row-group-facet-heading__badge', '12px'],
        ['popup mode tag', facets, '.msd-dropdown-list--rich .row-group-facet-mode__tag', '999px'],
        ['facet action', facets, '.row-group-facet-action', '6px'],
        ['heading outside the box', facets, '.row-group-facet-heading', '18px'],
        ['sort outside the box', dropdown, '.vdw-dropdown-input', 'var(--border_radius_small)'],
        ['button outside the box', framework, '.fw-btn', 'var(--primary-button-radius, var(--border_radius))'],
    ])('preserves the %s radius', (_label, css, selector, radius) => {
        expect(radii(css, selector)).toEqual([`border-radius: ${radius};`]);
    });
});
