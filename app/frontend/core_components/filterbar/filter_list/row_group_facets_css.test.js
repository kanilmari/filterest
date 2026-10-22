// row_group_facets_css.test.js
// Verifies compact category headers and hidden settings in the real shared CSS cascade.
// Connects category-owned controls with the portalled multiselect's layout and theme variables.
// Catches display rules that accidentally reveal unavailable settings or move header actions.
// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(resolve(directory, 'row_group_facets.css'), 'utf8')
    + readFileSync(resolve(directory, '../../../reusable_components/multiselect_dropdown/multiselect_dropdown.css'), 'utf8');
afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren(); document.body.className = ''; });

test.each(['light-mode', 'dark-mode'])('headers centre their controls and settings stay hidden in %s', theme => {
    document.body.className = theme;
    const style = document.createElement('style'); style.textContent = styles; document.head.append(style);
    document.body.innerHTML = `<div class="msd-dropdown-list msd-dropdown-list--rich">
        <div class="msd-popup-header"><h3>Tarjouksen ehto</h3>
            <button class="msd-popup-settings-toggle" hidden>Asetukset</button><button class="msd-popup-close">×</button></div>
        <div class="msd-popup-settings" hidden><div class="msd-popup-settings-header">
            <h4 class="row-group-facet-mode__legend">Kun valitset useita</h4>
            <button class="row-group-facet-mode__help-button">?</button><button class="msd-popup-settings-close">×</button>
        </div></div><div class="msd-popup-resize" tabindex="0"></div></div>`;
    for (const header of document.querySelectorAll('.msd-popup-header, .msd-popup-settings-header')) {
        expect(getComputedStyle(header).display).toBe('flex');
        expect(getComputedStyle(header).alignItems).toBe('center');
    }
    const gear = document.querySelector('.msd-popup-settings-toggle');
    expect(getComputedStyle(gear).display).toBe('none');
    expect(getComputedStyle(document.querySelector('.msd-popup-settings')).display).toBe('none');
    gear.hidden = false;
    expect(getComputedStyle(gear).display).toBe('grid');
    for (const close of document.querySelectorAll('.msd-popup-close, .msd-popup-settings-close')) {
        expect(getComputedStyle(close).minHeight).toBe('44px');
    }
    expect(getComputedStyle(document.querySelector('.row-group-facet-mode__help-button')).position).not.toBe('absolute');
    expect(getComputedStyle(document.querySelector('.msd-popup-resize')).touchAction).toBe('none');
});

test('settings scroll independently and the resize grip uses theme colours', () => {
    expect(styles).toMatch(/\.msd-dropdown-list--rich \.msd-popup-settings\s*\{[^}]*overflow-y: auto/s);
    expect(styles).toMatch(/\.msd-popup-resize::after\s*\{[^}]*border-block: 1px solid currentcolor/s);
    expect(styles).not.toContain('prefers-color-scheme');
});
