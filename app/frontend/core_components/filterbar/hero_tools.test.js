// hero_tools.test.js
// Proves shared hero geometry, decorative artwork and translation-safe controls.
// Connects source CSS contracts with real DOM icon and dropdown builders.
// Protects both themes and responsive layouts without requiring a browser target.
import { afterEach, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHeroToolIcon, appendHeroToolButtonIcon } from './hero_tool_icon_builder.js';
import { createVanillaDropdown } from '../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js';
import { buildSortOptions } from './top_row_buttons/sort_dropdown_builder_helpers.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const rule = (css, selector) => css.split(`${selector} {`).at(-1)?.split('}')[0] || '';
afterEach(() => document.body.replaceChildren());

test('hero tools keep K465\'s one search-tools radius and add no radius of their own', () => {
    const shared = source('./hero_tools.css');
    const search = source('./text_search/text_search.css');
    const panel = source('./morphing_filterbar_content.css');
    expect(panel).toContain("@import url('./hero_tools.css')");
    // WO50's "one border radius" is K465's token (232a30fd); a second token would split the group again.
    expect(shared).not.toMatch(/border-radius|--[\w-]*radius\s*:/);
    for (const selector of ['.dataset-search-input-row', '.dataset-search-input', '.dataset-search-submit-button']) {
        // Use the owning rule, rather than a later interaction selector.
        const block = search.match(new RegExp(`\\n${selector.replaceAll('.', '\\.')} \\{([^}]+)`))?.[1];
        expect(block).toContain('var(--search_tools_radius)');
    }
    // The panel's owning rule, not a later phone override that ends with the same selector.
    expect(panel.match(/\n\.dataset-filter-section \{([^}]+)/)?.[1]).toContain('border-radius: var(--search_tools_radius)');
    expect(shared).not.toMatch(/@media|dark-mode|light-mode/);
    expect(rule(shared, '.filterbar-inline-hero-filter-actions > button')).toContain('gap: var(--fw-space-2)');
    expect(rule(shared, '.filterbar-inline-hero-filter-actions > button')).toContain('white-space: normal');
    expect(rule(shared, '.filterbar-inline-hero-filter-actions > button > [data-lang-key]')).toContain('min-width: 0');
});

test('the hero row sizes its reset button by column, and the phone limit stays for the sort-dropdown hosts', () => {
    const shared = source('./hero_tools.css');
    expect(rule(shared, '.filterbar-inline-hero-filter-actions > .reset-search-button')).toContain('max-width: none');
    expect(rule(shared, '.filterbar-inline-hero-filter-actions > button')).toContain('padding-inline: var(--fw-space-2)');
    expect(rule(shared, '.filterbar-inline-hero-filter-actions > button')).toContain('align-self: stretch');
    expect(rule(source('./filterbar.css'), '    .reset-search-button')).toContain('max-width: 5.5rem');
});

test('the categories border outranks the row reset and stays before the phone section', () => {
    const css = source('./morphing_filterbar_content.css');
    const selector = '.dataset-filter-section > .row-group-facets:not(:first-child)';
    const separator = rule(css, selector);
    expect(separator).toContain('border-top: 1px solid var(--border_color)');
    expect(separator).toContain('padding-top: var(--fw-space-4)');
    // One class more specific than the row reset, so order does not matter; the responsive guard keeps new
    // top-level rules before the first phone section.
    expect(css).toContain('.dataset-filter-section > .row-group-facets {\n  width: 100%;');
    expect(css.indexOf(`${selector} {`)).toBeLessThan(css.indexOf('@media (width <= 700px)'));
    // A CSS border adds no DOM, focus stop, role or reading-order content.
    expect(separator).not.toMatch(/content:|tabindex|order:/);
});

test.each(['Filter results', 'Suodata tuloksia', 'Reset search', 'Tyhjennä haku'])('icons retain the accessible label %s through translation', label => {
    const button = document.createElement('button');
    button.dataset.langKey = 'reset_search';
    button.textContent = label;
    appendHeroToolButtonIcon(button, 'reset');
    expect(button.textContent).toBe(label);
    expect(button.querySelector('[data-lang-key="reset_search"]').textContent).toBe(label);
    const icon = button.firstElementChild;
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.tabIndex).toBe(-1);
    expect(icon.hasAttribute('style')).toBe(false);
    button.lastElementChild.textContent = 'Käännös';
    expect(button.firstElementChild).toBe(icon);
    expect(button.textContent).toBe('Käännös');
});

test('sort uses the existing decorative chevron and all fallback option labels omit Sort', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const options = buildSortOptions(['title'], ['updated']);
    const dropdown = createVanillaDropdown({ containerElement: host, options, showClearButton: false, useSearch: false });
    const chevron = host.querySelector('.vdw-input-wrapper > .vdw-dropdown-chevron');
    expect(chevron.getAttribute('aria-hidden')).toBe('true');
    expect(chevron.textContent).toBe('');
    expect(chevron.style.maskImage).toContain('chevron-down-icon.svg');
    expect(options.every(option => !/\bsort\b/i.test(option.label))).toBe(true);
    dropdown.destroy();
});

test('masks reuse existing artwork, inherit text colour and reserve input space', () => {
    const shared = source('./hero_tools.css');
    for (const [name, asset] of [['filter', 'symbols/tune.svg'], ['reset', 'general/refresh-icon.svg'], ['chevron', 'general/chevron-down-icon.svg']]) {
        const icon = createHeroToolIcon(name);
        expect(icon.getAttribute('aria-hidden')).toBe('true');
        expect(icon.tabIndex).toBe(-1);
        expect(rule(shared, `.dataset-hero-tool-icon--${name}`)).toContain(asset);
        expect(source(`../../icons/${asset}`)).toContain('<svg');
    }
    expect(rule(shared, '.dataset-hero-tool-icon')).toContain('background-color: currentcolor');
    expect(shared).toContain('rotate: 180deg');
    const search = source('./text_search/text_search.css');
    expect(rule(search, '.dataset-search-field-icon')).toContain('inset-inline-start: 14px');
    expect(rule(search, '.dataset-search-input-shell > .dataset-search-input')).toContain('padding-inline-start: 44px !important');
    expect(search).toContain('inset-inline-start: 44px');
    expect(search).toContain('general/dataset-search-icon.svg');
    expect(rule(source('./morphing_filterbar_content.css'), '.filterbar-panel-body .filterbar-text-search-row .dataset-search-input')).toContain('padding-inline: 44px !important');
});
