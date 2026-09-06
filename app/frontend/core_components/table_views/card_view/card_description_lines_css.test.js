// Guards the site-wide card-description row limit and its load order.
// Connects the semantic theme default, card override, and central stylesheet bundle.
// Exists so legacy card CSS cannot silently restore a fixed two-row description.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(CURRENT_DIR, 'card_description_lines.css');
const IMPORTS_PATH = resolve(CURRENT_DIR, '../../../styles/imports.css');
const VARIABLES_PATH = resolve(CURRENT_DIR, '../../../styles/variables.css');

describe('card description line count CSS', () => {
    test('uses one semantic row-count variable and retains ellipsis', () => {
        const css = readFileSync(CSS_PATH, 'utf8');

        expect(css).toContain('-webkit-line-clamp: var(--card-description-lines, 2)');
        expect(css).toContain('line-clamp: var(--card-description-lines, 2)');
        expect(css).toContain('max-height: calc(1.5em * var(--card-description-lines, 2))');
        expect(css).toContain('text-overflow: ellipsis');
    });

    test('loads after legacy card variants and has a source default', () => {
        const imports = readFileSync(IMPORTS_PATH, 'utf8');
        const variables = readFileSync(VARIABLES_PATH, 'utf8');

        expect(imports.indexOf('card_description_lines.css'))
            .toBeGreaterThan(imports.indexOf('card_view/cards.css'));
        expect(variables).toContain('--card-description-lines: 2');
    });
});
