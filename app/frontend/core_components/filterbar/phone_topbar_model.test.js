// @vitest-environment node
// phone_topbar_model.test.js
// Pins Model D's phone cells, dividers and square search exception.
// Reads the owning stylesheets alongside the DOM behavior tests.
// Keeps the hero's K465 styling and wider layouts outside the phone exception.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { requireNodeDependency } from '../../../server_tools/lib/node_dependency_loader.mjs';

const postcss = requireNodeDependency('postcss');
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
function rule(file, selector, phone = false) {
    const result = {};
    postcss.parse(read(file)).walkRules(node => {
        if (node.selector !== selector) return;
        let parent = node.parent;
        let inPhone = false;
        while (parent) {
            if (parent.name === 'media' && parent.params === '(width <= 700px)') inPhone = true;
            parent = parent.parent;
        }
        if (inPhone !== phone) return;
        node.walkDecls(({ prop, value }) => { result[prop] = value; });
    });
    return result;
}
const hair = '1px solid color-mix(in srgb, var(--border_color) 50%, transparent)';

test('dataset and article share a 48px edge-to-edge bar with a 52px menu and a 44px/52px end pair', () => {
    expect(rule('shared_topbar.css', '.dataset-shared-topbar', true)).toMatchObject({
        height: '48px', padding: '0', 'box-sizing': 'border-box', 'border-bottom-width': '1px',
    });
    expect(rule('shared_topbar.css', '.dataset-shared-topbar__inner', true)).toEqual({
        'grid-template-columns': '52px minmax(0, 1fr) 96px', 'grid-template-rows': '47px', gap: '0',
    });
    expect(rule('shared_topbar.css', '.dataset-shared-topbar__search-toggle', true)).toMatchObject({ height: '47px', border: '0', 'border-radius': '0' });
    expect(rule('shared_topbar.css', '.dataset-shared-topbar__search-toggle').width).toBe('44px');
    expect(rule('dataset_corner_controls.css', '.dataset-corner-controls-topbar-end > .filterbar-fixed-toggle--hosted', true))
        .toMatchObject({ width: '52px', height: '47px', 'border-inline-start': hair });
    expect(rule('shared_topbar.css', '.dataset-shared-topbar__center', true)['border-inline']).toBe(hair);
});

test('Home has the same cells without a panel, including both dividers while search is open', () => {
    expect(rule('../front_page/front_page.css', '.front-page-phone-topbar', true)).toMatchObject({
        height: '48px', padding: '0', gap: '0', 'grid-template-rows': '47px',
        'grid-template-columns': '52px minmax(0, 1fr) 44px',
    });
    expect(rule('../front_page/front_page.css', '.front-page-phone-topbar > .front-page-top-row__identity', true)['border-inline-start']).toBe(hair);
    expect(rule('../front_page/front_page_search_sheet.css', '.front-page-search-sheet.dataset-search-panel')).toMatchObject({
        'grid-column': '2 / 4', 'grid-template-columns': 'minmax(0, 1fr) 44px', gap: '0', 'border-inline-start': hair,
    });
    expect(rule('../front_page/front_page_search_sheet.css', '.front-page-search-button')).toMatchObject({
        width: '44px', height: '47px', 'border-inline-start': hair,
    });
});

test('only bar fields override K465 and remove the decorative magnifier; the hero retains its rounding', () => {
    expect(rule('shared_topbar.css', '.dataset-shared-topbar', true)['--search_tools_radius']).toBe('0px');
    expect(rule('../front_page/front_page_search_sheet.css', '.front-page-search-sheet > .dataset-search-input-row')['--search_tools_radius']).toBe('0px');
    expect(rule('../front_page/front_page_search_sheet.css', '.front-page-search-sheet.dataset-search-panel')['--search_tools_radius']).toBeUndefined();
    expect(rule('text_search/text_search.css', '.dataset-search-input-row')['border-radius']).toBe('var(--search_tools_radius)');
    const css = read('text_search/text_search.css');
    expect(css).toContain('[data-topbar-search-mode="phone"] .dataset-search-field-icon');
    expect(rule('text_search/text_search.css', '[data-topbar-search-mode="phone"] .dataset-search-input-row', true))
        .toMatchObject({ height: '47px', 'border-radius': '0' });
    expect(rule('shared_topbar.css', '.filterbar-inline-hero > .filter-content-inner > .dataset-search-panel', true)['--dataset-search-control-height']).toBe('44px');
    expect(rule('filters_opener_and_closer.css', '[data-topbar-search-mode="phone"] .dataset-search-clear-button', true))
        .toMatchObject({ width: '44px', height: '47px', 'min-height': '44px' });
});

test('an empty Home results box is hidden while its live status remains outside that box', () => {
    expect(rule('../front_page/front_page_search_sheet.css', '.front-page-search-sheet__results:not(:has(.supplemental-dataset-result))')).toEqual({ display: 'none' });
    const source = read('../front_page/front_page_search_sheet.js');
    expect(source).toContain('results.append(groups)');
    expect(source).toContain('layer.append(status, results)');
});

test('the 22px search-off SVG has the exact masked gap and strike from the owner mock', () => {
    expect(rule('shared_topbar.css', '.dataset-shared-topbar__search-toggle > span', true)).toEqual({ width: '22px', height: '22px' });
    const icon = read('../../icons/general/dataset-search-off-icon.svg');
    expect(icon).toContain('viewBox="0 0 24 24"');
    expect(icon).toContain('d="M2.5 18.5 18.5 2.5" stroke="#000" stroke-width="5"');
    expect(icon).toContain('mask="url(#search-strike)"');
    expect(icon).toContain('d="M2.5 18.5 18.5 2.5" stroke="currentColor" stroke-width="2"');
});
