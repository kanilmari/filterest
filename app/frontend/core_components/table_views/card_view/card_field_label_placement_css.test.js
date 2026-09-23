// card_field_label_placement_css.test.js
// Guards the two load-bearing rules of the card field-name placement stylesheet.
// Connects the placement the card renderer resolves with the bundle's load order.
// Exists because the inline arrangement only wins if this sheet loads after the
// legacy card rules, and because the colon must never become translatable text.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(CURRENT_DIR, 'card_field_label_placement.css');
const IMPORTS_PATH = resolve(CURRENT_DIR, '../../../styles/imports.css');

describe('card field label placement CSS', () => {
    test('draws the colon from style, not from the translated element', () => {
        const css = readFileSync(CSS_PATH, 'utf8');

        expect(css).toContain('.key_value_wrapper[data-card-label-placement="inline"] > .kv_label::after');
        expect(css).toContain('content: ":"');
    });

    test('loads after the legacy card rules it has to outrank', () => {
        const imports = readFileSync(IMPORTS_PATH, 'utf8');

        expect(imports.indexOf('card_field_label_placement.css'))
            .toBeGreaterThan(imports.indexOf('card_view/cards.css'));
    });
});
