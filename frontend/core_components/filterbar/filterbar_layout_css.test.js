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
