// @vitest-environment node
// filterbar_layout_css.test.js
// Verifies CSS contracts for the shared dataset topbar layout.
// Bridges filterbar DOM classes and stylesheet-only sizing guarantees.
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

describe('shared topbar layout CSS', () => {
    test('caps the search-only field at 600px inside the shared topbar', () => {
        const css = readSiblingCss('filterbar_layout.css');
        const topbarRule = extractRule(css, '.dataset-shared-topbar');
        const searchRule = extractRule(css, '.dataset-shared-topbar__center > .dataset-search-panel');

        expect(topbarRule).toContain('--filterbar-search-only-max-width: 600px');
        expect(searchRule).toContain('max-width: var(--filterbar-search-only-max-width, 600px)');
    });

    test('moves the article close button left of the exposed filterbar toggle', () => {
        const css = readSiblingCss('filterbar_layout.css');
        const closeOffsetRule = extractRule(
            css,
            '.tab_parts_container:has(.filterbar-fixed-toggle--exposed) .dataset-shared-topbar__article-close:not([hidden])'
        );

        expect(closeOffsetRule).toContain('margin-right: 52px');
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
        expect(panelRule).toContain('bottom: calc(100% + 8px)');
        expect(panelRule).toContain('border-collapse: separate');
        expect(panelRule).toContain('border-spacing: 0 2px');
        expect(keyRule).toContain('padding: 0 19px 0 0');
    });
});
