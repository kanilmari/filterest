// @vitest-environment jsdom
// Checks translated controls, explicit booleans and the draft-only interaction boundary.
import { afterEach, expect, test, vi } from 'vitest';
import { buildDisclosureDefaultControls, getDisclosurePaletteCopy } from './disclosure_palette_controls.js';
afterEach(() => { document.documentElement.lang = ''; });

test.each(['fi', 'en', 'zh-CN', 'zh-TW', 'zh-HK'])('all disclosure controls have copy in %s', lang => {
    document.documentElement.lang = lang;
    const parent = document.createElement('div'), rows = [];
    const change = vi.fn();
    buildDisclosureDefaultControls(parent, (control, key, target) => {
        rows.push({ control, key }); control.setCopy(); control.setValue(false); target.append(control.element);
    }, change);
    expect(rows).toHaveLength(15);
    expect(parent.querySelectorAll('input:checked')).toHaveLength(0);
    for (const { control } of rows) {
        expect(control.element.textContent).not.toMatch(/undefined|null/);
        expect(control.element.textContent.length).toBeGreaterThan(5);
        if (lang !== 'en') expect(control.element.textContent).not.toContain('Initially open');
    }
    const { control, key } = rows.find(row => row.key === 'article_view_details_initial_open');
    const input = control.element.querySelector('input');
    control.setValue(true); expect(input.checked).toBe(true);
    expect(change).not.toHaveBeenCalled();
    input.checked = false; input.dispatchEvent(new Event('change'));
    expect(change).toHaveBeenCalledExactlyOnceWith(key, false);
    expect(getDisclosurePaletteCopy().hint).toBeTruthy();
});
