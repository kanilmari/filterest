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

    test('keeps the navbar inset edge painted throughout the collapsed state', () => {
        const css = readFileSync(resolve(CURRENT_DIR, 'navbar_layout.css'), 'utf8');
        const collapsedRule = css.match(/#navbar\.collapsed\s*\{([^}]*)\}/)?.[1] || '';
        const completedRule = css.match(
            /#navbar\.collapsed\.navbar-collapse-complete\s*\{([^}]*)\}/
        )?.[1] || '';

        expect(collapsedRule).toContain('box-shadow: inset -2px 0 0 0 var(--border_color);');
        expect(completedRule).toContain('box-shadow: inset -2px 0 0 0 var(--border_color);');
    });

    test('aligns rectangular tab-button borders with the navbar edge', () => {
        const css = readFileSync(resolve(CURRENT_DIR, '../main_tabs/tabs.css'), 'utf8');
        const buttonRule = css.match(
            /#navbar #navmenu \.navtablinks\[data-tab-presentation\^="button"\]\s*\{([^}]*)\}/
        )?.[1] || '';

        expect(buttonRule).toContain('box-sizing: border-box;');
        expect(buttonRule).toContain('width: 100%;');
        expect(buttonRule).toContain('border-right: 2px solid var(--border_color);');
    });
});
