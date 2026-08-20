// @vitest-environment node
// navbar_layout_css.test.js
// Verifies stylesheet-only contracts for the fixed navbar shell.

import { describe, expect, test } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

describe('navbar layout CSS', () => {
    test('keeps the opening top row neutral except for its menu button', () => {
        const css = readFileSync(resolve(CURRENT_DIR, 'navbar_layout.css'), 'utf8');

        expect(css).toContain('#navbar.navbar-opening .top-button-bar,');
        expect(css).toContain('#navbar.navbar-opening .top-button-bar * {');
        expect(css).toContain('cursor: default !important;');
        expect(css).toContain('#navbar.navbar-opening #hideMenuButton,');
        expect(css).toContain('#navbar.navbar-opening #hideMenuButton * {');
        expect(css).toContain('cursor: pointer !important;');
        expect(css).not.toContain('#navbar:not(.collapsed) .top-button-bar *');
    });

    test('keeps a dedicated sticky top-row edge above scrolling dataset tabs', () => {
        const css = readFileSync(resolve(CURRENT_DIR, 'navbar_layout.css'), 'utf8');
        const topBarRule = css.match(/\.top-button-bar\s*\{([^}]*)\}/)?.[1] || '';

        expect(topBarRule).toContain('position: sticky;');
        expect(topBarRule).toContain('border-right: 2px solid var(--border_color);');
        expect(topBarRule).toContain('margin-right: 0;');
    });
});
