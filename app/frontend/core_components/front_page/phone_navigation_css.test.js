// @vitest-environment node
// phone_navigation_css.test.js
// Pins phone-only Home, toolbar and hero spacing against the shipped CSS cascade.
// Connects the responsive overrides to unchanged tablet/desktop source rules.
// Native browser geometry remains covered by G11/G13 and E15/E19.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { requireNodeDependency } from '../../../server_tools/lib/node_dependency_loader.mjs';

const postcss = requireNodeDependency('postcss');
const baseline = {
    'top_nav_home_button.css': '4c2b8e10a17ee70737ee8af0adf2b21b6fc3bca40f92c85f403de5f91ab8003c',
    '../filterbar/shared_topbar.css': '662fce1278e4845710e0e338215d67db3009ccc8447cef4bbd1c67974325abf1',
    '../filterbar/morphing_filterbar_content.css': '4e7755e312211cfe9162b738f017aa2a30c01d462e5c8a2eaded12fe0c598607',
};
const sheets = Object.fromEntries(Object.keys(baseline).map(file =>
    [file, postcss.parse(readFileSync(new URL(file, import.meta.url), 'utf8'))]));

function phoneRule(file, selector) {
    const declarations = {};
    sheets[file].walkAtRules('media', media => {
        if (media.params !== '(width <= 700px)') return;
        media.walkRules(rule => {
            if (rule.selector !== selector) return;
            rule.walkDecls(declaration => { declarations[declaration.prop] = declaration.value; });
        });
    });
    return declarations;
}

test.each(Object.keys(baseline))('%s keeps every rule outside the phone breakpoint byte-identical to d373e6c6', file => {
    const root = sheets[file].clone();
    root.walkAtRules('media', media => { if (media.params === '(width <= 700px)') media.remove(); });
    expect(createHash('sha256').update(root.toString()).digest('hex')).toBe(baseline[file]);
});

test('only Home has a full-width labelled phone link, including a stale compact fit class', () => {
    const file = 'top_nav_home_button.css';
    expect(phoneRule(file, '.navbar-front-page-link.top-nav-home-button')).toEqual({ width: 'var(--top-nav-home-size)', padding: '0' });
    expect(phoneRule(file, '.top-nav-home-button .navbar-front-page-label')).toEqual({ display: 'none' });
    expect(phoneRule(file, '.front-page-top-row .navbar-front-page-link.top-nav-home-button')).toEqual({
        width: '100%', 'max-width': 'none', 'min-height': 'var(--top-nav-home-size)', padding: '6px 12px',
    });
    expect(phoneRule(file, '.front-page-top-row .top-nav-home-button .navbar-front-page-label')).toEqual({ display: 'inline' });
});

const INSET = 'calc(12px - var(--dataset-shared-topbar-padding-inline, 12px))';

test('phone toolbar reserves menu/Home and search/filter tracks; corner inset cannot clip the menu border', () => {
    expect(phoneRule('top_nav_home_button.css', '.dataset-shared-topbar__inner:has(.top-nav-home-button)'))
        .toEqual({ 'grid-template-columns': 'calc(96px + 12px - var(--dataset-shared-topbar-padding-inline, 12px)) minmax(0, 1fr) 96px' });
    const file = '../filterbar/shared_topbar.css';
    expect(phoneRule(file, '.dataset-shared-topbar__inner')['grid-template-columns'])
        .toBe('calc(44px + 12px - var(--dataset-shared-topbar-padding-inline, 12px)) minmax(0, 1fr) 96px');
    expect(phoneRule(file, '.dataset-shared-topbar__slot--start')).toEqual({ gap: '8px' });
    expect(phoneRule(file, '.dataset-shared-topbar .dataset-shared-topbar__menu-slot')).toEqual({
        flex: '0 0 44px', width: '44px', 'max-width': '44px', 'margin-inline-start': INSET, transition: 'none',
    });
    expect(phoneRule(file, '.dataset-shared-topbar .dataset-shared-topbar__menu-slot > .dataset-shared-topbar__menu-button'))
        .toEqual({ left: '0' });
});

// Gate 512a: G14 (`G14_home_menu_parity.spec.ts:34`, `:97`) and Dataset_Corner_Buttons.md require the menu button's
// left edge at exactly 12px. The bar padding is 12px at 481–700px and 10px at <=480px (shared_topbar.css).
test.each([12, 10])('bar padding %ipx: the menu button starts at x=12 and fits inside its 44px slot and track', padding => {
    const slotMargin = 12 - padding;                       // margin-inline-start: INSET
    const slotX = padding + slotMargin;                    // the slot's left edge in the viewport
    const buttonX = slotX + 0;                             // left: 0 inside the slot (no shift into the clip)
    expect(buttonX).toBe(12);
    expect(buttonX + 44).toBeLessThanOrEqual(slotX + 44);  // the whole 44px button is inside the 44px slot
    for (const [base, contents] of [[44, 44], [96, 44 + 8 + 44]]) {
        const track = base + 12 - padding;                 // calc(base + 12px - padding)
        expect(slotMargin + contents).toBeLessThanOrEqual(track); // menu (+ gap + Home) fit their first track
    }
});

test('phone hero has small title/search-area gaps and a full-width tools box with no outer margin', () => {
    const file = '../filterbar/morphing_filterbar_content.css';
    expect(phoneRule(file, '.filterbar-inline-hero > .filter-content-inner')).toEqual({ width: '100%', 'max-width': 'none', margin: '0', gap: '8px' });
    expect(phoneRule(file, '.filterbar-inline-hero .morphing-header')).toEqual({ margin: '0' });
    expect(phoneRule(file, '.filterbar-inline-hero .morphing-title')).toEqual({ margin: '0 0 4px' });
    expect(phoneRule(file, '.filterbar-inline-hero .morphing-subtitle')).toEqual({ margin: '0' });
    expect(phoneRule(file, '.filterbar-inline-hero .filter-content-inner > .dataset-filter-section')).toEqual({ margin: '0', 'max-width': 'none' });
});
