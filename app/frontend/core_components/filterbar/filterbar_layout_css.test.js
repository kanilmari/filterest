// @vitest-environment node
// filterbar_layout_css.test.js
// Verifies stylesheet-only contracts owned by the main filterbar layout.
// Exists to catch visual regressions that do not require jsdom behavior.

import { describe, expect, test } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

function readSiblingCss(filename) {
    return readFileSync(resolve(CURRENT_DIR, filename), 'utf8');
}

function extractRule(css, selector) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|\\n)${escapedSelector}\\s*\\{`).exec(css);
    const startIndex = match?.index ?? -1;
    expect(startIndex, `Missing CSS rule for ${selector}`).toBeGreaterThanOrEqual(0);
    const bodyStart = startIndex + (match?.[0].length ?? 0);
    const bodyEnd = css.indexOf('}', bodyStart);
    expect(bodyEnd, `Missing CSS rule end for ${selector}`).toBeGreaterThan(bodyStart);
    return css.slice(bodyStart, bodyEnd);
}

describe('filterbar layout CSS', () => {
    test('gives the style disclosure full width and bounds its preferences fieldset', () => {
        const css = readSiblingCss('filterbar_layout.css');
        const marginSelector = css.match(/\.filterbar-panel-body > :not\(([^)]+)\)/)[1];
        expect(marginSelector.split(', ')).toContain('.filterbar-style-section');
        const fullWidth = extractRule(css, '.filterbar-panel-body > .filterbar-style-section,\n.filterbar-panel-body > .column-preset-row,\n.filterbar-panel-body > .favefox-filterbar-wrapper');
        expect(fullWidth).toContain('width: 100%');
        expect(fullWidth).toContain('box-sizing: border-box');
        const preferences = extractRule(css, '.filterbar-preference-controls');
        for (const declaration of ['box-sizing: border-box', 'min-width: 0', 'width: 100%', 'margin: 0']) {
            expect(preferences).toContain(declaration);
        }
    });
    test('uses the shared SVG info control with a click disclosure panel', () => {
        const css = readSiblingCss('../admin_tools/admin_version_info_indicator.css');
        const shellRule = extractRule(css, '.filterbar-clock-bar__version-info-shell');
        const indicatorRule = extractRule(css, '.filterbar-clock-bar__version-info');
        const iconRule = extractRule(css, '.filterbar-clock-bar__version-info-icon');
        const panelRule = extractRule(css, '.filterbar-clock-bar__version-info-panel');
        const keyRule = extractRule(css, '.filterbar-clock-bar__version-info-key');

        expect(shellRule).toContain('right: 8px');
        expect(shellRule).toContain('transform: translateY(-50%)');
        expect(indicatorRule).toContain('width: 18px');
        expect(indicatorRule).toContain('height: 18px');
        expect(indicatorRule).toContain('border: 0');
        expect(iconRule).toContain('pointer-events: none');
        expect(panelRule).toContain('position: fixed');
        expect(panelRule).toContain('z-index: calc(var(--z-modal, 101000) + 10)');
        expect(panelRule).not.toContain('bottom:');
        expect(panelRule).not.toContain('right:');
        expect(panelRule).toContain('border-collapse: separate');
        expect(panelRule).toContain('border-spacing: 0 2px');
        expect(keyRule).toContain('padding: 0 19px 0 0');
    });
});
