// @vitest-environment node
// table_grid_css.test.js
// Verifies table-grid CSS keeps sticky headers bordered without shadow hacks.
// Bridges table view CSS source and regression tests for scroll-stable grid lines.
// Exists to prevent collapsed sticky header borders from disappearing while scrolling.

import { describe, expect, test } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

function readCss(relativePath) {
    return readFileSync(resolve(CURRENT_DIR, relativePath), 'utf8');
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

describe('table view grid CSS', () => {
    test('uses separate borders so sticky header borders remain visible while scrolling', () => {
        const tablesCss = readCss('tables.css');
        const tableRule = extractRule(tablesCss, '.table_from_db');
        const cellRule = extractRule(tablesCss, '.table_from_db th,\n.table_from_db td');
        const headerRule = extractRule(tablesCss, '.table_from_db th');
        const stickyHeaderRule = extractRule(tablesCss, '.table_from_db thead tr:first-child th');
        const cellsCss = readCss('cells.css');
        const dataCellRule = extractRule(cellsCss, '.table_from_db td');

        expect(tableRule).toContain('border-collapse: separate');
        expect(tableRule).toContain('border-spacing: 0');
        expect(tableRule).toContain('--table-grid-border-color: var(--table_border_color)');
        expect(cellRule).toContain('border: 0');
        expect(cellRule).toContain('border-right: var(--table-body-grid-border-width) solid var(--table-grid-border-color)');
        expect(cellRule).toContain('border-bottom: var(--table-body-grid-border-width) solid var(--table-grid-border-color)');
        expect(headerRule).toContain('background-color: var(--bg_color)');
        expect(headerRule).toContain('border-right-width: var(--table-header-grid-border-width)');
        expect(headerRule).toContain('border-bottom-width: var(--table-header-grid-border-width)');
        expect(stickyHeaderRule).toContain('top: 0');
        expect(stickyHeaderRule).not.toContain('top: -1px');
        expect(dataCellRule).toContain('border-color: var(--table-grid-border-color, var(--table_border_color))');
        expect(dataCellRule).not.toContain('bg_color_blended');
        expect(dataCellRule).not.toContain('box-shadow');
    });

    test('keeps the legacy table header border direct instead of shadow-based', () => {
        const sharedCss = readCss('../table_views.css');
        const rowRule = extractRule(sharedCss, '.row');
        const headerRule = extractRule(sharedCss, '.header');

        expect(rowRule).toContain('box-shadow: none');
        expect(headerRule).toContain('border-bottom: 2px solid var(--table_border_color)');
        expect(headerRule).toContain('box-shadow: none');
        expect(headerRule).not.toContain('color-mix');
        expect(headerRule).not.toContain('inset');
    });
});
