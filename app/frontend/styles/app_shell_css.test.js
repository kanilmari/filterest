// @vitest-environment node
// app_shell_css.test.js
// Verifies the ultra-wide application shell and its permanent backdrop contract.

import { describe, expect, test } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

describe('application shell CSS', () => {
    test('uses the extreme theme background behind the complete app surface', () => {
        const css = readFileSync(resolve(CURRENT_DIR, 'base.css'), 'utf8');
        const wrapperRule = css.match(/\.body_wrapper\s*\{([^}]*)\}/)?.[1] || '';

        expect(wrapperRule).toContain('min-height: 100vh;');
        expect(wrapperRule).toContain('background-color: var(--bg_color_extreme);');
    });

    test('adds one complete border only after the fixed-width shell leaves spare space', () => {
        const css = readFileSync(resolve(CURRENT_DIR, 'base.css'), 'utf8');
        const ordinaryRule = css.match(/\.body_content\s*\{([^}]*)\}/)?.[1] || '';
        const wideRule = css.match(
            /@media \(width >= 2562px\)\s*\{\s*\.body_content\s*\{([^}]*)\}/
        )?.[1] || '';

        expect(wideRule).toContain('border: 1px solid var(--border_color);');
        expect(ordinaryRule).not.toContain('border: 1px solid var(--border_color);');
    });
});
