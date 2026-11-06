// @vitest-environment node
// phone_navigation_css.test.js
// Pins phone Home exclusion, toolbar and hero spacing against the shipped CSS cascade.
// Connects the responsive overrides to unchanged tablet/desktop source rules.
// Native browser geometry remains covered by G11/G13 and E15/E19.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { requireNodeDependency } from '../../../server_tools/lib/node_dependency_loader.mjs';

const postcss = requireNodeDependency('postcss');
const baseline = {
    'front_page.css': 'b832974c3b27a5e7972d9762869bc8d6df7168626ab6ae9966d05ed27cfbd542',
    'top_nav_home_button.css': '370d13d5d63468cd1e8e03d637d3290e4375a7ef0654a41ba43b815ca207566b',
    '../filterbar/shared_topbar.css': '7df8d0d19b2b7c03bd899204e225275384a2c137285bd9ef13ae013e280306a2',
    '../filterbar/morphing_filterbar_content.css': '914f86240ec27901629286c4743b81928390c06e2e7dd89b0245b9b0be30a3e8',
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

function rulesAtWidth(file, selector, width) {
    const declarations = {};
    sheets[file].walkRules(rule => {
        if (rule.selector !== selector) return;
        if (rule.parent.type === 'atrule') {
            const breakpoint = /^\(width <= (\d+)px\)$/.exec(rule.parent.params);
            if (!breakpoint || width > Number(breakpoint[1])) return;
        }
        rule.walkDecls(({ prop, value }) => { declarations[prop] = value; });
    });
    return declarations;
}

// Batch 512 (63b9b250) retains the non-phone baseline from d373e6c6; K465 updates only the hero's shared radius;
// WO95 re-pins Home for its desktop-only inset edge; every phone rule stays unchanged.
// Batch 569 re-pins only the topbar/hero colour mixes to use their solid companion.
// WO96 removes only Home's shared-bar order:10; original hosts, sizing and phone tracks stay pinned.
// WO98 re-pins Home only: shared box/hero/bottom spacing changes outside the phone breakpoint.
// WO107/K528 re-pins only Home's approved side margins and auto width; centre and phone layout stay unchanged.
// WO111/K533 re-pins only the top bar's name-first columns and the measured button mode's search over the name.
// WO129 changes only phone bar geometry; drawer lock, focus clearance and hero anchoring retain their contracts.
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

test('Home has no phone-only button or label rules after its top-bar exclusion', () => {
    const media = sheets['top_nav_home_button.css'].nodes.filter(node => node.type === 'atrule' && node.name === 'media');
    expect(media).toEqual([]);
});

// WO129 removes the obsolete <=480px phone inset block; rules above 700px retain their hash.
test('phone toolbar reserves edge-to-edge menu, identity and search/panel tracks', () => {
    expect(phoneRule('top_nav_home_button.css', '.dataset-shared-topbar__inner:has(.top-nav-home-button)'))
        .toEqual({});
    const file = '../filterbar/shared_topbar.css';
    expect(phoneRule(file, '.dataset-shared-topbar__inner')['grid-template-columns'])
        .toBe('52px minmax(0, 1fr) 96px');
    expect(phoneRule(file, '.dataset-shared-topbar__slot--start')).toEqual({ gap: '0' });
    expect(phoneRule(file, '.dataset-shared-topbar .dataset-shared-topbar__menu-slot')).toEqual({
        flex: '0 0 52px', width: '52px', 'max-width': '52px', height: '47px',
        'margin-inline-start': '0', 'clip-path': 'none', transition: 'none',
    });
    expect(phoneRule(file, '.dataset-shared-topbar .dataset-shared-topbar__menu-slot > .dataset-shared-topbar__menu-button'))
        .toEqual({ left: '0', 'flex-basis': '52px', width: '52px', height: '47px', border: '0',
            'border-radius': '0', 'box-shadow': 'none', background: 'transparent' });
});

test.each([320, 390, 479, 480, 481, 699, 700])('at %ipx the bar is 48px tall and the menu fills its 52px cell', width => {
    const file = '../filterbar/shared_topbar.css';
    const bar = rulesAtWidth(file, '.dataset-shared-topbar', width);
    const inner = rulesAtWidth(file, '.dataset-shared-topbar__inner', width);
    expect(inner['grid-template-columns']).toBe('52px minmax(0, 1fr) 96px');
    expect(bar.height).toBe('48px');
    expect(bar.padding).toBe('0');
    expect(bar['--dataset-shared-topbar-padding-inline']).toBe('0px');
    expect(inner['grid-template-rows']).toBe('47px');
    expect(inner.gap).toBe('0');
});

test('phone hero has small title/search-area gaps and stretches its tools box to the screen edges', () => {
    const file = '../filterbar/morphing_filterbar_content.css';
    expect(phoneRule(file, '.filterbar-inline-hero > .filter-content-inner')).toEqual({ width: '100%', 'max-width': 'none', margin: '0', gap: '8px' });
    expect(phoneRule(file, '.filterbar-inline-hero .morphing-header')).toEqual({ margin: '0' });
    // A block icon: as .metadata-symbol-icon's inline-block its line box added ~7px under the margin (d515, 15px gap).
    expect(phoneRule(file, '.filterbar-inline-hero .filterbar-hero-dataset-icon')).toEqual({ display: 'block', 'margin-bottom': '8px' });
    expect(phoneRule(file, '.filterbar-inline-hero .morphing-title')).toEqual({ margin: '0 0 4px' });
    expect(phoneRule(file, '.filterbar-inline-hero .morphing-subtitle')).toEqual({ margin: '0' });
    expect(phoneRule(file, '.filterbar-inline-hero .filter-content-inner > .dataset-filter-section')).toEqual({
        'align-self': 'stretch', width: 'auto', margin: '0',
        'margin-inline': 'calc(-1 * var(--filterbar-hero-inline-space))', 'max-width': 'none',
        'border-inline-width': '0', 'border-radius': '0', 'padding-inline': '16px',
    });
});

test('phone hero and chips share 16px edges while tabs retain their additional 4px margin', () => {
    const file = '../filterbar/morphing_filterbar_content.css';
    const selector = '.filterbar-inline-hero,\n  .filterbar-inline-hero ~ .dataset-results-surface > .card_top_controls';
    expect(phoneRule(file, selector)).toEqual({ '--filterbar-hero-inline-space': '16px' });
    expect(phoneRule(file, '.filterbar-inline-hero__top-row')['margin-inline']).toBe('4px');
    for (const [query, inset] of [['(width <= 768px)', '12px'], ['(width <= 480px)', '8px']]) {
        const values = [];
        sheets[file].walkAtRules('media', media => {
            if (media.params !== query) return;
            media.walkRules(rule => {
                if (rule.selector === selector) rule.walkDecls('--filterbar-hero-inline-space', declaration => values.push(declaration.value));
            });
        });
        expect(values).toEqual([inset]);
    }
});

test('phone hero search retains its full width and 44px controls while the toolbar fills its 47px row', () => {
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
        .toEqual({ '--dataset-search-control-height': '47px' });
    // WO111/K533: the second surface opens in the bar's own row over the identity, so no overlay offset or frame remains.
    expect(phoneRule(file, '.dataset-shared-topbar__center > .dataset-search-panel'))
        .toEqual({ width: '100%', 'max-width': 'none' });
});
