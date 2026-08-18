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

    test('derives admin and database-tree contrast from the active theme', () => {
        const css = [
            readFileSync(resolve(CURRENT_DIR, 'navbar_layout.css'), 'utf8'),
            readFileSync(resolve(CURRENT_DIR, 'navbar_theme_contrast.css'), 'utf8'),
        ].join('\n');

        expect(css).toContain('--admin-tree-accent: color-mix(in srgb, var(--text_color)');
        expect(css).toContain('--admin-tree-surface: color-mix(in srgb, var(--bg_color_extreme)');
        expect(css).toContain('--database-tree-leaf-surface: color-mix(in srgb, var(--bg_color_extreme)');
        expect(css).toContain('#navbar #nav_tree .general_button_nav {');
        expect(css).toContain('background-color: var(--database-tree-leaf-surface);');
        expect(css).toContain('border: 1px solid var(--database-tree-leaf-border);');
        expect(css).toContain('#navbar #nav_tree .general_button_nav:hover {');
        expect(css).toContain('body.light-mode #navbar {');
        expect(css).toContain('--navbar-structural-border: color-mix(in srgb, var(--border_color) 62%, var(--text_color) 38%);');
        expect(css).toContain('border-block: 2px solid var(--navbar-structural-border);');
        expect(css).toContain('color: var(--admin-tree-accent);');
        expect(css).toContain('color: var(--text_color);');
        expect(css).not.toContain('color: rgb(180 170 220);');
    });
});
