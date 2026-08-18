// @vitest-environment node
// shared_topbar_css.test.js
// Verifies stylesheet-only contracts for the shared dataset topbar.
// Exists to catch sizing and ownership regressions without a browser runtime.

import { describe, expect, test } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

function readSharedTopbarCss() {
    return readFileSync(resolve(CURRENT_DIR, 'shared_topbar.css'), 'utf8');
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

describe('shared topbar CSS', () => {
    test('caps the search-only field at 600px inside the shared topbar', () => {
        const css = readSharedTopbarCss();
        const topbarRule = extractRule(css, '.dataset-shared-topbar');
        const searchRule = extractRule(css, '.dataset-shared-topbar__center > .dataset-search-panel');

        expect(topbarRule).toContain('--filterbar-search-only-max-width: 600px');
        expect(searchRule).toContain('max-width: var(--filterbar-search-only-max-width, 600px)');
    });

    test('matches the navbar top-row divider without changing collapse geometry', () => {
        const css = readSharedTopbarCss();
        const topbarRule = extractRule(css, '.dataset-shared-topbar');
        const visibleRule = extractRule(css, '.dataset-shared-topbar--visible');

        expect(topbarRule).toContain('border-bottom: 2px solid transparent');
        expect(visibleRule).toContain('border-bottom-color: var(--border_color)');
        expect(visibleRule).not.toContain('var(--filter_panel_border)');
    });

    test('moves the article close button left of the exposed filterbar toggle', () => {
        const css = readSharedTopbarCss();
        const closeOffsetRule = extractRule(
            css,
            '.tab_parts_container:has(.filterbar-fixed-toggle--exposed) .dataset-shared-topbar__article-close:not([hidden])'
        );

        expect(closeOffsetRule).toContain('margin-right: 52px');
    });

    test('reveals the menu control through synchronized width and opacity transitions', () => {
        const css = readSharedTopbarCss();
        const hiddenSlotRule = extractRule(css, '.dataset-shared-topbar__menu-slot');
        const visibleSlotRule = extractRule(css, '.dataset-shared-topbar__menu-slot--visible');

        expect(hiddenSlotRule).toContain('width: 0');
        expect(hiddenSlotRule).toContain('opacity: 0');
        expect(hiddenSlotRule).toContain('clip-path: inset(-8px 0 -8px 0)');
        expect(hiddenSlotRule).toContain('opacity 260ms cubic-bezier(0.4, 0, 0.2, 1)');
        expect(visibleSlotRule).toContain('width: 52px');
        expect(visibleSlotRule).toContain('opacity: 1');
        expect(visibleSlotRule).toContain('opacity 260ms cubic-bezier(0.4, 0, 0.2, 1)');
    });
});
