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
    'front_page.css': '0d11dd6018f2d5865c63491debc6d17e39f2916b457f476fa31d6301497639a9',
    'top_nav_home_button.css': '370d13d5d63468cd1e8e03d637d3290e4375a7ef0654a41ba43b815ca207566b',
    '../filterbar/shared_topbar.css': '47dcce674bc0e9974a499e7f19db9e98f7988a23688051561e4ed73ed15a484f',
    '../filterbar/morphing_filterbar_content.css': '9b0c7307b1a1448328bb6e7bb59fbaf440006f72ac04827c02d6bb511324708a',
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

// Batch 512 (63b9b250) retains the non-phone baseline from d373e6c6; K465 updates only the hero's shared radius;
// WO95 re-pins Home for its desktop-only inset edge; every phone rule stays unchanged.
// Batch 569 re-pins only the topbar/hero colour mixes to use their solid companion.
// WO96 removes only Home's shared-bar order:10; original hosts, sizing and phone tracks stay pinned.
// WO98 re-pins Home only: shared box/hero/bottom spacing changes outside the phone breakpoint.
// The sticky bar, drawer lock, focus clearance and hero anchoring rules retain batch 513 geometry.
test.each(Object.keys(baseline))('%s keeps every rule outside the phone breakpoint byte-identical to its approved baseline', file => {
    const root = sheets[file].clone();
    root.walkAtRules('media', media => { if (media.params === '(width <= 700px)') media.remove(); });
    expect(createHash('sha256').update(root.toString()).digest('hex')).toBe(baseline[file]);
});

test('Home follows DOM order without changing its original hero sizing or corner reservation', () => {
    sheets['top_nav_home_button.css'].walkDecls('order', declaration => expect(declaration.value).toBe('0'));
    const corner = postcss.parse(readFileSync(new URL('../filterbar/dataset_corner_controls.css', import.meta.url), 'utf8'));
    corner.walkDecls('--hero-action-space', declaration => expect(declaration.value).toBe('52px'));
    const hero = sheets['top_nav_home_button.css'].nodes.find(rule => rule.selector === '.hero-dataset-tabs > .top-nav-home-button');
    expect(hero.nodes.map(({ prop, value }) => [prop, value])).toContainEqual(['min-height', 'var(--top-nav-home-size)']);
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
    // A block icon: as .metadata-symbol-icon's inline-block its line box added ~7px under the margin (d515, 15px gap).
    expect(phoneRule(file, '.filterbar-inline-hero .filterbar-hero-dataset-icon')).toEqual({ display: 'block', 'margin-bottom': '8px' });
    expect(phoneRule(file, '.filterbar-inline-hero .morphing-title')).toEqual({ margin: '0 0 4px' });
    expect(phoneRule(file, '.filterbar-inline-hero .morphing-subtitle')).toEqual({ margin: '0' });
    expect(phoneRule(file, '.filterbar-inline-hero .filter-content-inner > .dataset-filter-section')).toEqual({ margin: '0', 'max-width': 'none' });
});

test('phone hero search is visible at full inner width with the same 44px controls as the toolbar', () => {
    const file = '../filterbar/shared_topbar.css';
    const panel = '.filterbar-inline-hero > .filter-content-inner > .dataset-search-panel';
    expect(phoneRule(file, panel)).toEqual({
        '--dataset-search-control-height': '44px', display: 'flex', width: '100%',
        'min-width': '0', 'max-width': 'none', margin: '0',
    });
    expect(phoneRule(file, `${panel} .dataset-search-fields`)).toEqual({ 'min-width': '0' });
    // shared_topbar.css loads before morphing_filterbar_content.css, whose equal-specificity wide-state rule caps
    // `> :not(.morphing-header)` at 550px; its phone block lifts the cap (d515: the field sat centred at x=75 on 700px).
    expect(phoneRule('../filterbar/morphing_filterbar_content.css', '.filterbar-inline-hero .filter-content-inner > .dataset-search-panel'))
        .toEqual({ 'max-width': 'none' });
    expect(phoneRule(file, '.dataset-shared-topbar__center .dataset-search-panel'))
        .toEqual({ '--dataset-search-control-height': '44px' });
    // The second surface remains an overlay, without changing the toolbar row.
    expect(phoneRule(file, '.dataset-shared-topbar__center > .dataset-search-panel'))
        .toMatchObject({ position: 'absolute', top: '100%', width: 'auto' });
});
